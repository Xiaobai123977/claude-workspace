import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),{projectKey}=require('../electron/shared-history.cjs'),root=path.resolve(import.meta.dirname,'..')
const data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-agents-ui-')),profile=path.join(data,'profile'),project=path.join(data,'project'),nativeId=crypto.randomUUID(),id='agents-ui',dir=path.join(profile,'projects',projectKey(project)),file=path.join(dir,nativeId+'.jsonl')
fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(project)
const row=(type,uuid,parentUuid,content,extra={})=>({type,uuid,parentUuid,sessionId:nativeId,cwd:project,timestamp:new Date(Date.now()-20000).toISOString(),message:{role:type,content},...extra})
const records=[row('user','u1',null,'派出子代理'),row('assistant','launch','u1',[{type:'tool_use',id:'old-agent',name:'Agent',input:{description:'原生独立验证'}}]),row('user','tool-result','launch',[{type:'tool_result',tool_use_id:'old-agent',content:'agentId: worker'}]),row('assistant','a1','tool-result','主对话第一条回复'),row('user','u2','a1','继续'),row('assistant','a2','u2','最新主对话：必须保持可见'),row('user','meta','a1','内部任务状态',{isMeta:true})]
fs.writeFileSync(file,records.map(e=>JSON.stringify(e)).join('\n')+'\n')
const childDir=path.join(dir,nativeId,'subagents');fs.mkdirSync(childDir,{recursive:true})
fs.writeFileSync(path.join(childDir,'agent-worker.jsonl'),[row('assistant','child-tool',null,[{type:'tool_use',id:'child-read',name:'Read',input:{file_path:'child.txt'}}],{isSidechain:true,parentToolUseID:'old-agent'}),row('user','child-result','child-tool',[{type:'tool_result',tool_use_id:'child-read',content:'子代理工具记录，只在展开后显示'}],{isSidechain:true,parentToolUseID:'old-agent'}),row('assistant','child-answer','child-result','子代理独立输出，不属于主对话',{isSidechain:true,parentToolUseID:'old-agent'})].map(e=>JSON.stringify(e)).join('\n')+'\n')
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs'),configDir:profile},activeId:id,sessions:[{id,nativeId,cwd:project,title:'Agent regression',archived:false,messages:[],model:'sonnet',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:profile};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message))
try{
  const input=page.getByRole('textbox',{name:'消息输入'}),latest=page.getByText('最新主对话：必须保持可见',{exact:true})
  await input.waitFor();await latest.waitFor();assert.equal(await page.getByTitle('代理与后台任务',{exact:true}).count(),0)
  const card=page.locator('[data-task-card="old-agent"]');await card.waitFor();assert.equal(await page.getByText('子代理独立输出，不属于主对话',{exact:true}).count(),0)
  const before=await page.evaluate(async()=>{const s=await window.workspace.get();return s.sessions.find(x=>x.id===s.activeId).messages.map(m=>m.id)})
  for(let i=0;i<3;i++){await card.locator('.agent-activity-summary').click();await latest.waitFor()}
  await card.getByText('子代理独立输出，不属于主对话',{exact:true}).waitFor();await card.getByRole('button',{name:/Read/}).click();await card.getByText('子代理工具记录，只在展开后显示',{exact:true}).waitFor()
  assert.deepEqual(await page.evaluate(async()=>{const s=await window.workspace.get();return s.sessions.find(x=>x.id===s.activeId).messages.map(m=>m.id)}),before)
  await page.evaluate(id=>window.workspace.send(id,'子代理卡片验证',[]),id)
  const live=page.locator('[data-task-card="live-agent"]');await live.waitFor();await live.getByText('运行中',{exact:true}).waitFor()
  assert.equal(await page.getByText('实时子代理输出，仅卡片内可见',{exact:true}).count(),0)
  await live.locator('.agent-activity-summary').click();await live.getByText('实时子代理输出，仅卡片内可见',{exact:true}).waitFor()
  await live.getByRole('button',{name:/Read/}).click();await live.getByText('实时子代理工具结果',{exact:true}).waitFor()
  const main=page.getByText('最新主对话：子代理仍在后台运行。',{exact:true});await main.waitFor()
  await live.getByRole('button',{name:'停止此任务',exact:true}).click();await live.getByText('已停止',{exact:true}).waitFor();await page.getByRole('button',{name:'发送消息',exact:true}).waitFor()
  fs.appendFileSync(file,JSON.stringify(row('user','late-meta','a1','迟到的后台状态',{isMeta:true}))+'\n')
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].emit('focus'))
  await main.waitFor();await latest.waitFor()
  assert.ok((await page.evaluate(id=>window.workspace.readSession(id),id)).messages.some(m=>m.text==='最新主对话：子代理仍在后台运行。'))
  const current=await page.evaluate(()=>window.workspace.get()),messages=current.sessions.find(s=>s.id===current.activeId).messages
  assert.ok(messages.every(m=>!m.text.includes('实时子代理输出')&&!m.text.includes('实时子代理工具结果')))
  await live.locator('.agent-activity-summary').click();await input.fill('/tasks');await input.press('Enter');await live.getByText('实时子代理输出，仅卡片内可见',{exact:true}).waitFor();await main.waitFor()
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/agent-activity.png')})
  assert.deepEqual(errors,[]);console.log('Agent activity passed: native child history, lazy isolated output/tools, repeated expansion preserves latest messages, live progress, individual stop, late meta/partial disk refresh, /tasks locates cards; no upstream requests.')
}finally{await inputClear();await app.close()}
async function inputClear(){await page.getByRole('textbox',{name:'消息输入'}).fill('').catch(()=>{})}
