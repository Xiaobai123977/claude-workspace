import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'topology-flow-ui-')),project=path.join(data,'project'),id='flow-ui'
fs.mkdirSync(path.join(project,'.claude'),{recursive:true});fs.writeFileSync(path.join(project,'app.js'),'// route\n// consumer\n')
const refs=[{path:'app.js',line:1}],boundary=(direction,port,kind)=>({direction,port,kind,reason:'已核对入口和终点',refs}),graph={version:1,flowVersion:1,title:'数据流检查',description:'测试输入来源与输出去向',nodes:[{id:'start',label:'生产结果',kind:'module',purpose:'处理用户输入',inputs:['请求'],outputs:['结果','被漏掉的写入'],refs,boundaries:[boundary('input','请求','entry')]},{id:'sink',label:'真实终点',kind:'terminal',purpose:'归档',inputs:['待归档结果'],outputs:['审计记录'],refs,boundaries:[boundary('output','审计记录','terminal')]}],edges:[{id:'flow',source:'start',target:'sink',kind:'data',label:'提交归档',data:'处理结果',sourceOutputs:['结果'],targetInputs:['待归档结果'],refs}]},file=path.join(project,'.claude/workspace-topology.json')
const save=()=>fs.writeFileSync(file,JSON.stringify(graph));save()
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:id,sessions:[{id,cwd:project,title:'Flow checks',archived:false,messages:[],model:'sonnet',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'profile')};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
try{
  await page.getByRole('textbox',{name:'消息输入'}).waitFor();await page.getByRole('button',{name:'业务拓扑',exact:true}).click()
  const check=page.locator('.topology-flow-check');await check.locator('summary').getByText('未通过完整性检查',{exact:false}).waitFor();await check.locator('summary').click()
  await check.getByRole('button',{name:'生产结果：「被漏掉的写入」没有明确去向',exact:true}).click()
  await page.getByRole('dialog',{name:'拓扑批注窗口'}).waitFor();await page.locator('.topology-target-details h3').getByText('生产结果',{exact:true}).waitFor()
  assert.equal(await check.getByRole('button').count(),1,'A real terminal is accepted while a connected node still exposes its omitted output')
  await page.getByRole('button',{name:'收起拓扑批注窗口'}).click();graph.nodes[0].outputs.pop();save();await page.getByRole('button',{name:'刷新拓扑',exact:true}).click()
  await check.locator('summary').getByText('数据流映射检查通过',{exact:true}).waitFor()
  await page.getByRole('button',{name:'连接：提交归档',exact:true}).click();await page.locator('.topology-target-details').getByText('来源输出',{exact:true}).waitFor();await page.locator('.topology-target-details').getByText('待归档结果',{exact:true}).waitFor()
  await page.getByRole('button',{name:'收起拓扑批注窗口'}).click();delete graph.flowVersion;delete graph.edges[0].sourceOutputs;save();await page.getByRole('button',{name:'刷新拓扑',exact:true}).click();await check.locator('summary').getByText('未通过完整性检查',{exact:false}).waitFor()
  if(await check.getAttribute('open')===null)await check.locator('summary').click()
  await check.getByText('旧图尚未声明数据流协议，需要补齐输入来源和输出去向',{exact:true}).waitFor()
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/topology-flow-check.png')})
  assert.deepEqual(errors,[]);console.log('Data-flow UI passed: missing output on connected node, real terminal, issue selection, explicit edge ports, closed graph success, readable legacy graph flagged incomplete. Isolated data; no upstream calls.')
}finally{await app.close()}
