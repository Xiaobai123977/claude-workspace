const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { ProvidersService, validate, metadata } = require('../electron/providers.cjs')
const { startProxy, endpoint, convertRequest, sse } = require('../electron/provider-proxy.cjs')
const base = () => ({ name: 'Fixture', protocol: 'chat', baseUrl: 'https://example.invalid/v1', auth: 'bearer', key: 'PRIVATE_FIXTURE', models: [{id: 'model-a', efforts: ['low', 'high'], context: 128000}], defaultModel: 'model-a' })
const secure = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s.split('').reverse().join('')), decryptString: b => b.toString().split('').reverse().join('') }
function fixture(fetcher) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-providers-')); return { root, service: new ProvidersService({userData:root, secureStorage:secure, fetcher}) } }
test('provider credentials stay encrypted and masked; blank drafts retain credentials and connections stay separate', t => {
  const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}))
  const saved=f.service.save(base())
  assert.equal(saved.hasKey,true);assert.equal(saved.key,undefined)
  assert.ok(!fs.readFileSync(f.service.file,'utf8').includes('PRIVATE_FIXTURE'))
  const updated=f.service.save({...saved,key:'',name:'Updated'})
  assert.equal(f.service.resolve(updated).key,'PRIVATE_FIXTURE')
  assert.equal(f.service.save({...base(),key:'OTHER'}).id===saved.id,false)
  assert.throws(()=>validate({...base(),headers:{Authorization:'secret'}}),/请求头/)
  assert.throws(()=>validate({...base(),baseUrl:'https://user:secret@host/v1'}),/地址/)
})
test('discovery uses draft configuration, retains disappeared models, and never invents effort levels', async t => {
  const f=fixture(async(url,init)=>{assert.equal(String(url),'https://example.invalid/v1/models');assert.equal(init.headers.Authorization,'Bearer PRIVATE_FIXTURE');return Response.json({data:[{id:'new-model',owned_by:'fixture'},{id:'rich',effort:{supported_levels:['low','max']},context_window:1000000,input_modalities:['text','image']}]})});t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}))
  const result=await f.service.discover(base())
  assert.equal(result.models.find(m=>m.id==='new-model').efforts,undefined)
  assert.equal(result.models.find(m=>m.id==='model-a').stale,true)
  assert.deepEqual(result.models.find(m=>m.id==='rich').efforts,['low','max'])
  assert.equal(result.models.find(m=>m.id==='rich').vision,true)
  assert.equal(fs.existsSync(f.service.file),false)
  f.service.fetcher=async()=>new Response('',{status:401})
  await assert.rejects(f.service.discover(base()),/401/)
  assert.deepEqual(metadata({id:'minimal'}).efforts,undefined)
})
test('endpoint normalization preserves prefixes and does not duplicate version or complete endpoint',()=>{
  assert.equal(endpoint('https://host','chat'),'https://host/v1/chat/completions')
  assert.equal(endpoint('https://host/api/v1/messages','responses'),'https://host/api/v1/responses')
  assert.equal(endpoint('https://host/v4/chat/completions','chat'),'https://host/v4/chat/completions')
})

test('DeepSeek official Messages uses its Anthropic prefix without rewriting custom providers or model IDs',async t=>{
  for(const base of ['https://api.deepseek.com','https://api.deepseek.com/v1','https://api.deepseek.com/anthropic','https://api.deepseek.com/anthropic/v1','https://api.deepseek.com/anthropic/v1/messages'])assert.equal(endpoint(base,'anthropic'),'https://api.deepseek.com/anthropic/v1/messages')
  assert.equal(endpoint('https://api.deepseek.com','chat'),'https://api.deepseek.com/v1/chat/completions')
  assert.equal(endpoint('https://api.deepseek.com/custom','anthropic'),'https://api.deepseek.com/custom/messages')
  assert.equal(endpoint('https://api.deepseek.com.example.org','anthropic'),'https://api.deepseek.com.example.org/v1/messages')
  const f=fixture(async url=>{
    assert.equal(String(url),'https://api.deepseek.com/models')
    return Response.json({data:[{id:'deepseek-flash',name:'DeepSeek-V4.1-Flash',effort:{supported_levels:['low','high','max']}}]})
  });t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}))
  const result=await f.service.discover({...base(),baseUrl:'https://api.deepseek.com',protocol:'anthropic'})
  const model=result.models.find(m=>m.id==='deepseek-flash')
  assert.equal(model.name,'DeepSeek-V4.1-Flash')
  assert.equal(convertRequest({max_tokens:64,messages:[{role:'user',content:'hello'}]},{...base(),protocol:'anthropic',model:model.id,models:[model]}).model,'deepseek-flash')
})
test('concurrent runtime creation shares one proxy and deleted connections cannot be resolved',async t=>{
  const f=fixture();t.after(()=>{f.service.close();fs.rmSync(f.root,{recursive:true,force:true})})
  const p=f.service.save(base()),[a,b]=await Promise.all([f.service.runtime(p.id,'model-a','low'),f.service.runtime(p.id,'model-a','low')])
  assert.equal(a.env.ANTHROPIC_BASE_URL,b.env.ANTHROPIC_BASE_URL)
  assert.equal(f.service.proxies.size,1);assert.notEqual(a.env.ANTHROPIC_API_KEY,'PRIVATE_FIXTURE')
  f.service.remove(p.id);await assert.rejects(f.service.runtime(p.id,'model-a'),/已删除/)
})
test('expert parameters cannot replace agent messages or credentials and model defaults require supported effort',()=>{
  assert.throws(()=>validate({...base(),extraBody:{messages:[]}}),/兼容参数/)
  assert.throws(()=>validate({...base(),models:[{id:'model-a',efforts:['low'],defaultEffort:'max'}]}),/默认思考强度/)
})
test('protocol requests preserve tool turns, reasoning history, images, and protocol-specific effort',()=>{
  const body={system:[{type:'text',text:'System'}],max_tokens:500,stream:true,tools:[{name:'Read',input_schema:{type:'object'}}],messages:[{role:'assistant',content:[{type:'thinking',thinking:'Private history'},{type:'tool_use',id:'call1',name:'Read',input:{path:'a'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'call1',content:[{type:'text',text:'Read result'}]},{type:'image',source:{type:'base64',media_type:'image/png',data:'abc'}}]}]}
  const chat=convertRequest(body,{...base(),model:'model-a',effort:'high'})
  assert.equal(chat.reasoning_effort,'high');assert.equal(chat.messages[1].reasoning_content,'Private history');assert.equal(chat.messages.at(-1).tool_call_id,'call1')
  const responses=convertRequest(body,{...base(),protocol:'responses',model:'model-a',effort:'low'})
  assert.deepEqual(responses.reasoning,{effort:'low'});assert.equal(responses.input.find(i=>i.type==='function_call_output').output,'Read result')
  assert.ok(!JSON.stringify(convertRequest(body,{...base(),model:'model-a',models:[{id:'model-a',vision:false}]})).includes('data:image/'))
})
function stream(events){return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n',{headers:{'Content-Type':'text/event-stream'}})}
test('Chat streaming translates partial tool arguments, usage and finish reason; local token required', async t=>{
  let received
  const proxy=await startProxy({...base(),model:'model-a'},{Authorization:'Bearer PRIVATE_FIXTURE'},async(url,init)=>{received=JSON.parse(init.body);return stream([{choices:[{delta:{content:'你好'}}]},{choices:[{delta:{tool_calls:[{index:0,id:'call1',function:{name:'Read',arguments:'{"path":'}}]}}]},{choices:[{delta:{tool_calls:[{index:0,function:{arguments:'"a"}'}}]},finish_reason:'tool_calls'}]},{choices:[],usage:{prompt_tokens:7,completion_tokens:9}}])})
  t.after(()=>proxy.close())
  assert.equal((await fetch(proxy.url+'/v1/messages',{method:'POST'})).status,401)
  const r=await fetch(proxy.url+'/v1/messages',{method:'POST',headers:{'x-api-key':proxy.token},body:JSON.stringify({messages:[],stream:true,max_tokens:200})})
  const events=[];for await(const e of sse(r.body))events.push(e)
  assert.equal(received.model,'model-a');assert.ok(events.some(e=>e.delta?.text==='你好'))
  assert.equal(events.filter(e=>e.delta?.partial_json).map(e=>e.delta.partial_json).join(''),'{"path":"a"}')
  assert.equal(events.find(e=>e.type==='message_delta').delta.stop_reason,'tool_use')
  assert.equal(events.find(e=>e.type==='message_delta').usage.output_tokens,9)
})
test('Responses stream matches function item IDs and replays opaque reasoning before tool history',async t=>{
  let calls=0,last
  const proxy=await startProxy({...base(),protocol:'responses',model:'model-a'},{},async(url,init)=>{
    last=JSON.parse(init.body);calls++
    if(calls===2)return Response.json({id:'r2',output:[{type:'message',content:[{type:'output_text',text:'Done'}]}],usage:{input_tokens:3,output_tokens:4}})
    return stream([{type:'response.output_item.added',output_index:0,item:{id:'reason1',type:'reasoning'}},{type:'response.output_item.done',item:{id:'reason1',type:'reasoning',encrypted_content:'OPAQUE'}},{type:'response.output_item.added',output_index:1,item:{id:'item1',type:'function_call',call_id:'call1',name:'Read'}},{type:'response.function_call_arguments.delta',item_id:'item1',delta:'{"path":"a"}'},{type:'response.output_item.done',item:{id:'item1',type:'function_call',call_id:'call1',name:'Read',arguments:'{"path":"a"}'}},{type:'response.completed',response:{usage:{input_tokens:4,output_tokens:5}}}])
  });t.after(()=>proxy.close())
  const request=async body=>fetch(proxy.url+'/v1/messages',{method:'POST',headers:{'x-api-key':proxy.token},body:JSON.stringify(body)})
  const r=await request({messages:[],stream:true});const events=[];for await(const e of sse(r.body))events.push(e)
  const tools=events.filter(e=>e.content_block?.type==='tool_use');assert.equal(tools.length,1);assert.equal(tools[0].content_block.id,'call1')
  await new Promise(resolve=>setTimeout(resolve,10))
  const second=await request({messages:[{role:'assistant',content:[{type:'tool_use',id:'call1',name:'Read',input:{path:'a'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'call1',content:'result'}]}]})
  assert.equal((await second.json()).content[0].text,'Done')
  assert.equal(last.input[0].encrypted_content,'OPAQUE');assert.equal(last.input[1].type,'function_call')
})
test('Anthropic passthrough keeps native fields, caps output and masks upstream error bodies',async t=>{
  let received
  const proxy=await startProxy({...base(),protocol:'anthropic',model:'model-a',models:[{id:'model-a',output:100}]},{},async(url,init)=>{received=JSON.parse(init.body);return new Response('PRIVATE_FIXTURE_ERROR',{status:429})},{retryPolicy:{maxRetries:0}});t.after(()=>proxy.close())
  const r=await fetch(proxy.url+'/v1/messages',{method:'POST',headers:{'x-api-key':proxy.token},body:JSON.stringify({messages:[],max_tokens:500,thinking:{type:'adaptive'}})})
  assert.equal(r.status,429);assert.ok(!(await r.text()).includes('PRIVATE_FIXTURE_ERROR'));assert.equal(received.max_tokens,100);assert.equal(received.thinking.type,'adaptive')
})
test('truncated streams return an error instead of a false successful stop',async t=>{
  const proxy=await startProxy({...base(),model:'model-a'},{},async()=>stream([{choices:[{delta:{content:'Partial'}}]}]));t.after(()=>proxy.close())
  const r=await fetch(proxy.url+'/v1/messages',{method:'POST',headers:{'x-api-key':proxy.token},body:JSON.stringify({messages:[],stream:true})})
  const events=[];for await(const e of sse(r.body))events.push(e)
  assert.ok(events.some(e=>e.type==='error'));assert.equal(events.some(e=>e.type==='message_stop'),false)
})


test('hidden models survive discovery and cannot become the default or run', async t=>{
  const f=fixture(async()=>Response.json({data:[{id:'model-a',effort:{supported_levels:['low','high']}},{id:'hidden-model'}]}));t.after(()=>{f.service.close();fs.rmSync(f.root,{recursive:true,force:true})})
  const saved=f.service.save({...base(),models:[...base().models,{id:'hidden-model',enabled:false}]})
  const discovery=await f.service.discover(saved)
  assert.equal(discovery.models.find(m=>m.id==='hidden-model').enabled,false)
  assert.equal(discovery.models.find(m=>m.id==='model-a').enabled,true)
  assert.throws(()=>validate({...base(),models:[{id:'model-a',enabled:false}]}),/默认模型/)
  await assert.rejects(f.service.runtime(saved.id,'hidden-model',''),/已隐藏/)
})

test('shared provider retries and cancellation are isolated by chat', async t=>{
  let count=0
  const f=fixture(async()=>{
    if(++count<=2)return new Response('',{status:503,headers:{'retry-after-ms':'80'}})
    return Response.json({choices:[{message:{content:'Other chat succeeded'},finish_reason:'stop'}]})
  })
  t.after(()=>{f.service.close();fs.rmSync(f.root,{recursive:true,force:true})})
  const waiting=new Set(),events=[];let bothWaiting
  const ready=new Promise(resolve=>{bothWaiting=resolve})
  f.service.onRetry=(id,event)=>{events.push({id,...event});if(event.phase==='waiting'){waiting.add(id);if(waiting.size===2)bothWaiting()}}
  const saved=f.service.save(base())
  const a=await f.service.runtime(saved.id,'model-a','','chat-a'),b=await f.service.runtime(saved.id,'model-a','','chat-b')
  assert.notEqual(a.env.ANTHROPIC_BASE_URL,b.env.ANTHROPIC_BASE_URL)
  const call=runtime=>fetch(runtime.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'x-api-key':runtime.env.ANTHROPIC_API_KEY},body:JSON.stringify({messages:[],stream:false})})
  const first=call(a),second=call(b)
  await ready;f.service.cancelSession('chat-a')
  const [cancelled,completed]=await Promise.all([first,second])
  assert.equal(cancelled.status,502);assert.equal(completed.status,200);assert.equal(count,3)
  assert.equal((await completed.json()).content[0].text,'Other chat succeeded')
  assert.ok(events.some(e=>e.id==='chat-a'&&e.phase==='cleared'))
  assert.ok(events.some(e=>e.id==='chat-b'&&e.phase==='attempting'))
})
