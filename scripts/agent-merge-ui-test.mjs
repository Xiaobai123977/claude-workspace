import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-agent-merge-')),project=path.join(data,'project'),id='agent-merge'
fs.mkdirSync(path.join(project,'.claude'),{recursive:true});fs.writeFileSync(path.join(project,'.claude/workspace-topology.json'),JSON.stringify({version:1,title:'汇总测试',description:'等待主模型合并',nodes:[],edges:[]}))
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:id,sessions:[{id,cwd:project,title:'Merge regression',archived:false,messages:[],model:'sonnet',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'profile')};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message))
try{
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  await page.evaluate(async id=>{const data=await window.workspace.topology(id);await window.workspace.send(id,'代理完成后汇总验证',[],[],[{revision:data.revision,targets:[],action:'explore',text:'代理完成后汇总验证',depth:2,parallel:true,summary:'汇总写图回归'}])},id)
  await page.getByText('子代理已返回，等待主模型核对并汇总写图',{exact:true}).waitFor();await page.getByRole('button',{name:'停止执行',exact:true}).waitFor()
  const before=await page.evaluate(async id=>(await window.workspace.get()).sessions.find(s=>s.id===id).messages,id),reply=before.find(m=>m.role==='assistant');assert.equal(reply.status,'running');assert.equal(reply.agentProgress.completed,1);assert.equal(reply.agentProgress.total,1);assert.equal(fs.existsSync(path.join(project,'merged.json')),false)
  const rejected=await page.evaluate(async id=>{try{await window.workspace.send(id,'误以为完成时不应允许新消息覆盖汇总',[]);return false}catch{return true}},id);assert.equal(rejected,true)
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/agent-merge-waiting.png')})
  await page.getByRole('button',{name:'允许一次',exact:true}).click();await page.locator('.markdown').getByText('主模型已完成合并写图。',{exact:true}).waitFor()
  for(let n=0;n<100;n++){const s=await page.evaluate(id=>window.workspace.readSession(id),id);if(s.messages.at(-1).status==='done')break;await new Promise(r=>setTimeout(r,30))}
  const after=await page.evaluate(id=>window.workspace.readSession(id),id);assert.equal(after.messages.filter(m=>m.role==='assistant').length,1,'The parent merge must remain in its original reply');assert.equal(after.messages.at(-1).id,reply.id);assert.equal(after.messages.at(-1).status,'done');assert.equal(after.messages.at(-1).approvals[0].status,'approved');assert.equal(fs.readFileSync(path.join(project,'merged.json'),'utf8'),'{"merged":true}');assert.equal(await page.getByRole('button',{name:'停止执行',exact:true}).count(),0)
  assert.deepEqual(errors,[]);console.log('Agent merge regression passed: old result+idle, last child notification, delayed parent permission, same reply, blocked concurrent user input and successful final write. Isolated CLI fixture; no upstream calls.')
}finally{await app.close()}
