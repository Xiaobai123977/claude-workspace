const test = require('node:test')
const assert = require('node:assert/strict')
const { fetchWithRetry, retryDelay } = require('../electron/gateway-retry.cjs')
const { startProxy, sse } = require('../electron/provider-proxy.cjs')
const quick = { baseDelayMs: 0, maxDelayMs: 0 }

test('429 then 503 retry the same body and clear progress on success', async () => {
  const events = [], bodies = []; let count = 0
  const result = await fetchWithRetry(async (_url, init) => {
    bodies.push(init.body)
    return ++count < 3 ? new Response('secret upstream body', {status:count===1?429:503}) : Response.json({ok:true})
  }, 'http://fixture.invalid', {body:'unchanged'}, {policy:quick,onRetry:e=>events.push(e)})
  result.release()
  assert.equal(result.response.status,200); assert.equal(result.retries,2)
  assert.deepEqual(bodies,['unchanged','unchanged','unchanged'])
  assert.deepEqual(events.filter(e=>e.phase==='waiting').map(e=>[e.status,e.attempt,e.maxRetries]),[[429,1,10],[503,2,10]])
  assert.equal(events.at(-1).phase,'cleared')
  assert.ok(!JSON.stringify(events).includes('secret'))
})

test('default limit is ten retries; permanent HTTP failures and opt-out do not retry', async () => {
  let count = 0
  const exhausted = await fetchWithRetry(async()=>{count++;return new Response('',{status:503})},'http://fixture',{}, {policy:quick})
  exhausted.release(); assert.equal(count,11); assert.equal(exhausted.retries,10)
  for (const status of [400,401,403,404,422]) {
    count=0; const result=await fetchWithRetry(async()=>{count++;return new Response('',{status})},'http://fixture',{}, {policy:quick})
    result.release(); assert.equal(count,1)
  }
  count=0
  const result=await fetchWithRetry(async()=>{count++;return new Response('',{status:429,headers:{'x-should-retry':'false'}})},'http://fixture',{}, {policy:quick})
  result.release(); assert.equal(count,1)
})

test('backoff honors seconds, HTTP dates and milliseconds, and caps exponential delay', () => {
  assert.equal(retryDelay(new Headers({'retry-after':'2'}),1),2000)
  assert.equal(retryDelay(new Headers({'retry-after-ms':'25','retry-after':'2'}),1),25)
  const dated=retryDelay(new Headers({'retry-after':new Date(Date.now()+10000).toUTCString()}),1)
  assert.ok(dated>=8500&&dated<=10000)
  assert.equal(retryDelay(new Headers(),1,{random:()=>0.5}),1000)
  assert.equal(retryDelay(new Headers(),10,{random:()=>0.5}),30000)
  assert.equal(retryDelay(new Headers(),10,{random:()=>1}),30000)
})

test('aborting a Retry-After wait stops immediately and starts no new request', async () => {
  const controller=new AbortController(),events=[];let count=0
  await assert.rejects(fetchWithRetry(async()=>{count++;return new Response('',{status:429,headers:{'retry-after':'60'}})},'http://fixture',{signal:controller.signal},{onRetry:e=>{events.push(e);if(e.phase==='waiting')controller.abort()}}),/abort/i)
  assert.equal(count,1);assert.equal(events.at(-1).phase,'cleared')
})

test('connection failures and per-attempt timeouts retry without leaking their messages', async () => {
  let count=0
  const network=await fetchWithRetry(async()=>{if(++count===1)throw new TypeError('fetch failed: PRIVATE_TOKEN');return Response.json({ok:true})},'http://fixture',{}, {policy:quick})
  network.release();assert.equal(count,2)
  const events=[];count=0
  const timed=await fetchWithRetry(async(_url,{signal})=>{
    if(++count===1)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('PRIVATE_TIMEOUT')),{once:true}))
    return Response.json({ok:true})
  },'http://fixture',{}, {timeout:5,policy:quick,onRetry:e=>events.push(e)})
  timed.release();assert.equal(count,2);assert.equal(events[0].reason,'timeout');assert.ok(!JSON.stringify(events).includes('PRIVATE'))
})

test('invalid certificates do not retry and a long upstream cooldown is never shortened',async()=>{
  let count=0
  await assert.rejects(fetchWithRetry(async()=>{count++;throw new TypeError('PRIVATE_TLS_ERROR',{cause:{code:'CERT_HAS_EXPIRED'}})},'https://fixture',{}, {policy:quick}),/网络连接失败/)
  assert.equal(count,1)
  count=0
  const result=await fetchWithRetry(async()=>{count++;return new Response('',{status:429,headers:{'retry-after':'3600'}})},'http://fixture',{}, {policy:quick})
  result.release();assert.equal(count,1);assert.equal(result.cooldownExceeded,true)
})

test('proxy exhaustion preserves upstream wording, redacts credentials and suppresses downstream retries', async t => {
  let count=0
  const proxy=await startProxy({protocol:'chat',model:'fixture',baseUrl:'http://fixture',key:'PRIVATE_KEY',models:[]},{},async()=>{count++;return new Response('Capacity unavailable PRIVATE_KEY',{status:503})},{retryPolicy:{...quick,maxRetries:2}})
  t.after(()=>proxy.close())
  const response=await fetch(proxy.url+'/v1/messages',{method:'POST',headers:{'x-api-key':proxy.token},body:JSON.stringify({messages:[],stream:false})})
  assert.equal(response.headers.get('x-should-retry'),'false');assert.equal(response.status,503);assert.equal(count,3)
  const data=await response.json();assert.equal(data.error.message,'Capacity unavailable [REDACTED]');assert.ok(!JSON.stringify(data).includes('PRIVATE'))
})

test('a partially streamed response is never retried', async t => {
  let count=0
  const proxy=await startProxy({protocol:'chat',model:'fixture',baseUrl:'http://fixture',models:[]},{},async()=>{
    count++;return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Partial only once'}}]})+'\n\n',{headers:{'Content-Type':'text/event-stream'}})
  },{retryPolicy:quick})
  t.after(()=>proxy.close())
  const response=await fetch(proxy.url+'/v1/messages',{method:'POST',headers:{'x-api-key':proxy.token},body:JSON.stringify({messages:[],stream:true})})
  const events=[];for await(const event of sse(response.body))events.push(event)
  assert.equal(count,1);assert.equal(events.filter(e=>e.delta?.text==='Partial only once').length,1)
  assert.ok(events.some(e=>e.type==='error'))
})
