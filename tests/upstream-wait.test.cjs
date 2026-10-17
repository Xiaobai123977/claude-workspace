const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),zlib=require('node:zlib')
const {upstreamFetch}=require('../electron/upstream-fetch.cjs')
const {fetchWithRetry}=require('../electron/gateway-retry.cjs')
const {startProxy}=require('../electron/provider-proxy.cjs')
const {normalizeProvider}=require('../electron/provider-keys.cjs'),{resolvedModel}=require('../electron/model-profile.cjs')
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function server(t,handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.close();server.closeAllConnections()});return 'http://127.0.0.1:'+server.address().port}
const packet=value=>'data: '+JSON.stringify(value)+'\n\n'

test('old default 120s becomes unlimited while explicit limits and model overrides remain effective',()=>{
  const base={models:[{id:'m'}]}
  const legacy=normalizeProvider({...base,timeout:120000});assert.equal(legacy.timeoutMode,'unlimited');assert.equal(resolvedModel(legacy,base.models[0]).timeout,0)
  const explicit=normalizeProvider({...base,timeout:120000,timeoutMode:'limited'});assert.equal(resolvedModel(explicit,base.models[0]).timeout,120000)
  const custom=normalizeProvider({...base,timeout:15000});assert.equal(resolvedModel(custom,base.models[0]).timeout,15000)
  assert.equal(resolvedModel(custom,{id:'m',request:{timeout:0}}).timeout,0)
})

test('a locally configured deadline does not poison the key health or delay unrelated conversations',async t=>{
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{ProvidersService}=require('../electron/providers.cjs')
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'local-timeout-health-'))
  const service=new ProvidersService({userData:root,secureStorage:{isEncryptionAvailable:()=>true},fetcher:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))})
  t.after(()=>service.close())
  const p=service.save({name:'fixture',protocol:'chat',baseUrl:'http://fixture.invalid',auth:'none',models:[{id:'m'}],defaultModel:'m'})
  const original=service.resolve.bind(service);service.resolve=(...args)=>({...original(...args),timeout:20,timeoutMode:'limited'})
  const runtime=await service.runtime(p.id,'m','','a');let notify
  const ready=new Promise(resolve=>notify=resolve);service.onRetry=(_id,e)=>{if(e.phase==='waiting'&&e.reason==='timeout')notify()}
  const pending=fetch(runtime.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'x-api-key':runtime.env.ANTHROPIC_API_KEY},body:JSON.stringify({messages:[{role:'user',content:'hello'}]})})
  await ready;assert.equal(service.router.health.size,0);service.cancelSession('a');await(await pending).text()
})

test('default gateway wait has no deadline, keeps streaming open, and remains cancellable',async t=>{
  const events=[];let signal
  const result=await fetchWithRetry(async(_url,init)=>{signal=init.signal;await sleep(30);return Response.json({ok:true})},'http://fixture',{}, {policy:{noticeDelayMs:5},onRetry:e=>events.push(e)})
  await sleep(30);assert.equal(signal.aborted,false)
  assert.equal(events.find(e=>e.phase==='requesting').timeoutAt,undefined)
  result.release();assert.equal(signal.aborted,true)
  const controller=new AbortController();let started
  const ready=new Promise(resolve=>started=resolve)
  const pending=fetchWithRetry(async(_url,{signal})=>{started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))},'http://fixture',{signal:controller.signal})
  await ready;controller.abort();await assert.rejects(pending,/abort/i)
})

test('retrying an actual request displays current waiting rather than an obsolete cooldown reason',async()=>{
  let calls=0;const events=[]
  const result=await fetchWithRetry(async()=>++calls===1?new Response('',{status:503,headers:{'x-claude-gui-local-error':'true'}}):Response.json({ok:true}),'http://fixture',{}, {policy:{baseDelayMs:0,maxDelayMs:0},onRetry:e=>events.push(e)})
  result.release();assert.equal(events.find(e=>e.phase==='waiting').reason,'routing')
  const active=events.find(e=>e.phase==='attempting');assert.equal(active.reason,'pending');assert.equal(active.timeoutAt,undefined)
})

test('cooldown scheduling never calls the upstream early or consumes the attempt budget',async()=>{
  let preparations=0,calls=0;const events=[]
  const result=await fetchWithRetry(async()=>{calls++;return Response.json({ok:true})},'http://fixture',{}, {policy:{maxRetries:0},prepare:()=>{if(++preparations<4)throw Object.assign(Error('cooling'),{retryAfterMs:1})},onRetry:e=>events.push(e)})
  result.release();assert.equal(calls,1);assert.equal(result.retries,0);assert.equal(events.filter(e=>e.phase==='waiting').length,3)
})

test('HTTP transport waits through delayed headers and body, handles gzip, and sends exact JSON with content length',async t=>{
  let received
  const url=await server(t,async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk
    received={body:raw,length:req.headers['content-length'],chunked:req.headers['transfer-encoding']}
    await sleep(30);res.writeHead(200,{'Content-Type':'application/json','Content-Encoding':'gzip'})
    const bytes=zlib.gzipSync(Buffer.from('{"ok":true}'));res.write(bytes.subarray(0,8));await sleep(30);res.end(bytes.subarray(8))
  })
  const body=JSON.stringify({message:'你好'})
  assert.deepEqual(await(await upstreamFetch(url,{method:'POST',body})).json(),{ok:true})
  assert.deepEqual(received,{body,length:String(Buffer.byteLength(body)),chunked:undefined})
})

test('real HTTP request waiting before headers and during body is stopped immediately by cancellation',async t=>{
  const url=await server(t,(req,res)=>{if(req.url==='/body'){res.writeHead(200);res.write('partial')}req.on('error',()=>{})})
  const first=new AbortController(),pending=upstreamFetch(url,{signal:first.signal});await sleep(20);first.abort();await assert.rejects(pending,/abort/i)
  const second=new AbortController(),response=await upstreamFetch(url+'/body',{signal:second.signal}),body=response.text();second.abort();await assert.rejects(body)
})

test('slow successful SSE with no explicit timeout is one request, no retries or artificial HTTP error',async t=>{
  let calls=0;const url=await server(t,async(req,res)=>{
    calls++;req.resume();await sleep(40);res.writeHead(200,{'Content-Type':'text/event-stream'})
    res.write(packet({choices:[{delta:{content:'first'}}]}));await sleep(60)
    res.end(packet({choices:[{delta:{content:'last'},finish_reason:'stop'}]})+'data: [DONE]\n\n')
  })
  const proxy=await startProxy({protocol:'chat',model:'fixture',baseUrl:url,models:[],timeout:0},{})
  t.after(()=>proxy.close())
  const response=await fetch(proxy.url+'/v1/messages',{method:'POST',headers:{'x-api-key':proxy.token},body:JSON.stringify({messages:[{role:'user',content:'hello'}],stream:true})})
  const output=await response.text();assert.equal(response.status,200);assert.match(output,/first/);assert.match(output,/last/);assert.doesNotMatch(output,/event: error/);assert.equal(calls,1)
})
