import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'business-flow-ui-')),cwd=path.join(data,'project'),id='business-flow',fixture=path.join(data,'graphs.json')
fs.mkdirSync(cwd);fs.writeFileSync(path.join(cwd,'app.cjs'),'// verified entry\n// process\n// response\n')
const refs=[{path:'app.cjs',line:1}],boundary=(direction,port,kind,parentPort)=>({direction,port,kind,reason:'已核实真实输入输出',refs,...(parentPort?{parentPort}:{})})
const graph={version:1,flowVersion:1,title:'提交申请与返回业务结果',description:'沿具体数据流阅读业务：申请进入、处理，成功或失败分别返回；重试走独立回路。',nodes:[
  {id:'process',label:'处理申请',purpose:'校验并处理用户申请',kind:'module',inputs:['用户提交','重试事件'],outputs:['成功结果','失败结果'],refs,boundaries:[boundary('input','用户提交','entry')]},
  {id:'reply',label:'返回业务结果',purpose:'返回成功或失败并触发必要重试',kind:'terminal',inputs:['成功回执','失败回执'],outputs:['最终响应','重试请求'],refs,boundaries:[boundary('output','最终响应','terminal')],exploration:{state:'leaf',reason:'app.cjs:3 仅格式化并返回结果，无独立子流程'}}
],edges:[
  {id:'success',source:'process',target:'reply',label:'成功结果',data:'成功的申请处理结果',kind:'data',sourceOutputs:['成功结果'],targetInputs:['成功回执'],refs},
  {id:'failure',source:'process',target:'reply',label:'失败原因',data:'失败原因与错误信息',kind:'data',sourceOutputs:['失败结果'],targetInputs:['失败回执'],refs},
  {id:'retry',source:'reply',target:'process',label:'重试请求',data:'用户发起的业务重试',kind:'return',sourceOutputs:['重试请求'],targetInputs:['重试事件'],refs}
]}
const expanded=structuredClone(graph)
expanded.nodes.push({id:'process.step',parent:'process',label:'核验并执行业务',purpose:'原子的业务处理步骤',kind:'module',inputs:['原始申请','重试输入'],outputs:['成功输出','错误输出'],refs,exploration:{state:'leaf',reason:'app.cjs:2 已核实为单次纯业务操作，不含独立的处理子流程'},boundaries:[boundary('input','原始申请','parent','用户提交'),boundary('input','重试输入','parent','重试事件'),boundary('output','成功输出','parent','成功结果'),boundary('output','错误输出','parent','失败结果')]})
fs.writeFileSync(fixture,JSON.stringify([graph,expanded]));fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:id,sessions:[{id,cwd,title:'业务流程测试',archived:false,messages:[],model:'sonnet',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'profile'),CLAUDE_GUI_TEST_TOPOLOGY_AUTO:fixture};delete env.ELECTRON_RUN_AS_NODE
let app,page;const errors=[]
const launch=async()=>{app=await electron.launch({executablePath:require('electron'),args:[root],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('textbox',{name:'消息输入'}).waitFor()}
const button=name=>page.getByRole('button',{name,exact:true})
try{
  await launch();await button('业务拓扑').click();await button('并发探索').click();await page.getByRole('combobox',{name:'拓扑探索深度'}).selectOption('auto');await button('准备并发探索').click();await page.getByRole('textbox',{name:'消息输入'}).press('Enter')
  await button('模块：处理申请').waitFor({timeout:15000})
  const deadline=Date.now()+15000;let session
  do{session=(await page.evaluate(()=>window.workspace.get())).sessions[0];if(session.messages.at(-1)?.status==='done')break;await new Promise(r=>setTimeout(r,100))}while(Date.now()<deadline)
  assert.equal(session.messages.at(-1).status,'done');assert.match(session.messages.at(-1).notice,/检查通过/);assert.equal(session.messages.at(-1).internalUserIds.length,1)
  assert.equal(session.messages.filter(m=>m.role==='user').length,1,'Automatic continuation must not impersonate user chat messages')
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd,'.claude/workspace-topology.json'),'utf8')).nodes.length,3)
  await button('展开拓扑').click();await page.locator('.topology-exploration-progress').getByText('已展开 2 层 · 探索停止依据已齐全',{exact:true}).waitFor()
  const success=page.getByRole('button',{name:'连接：成功结果',exact:true}),failure=page.getByRole('button',{name:'连接：失败原因',exact:true})
  assert.notEqual(await success.locator('.edge-line').getAttribute('d'),await failure.locator('.edge-line').getAttribute('d'))
  assert.equal(await page.locator('.flow-wire.return').count(),1);await page.getByRole('img',{name:'业务流程全景导航，点击定位'}).waitFor()
  await button('模块：处理申请').click();await button('收起拓扑批注窗口').click();await button('突出选中流程').click();assert.ok(await page.locator('.flow-port').count()>=8)
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/topology-business-flow.png')})
  await button('模块：处理申请').dblclick();await button('模块：核验并执行业务').waitFor();assert.ok(await page.locator('.boundary-wire').count()>=4)
  await app.close();await launch();await button('业务拓扑').click();await button('模块：处理申请').waitFor();assert.equal((await page.evaluate(()=>window.workspace.get())).sessions[0].messages.filter(m=>m.role==='user').length,1)
  // Start another automatic job, then interrupt while its second batch waits.
  await app.close();env.CLAUDE_GUI_TEST_TOPOLOGY_AUTO_WAIT='1';await launch();await button('业务拓扑').click();await button('并发探索').click();await page.getByRole('combobox',{name:'拓扑探索深度'}).selectOption('auto');await button('准备并发探索').click();await page.getByRole('textbox',{name:'消息输入'}).press('Enter')
  const stopDeadline=Date.now()+10000
  do{session=(await page.evaluate(()=>window.workspace.get())).sessions[0];if(session.messages.at(-1)?.notice?.includes('第 2 轮'))break;await new Promise(r=>setTimeout(r,100))}while(Date.now()<stopDeadline)
  assert.match(session.messages.at(-1).notice,/第 2 轮/);await button('停止执行').click();await button('发送消息').waitFor()
  session=(await page.evaluate(()=>window.workspace.get())).sessions[0];assert.equal(session.messages.at(-1).status,'stopped');assert.match(session.messages.at(-1).notice,/已停止/);assert.equal(session.messages.filter(m=>m.role==='user').length,2)
  assert.deepEqual(errors,[]);console.log('Business flow UI passed: actual automatic second round, depth/leaf evidence, one visible user request, ports, distinct success/error wires, return path, overview navigation, parent boundaries, restart and cancellation during automatic continuation. Isolated fake CLI; no upstream calls.')
}finally{await app?.close()}
