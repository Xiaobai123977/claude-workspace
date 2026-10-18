import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'topology-dense-')),cwd=path.join(data,'project'),id='dense'
fs.mkdirSync(path.join(cwd,'.claude'),{recursive:true});fs.writeFileSync(path.join(cwd,'app.js'),'// layout fixture\n')
const refs=[{path:'app.js',line:1}],node=(id,label)=>({id,label,purpose:label,kind:'module',inputs:['业务请求','重试输入'],outputs:['业务结果','错误信息'],refs})
const nodes=[node('start','接收业务申请'),node('verify','校验申请'),node('risk','评估风险'),node('inventory','核对库存'),node('merge','合并处理结果'),node('reply','返回业务响应')],edges=[]
const connect=(id,source,target,kind='data')=>edges.push({id:'edge-'+edges.length,source,target,label:id,data:'业务数据与处理结果',kind,sourceOutputs:['业务结果'],targetInputs:['业务请求'],refs})
for(const id of ['verify','risk','inventory']){connect('提交'+id,'start',id);connect('回传'+id,id,'merge')}
connect('响应','merge','reply');connect('快速响应','start','reply');connect('发起重试','reply','start','return');connect('补充验证','verify','merge');connect('错误回执','risk','reply')
const large=process.argv.includes('--large')
if(large){
  const names=['接收申请','读取项目','评估风险','执行业务','返回响应','写入记录','发送通知','更新缓存','保存结果','发布事件','生成报告','更新索引','统计用量','同步状态','写入审计','检查规则','调用外部服务','记录错误','完成任务']
  const ports=Array.from({length:12},(_,i)=>'业务数据'+(i+1))
  nodes.splice(0,nodes.length,...names.map((name,i)=>({...node('n'+i,name),inputs:ports,outputs:ports,boundaries:[...ports.map(port=>({direction:'input',port,kind:'entry',reason:'测试业务入口',refs})),...ports.map(port=>({direction:'output',port,kind:'terminal',reason:'测试业务结果',refs}))]})))
  edges.splice(0)
  for(let i=0;i<4;i++)connect('主流程'+i,'n'+i,'n'+(i+1))
  for(let i=5;i<19;i++)connect('业务分支'+i,'n'+(i%3+1),'n'+i)
  connect('返回重试','n4','n0','return');connect('快速完成','n0','n4')
  for(const edge of edges){edge.sourceOutputs=ports;edge.targetInputs=ports}
}
const sourceProject=process.argv.find(arg=>arg.startsWith('--project='))?.slice(10),real=!!sourceProject
const graph=real?JSON.parse(fs.readFileSync(path.join(sourceProject,'.claude/workspace-topology.json'),'utf8')):{version:1,flowVersion:1,title:'多分支业务与返回路径',description:'用于验证密集分支、回路、跨列连线与局部高亮的隔离样例。',nodes,edges}
if(real){
  const refs=[...graph.nodes,...graph.edges].flatMap(item=>[...(item.refs||[]),...(item.boundaries||[]).flatMap(b=>b.refs||[])])
  for(const ref of refs){
    const relative=ref.path
    if(path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..'))continue
    const source=path.join(sourceProject,relative),target=path.join(cwd,relative)
    if(fs.existsSync(source)&&fs.statSync(source).isFile()&&fs.statSync(source).size<2*1024*1024){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target)}
  }
}
require('../electron/topology.cjs').validateGraph(graph,cwd)
fs.writeFileSync(path.join(cwd,'.claude/workspace-topology.json'),JSON.stringify(graph))
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:id,sessions:[{id,cwd,title:'排版验证',archived:false,messages:[],createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native')};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env})
try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.getByRole('button',{name:'业务拓扑',exact:true}).click()
  const moduleName=real?'模块：运行编排':'模块：评估风险'
  await page.getByRole('button',{name:moduleName,exact:true}).waitFor()
  const expand=page.getByRole('button',{name:'展开拓扑',exact:true});if(await expand.count())await expand.click()
  if(!large&&!real){assert.ok(await page.locator('.dense-wire').count()>0);const label=page.locator('.dense-wire text').filter({hasText:'补充验证'}).first();assert.equal(await label.evaluate(el=>getComputedStyle(el).opacity),'0')}
  if(real){
    assert.equal(await page.locator('.flow-wire:not(.boundary-wire)').count(),20)
    const initialCount=await page.locator('.flow-wire').count()
    await page.getByRole('button',{name:/显示跨层细节/}).click()
    await page.waitForFunction(count=>document.querySelectorAll('.flow-wire').length>count,initialCount)
    assert.ok(await page.locator('.flow-wire').count()<178)
    await page.getByRole('button',{name:/隐藏跨层细节/}).click()
    await page.waitForFunction(count=>document.querySelectorAll('.flow-wire').length===count,initialCount)
  }
  await page.getByRole('button',{name:moduleName,exact:true}).click()
  await page.getByRole('button',{name:'收起拓扑批注窗口',exact:true}).click()
  await page.getByRole('button',{name:'突出选中流程',exact:true}).click()
  assert.ok(await page.locator('.flow-wire.flow-dim').count()>0)
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true})
  if(large||real)await page.getByRole('button',{name:'适合拓扑宽度',exact:true}).click()
  await page.screenshot({path:path.join(root,'artifacts',real?'topology-real-project-overview.png':large?'topology-19-module-layout.png':'topology-dense-layout.png')})
  assert.deepEqual(errors,[])
  console.log('PASS: dense branches, routed return and skip paths, labels revealed on interaction, selected direct flow focus, fullscreen/minimap retained')
}finally{await app.close();fs.rmSync(data,{recursive:true,force:true})}
