import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'topology-workflow-ui-')),project=path.join(data,'new-project'),fixture=path.join(data,'design.json'),id='workflow-ui'
fs.mkdirSync(project)
const boundary=(direction,port,kind)=>({direction,port,kind,reason:'需求定义的入口和终点',refs:[]}),graph={version:1,flowVersion:1,title:'输入标准化项目',description:'从需求开始的计划设计',nodes:[{id:'start',label:'规范化输入',purpose:'去除前后空格',kind:'module',status:'planned',inputs:['用户文本'],outputs:['规范化文本'],acceptance:['去除前后空格','空串仍返回空串'],refs:[],boundaries:[boundary('input','用户文本','entry')]},{id:'end',label:'返回结果',purpose:'输出处理结果',kind:'terminal',status:'planned',inputs:['待返回文本'],outputs:['最终结果'],acceptance:['完整返回规范化文本'],refs:[],boundaries:[boundary('output','最终结果','terminal')]}],edges:[{id:'result',source:'start',target:'end',kind:'data',status:'planned',label:'交付结果',data:'规范化文本',sourceOutputs:['规范化文本'],targetInputs:['待返回文本'],refs:[]}]}
fs.writeFileSync(fixture,JSON.stringify(graph));fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:id,sessions:[{id,cwd:project,title:'从拓扑开始开发',archived:false,messages:[],model:'sonnet',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'profile'),CLAUDE_GUI_TEST_TOPOLOGY_WORKFLOW:fixture};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
const button=name=>page.getByRole('button',{name,exact:true}),input=()=>page.getByRole('textbox',{name:'消息输入'}),dialog=()=>page.getByRole('dialog',{name:'拓扑设计与开发'})
async function send(){await input().press('Enter');await page.waitForFunction(()=>document.querySelector('textarea[aria-label="消息输入"]').value==='');for(let n=0;n<200;n++){const state=await page.evaluate(()=>window.workspace.get());if(state.sessions[0].messages.at(-1)?.role==='assistant'&&state.sessions[0].messages.at(-1).status!=='running')return;await new Promise(r=>setTimeout(r,40))}throw Error('Workflow did not finish')}
try{
  await input().waitFor();await button('业务拓扑').click();await button('从需求设计拓扑').click();await dialog().waitFor()
  await dialog().getByRole('button',{name:'加入对话',exact:true}).click();await dialog().getByRole('alert').getByText('请先填写设计需求。',{exact:true}).waitFor()
  await page.getByRole('textbox',{name:'拓扑设计开发要求'}).fill('开发文本标准化小项目，先画清输入处理输出，不要先写代码。');await dialog().getByRole('button',{name:'加入对话',exact:true}).click();await page.locator('.topology-context-chips').waitFor();await send()
  await button('模块：规范化输入').waitFor();assert.equal(fs.existsSync(path.join(project,'app.cjs')),false,'Design must not create implementation files')
  await page.locator('.topology-flow-check summary').getByText('设计数据流已闭合 · 待实现',{exact:false}).waitFor();assert.equal(await page.locator('.topology-node.planned').count(),2)
  await button('模块：规范化输入').click();await page.locator('.topology-acceptance').getByText('去除前后空格',{exact:true}).waitFor();await button('按此模块开发').click();assert.equal(await page.getByRole('combobox',{name:'拓扑开发范围'}).inputValue(),'selected');await button('关闭拓扑设计与开发').click();await button('收起拓扑批注窗口').click()
  await button('设计与开发').click();await page.getByRole('combobox',{name:'拓扑开发范围'}).selectOption('');await page.getByRole('textbox',{name:'拓扑设计开发要求'}).fill('按验收条件实现并执行本地测试。');await dialog().getByRole('button',{name:'加入对话',exact:true}).click();await send()
  await page.locator('.topology-flow-check summary').getByText('数据流映射检查通过',{exact:true}).waitFor();assert.equal(await page.locator('.topology-node.planned').count(),0);assert(fs.existsSync(path.join(project,'app.cjs')))
  const implemented=JSON.parse(fs.readFileSync(path.join(project,'.claude/workspace-topology.json'),'utf8'));assert.equal(implemented.nodes[0].verification.status,'passed');assert.deepEqual(implemented.nodes.map(n=>n.id),['start','end'])
  await button('模块：规范化输入').click();await page.locator('.topology-target-details').getByText(/验证记录 · 报告通过/).waitFor();await button('核对代码与拓扑').click();await dialog().getByRole('button',{name:'加入对话',exact:true}).click();await send()
  const session=await page.evaluate(id=>window.workspace.readSession(id),id);assert.deepEqual(session.messages.filter(m=>m.role==='user').map(m=>m.topologySelection.requests[0].action),['design','implement','sync']);assert.equal(session.messages.filter(m=>m.role==='user').at(-1).topologySelection.requests[0].targets[0].id,'start')
  await button('展开拓扑').click();await button('模块：规范化输入').click();fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/topology-bidirectional.png')})
  assert.deepEqual(errors,[]);console.log('Bidirectional topology UI passed: empty project design, requirement validation, planned states and acceptance, scoped implementation request, actual fixture code + Node test, same stable IDs, code sync and immutable selection context. Isolated fake CLI; no upstream calls.')
}finally{await app.close()}
