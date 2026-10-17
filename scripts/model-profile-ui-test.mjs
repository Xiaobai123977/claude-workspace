import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),{colorPng}=require('../electron/model-probe.cjs')
const data=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'claude-profile-ui-')),cwd=path.join(data,'project'),profile=path.join(data,'profile'),proof=path.join(data,'proof.json');fs.mkdirSync(cwd);fs.mkdirSync(profile)
const requests=[]
const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json')
  if(req.url.endsWith('/models')){res.end(JSON.stringify({data:[{id:'model-one',context_window:128000,max_output_tokens:8192,effort:{supported_levels:['low','high']},input_modalities:['text','image'],capabilities:{tool_calling:{supported:true},thinking:{supported:true}}},{id:'model-two',context_window:64000,max_output_tokens:4096}]}));return}
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests.push(body)
  const last=body.messages.at(-1),image=Array.isArray(last.content)&&last.content.find(b=>b.type==='image'),result=Array.isArray(last.content)&&last.content.find(b=>b.type==='tool_result')
  const content=body.tool_choice?[{type:'tool_use',id:'profile-call',name:'workspace_probe',input:{token:body.tools[0].input_schema.properties.token.enum[0]}}]:[{type:'text',text:image?(image.source.data===colorPng(true)?'red':'blue'):result?result.content:'OK'}]
  res.end(JSON.stringify({id:'profile-response',type:'message',role:'assistant',model:body.model,stop_reason:body.tool_choice?'tool_use':'end_turn',content}))
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const id='profile-ui';fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs'),configDir:profile},activeId:id,sessions:[{id,cwd,title:'Model profile test',createdAt:Date.now(),updatedAt:Date.now(),model:'',effort:'',permission:'default',messages:[]}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native-profile'),CLAUDE_GUI_TEST_PROOF:proof};delete env.ELECTRON_RUN_AS_NODE
let app,page;const errors=[]
try{
  app=await electron.launch({executablePath:require('electron'),args:[root],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>void d.accept().catch(()=>{}));await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  const saved=await page.evaluate(async({id,url})=>{const input={name:'Profile UI supplier',baseUrl:url,protocol:'anthropic',auth:'api-key',models:[],keys:[{id:'one',name:'Key 1',key:'PRIVATE_PROFILE_UI_ONE',models:[]},{id:'two',name:'Key 2',key:'PRIVATE_PROFILE_UI_TWO',models:[]}]};const discovered=await window.workspace.discoverModels(input);const p=await window.workspace.saveProvider({...input,...discovered,keys:input.keys.map(k=>({...k,...discovered.keys.find(x=>x.id===k.id),key:k.key})),defaultModel:'model-one'});await window.workspace.activateProvider(id,p.id);return p},{id,url:`http://127.0.0.1:${server.address().port}/v1`})
  await page.getByRole('button',{name:'设置',exact:true}).last().click();await page.locator('.settings-nav').getByRole('button',{name:'连接与模型',exact:true}).click()
  await page.getByRole('region',{name:'已保存的供应商'}).getByRole('button',{name:/Profile UI supplier/}).click()
  await page.getByText('高级模型能力',{exact:true}).click();await page.getByLabel('上下文 token 容量',{exact:true}).fill('96000')
  await page.getByText('能力来源与覆盖',{exact:true}).click();await page.locator('.model-source-table').getByText('96000',{exact:true}).first().waitFor()
  await page.getByRole('button',{name:'恢复接口报告值',exact:true}).click();assert.equal(await page.getByLabel('上下文 token 容量',{exact:true}).inputValue(),'128000');await page.getByLabel('上下文 token 容量',{exact:true}).fill('96000')
  await page.getByText('此模型的请求与协议兼容',{exact:true}).click();await page.getByLabel('模型思考请求模式').selectOption('disabled');await page.getByLabel('模型思考强度字段').selectOption('reasoning_effort')
  await page.getByLabel('此模型默认思考强度').selectOption('high');await page.getByLabel('模型思考档位映射').fill('{"high":"medium"}');await page.getByLabel('模型兼容参数').fill('{"vendor_option":1}');await page.getByRole('button',{name:'应用模型 JSON',exact:true}).click()
  await page.getByText('实际请求预览与验证',{exact:true}).click();await page.getByRole('button',{name:'刷新脱敏请求预览',exact:true}).click()
  const request=JSON.parse(await page.getByLabel('模型实际请求预览').textContent());assert.equal(request.reasoning_effort,'medium');assert.equal(request.thinking.type,'disabled');assert.equal(request.vendor_option,1)
  for(const [kind,label] of [['generation','生成 · 已验证'],['tools','工具往返 · 已验证'],['vision','图片识别 · 已验证'],['effort:high','思考 high · 参数已接受']]){
    await page.getByLabel('模型验证项目').selectOption(kind);await page.getByRole('button',{name:'验证所选 Key 和模型（产生用量）',exact:true}).click();await page.locator('.model-checks').getByText(new RegExp(label)).waitFor()
  }
  assert.equal(requests.length,6)
  await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByRole('status').filter({hasText:'连接已保存'}).waitFor()
  const updated=(await page.evaluate(()=>window.workspace.providers())).find(p=>p.id===saved.id)
  assert.equal(updated.keys[0].models[0].request.thinkingMode,'disabled');assert.equal(updated.keys[0].models[0].context,96000);assert.equal(updated.keys[0].models[0].reported.context,128000);assert.ok(!updated.keys[1].models[0].verification)
  const disk=fs.readFileSync(path.join(data,'providers.json'),'utf8');assert.ok(!disk.includes('PRIVATE_'));assert.equal(JSON.parse(disk)[0].schemaVersion,2)
  await page.screenshot({path:path.join(root,'artifacts/model-profile.png')})
  await page.getByRole('button',{name:'工作区',exact:true}).click();await page.getByRole('textbox',{name:'消息输入'}).fill('Check model runtime');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByRole('button',{name:'发送消息',exact:true}).waitFor()
  const runtime=JSON.parse(fs.readFileSync(proof));assert.equal(runtime.maxContextTokens,'96000');assert.equal(runtime.autoCompactWindow,'96000');assert.equal(runtime.maxOutputTokens,'8192')
  await page.getByRole('button',{name:'设置',exact:true}).last().click();await page.locator('.settings-nav').getByRole('button',{name:'连接与模型',exact:true}).click();await page.getByRole('button',{name:'导入、导出与备份',exact:true}).click()
  const exchange=path.join(data,'exchange.json');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({filePath:file,canceled:false});dialog.showOpenDialog=async()=>({filePaths:[file],canceled:false})},exchange)
  await page.getByRole('button',{name:'导出脱敏配置',exact:true}).click();await page.getByRole('status').filter({hasText:'脱敏配置已导出'}).waitFor()
  const exported=JSON.parse(fs.readFileSync(exchange,'utf8'));assert.ok(!JSON.stringify(exported).includes('PRIVATE_'));assert.ok(!JSON.stringify(exported).includes('encryptedKey'))
  exported.providers[0].name='Imported profile supplier';fs.writeFileSync(exchange,JSON.stringify(exported))
  await page.getByRole('button',{name:'导入配置并预览',exact:true}).click();await page.getByText('更新供应商：Imported profile supplier',{exact:true}).waitFor();assert.equal((await page.evaluate(()=>window.workspace.providers()))[0].name,'Profile UI supplier')
  await page.getByRole('button',{name:'应用已预览配置',exact:true}).click();await page.getByRole('status').filter({hasText:'模型配置已应用'}).waitFor();assert.equal((await page.evaluate(()=>window.workspace.providers()))[0].name,'Imported profile supplier')
  await page.getByRole('button',{name:'预览恢复',exact:true}).first().click();await page.getByRole('button',{name:'应用已预览配置',exact:true}).click();await page.getByRole('status').filter({hasText:'模型配置已应用'}).waitFor();assert.equal((await page.evaluate(()=>window.workspace.providers()))[0].name,'Profile UI supplier')
  await page.screenshot({path:path.join(root,'artifacts/model-config-files.png')});assert.deepEqual(errors,[])
  console.log('Model profile UI passed: per-Key overrides and provenance, request mapping, explicit generation/tools/vision/effort checks, encrypted records, CLI context/output environment, versioned redacted export, import preview and backup restore.')
}catch(e){if(page&&!page.isClosed())await page.screenshot({path:path.join(root,'artifacts/model-profile-failure.png')}).catch(()=>{});throw e}finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});server.close();console.log('Isolated model-profile fixture: '+data)}
