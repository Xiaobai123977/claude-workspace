import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-topology-exploration-')),project=path.join(data,'project'),id='topology-exploration',proof=path.join(data,'proof.json'),fixture=path.join(data,'graph.json')
fs.mkdirSync(path.join(project,'src'),{recursive:true});fs.writeFileSync(path.join(project,'src/app.ts'),'// source\nfunction validate(){}\nfunction save(){}\n')
const node=(id,label,parent)=>({id,label,purpose:'处理请求',kind:'module',inputs:['请求'],outputs:['结果'],refs:[{path:'src/app.ts',line:2}],...(parent?{parent}:{})})
const graph={version:1,title:'并发探索测试',description:'静态代码分析',nodes:[node('entry','请求入口'),node('store','数据存储'),node('validate','参数校验','entry')],edges:[{id:'save',source:'entry',target:'store',label:'保存请求',data:'校验后的数据',refs:[{path:'src/app.ts',line:3}]}]}
fs.writeFileSync(fixture,JSON.stringify(graph,null,2));fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:id,sessions:[{id,cwd:project,title:'Concurrent exploration',archived:false,messages:[],model:'sonnet',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'profile'),CLAUDE_GUI_TEST_TOPOLOGY:fixture,CLAUDE_GUI_TEST_TOPOLOGY_PROOF:proof};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
const button=name=>page.getByRole('button',{name,exact:true}),depth=()=>page.getByRole('combobox',{name:'拓扑探索深度'}),scope=()=>page.getByRole('combobox',{name:'拓扑探索范围'}),input=()=>page.getByRole('textbox',{name:'消息输入'})
const state=()=>page.evaluate(()=>window.workspace.get())
async function idle(){for(let n=0;n<200;n++){const s=await state();if(s.sessions[0].messages.at(-1)?.role==='assistant'&&s.sessions[0].messages.at(-1).status!=='running')return;await new Promise(r=>setTimeout(r,40))}throw Error('Reply did not finish')}
try{
  await input().waitFor();await button('业务拓扑').click();await button('并发探索').click();await page.getByRole('dialog',{name:'并发探索设置'}).waitFor()
  assert.deepEqual(await depth().locator('option').allTextContents(),['1 层','2 层','N 层（自定义）','模型自行判断结束']);assert.equal(await scope().inputValue(),'')
  await depth().selectOption('1');await button('准备并发探索').click();await page.locator('.topology-context-chips').waitFor();await input().press('Enter');await idle();await button('模块：请求入口').waitFor()
  const firstRequest=(await state()).sessions[0].messages.find(m=>m.role==='user').topologySelection.requests[0];assert.equal(firstRequest.depth,1);assert.equal(firstRequest.parallel,true);assert.deepEqual(firstRequest.targets,[])
  assert.equal(await page.locator('.agent-activity').count(),2);assert.equal(await page.getByText('子代理模块探索结果 1',{exact:true}).count(),0)
  await page.locator('.agent-activity-summary').first().click();await page.getByText('子代理模块探索结果 1',{exact:true}).waitFor()
  assert.match(JSON.parse(fs.readFileSync(proof,'utf8')).prompt,/原生 Agent\/Task/)
  await button('并发探索').click();assert.equal(await depth().inputValue(),'2');await button('关闭拓扑探索设置').click()
  await button('模块：请求入口').click();await button('并发探索此节点').click();assert.equal(await scope().inputValue(),'entry');await depth().selectOption('auto');await button('准备并发探索').click()
  await input().press('Enter');await idle();assert.match(JSON.parse(fs.readFileSync(proof,'utf8')).prompt,/逐项解释停止依据/);assert.match(JSON.parse(fs.readFileSync(proof,'utf8')).prompt,/"moduleId": "entry"/)
  assert.equal(JSON.parse(fs.readFileSync(proof,'utf8')).continuations.length,2)
  assert.match((await state()).sessions[0].messages.at(-1).notice,/自动探索尚未完成.*连续两轮/)
  const current=fs.readFileSync(path.join(project,'.claude/workspace-topology.json'),'utf8')
  await button('模块：请求入口').click();await button('重新生成此节点').click();assert.equal(await scope().inputValue(),'entry');await depth().selectOption('custom');await page.getByRole('spinbutton',{name:'自定义拓扑层数'}).fill('0');await button('准备重新生成').click();await page.getByRole('alert').getByText('探索深度应为 1–100 层',{exact:true}).waitFor()
  await page.getByRole('spinbutton',{name:'自定义拓扑层数'}).fill('4');await button('准备重新生成').click();await page.getByRole('status').getByText(/旧图已备份/).waitFor();const backups=fs.readdirSync(path.join(data,'topology/backups'),{recursive:true}).filter(name=>name.endsWith('.json'));assert.equal(backups.length,1);assert.equal(fs.readFileSync(path.join(data,'topology/backups',backups[0]),'utf8'),current)
  await input().press('Enter');await idle();let latest=(await state()).sessions[0].messages.findLast(m=>m.role==='user');assert.equal(latest.topologySelection.requests[0].depth,4);assert.equal(latest.topologySelection.requests[0].action,'regenerate');assert.match(JSON.parse(fs.readFileSync(proof,'utf8')).prompt,/不得删除父模块/)
  const regenerated=JSON.parse(fs.readFileSync(path.join(project,'.claude/workspace-topology.json'),'utf8'));assert.deepEqual(regenerated.nodes.find(n=>n.id==='store'),graph.nodes.find(n=>n.id==='store'));assert.deepEqual(regenerated.edges,graph.edges)
  await button('重新生成拓扑').click();assert.equal(await scope().inputValue(),'');await depth().selectOption('2')
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/topology-concurrent-exploration.png')})
  await button('准备重新生成').click();await input().press('Enter');await idle();latest=(await state()).sessions[0].messages.findLast(m=>m.role==='user');assert.deepEqual(latest.topologySelection.requests[0].targets,[]);assert.equal(latest.topologySelection.requests[0].depth,2)
  const multiGraph=JSON.parse(fs.readFileSync(path.join(project,'.claude/workspace-topology.json'),'utf8'));multiGraph.nodes.push(node('outside','未选模块'),node('validation-more','校验子模块','entry'));fs.writeFileSync(path.join(project,'.claude/workspace-topology.json'),JSON.stringify(multiGraph));await button('刷新拓扑').click();await button('模块：未选模块').waitFor()
  await button('模块：请求入口').click();await button('收起拓扑批注窗口').click();await button('模块：数据存储').click({modifiers:['Control']});await button('并发探索所选模块').click();assert.equal(await scope().inputValue(),'@multiple')
  assert.equal(await page.getByRole('checkbox',{name:'探索模块 请求入口 · entry',exact:true}).isChecked(),true);assert.equal(await page.getByRole('checkbox',{name:'探索模块 数据存储 · store',exact:true}).isChecked(),true)
  await page.getByRole('checkbox',{name:'探索模块 校验子模块 · validation-more',exact:true}).check();await page.getByText('已选 3 个模块，合并为 2 个探索范围。父子重叠部分只探索一次。',{exact:true}).waitFor();await depth().selectOption('auto')
  await page.screenshot({path:path.join(root,'artifacts/topology-multi-module.png')});await button('准备并发探索').click();await input().press('Enter');await idle()
  const multiProof=JSON.parse(fs.readFileSync(proof,'utf8')).prompt,context=JSON.parse(multiProof.slice(multiProof.lastIndexOf('\n{\n  "file":')+1));assert.deepEqual(context.scope.moduleIds,['entry','store']);assert.deepEqual(context.scope.requestedModuleIds,['entry','store','validation-more']);assert.deepEqual(context.scope.overlappingModuleIds,['validation-more']);assert.equal(context.relatedNodes.some(n=>n.id==='outside'),false)
  latest=(await state()).sessions[0].messages.findLast(m=>m.role==='user');assert.equal(latest.topologySelection.requests[0].targets.length,3)
  if(await button('收起拓扑批注窗口').count())await button('收起拓扑批注窗口').click()
  await button('模块：请求入口').click();await button('收起拓扑批注窗口').click();await button('模块：数据存储').click({modifiers:['Control']});await page.getByRole('dialog',{name:'拓扑批注窗口'}).getByRole('button',{name:'重新生成所选模块',exact:true}).click();assert.equal(await scope().inputValue(),'@multiple')
  await button('准备重新生成').click();await input().press('Enter');await idle();const finalGraph=JSON.parse(fs.readFileSync(path.join(project,'.claude/workspace-topology.json'),'utf8'));assert.deepEqual(finalGraph.nodes.find(n=>n.id==='outside'),multiGraph.nodes.find(n=>n.id==='outside'))
  if(await button('收起拓扑批注窗口').count())await button('收起拓扑批注窗口').click()
  await button('并发探索').click();await depth().selectOption('custom');await page.getByRole('spinbutton',{name:'自定义拓扑层数'}).fill('7');await page.screenshot({path:path.join(root,'artifacts/topology-exploration-options.png')})
  const changed=JSON.parse(fs.readFileSync(path.join(project,'.claude/workspace-topology.json'),'utf8'));changed.description+='外部变化';fs.writeFileSync(path.join(project,'.claude/workspace-topology.json'),JSON.stringify(changed));await button('准备并发探索').click();await page.getByRole('alert').getByText('拓扑已更新，请刷新后重新选择。',{exact:true}).waitFor()
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'并发探索设置'}).count(),0);assert.equal(await page.locator('.topology-panel').isVisible(),true)
  assert.deepEqual(errors,[]);console.log('Topology exploration UI passed: global first graph, 1/2/N/auto depths, module scope, multiple module selection and parent/child overlap merging, native child-event cards, regeneration scope, exact backup, stale dialog guard and Escape. Isolated fixture, no upstream calls.')
}finally{await app.close()}
