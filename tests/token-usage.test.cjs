const test=require('node:test')
const assert=require('node:assert/strict')
const {normalizeUsage,stats,sessionUsage,normalizeContext,contextKey}=require('../electron/token-usage.cjs')
const {TurnAccumulator}=require('../electron/stream.cjs')
const {startProxy,sse}=require('../electron/provider-proxy.cjs')

test('protocol cache accounting counts inclusive Chat/Responses input exactly once; missing differs from zero',()=>{
  for(const [protocol,raw] of [['chat',{prompt_tokens:100,completion_tokens:8,prompt_tokens_details:{cached_tokens:80}}],['responses',{input_tokens:100,output_tokens:8,input_tokens_details:{cached_tokens:80}}],['anthropic',{input_tokens:20,output_tokens:8,cache_read_input_tokens:80,cache_creation_input_tokens:0}]]){
    const value=stats(normalizeUsage(raw,protocol));assert.equal(value.input,100);assert.equal(value.total,108);assert.equal(value.cacheRate,80)
  }
  assert.equal(stats(normalizeUsage({prompt_tokens:100},'chat')).cacheRate,null)
  assert.equal(stats(normalizeUsage({prompt_tokens:100,prompt_tokens_details:{cached_tokens:0}},'chat')).cacheRate,0)
  assert.equal(stats({input_tokens:10,cache_read_input_tokens:0},false).cacheRead,null)
  assert.equal(stats().input,null)
  assert.deepEqual(normalizeUsage({input_tokens:-1,output_tokens:Infinity}),{})
})

test('branch totals weight cache rate; context only uses CLI reports and rejects stale reports',()=>{
  const session={model:'m',nativeId:'native',messages:[{id:'a',role:'assistant',status:'done',usage:{input_tokens:20,cache_read_input_tokens:80,output_tokens:10}},{id:'b',role:'assistant',status:'done',model:'m',usage:{input_tokens:400,cache_read_input_tokens:500,output_tokens:50},lastRequestUsage:{input_tokens:30,cache_read_input_tokens:70,output_tokens:12},modelUsage:{m:{contextWindow:1000}}}]}
  session.messages[1].contextKey=contextKey(session)
  let value=sessionUsage(session,1000);assert.equal(value.totals.input,1000);assert.ok(Math.abs(value.totals.cacheRate-58)<1e-9);assert.equal(value.context.used,null);assert.equal(value.context.max,null);assert.equal(value.context.percentage,null)
  session.contextReport={value:normalizeContext({totalTokens:240,maxTokens:1000,categories:[{name:'used',tokens:240},{name:'free',tokens:760}]}),anchor:'b',key:contextKey(session),nativeId:'native'}
  value=sessionUsage(session);assert.equal(value.context.used,240);assert.equal(value.context.source,'cli')
  session.messages.push({id:'next',role:'user'});assert.equal(sessionUsage(session).context.used,null);session.messages.pop()
  session.nativeId='other';assert.equal(sessionUsage(session).context.max,null);session.nativeId='native'
  session.model='other';value=sessionUsage(session);assert.equal(value.context.used,null);assert.equal(value.context.max,null)
  assert.equal(normalizeContext({totalTokens:1,maxTokens:0}),null)
})

test('stream cumulative snapshots and repeated assistant blocks deduplicate per request; CLI result remains authoritative',()=>{
  const m={text:'',tools:[],status:'running'},turn=new TurnAccumulator(m)
  const event=e=>turn.consume({type:'stream_event',event:e})
  event({type:'message_start',message:{id:'a',usage:{input_tokens:10,cache_read_input_tokens:90,output_tokens:0}}})
  event({type:'message_delta',usage:{output_tokens:4}})
  turn.consume({type:'assistant',message:{id:'a',usage:{input_tokens:10,cache_read_input_tokens:90,output_tokens:4},content:[]}})
  event({type:'message_start',message:{id:'b',usage:{input_tokens:0,output_tokens:0}}})
  assert.equal(m.lastRequestUsage.output_tokens,4)
  event({type:'message_delta',usage:{input_tokens:15,cache_read_input_tokens:95,output_tokens:7}})
  assert.equal(stats(m.usage).input,210);assert.equal(m.usage.output_tokens,11);assert.equal(stats(m.lastRequestUsage).input,110)
  turn.consume({type:'result',subtype:'success',usage:{input_tokens:25,cache_read_input_tokens:185,output_tokens:11},modelUsage:{m:{contextWindow:200000}}})
  assert.equal(stats(m.usage).input,210);assert.equal(m.modelUsage.m.contextWindow,200000)
})

for(const protocol of ['chat','responses','anthropic'])for(const streaming of [false,true])test(`${protocol} ${streaming?'stream':'JSON'} gateway preserves cache usage`,async t=>{
  const usage=protocol==='chat'?{prompt_tokens:100,completion_tokens:8,prompt_tokens_details:{cached_tokens:80}}:protocol==='responses'?{input_tokens:100,output_tokens:8,input_tokens_details:{cached_tokens:80}}:{input_tokens:20,output_tokens:8,cache_read_input_tokens:80,cache_creation_input_tokens:0}
  const json=protocol==='chat'?{id:'m',choices:[{message:{content:'Hello'},finish_reason:'stop'}],usage}:protocol==='responses'?{id:'m',output:[{type:'message',content:[{type:'output_text',text:'Hello'}]}],usage}:{id:'m',type:'message',content:[{type:'text',text:'Hello'}],usage}
  const events=protocol==='chat'?[{choices:[{delta:{content:'Hello'},finish_reason:'stop'}]},{choices:[],usage}]:protocol==='responses'?[{type:'response.output_text.delta',delta:'Hello'},{type:'response.completed',response:{usage}}]:[{type:'message_start',message:{id:'m',usage:{...usage,output_tokens:0}}},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:8}},{type:'message_stop'}]
  const wire=events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),observed=[]
  const proxy=await startProxy({protocol,baseUrl:'https://example.invalid',model:'m',models:[{id:'m'}]}, {},async()=>streaming?new Response(wire,{headers:{'content-type':'text/event-stream'}}):Response.json(json),{onUsage:e=>observed.push(e)})
  t.after(()=>proxy.close())
  const response=await fetch(proxy.url+'/v1/messages',{method:'POST',headers:{'x-api-key':proxy.token},body:JSON.stringify({model:'m',messages:[],stream:streaming,max_tokens:20})})
  assert.equal(response.status,200)
  if(streaming){
    if(protocol==='anthropic')assert.equal(await response.text(),wire)
    else{const all=[];for await(const e of sse(response.body))all.push(e);assert.equal(stats(all.find(e=>e.type==='message_delta').usage).input,100)}
  }else assert.equal(stats((await response.json()).usage).input,100)
  assert.equal(observed.length,1);assert.equal(observed[0].cacheReported,true);assert.equal(stats(observed[0].usage).cacheRate,80)
})
