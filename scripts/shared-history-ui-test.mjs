import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),{projectKey}=require('../electron/shared-history.cjs'),root=path.resolve(import.meta.dirname,'..')
const data=fs.mkdtempSync(path.join(os.tmpdir(),'shared-history-ui-')),home=path.join(data,'native'),cwd=path.join(data,'project'),nativeId=crypto.randomUUID(),folder=path.join(home,'projects',projectKey(cwd)),file=path.join(folder,nativeId+'.jsonl')
fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(cwd);fs.writeFileSync(path.join(cwd,'keep.txt'),'project stays')
const u=crypto.randomUUID(),a=crypto.randomUUID(),u2=crypto.randomUUID(),a2=crypto.randomUUID()
const event=(type,uuid,parentUuid,text,id=nativeId)=>({type,uuid,parentUuid,sessionId:id,cwd,timestamp:new Date().toISOString(),message:{role:type,content:[{type:'text',text}]}})
const rawGoal='<command-name>/goal</command-name> <command-message>goal</command-message> <command-args>仅仅是确认目标功能完好，请回复：功能正常！</command-args>'
fs.writeFileSync(file,[event('user',u,null,rawGoal),event('assistant',a,u,'native answer')].map(e=>JSON.stringify(e)).join('\n')+'\n')
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{configDir:home,cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:'existing-gui',sessions:[{id:'existing-gui',nativeId,cwd,title:'Existing',createdAt:Date.now(),updatedAt:Date.now(),archived:false,model:'',effort:'',permission:'default',messages:[{id:'old-cache',role:'assistant',text:'stale GUI copy',time:0,tools:[],status:'done',nativeUUID:a}]}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:home};delete env.ELECTRON_RUN_AS_NODE
let app,page;const errors=[]
const launch=async()=>{app=await electron.launch({executablePath:require('electron'),args:[root],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('textbox',{name:'消息输入'}).waitFor()}
const state=()=>page.evaluate(()=>window.workspace.get())
const waitState=async predicate=>{const end=Date.now()+10000;while(Date.now()<end){if(predicate(await state()))return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('History state did not synchronize')}
try{
  await launch();assert.equal((await state()).sessions.length,1);await page.getByText('native answer',{exact:true}).waitFor();assert.equal(await page.getByText('stale GUI copy',{exact:true}).count(),0)
  await page.locator('.message.user .markdown').getByText('/goal 仅仅是确认目标功能完好，请回复：功能正常！',{exact:true}).waitFor()
  assert.ok(!await page.locator('.message.user .markdown').textContent().then(text=>text.includes('<command-name>')))
  assert.ok(fs.readFileSync(file,'utf8').includes(rawGoal))
  const interrupted=crypto.randomUUID()
  fs.appendFileSync(file,JSON.stringify(event('user',interrupted,a,'[Request interrupted by user]'))+'\n')
  await page.getByText('已停止 · 已完成的工作与会话会保留',{exact:true}).waitFor({timeout:10000})
  assert.equal(await page.locator('.message.user').filter({hasText:'[Request interrupted by user]'}).count(),0)
  assert.ok(fs.readFileSync(file,'utf8').includes('[Request interrupted by user]'))
  await page.evaluate(()=>window.workspace.update('existing-gui',{title:'Shared renamed'}));assert.ok(fs.readFileSync(file,'utf8').includes('"customTitle":"Shared renamed"'))
  const saved=JSON.parse(fs.readFileSync(path.join(data,'workspace.json'),'utf8'));assert.equal(saved.sessions[0].messages.length,0);assert.equal(JSON.stringify(saved).includes('native answer'),false)
  fs.appendFileSync(file,[event('user',u2,a,'terminal continuation'),event('assistant',a2,u2,'terminal response')].map(e=>JSON.stringify(e)).join('\n')+'\n')
  await page.getByText('terminal response',{exact:true}).waitFor({timeout:10000})
  const fork=await page.evaluate(()=>window.workspace.fork('existing-gui'));assert.notEqual(fork.nativeId,nativeId);assert.ok(fs.existsSync(fork.nativeFile));assert.equal(fork.forkPending,false)
  await page.evaluate(id=>window.workspace.deleteSession(id),fork.id);assert.equal(fs.existsSync(fork.nativeFile),false);assert.ok(fs.existsSync(file));assert.equal(fs.readFileSync(path.join(cwd,'keep.txt'),'utf8'),'project stays')
  await app.close();await launch();await page.getByText('terminal response',{exact:true}).waitFor();assert.equal((await state()).sessions.length,1)
  const terminalId=crypto.randomUUID(),terminalFile=path.join(folder,terminalId+'.jsonl');fs.writeFileSync(terminalFile,[event('user',crypto.randomUUID(),null,'new terminal session',terminalId)].map(e=>JSON.stringify(e)).join('\n')+'\n')
  await waitState(s=>s.sessions.some(s=>s.nativeId===terminalId))
  const unopened=(await state()).sessions.find(s=>s.nativeId===terminalId);assert.equal(unopened.messages.length,0)
  await page.locator(`[data-chat-id="${unopened.id}"]`).click({button:'right'});await page.getByRole('menuitem',{name:'复制聊天内容',exact:true}).click()
  await page.waitForFunction(async()=>(await navigator.clipboard.readText()).includes('new terminal session'));assert.equal((await state()).activeId,'existing-gui')
  fs.unlinkSync(terminalFile);await waitState(s=>!s.sessions.some(s=>s.nativeId===terminalId))
  // Exercise the real context-menu confirmation and its native-file deletion.
  await page.locator('[data-chat-id="existing-gui"]').click({button:'right'});page.once('dialog',dialog=>{assert.match(dialog.message(),/同时删除 Claude CLI/);void dialog.accept()});await page.getByRole('menuitem',{name:'删除聊天',exact:true}).click()
  await page.waitForFunction(async()=>!(await window.workspace.get()).sessions.some(s=>s.id==='existing-gui'))
  assert.equal(fs.existsSync(file),false);assert.equal(fs.readFileSync(path.join(cwd,'keep.txt'),'utf8'),'project stays');assert.equal((await state()).sessions.length,1)
  assert.deepEqual(errors,[]);console.log('Shared CLI history UI passed: migration, native rename, terminal continuation, independent fork, restart, CLI discovery/deletion, GUI deletion, project preservation; isolated fixture '+data)
}finally{await app?.close().catch(()=>{})}
