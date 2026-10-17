import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-topology-ui-')),project=path.join(data,'project'),id='topology-ui',proof=path.join(data,'proof.json'),fixture=path.join(data,'graph.json')
fs.mkdirSync(project);fs.mkdirSync(path.join(project,'src'));fs.writeFileSync(path.join(project,'src/app.ts'),'// entry\nfunction validate(){}\nfunction save(){}\n')
const node=(id,label,parent)=>({id,label,purpose:id==='request'?'校验并转交业务请求':'保存已处理的业务结果',kind:'module',inputs:['用户请求'],outputs:['处理结果'],refs:[{path:'src/app.ts',line:id==='request'?2:3}],...(parent?{parent}:{})})
const graph={version:1,title:'订单业务拓扑',description:'读取本地代码生成的业务模块关系。',nodes:[node('request','处理请求'),node('storage','保存结果'),node('validation','字段校验','request')],edges:[{id:'request-storage',source:'request',target:'storage',label:'保存业务数据',data:'已校验的业务数据',refs:[{path:'src/app.ts',line:3}]}]}
fs.writeFileSync(fixture,JSON.stringify(graph,null,2))
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:id,sessions:[{id,cwd:project,title:'Topology UI',archived:false,messages:[],model:'sonnet',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'profile'),CLAUDE_GUI_TEST_TOPOLOGY:fixture,CLAUDE_GUI_TEST_TOPOLOGY_PROOF:proof};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
async function idle(){for(let n=0;n<200;n++){const done=await page.evaluate(async id=>{const session=(await window.workspace.get()).sessions.find(s=>s.id===id);return session.messages.at(-1)?.role==='assistant'&&session.messages.at(-1).status!=='running'},id);if(done)return;await new Promise(r=>setTimeout(r,40))}throw Error('Reply did not finish')}
try{
  const input=page.getByRole('textbox',{name:'消息输入'});await input.waitFor()
  await input.fill('保留已有草稿。')
  await page.getByRole('button',{name:'业务拓扑',exact:true}).click();await page.getByRole('heading',{name:'先把项目关系看清楚'}).waitFor()
  assert.equal(await page.locator('.main').isVisible(),false,'Topology opens as a standalone full workspace')
  await page.getByRole('button',{name:'生成首张拓扑',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('textarea[aria-label="消息输入"]').value.includes('请为当前项目生成或更新业务拓扑'))
  assert.match(await input.inputValue(),/^保留已有草稿/)
  assert.match(fs.readFileSync(path.join(project,'.claude/skills/workspace-topology/SKILL.md'),'utf8'),/name: workspace-topology/)
  await input.press('Enter');await idle();await page.getByRole('button',{name:'模块：处理请求',exact:true}).waitFor()
  const request=page.getByRole('button',{name:'模块：处理请求',exact:true}),storage=page.getByRole('button',{name:'模块：保存结果',exact:true})
  const canvasBefore=await page.locator('.topology-canvas').boundingBox()
  await request.click();await page.getByText('模块 ID · request',{exact:true}).waitFor();assert.equal(await request.getAttribute('aria-pressed'),'true')
  const floating=page.getByRole('dialog',{name:'拓扑批注窗口'});await floating.waitFor();const canvasAfter=await page.locator('.topology-canvas').boundingBox();assert.ok(Math.abs(canvasAfter.height-canvasBefore.height)<2,'Floating inspector must not shrink the canvas')
  const floatBefore=await floating.boundingBox(),handle=await page.getByLabel('拖动拓扑批注窗口').boundingBox();await page.mouse.move(handle.x+90,handle.y+16);await page.mouse.down();await page.mouse.move(handle.x-50,handle.y+96,{steps:6});await page.mouse.up();const floatAfter=await floating.boundingBox();assert.ok(floatAfter.x<floatBefore.x-80);assert.ok(floatAfter.y>floatBefore.y+40)
  await page.getByRole('textbox',{name:'拓扑批注内容'}).fill('切换视图时保留批注')
  await page.getByRole('button',{name:'展开拓扑',exact:true}).click();assert.equal(await page.locator('.main').isVisible(),false);assert.equal(await page.getByRole('textbox',{name:'拓扑批注内容'}).inputValue(),'切换视图时保留批注');assert.equal(await request.getAttribute('aria-pressed'),'true')
  await page.getByRole('button',{name:'半屏显示拓扑',exact:true}).click();assert.equal(await page.locator('.main').isVisible(),true);await page.getByRole('textbox',{name:'拓扑批注内容'}).fill('')
  await page.getByRole('button',{name:'展开内部拓扑',exact:true}).click();await page.getByRole('button',{name:'模块：字段校验',exact:true}).waitFor();await page.getByRole('button',{name:'模块：字段校验',exact:true}).click();await page.getByText('模块 ID · validation',{exact:true}).waitFor()
  await page.getByRole('button',{name:'返回上层',exact:true}).click();await request.waitFor()
  await request.click();await page.getByRole('button',{name:'收起拓扑批注窗口',exact:true}).click();await storage.click({modifiers:['Control']});await page.getByText('已选 2 个对象',{exact:true}).waitFor()
  await page.getByRole('button',{name:'清除选择',exact:true}).click()
  await page.getByRole('button',{name:'收起拓扑批注窗口',exact:true}).click()
  const a=await request.boundingBox(),b=await storage.boundingBox();await page.keyboard.down('Shift');await page.mouse.move(Math.min(a.x,b.x)-8,Math.min(a.y,b.y)-8);await page.mouse.down();await page.mouse.move(Math.max(a.x+a.width,b.x+b.width)+8,Math.max(a.y+a.height,b.y+b.height)+8,{steps:8});await page.mouse.up();await page.keyboard.up('Shift');await page.getByText('已选 2 个对象',{exact:true}).waitFor()
  await page.getByRole('button',{name:'清除选择',exact:true}).click()
  if(await page.getByRole('button',{name:'收起拓扑批注窗口',exact:true}).count())await page.getByRole('button',{name:'收起拓扑批注窗口',exact:true}).click()
  await page.getByRole('button',{name:'连接：保存业务数据',exact:true}).locator('text').click();await page.getByText('连接 ID · request-storage',{exact:true}).waitFor();assert.match(await page.locator('.topology-target-details').innerText(),/已校验的业务数据/)
  await page.getByRole('textbox',{name:'拓扑批注内容'}).fill('这个数据流为什么要先校验？')
  await page.getByRole('button',{name:'加入对话',exact:true}).click();await page.locator('.topology-context-chips').waitFor()
  assert.equal(await input.inputValue(),'这个数据流为什么要先校验？');assert.ok(!(await input.inputValue()).includes('"revision"'))
  await input.press('Enter');await idle()
  const received=JSON.parse(fs.readFileSync(proof,'utf8'));assert.match(received.prompt,/"id": "request-storage"/);assert.match(received.prompt,/"source": "request"/);assert.match(received.prompt,/"target": "storage"/);assert.match(received.prompt,/src\/app.ts/);assert.match(received.prompt,/不修改代码/)
  await page.locator('.topology-message-context').waitFor();const state=await page.evaluate(()=>window.workspace.get()),user=state.sessions[0].messages.findLast(m=>m.role==='user');assert.equal(user.text,'这个数据流为什么要先校验？');assert.equal(user.topologySelection.requests[0].targets[0].id,'request-storage')
  await request.click();await page.getByRole('combobox',{name:'拓扑操作类型'}).selectOption('approve');await page.getByRole('button',{name:'保存认可设计',exact:true}).click();await page.getByText('当前图版本的批注 · 1',{exact:true}).waitFor()
  assert.equal((await page.evaluate(id=>window.workspace.topology(id),id)).notes[0].targets[0].id,'request')
  await page.reload();await input.waitFor();await page.getByRole('button',{name:'业务拓扑',exact:true}).click();await page.getByRole('button',{name:'拓扑批注记录',exact:true}).click();await page.getByText('当前图版本的批注 · 1',{exact:true}).waitFor()
  await request.click();const previous=await page.evaluate(id=>window.workspace.topology(id),id)
  graph.nodes[0].purpose='新的处理方式';fs.writeFileSync(path.join(project,'.claude/workspace-topology.json'),JSON.stringify(graph))
  await page.getByRole('button',{name:'刷新拓扑',exact:true}).click();await page.getByText('拓扑版本已更新，请重新选择批注对象。',{exact:true}).waitFor();assert.equal(await request.getAttribute('aria-pressed'),'false');assert.equal(await page.getByText('当前图版本的批注 · 1',{exact:true}).count(),0)
  const stale=await page.evaluate(async({id,revision})=>{try{await window.workspace.send(id,'不能发送过期选择',[],[],[{revision,targets:[{kind:'node',id:'request'}],action:'change',text:'修改旧模块',summary:'处理请求'}]);return false}catch(e){return e.message}},{id,revision:previous.revision});assert.match(stale,/拓扑已更新/)
  if(await page.getByRole('button',{name:'收起拓扑批注窗口',exact:true}).count())await page.getByRole('button',{name:'收起拓扑批注窗口',exact:true}).click()
  const beforeRefinement=JSON.parse(fs.readFileSync(path.join(project,'.claude/workspace-topology.json'),'utf8'))
  await storage.dblclick();await page.getByRole('button',{name:'生成下一层拓扑',exact:true}).waitFor()
  assert.match(await page.locator('.topology-module-empty').innerText(),/模块 ID · storage/)
  await page.getByRole('button',{name:'生成下一层拓扑',exact:true}).click();await page.locator('.topology-context-chips').waitFor();assert.equal(await input.inputValue(),'请细化「保存结果」的内部业务拓扑。')
  await input.press('Enter');await idle();await page.getByRole('button',{name:'模块：内部步骤 1',exact:true}).waitFor()
  let refined=JSON.parse(fs.readFileSync(path.join(project,'.claude/workspace-topology.json'),'utf8'))
  assert.deepEqual(refined.nodes.filter(n=>n.parent!=='storage'),beforeRefinement.nodes);assert.deepEqual(refined.edges,beforeRefinement.edges);assert.equal(refined.nodes.find(n=>n.id==='storage.step1').parent,'storage')
  let scopedProof=JSON.parse(fs.readFileSync(proof,'utf8')).prompt;assert.match(scopedProof,/"moduleId": "storage"/);assert.match(scopedProof,/兄弟模块和无关连接不变/);assert.match(await page.locator('.topology-toolbar strong').innerText(),/保存结果 · 内部拓扑/)
  await page.getByRole('button',{name:'继续细化此模块',exact:true}).click();await input.press('Enter');await idle();await page.getByRole('button',{name:'模块：内部步骤 2',exact:true}).waitFor()
  scopedProof=JSON.parse(fs.readFileSync(proof,'utf8')).prompt;assert.match(scopedProof,/"id": "storage.step1"/);refined=JSON.parse(fs.readFileSync(path.join(project,'.claude/workspace-topology.json'),'utf8'));assert.ok(refined.edges.some(e=>e.source==='storage.step1'&&e.target==='storage.step2'))
  await page.getByRole('button',{name:'模块：内部步骤 1',exact:true}).dblclick();await page.getByRole('button',{name:'生成下一层拓扑',exact:true}).click();await input.press('Enter');await idle();await page.getByRole('button',{name:'模块：内部步骤 1',exact:true}).waitFor()
  refined=JSON.parse(fs.readFileSync(path.join(project,'.claude/workspace-topology.json'),'utf8'));assert.equal(refined.nodes.find(n=>n.id==='storage.step1.step1').parent,'storage.step1');assert.match(JSON.parse(fs.readFileSync(proof,'utf8')).prompt,/"moduleId": "storage.step1"/)
  await page.getByRole('button',{name:'关闭聊天工具',exact:true}).click()
  // User-owned generated graphs are optional screenshots, not test fixtures.
  let canCaptureRealGraph=false
  try{const {TopologyService}=require('../electron/topology.cjs');canCaptureRealGraph=!!new TopologyService(path.join(data,'optional-notes')).read(root).graph}catch{console.log('Optional real-project screenshots skipped: working graph is invalid; isolated interaction assertions remain required.')}
  if(canCaptureRealGraph){
  // Inspect and capture the real project's first graph, using the same isolated app profile.
  await page.evaluate(async({id,root})=>window.workspace.changeProject(id,root),{id,root})
  await page.getByRole('button',{name:'业务拓扑',exact:true}).click();await page.getByRole('button',{name:'模块：编排当前会话',exact:true}).waitFor()
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/topology-overview.png')})
  await page.getByRole('button',{name:'模块：编排当前会话',exact:true}).click();await page.getByRole('textbox',{name:'拓扑批注内容'}).fill('请解释工具授权与回复事件之间的关系。');await page.screenshot({path:path.join(root,'artifacts/topology-annotation.png')})
  await page.getByRole('textbox',{name:'拓扑批注内容'}).fill('');await page.getByRole('button',{name:'展开内部拓扑',exact:true}).click();await page.getByRole('button',{name:'模块：回应工具授权',exact:true}).waitFor();await page.screenshot({path:path.join(root,'artifacts/topology-detail.png')})
  await page.getByRole('button',{name:'模块：回应工具授权',exact:true}).dblclick();await page.getByRole('button',{name:'生成下一层拓扑',exact:true}).waitFor();await page.screenshot({path:path.join(root,'artifacts/topology-refine-module.png')})
  }
  assert.deepEqual(errors,[]);console.log('Topology UI passed: leaf module expansion, scoped refinement, existing subtree preservation and recursive generation;  standalone full/half workspace, draggable floating annotations without shrinking canvas, draft preservation, generated graph via CLI fixture, hierarchy, exact node/edge and multi-select, compact chat context received by CLI, version-bound design approval, persistence, stale send rejection; optional real-project overview when its graph is valid. No upstream requests.')
}finally{await app.close()}
