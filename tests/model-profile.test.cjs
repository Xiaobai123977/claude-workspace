const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {ProvidersService,validate}=require('../electron/providers.cjs'),{convertRequest}=require('../electron/provider-proxy.cjs'),{normalizeModel,resolvedModel}=require('../electron/model-profile.cjs'),{preview,probe}=require('../electron/model-probe.cjs')
const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('sealed:'+s),decryptString:b=>{const text=b.toString();if(!text.startsWith('sealed:'))throw new Error('Wrong profile');return text.slice(7)}}
function fixture(t,fetcher){const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'claude-profile-test-')),service=new ProvidersService({userData:root,secureStorage:secure,fetcher});t.after(()=>{service.close();fs.rmSync(root,{recursive:true,force:true})});return{root,service}}
const provider=(models)=>({name:'Profile fixture',protocol:'anthropic',baseUrl:'https://fixture.invalid/v1',auth:'api-key',models,defaultModel:models[0].id,keys:[{id:'one',name:'Key 1',key:'PRIVATE_PROFILE',models}]})

test('tool-returned images retain call association for Responses and follow all tool results in Chat',()=>{
  const image={type:'image',source:{type:'base64',media_type:'image/png',data:'TEST_IMAGE'}}
  const body={max_tokens:30,messages:[{role:'assistant',content:[{type:'tool_use',id:'shot',name:'Screenshot',input:{}},{type:'tool_use',id:'other',name:'Echo',input:{}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'shot',content:[{type:'text',text:'Screenshot'},image]},{type:'tool_result',tool_use_id:'other',content:'Echo'}]}]}
  const p={model:'m',baseUrl:'https://fixture.invalid',models:[{id:'m',vision:true}]}
  const r=convertRequest(body,{...p,protocol:'responses'}),output=r.input.find(i=>i.type==='function_call_output'&&i.call_id==='shot')
  assert.equal(output.output[1].type,'input_image');assert.match(output.output[1].image_url,/TEST_IMAGE/)
  const chat=convertRequest(body,{...p,protocol:'chat'})
  assert.deepEqual(chat.messages.filter(m=>m.role==='tool').map(m=>m.tool_call_id),['shot','other'])
  assert.equal(chat.messages.at(-2).role,'tool');assert.equal(chat.messages.at(-1).role,'user');assert.match(chat.messages.at(-1).content[0].text,/shot/);assert.match(chat.messages.at(-1).content[1].image_url.url,/TEST_IMAGE/)
  assert.match(JSON.stringify(convertRequest(body,{...p,protocol:'chat',models:[{id:'m',vision:false}]})),/图片内容未发送/)
})

test('reported metadata refresh preserves only explicit overrides and model request settings',async t=>{
  const {service}=fixture(t,async()=>Response.json({data:[{id:'m',context_window:64000,max_output_tokens:8192,capabilities:{tool_calling:{supported:true}},effort:{supported_levels:['low']}}]}))
  const first={id:'m',source:'server',context:128000,tools:false,efforts:['high'],reported:{context:128000,tools:false,efforts:['high']},overrides:{context:96000},request:{thinkingMode:'disabled'}}
  const input=provider([first]),result=await service.discover(input),model=result.keys[0].models[0]
  assert.equal(model.context,96000);assert.equal(model.reported.context,64000);assert.equal(model.tools,true);assert.deepEqual(model.efforts,['low']);assert.equal(model.request.thinkingMode,'disabled')
  assert.equal(normalizeModel({...model,overrides:{}}).context,64000)
})

test('each model has independent request overrides, mapped effort and redacted actual request preview',t=>{
  const {service}=fixture(t),m={id:'m',output:8192,efforts:['high'],defaultEffort:'high',request:{thinkingMode:'enabled',thinkingBudget:2048,effortField:'reasoning_effort',effortMap:{high:'medium'},extraBody:{vendor_option:true,private_secret:'DO_NOT_EXPOSE'}}}
  const input=provider([m,{id:'other'}]);input.thinking='disabled'
  const result=preview(service,input,'one','m')
  assert.equal(result.params.reasoning_effort,'medium');assert.equal(result.params.thinking.budget_tokens,2048);assert.equal(result.params.vendor_option,true);assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPOSE'));assert.ok(!JSON.stringify(result).includes('PRIVATE_PROFILE'))
  assert.equal(preview(service,input,'one','other').params.thinking.type,'disabled')
  assert.throws(()=>validate(provider([{id:'bad',request:{extraBody:{messages:[]}}}])),/兼容参数/)
})

test('CLI context uses the smallest declared route and keeps its known window while referencing tool images as files',async t=>{
  const seen=[];const {service}=fixture(t,async(_url,init)=>{seen.push(init.headers['x-api-key']);return Response.json({content:[{type:'text',text:'OK'}]})})
  const models=[{id:'m',context:64000,output:8192,vision:false}],input=provider(models)
  input.keys.push({id:'two',name:'Key 2',key:'PRIVATE_TWO',models:[{id:'m',vision:true}]})
  const saved=service.save(input),runtime=await service.runtime(saved.id,'m','','chat')
  assert.equal(runtime.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,'64000');assert.equal(runtime.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,'64000');assert.equal(runtime.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,'8192')
  const r=await fetch(runtime.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'x-api-key':runtime.env.ANTHROPIC_API_KEY},body:JSON.stringify({messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'shot',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'x'}}]}]}]})})
  assert.equal(r.status,200);assert.deepEqual(seen,['PRIVATE_PROFILE'])
})

test('text, tool round-trip, image and effort probes are explicit and return independent signed records',async t=>{
  let calls=0
  const {service}=fixture(t,async(_url,init)=>{
    calls++;const b=JSON.parse(init.body),last=b.messages.at(-1),image=Array.isArray(last.content)&&last.content.find(c=>c.type==='image')
    if(image){const zlib=require('node:zlib'),buf=Buffer.from(image.source.data,'base64');let at=8,raw;while(at<buf.length){const size=buf.readUInt32BE(at);if(buf.toString('ascii',at+4,at+8)==='IDAT')raw=zlib.inflateSync(buf.subarray(at+8,at+8+size));at+=size+12}return Response.json({content:[{type:'text',text:raw[1]===255?'red':'blue'}]})}
    if(b.tool_choice)return Response.json({content:[{type:'tool_use',id:'probe_call',name:'workspace_probe',input:{token:b.tools[0].input_schema.properties.token.enum[0]}}]})
    const result=Array.isArray(last.content)&&last.content.find(c=>c.type==='tool_result')
    return Response.json({content:[{type:'text',text:result?result.content:'OK'}]})
  })
  const input=provider([{id:'m',efforts:['high']}]);assert.equal(calls,0)
  const generation=await probe(service,input,'one','m','generation'),tools=await probe(service,input,'one','m','tools'),vision=await probe(service,input,'one','m','vision'),effort=await probe(service,input,'one','m','effort:high')
  for(const r of [generation,tools,vision,effort]){assert.equal(r.ok,true,r.detail);assert.equal(r.signature,generation.signature)}
  assert.equal(calls,6);assert.equal(fs.existsSync(service.file),false)
})

test('configuration snapshots support versioned redacted export, stale import rejection and encrypted restore',t=>{
  const {service,root}=fixture(t),saved=service.save(provider([{id:'m',request:{extraBody:{credential:'PRIVATE_BODY'}}}]))
  const exported=service.configStore.export();assert.equal(exported.schemaVersion,1);assert.ok(!JSON.stringify(exported).includes('PRIVATE_'));assert.ok(!JSON.stringify(exported).includes('encryptedKey'))
  const backup=service.configStore.backup('fixture backup'),changed=service.save({...saved,name:'Changed'})
  const plan=service.configStore.prepareBackup(backup);assert.ok(plan.changes.some(c=>c.includes('Profile fixture')))
  service.configStore.apply(plan.token);assert.equal(service.list()[0].name,'Profile fixture');assert.equal(service.resolve(service.list()[0],'one').key,'PRIVATE_PROFILE')
  const imported=structuredClone(exported);imported.providers[0].name='Imported name';const draft=service.configStore.prepare(imported)
  service.save({...service.list()[0],name:'External edit'});assert.throws(()=>service.configStore.apply(draft.token),/重新预览/)
  const fresh=service.configStore.prepare(imported);service.configStore.apply(fresh.token);assert.equal(service.list()[0].name,'Imported name');assert.equal(service.resolve(service.list()[0],'one').key,'PRIVATE_PROFILE')
  const other=structuredClone(exported);other.providers[0].id='new-supplier';service.configStore.apply(service.configStore.prepare(other).token);assert.equal(service.list().find(p=>p.id==='new-supplier').enabled,false)
  assert.ok(fs.readdirSync(path.join(root,'provider-backups')).length>=3)
  assert.throws(()=>service.configStore.prepare({...exported,schemaVersion:99}),/版本/)
})

test('configuration apply rolls back both files on failure and startup recovers an interrupted transaction',t=>{
  const {service,root}=fixture(t);service.save(provider([{id:'m'}]));const before=service.configStore.snapshot(),data=service.configStore.export();data.providers[0].name='Replacement'
  const plan=service.configStore.prepare(data),rename=fs.renameSync;let injected=false
  try{
    fs.renameSync=(from,to)=>{if(to===service.poolsFile&&!injected){injected=true;throw new Error('fixture disk failure')}return rename(from,to)}
    assert.throws(()=>service.configStore.apply(plan.token),/fixture disk failure/)
  }finally{fs.renameSync=rename}
  assert.deepEqual(service.configStore.snapshot(),before);assert.equal(fs.existsSync(service.configStore.journal),false)
  fs.writeFileSync(service.configStore.journal,JSON.stringify({schemaVersion:1,before}));fs.writeFileSync(service.file,JSON.stringify([{...before.providers[0],name:'Partial transaction'}]))
  const restarted=new ProvidersService({userData:root,secureStorage:secure});t.after(()=>restarted.close())
  assert.deepEqual(restarted.configStore.snapshot(),before);assert.equal(fs.existsSync(service.configStore.journal),false)
})

test('text-only routes continue the same image-containing history through all three protocols',async t=>{
  const received=[]
  const {service,root}=fixture(t,async(url,init)=>{
    const body=JSON.parse(init.body);received.push(body)
    assert.ok(!JSON.stringify(body).includes('data:image/'));assert.ok(!JSON.stringify(body).includes('HISTORY_IMAGE_BYTES'))
    assert.match(JSON.stringify(body),/本地图片文件/)
    if(String(url).endsWith('/chat/completions'))return Response.json({choices:[{message:{content:'continued'},finish_reason:'stop'}]})
    if(String(url).endsWith('/responses'))return Response.json({output:[{type:'message',content:[{type:'output_text',text:'continued'}]}],status:'completed'})
    return Response.json({content:[{type:'text',text:'continued'}]})
  })
  const image={type:'image',source:{type:'base64',media_type:'image/png',data:Buffer.from('HISTORY_IMAGE_BYTES').toString('base64')}}
  for(const protocol of ['anthropic','chat','responses']){
    const p=service.save({...provider([{id:'text-model',vision:false,tools:true}]),protocol})
    const runtime=await service.runtime(p.id,'text-model','',protocol)
    const messages=[{role:'user',content:[{type:'text',text:'old image'},image]},{role:'assistant',content:[{type:'tool_use',id:'screenshot-call',name:'Screenshot',input:{}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'screenshot-call',content:[{type:'text',text:'screenshot result'},image]}]}]
    for(const prompt of ['continue SVG','continue HTML']){
      messages.push({role:'user',content:prompt});const before=JSON.stringify(messages)
      const r=await fetch(runtime.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'x-api-key':runtime.env.ANTHROPIC_API_KEY},body:JSON.stringify({messages,stream:false})})
      assert.equal(r.status,200);assert.equal((await r.json()).content[0].text,'continued');assert.equal(JSON.stringify(messages),before)
    }
    const last=received.at(-1)
    if(protocol==='chat')assert.match(last.messages.find(m=>m.tool_call_id==='screenshot-call').content,/本地图片文件/)
    if(protocol==='responses')assert.match(last.input.find(i=>i.call_id==='screenshot-call'&&i.type==='function_call_output').output,/本地图片文件/)
  }
  assert.equal(received.length,6)
  const files=fs.readdirSync(path.join(root,'attachments','image-references'));assert.equal(files.length,1)
  assert.equal(fs.readFileSync(path.join(root,'attachments','image-references',files[0]),'utf8'),'HISTORY_IMAGE_BYTES')
})
