const test=require('node:test'),assert=require('node:assert/strict')
const {startProxy,sse,writeChunk}=require('../electron/provider-proxy.cjs')
const {fetchWithRetry}=require('../electron/gateway-retry.cjs')
const {upstreamHint}=require('../electron/provider-errors.cjs')
const quick={baseDelayMs:0,maxDelayMs:0,maxRetries:2}
const packet=event=>'data: '+JSON.stringify(event)+'\n\n'
const stream=(text)=>new Response(text,{headers:{'content-type':'text/event-stream'}})
const success=protocol=>protocol==='anthropic'?stream(packet({type:'message_start',message:{id:'m',type:'message',role:'assistant',content:[],usage:{input_tokens:1,output_tokens:0}}})+packet({type:'content_block_start',index:0,content_block:{type:'text',text:''}})+packet({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Recovered'}})+packet({type:'content_block_stop',index:0})+packet({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:1}})+packet({type:'message_stop'})):protocol==='chat'?stream(packet({choices:[{delta:{role:'assistant'}}]})+packet({choices:[{delta:{content:'Recovered'},finish_reason:'stop'}]})):stream(packet({type:'response.created',response:{id:'r'}})+packet({type:'response.output_text.delta',item_id:'m',delta:'Recovered'})+packet({type:'response.completed',response:{usage:{input_tokens:1,output_tokens:1}}}))
const call=(proxy,signal)=>fetch(proxy.url+'/v1/messages',{method:'POST',headers:{'x-api-key':proxy.token},body:JSON.stringify({messages:[{role:'user',content:'hello'}],max_tokens:20,stream:true}),signal})
test('HTTP 200 overloaded/rate-limit errors before any output are retried across all protocols without duplicate starts',async t=>{
  for(const protocol of ['anthropic','chat','responses']){
    let calls=0;const events=[]
    const proxy=await startProxy({protocol,model:'fixture',baseUrl:'http://fixture',models:[]},{},async()=>{calls++;return calls===1?stream(': heartbeat\n\n'+packet(protocol==='responses'?{type:'response.failed',response:{error:{type:'server_error',message:'raw upstream busy'}}}:{type:'error',error:{type:'overloaded_error',message:'raw upstream busy'}})):success(protocol)},{retryPolicy:quick,onRetry:e=>events.push(e)})
    t.after(()=>proxy.close());const response=await call(proxy),output=await response.text();assert.equal(calls,2);assert.match(output,/Recovered/);assert.equal((output.match(/event: message_start/g)||[]).length,protocol==='anthropic'?0:1)
    const waiting=events.find(e=>e.phase==='waiting');assert.equal(waiting.reason,'upstream');assert.equal(waiting.status,undefined,'Mapped internal status must not be presented as an actual HTTP status')
  }
})
test('heartbeat-only stalls time out and recover; the UI retains a deadline while waiting for the next attempt',async t=>{
  for(const protocol of ['chat','anthropic','responses']){
  let calls=0,cancelled=0;const events=[]
  const metadata=protocol==='anthropic'?packet({type:'message_start',message:{id:'m'}})+packet({type:'content_block_start',index:0,content_block:{type:'text',text:''}}):protocol==='responses'?packet({type:'response.output_text.delta',delta:''}):packet({choices:[{delta:{role:'assistant'}}]})
  const proxy=await startProxy({protocol,model:'fixture',baseUrl:'http://fixture',timeout:60,models:[]},{},async()=>++calls===1?new Response(new ReadableStream({start(c){c.enqueue(Buffer.from(metadata+': ping\n\n'))},cancel(){cancelled++}}),{headers:{'content-type':'text/event-stream'}}):success(protocol),{retryPolicy:{...quick,noticeDelayMs:5},onRetry:e=>events.push(e)})
  t.after(()=>proxy.close());const response=await call(proxy);assert.match(await response.text(),/Recovered/);assert.equal(calls,2);assert(cancelled>0)
  assert(events.some(e=>e.phase==='requesting'&&e.timeoutAt>e.startedAt));assert(events.some(e=>e.phase==='waiting'&&e.reason==='timeout'));assert(events.some(e=>e.phase==='attempting'&&e.timeoutAt>e.startedAt));assert.equal(events.at(-1).phase,'cleared')
  }
})
test('initial body socket failures and invalid/empty responses retry, while a delivered text/tool stream never replays',async t=>{
  for(const first of [()=>new Response(new ReadableStream({start(c){c.error(new TypeError('terminated',{cause:{code:'UND_ERR_BODY_TIMEOUT'}}))}}),{headers:{'content-type':'text/event-stream'}}),()=>stream(''),()=>stream('data: broken json\n\n')]){
    let calls=0;const proxy=await startProxy({protocol:'chat',model:'fixture',baseUrl:'http://fixture',models:[]},{},async()=>++calls===1?first():success('chat'),{retryPolicy:quick});t.after(()=>proxy.close());assert.match(await(await call(proxy)).text(),/Recovered/);assert.equal(calls,2)
  }
  for(const delta of [{content:'already delivered'},{tool_calls:[{index:0,id:'tool-1',function:{name:'Write',arguments:'{}'}}]}]){
    let calls=0;const proxy=await startProxy({protocol:'chat',model:'fixture',baseUrl:'http://fixture',key:'PRIVATE_KEY',models:[]},{},async()=>{calls++;return stream(packet({choices:[{delta}]})+packet({error:{type:'server_error',message:'raw stream failure PRIVATE_KEY'}}))},{retryPolicy:quick});t.after(()=>proxy.close());const output=await(await call(proxy)).text();assert.equal(calls,1);assert.match(output,/raw stream failure \[REDACTED\]/);assert(!output.includes('PRIVATE_KEY'))
  }
})
test('JSON error envelopes returned with HTTP 200 honor permanent errors, retries, original wording and opt-out',async t=>{
  for(const [error,expected] of [[{type:'rate_limit_error',message:'raw rate limit'},3],[{type:'invalid_request_error',message:'raw invalid input'},1]]){
    let calls=0;const proxy=await startProxy({protocol:'chat',model:'fixture',baseUrl:'http://fixture',models:[]},{},async()=>{calls++;return Response.json({error})},{retryPolicy:quick});t.after(()=>proxy.close());const response=await call(proxy),data=await response.json();assert.equal(calls,expected);assert.equal(data.error.message,error.message)
  }
  let calls=0;const proxy=await startProxy({protocol:'chat',model:'fixture',baseUrl:'http://fixture',models:[]},{},async()=>{calls++;return stream(packet({error:{type:'overloaded_error',message:'no retry'}}))},{retryPolicy:{...quick,maxRetries:0}});t.after(()=>proxy.close());const exhausted=await call(proxy);assert.equal(exhausted.status,502);assert.equal((await exhausted.json()).error.source,'upstream_body');assert.equal(calls,1)
})
test('reading a never-ending error body is bounded and retry cancellation cannot hang on body disposal',async()=>{
  const response=new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('{"error":'))}}),{status:503})
  const start=Date.now();assert.equal(await upstreamHint(response,[],{timeoutMs:20}),'');assert(Date.now()-start<500);void response.body.cancel()
  let calls=0;const result=await fetchWithRetry(async()=>++calls===1?new Response(new ReadableStream({cancel(){return new Promise(()=>{})}}),{status:503}):Response.json({ok:true}),'http://fixture',{}, {policy:quick});assert.equal(calls,2);result.release()
})
test('stop during the first heartbeat-only response cancels immediately without starting another attempt',async t=>{
  const controller=new AbortController();let calls=0,cancelled=0,started
  const ready=new Promise(resolve=>started=resolve)
  const proxy=await startProxy({protocol:'chat',model:'fixture',baseUrl:'http://fixture',timeout:2000,models:[]},{},async()=>{calls++;started();return new Response(new ReadableStream({start(c){c.enqueue(Buffer.from(': waiting\n\n'))},cancel(){cancelled++}}),{headers:{'content-type':'text/event-stream'}})},{retryPolicy:quick});t.after(()=>proxy.close())
  const pending=call(proxy,controller.signal);await ready;controller.abort();await assert.rejects(pending,/abort/i);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(calls,1);assert(cancelled>0)
})
test('a downstream closed during backpressure cannot leave the proxy waiting forever for drain',async()=>{
  const {EventEmitter}=require('node:events'),res=new EventEmitter(),controller=new AbortController();res.write=()=>false
  const pending=writeChunk(res,Buffer.from('chunk'),controller.signal);controller.abort();await assert.rejects(pending,/abort/i)
  assert.equal(res.listenerCount('drain'),0);assert.equal(res.listenerCount('close'),0)
})
test('a complete final SSE JSON event is preserved even when the upstream omits the final blank separator',async()=>{
  const values=[];for await(const event of sse(new Response('data: {"type":"message_stop"}').body))values.push(event)
  assert.deepEqual(values,[{type:'message_stop'}])
})
