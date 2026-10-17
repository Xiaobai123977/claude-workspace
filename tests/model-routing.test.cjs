const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {ProvidersService}=require('../electron/providers.cjs')
const {ModelRouter}=require('../electron/model-router.cjs')
const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('sealed:'+s),decryptString:b=>b.toString().slice(7)}
function fixture(t,fetcher){const root=fs.mkdtempSync(path.join(os.tmpdir(),'claude-route-test-')),service=new ProvidersService({userData:root,secureStorage:secure,fetcher});t.after(()=>{service.close();fs.rmSync(root,{recursive:true,force:true})});return {root,service}}
const supplier=(name,keys,weight=1)=>({name,baseUrl:`https://${name}.invalid/v1`,protocol:'chat',auth:'bearer',weight,enabled:true,models:[],keys:keys.map(([id,key,keyWeight=1])=>({id,name:id,key,weight:keyWeight,enabled:true,models:[]}))})
async function detectAndSave(service,input){const result=await service.discover(input);return service.save({...input,...result,keys:input.keys.map(k=>({...k,...result.keys.find(x=>x.id===k.id),key:k.key})),defaultModel:result.models.find(m=>!m.stale)?.id})}
const response=(model='shared')=>Response.json({choices:[{message:{content:'Served '+model},finish_reason:'stop'}]})
const call=runtime=>fetch(runtime.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'x-api-key':runtime.env.ANTHROPIC_API_KEY},body:JSON.stringify({messages:[{role:'user',content:'Hello'}],stream:false,max_tokens:20})})

test('single-key network cooldown is included in the retry wait instead of consuming phantom retry attempts',async t=>{
  let calls=0;const events=[]
  const {service}=fixture(t,async(url)=>{
    if(String(url).endsWith('/models'))return Response.json({data:[{id:'shared'}]})
    if(++calls===1)throw new TypeError('socket closed',{cause:{code:'ECONNRESET'}})
    return response()
  });service.onRetry=(_id,event)=>events.push(event)
  const p=await detectAndSave(service,supplier('cooldown',[['key','PRIVATE_KEY']]))
  assert.equal((await call(await service.runtime(p.id,'shared','','cooldown-chat'))).status,200)
  assert.equal(calls,2);assert.equal(events.filter(e=>e.phase==='waiting').length,1)
})

test('a pre-output HTTP-200 overload rotates to another key and keeps the recovered sticky route',async t=>{
  const received=[]
  const {service}=fixture(t,async(url,init)=>{
    if(String(url).endsWith('/models'))return Response.json({data:[{id:'shared'}]})
    const auth=init.headers.Authorization;received.push(auth)
    return auth==='Bearer PRIVATE_A'?Response.json({error:{type:'overloaded_error',message:'raw overload'}}):response()
  })
  const p=await detectAndSave(service,supplier('pool',[['a','PRIVATE_A'],['b','PRIVATE_B']]))
  const runtime=await service.runtime(p.id,'shared','','sticky-chat')
  assert.equal((await call(runtime)).status,200);assert.deepEqual(received,['Bearer PRIVATE_A','Bearer PRIVATE_B'])
  assert.equal((await call(runtime)).status,200);assert.equal(received.at(-1),'Bearer PRIVATE_B')
})

test('an upstream model restriction remains 403 on later calls and does not disable other models on the key',async t=>{
  let calls=0
  const {service}=fixture(t,async(url,init)=>{
    if(String(url).endsWith('/models'))return Response.json({data:[{id:'restricted'},{id:'working'}]})
    calls++;const model=JSON.parse(init.body).model
    return model==='restricted'?Response.json({error:{message:"OpenCode's free tier can only be used from within OpenCode. PRIVATE_A"}},{status:403}):response()
  })
  const p=await detectAndSave(service,supplier('a',[['a1','PRIVATE_A']]))
  const runtime=await service.runtime(p.id,'restricted','','chat')
  const first=await call(runtime);assert.equal(first.status,403);const body=JSON.stringify(await first.json());assert.equal((JSON.parse(body)).error.message,"OpenCode's free tier can only be used from within OpenCode. [REDACTED]");assert.ok(!body.includes('PRIVATE_A'))
  const second=await call(runtime);assert.equal(second.status,403);const repeated=JSON.stringify(await second.json());assert.match(repeated,/OpenCode/);assert.equal(calls,1)
  assert.equal((await call(await service.runtime(p.id,'working','','chat'))).status,200);assert.equal(calls,2)
})

test('legacy single-key files are readable without a write or credential loss',t=>{
  const {service,root}=fixture(t)
  const legacy={id:'legacy',name:'Legacy',protocol:'chat',baseUrl:'https://legacy.invalid/v1',auth:'bearer',encryptedKey:secure.encryptString('PRIVATE_LEGACY').toString('base64'),models:[{id:'legacy-model',source:'server'}],defaultModel:'legacy-model',revision:'original'}
  const file=path.join(root,'providers.json'),original=JSON.stringify([legacy]);fs.writeFileSync(file,original)
  const loaded=service.list()[0]
  assert.equal(loaded.keys.length,1);assert.equal(service.routes(loaded.id,'legacy-model').length,1)
  assert.equal(service.resolve(loaded,'primary').key,'PRIVATE_LEGACY');assert.equal(fs.readFileSync(file,'utf8'),original)
  assert.equal(service.resolve(service.save(loaded),'primary').key,'PRIVATE_LEGACY')
})

test('a newly established routed proxy does not forward unowned opaque thinking history',async t=>{
  const received=[]
  const {service}=fixture(t,async(url,init)=>{received.push(JSON.parse(init.body));return Response.json({id:'m',content:[{type:'text',text:'OK'}],stop_reason:'end_turn'})})
  const p=service.save({...supplier('a',[['a1','PRIVATE_A']]),protocol:'anthropic',models:[{id:'shared'}],defaultModel:'shared',keys:[{id:'a1',name:'one',key:'PRIVATE_A',models:[{id:'shared'}]}]})
  const runtime=await service.runtime(p.id,'','','chat')
  const result=await fetch(runtime.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'x-api-key':runtime.env.ANTHROPIC_API_KEY},body:JSON.stringify({stream:false,max_tokens:20,messages:[{role:'assistant',content:[{type:'thinking',thinking:'private thought',signature:'foreign'},{type:'redacted_thinking',data:'foreign'},{type:'text',text:'Prior answer'}]},{role:'user',content:'Continue'}]})})
  assert.equal(result.status,200);assert.deepEqual(received[0].messages[0].content,[{type:'text',text:'Prior answer'}])
})

test('one supplier can map independent key aliases without multiplying a key weight',async t=>{
  const seen=[]
  const {service}=fixture(t,async(url,init)=>{
    const first=init.headers.Authorization==='Bearer PRIVATE_A'
    if(String(url).endsWith('/models'))return Response.json({data:[{id:first?'alias-a':'alias-b'},{id:'common'}]})
    seen.push({auth:init.headers.Authorization,model:JSON.parse(init.body).model});return response()
  })
  const p=await detectAndSave(service,supplier('a',[['a1','PRIVATE_A'],['a2','PRIVATE_B']]))
  const pool=service.savePool({name:'Aliases',model:'unified',sticky:false,members:[{providerId:p.id,model:'alias-a',keyIds:['a1']},{providerId:p.id,model:'alias-b',keyIds:['a2']}]})
  const runtime=await service.runtime(pool.id,'','','conversation')
  await call(runtime);await call(runtime)
  assert.deepEqual(seen,[{auth:'Bearer PRIVATE_A',model:'alias-a'},{auth:'Bearer PRIVATE_B',model:'alias-b'}])
  assert.equal(service.connections().find(x=>x.id===pool.id).providerCount,1)
  assert.throws(()=>service.savePool({...pool,members:[{providerId:p.id,model:'common'},{providerId:p.id,model:'alias-a',keyIds:['a1']}]}),/重复映射/)
})

test('each key has its own detected catalog and encrypted secret; missing models are never copied',async t=>{
  const seen=[]
  const {service,root}=fixture(t,async(url,init)=>{seen.push(init.headers.Authorization);return Response.json({data:init.headers.Authorization==='Bearer PRIVATE_A'?[{id:'shared'},{id:'a-only'}]:[{id:'b-only'}]})})
  const saved=await detectAndSave(service,supplier('a',[['a1','PRIVATE_A'],['a2','PRIVATE_B']]))
  assert.deepEqual(seen.sort(),['Bearer PRIVATE_A','Bearer PRIVATE_B'])
  assert.deepEqual(saved.keys[0].models.map(m=>m.id),['shared','a-only']);assert.deepEqual(saved.keys[1].models.map(m=>m.id),['b-only'])
  assert.equal(service.routes(saved.id,'shared').length,1)
  const coverage=service.coverage().find(c=>c.model==='shared');assert.equal(coverage.providerCount,1);assert.equal(coverage.keyCount,1)
  assert.equal(coverage.detectedKeyCount,1)
  assert.ok(!fs.readFileSync(path.join(root,'providers.json'),'utf8').includes('"key"'))
  assert.ok(!JSON.stringify(service.list()).includes('PRIVATE_'));assert.ok(!JSON.stringify(service.list()).includes('encryptedKey'))
  assert.equal(service.resolve(saved,'a1').key,'PRIVATE_A');assert.equal(service.resolve(saved,'a2').key,'PRIVATE_B')
  const again=service.save(saved);assert.equal(service.resolve(again,'a2').key,'PRIVATE_B')
})

test('a failed key discovery preserves only its own previous results and reports the failure',async t=>{
  let fail=false
  const {service}=fixture(t,async(url,init)=>fail&&init.headers.Authorization.endsWith('PRIVATE_B')?new Response('',{status:401}):Response.json({data:[{id:init.headers.Authorization.endsWith('PRIVATE_A')?'a-model':'b-model'}]}))
  const saved=await detectAndSave(service,supplier('a',[['a1','PRIVATE_A'],['a2','PRIVATE_B']]))
  fail=true;const result=await service.discover(saved)
  assert.equal(result.errors[0].keyId,'a2');assert.match(result.keys[1].checkError,/401/)
  assert.deepEqual(result.keys[1].models.map(m=>m.id),['b-model']);assert.ok(!result.keys[1].models.some(m=>m.id==='a-model'))
})

test('provider weights and key weights are independent smooth round-robin levels',()=>{
  const router=new ModelRouter(),routes=[
    {id:'a/1',providerId:'a',keyId:'1',providerWeight:1,keyWeight:1},
    {id:'a/2',providerId:'a',keyId:'2',providerWeight:1,keyWeight:3},
    {id:'b/1',providerId:'b',keyId:'1',providerWeight:3,keyWeight:1},
    {id:'b/2',providerId:'b',keyId:'2',providerWeight:3,keyWeight:1},
    {id:'b/3',providerId:'b',keyId:'3',providerWeight:3,keyWeight:1}
  ],counts={}
  for(let i=0;i<160;i++){const r=router.choose(routes,{scope:'pool',model:'m',sticky:false});counts[r.id]=(counts[r.id]||0)+1}
  assert.equal(counts['a/1'],10);assert.equal(counts['a/2'],30)
  assert.equal(counts['b/1']+counts['b/2']+counts['b/3'],120)
})

test('sticky routing survives restart, expires, and immediately excludes disabled or failed routes',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'claude-sticky-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  let now=100000;const options={file:path.join(root,'affinity.json'),now:()=>now},routes=['a','b'].map(id=>({id,providerId:id,keyId:'key',revision:'1',providerWeight:1,keyWeight:1}))
  const router=new ModelRouter(options),context={scope:'pool',model:'m',sessionId:'conversation',ttlMinutes:1}
  const first=router.choose(routes,context)
  for(let i=0;i<5;i++)assert.equal(router.choose(routes,context).id,first.id)
  const restarted=new ModelRouter(options);assert.equal(restarted.choose(routes,context).id,first.id)
  restarted.report(first,{response:new Response('',{status:429,headers:{'retry-after':'60'}})})
  const next=restarted.choose(routes,context);assert.notEqual(next.id,first.id)
  assert.throws(()=>restarted.choose(routes.filter(r=>r.id===first.id),{...context,sessionId:'other'}),/HTTP 429/)
  now+=61000
  assert.equal(restarted.choose(routes.map(r=>({...r,providerWeight:r.id===first.id?1000:1})),context).id,first.id)
})

test('pool mapping crosses protocols, rotates bad credentials, and retains the new sticky route',async t=>{
  const upstream=[]
  const {service}=fixture(t,async(url,init)=>{
    url=String(url)
    if(url.endsWith('/models'))return Response.json({data:[{id:url.includes('a.invalid')?'alias-a':'alias-b',effort:{supported_levels:['low','high']}}]})
    const body=JSON.parse(init.body);upstream.push({url,body,auth:init.headers.Authorization})
    if(url.includes('a.invalid'))return new Response('',{status:401})
    return Response.json({id:'result',output:[{type:'message',content:[{type:'output_text',text:'Mapped response'}]}]})
  })
  const a=await detectAndSave(service,supplier('a',[['a1','PRIVATE_A']])),b=await detectAndSave(service,{...supplier('b',[['b1','PRIVATE_B']]),protocol:'responses'})
  const pool=service.savePool({name:'Unified',model:'logical-model',enabled:true,sticky:true,ttlMinutes:60,members:[{providerId:a.id,model:'alias-a'},{providerId:b.id,model:'alias-b'}]})
  const runtime=await service.runtime(pool.id,'','high','chat')
  assert.equal((await (await call(runtime)).json()).content[0].text,'Mapped response')
  assert.equal(upstream.length,2);assert.equal(upstream[0].body.model,'alias-a');assert.equal(upstream[1].body.model,'alias-b');assert.ok(upstream[1].url.endsWith('/responses'))
  await call(runtime);assert.equal(upstream.length,3);assert.ok(upstream[2].url.includes('b.invalid'))
  assert.equal(service.connections().find(p=>p.id===pool.id).providerCount,2)
})

test('only independently compatible routes receive an explicit thinking level',async t=>{
  const routed=[]
  const {service}=fixture(t,async(url,init)=>{
    url=String(url)
    if(url.endsWith('/models'))return Response.json({data:[{id:'shared',effort:{supported_levels:url.includes('a.invalid')?['low']:['high']}}]})
    routed.push(url);return response()
  })
  const a=await detectAndSave(service,supplier('a',[['a1','PRIVATE_A']])),b=await detectAndSave(service,supplier('b',[['b1','PRIVATE_B']]))
  const pool=service.savePool({name:'Shared',model:'shared',enabled:true,sticky:true,ttlMinutes:60,members:[{providerId:a.id,model:'shared'},{providerId:b.id,model:'shared'}]})
  await call(await service.runtime(pool.id,'','high','chat'))
  assert.equal(routed.length,1);assert.ok(routed[0].includes('b.invalid'))
  assert.throws(()=>service.savePool({...pool,members:[{providerId:a.id,model:'not-in-catalog'}]}),/没有.*可用/)
})

test('local capability rejection is a nonretryable 400 and never calls the upstream',async t=>{
  let calls=0
  const {service}=fixture(t,async()=>{calls++;return response()})
  for(const capability of [{vision:true,tools:false}]){
    const models=[{id:'glm-5.2',...capability}]
    const p=service.save({...supplier('local',[['key','PRIVATE']]),models,defaultModel:'glm-5.2',keys:[{id:'key',name:'one',key:'PRIVATE',models}]})
    const runtime=await service.runtime(p.id,'glm-5.2','','local-'+p.id)
    const messages=[{role:'user',content:[{type:'text',text:'write svg'},...(capability.vision===false?[{type:'image',source:{type:'base64',media_type:'image/png',data:'fixture'}}]:[])]}]
    const r=await fetch(runtime.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'x-api-key':runtime.env.ANTHROPIC_API_KEY},body:JSON.stringify({messages,tools:[{name:'inspect',input_schema:{type:'object'}}],stream:false})})
    assert.equal(r.status,400);assert.equal(r.headers.get('x-should-retry'),'false')
    const message=(await r.json()).error.message
    assert.match(message,/本地网关.*glm-5.2/)
    assert.match(message,capability.vision===false?/不支持图片输入/:/不支持工具调用/)
  }
  assert.equal(calls,0)
})

test('image requests prefer vision routes and can fail over to file references on text routes',async t=>{
  const received=[];const {service}=fixture(t,async(url,init)=>{const body=JSON.parse(init.body);received.push({url:String(url),body});return String(url).includes('vision.invalid')?Response.json({error:{message:'vision unavailable'}},{status:403}):response()})
  const create=(name,vision,weight)=>service.save({...supplier(name,[['key','PRIVATE']],weight),models:[{id:'shared',vision}],defaultModel:'shared',keys:[{id:'key',name:'one',key:'PRIVATE',models:[{id:'shared',vision}]}]})
  const textProvider=create('text',false,100),visionProvider=create('vision',true,1)
  const pool=service.savePool({name:'Mixed',model:'shared',members:[{providerId:textProvider.id,model:'shared'},{providerId:visionProvider.id,model:'shared'}]})
  const runtime=await service.runtime(pool.id,'shared','','images'),messages=[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'eA=='}}]}]
  const r=await fetch(runtime.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'x-api-key':runtime.env.ANTHROPIC_API_KEY},body:JSON.stringify({messages,stream:false})})
  assert.equal(r.status,200);assert.equal(received.length,2);assert.match(received[0].url,/vision.invalid/);assert.match(JSON.stringify(received[0].body),/data:image/);assert.match(received[1].url,/text.invalid/);assert.ok(!JSON.stringify(received[1].body).includes('data:image/'));assert.match(JSON.stringify(received[1].body),/本地图片文件/)
})
