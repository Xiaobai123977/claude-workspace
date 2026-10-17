import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-chat-menu-')),cwd=path.join(data,'project');fs.mkdirSync(cwd)
fs.writeFileSync(path.join(cwd,'keep.txt'),'project must survive')
const make=(id,title)=>({id,title,cwd,createdAt:Date.now(),updatedAt:Date.now(),archived:false,model:'',effort:'',permission:'default',messages:[{id:id+'-message',role:'user',text:title+' content',time:Date.now(),status:'done',tools:[]}]})
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:'chat-a',sessions:[make('chat-a','Chat A'),make('chat-b','Chat B')]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native-profile')};delete env.ELECTRON_RUN_AS_NODE
let app,page;const errors=[]
const launch=async()=>{app=await electron.launch({executablePath:require('electron'),args:[root],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('textbox',{name:'消息输入'}).waitFor()}
const right=async(id)=>{await page.locator(`[data-chat-id="${id}"]`).click({button:'right'});await page.getByRole('menu',{name:'聊天操作'}).waitFor()}
const action=async name=>page.getByRole('menuitem',{name,exact:true}).click()
const state=()=>page.evaluate(()=>window.workspace.get())
try{
  await launch()
  await right('chat-b');assert.equal((await state()).activeId,'chat-a')
  await action('重命名');await page.getByLabel('聊天名称').fill('Renamed B');await page.getByRole('dialog',{name:'重命名'}).getByRole('button',{name:'保存',exact:true}).click()
  assert.equal((await state()).sessions.find(s=>s.id==='chat-b').title,'Renamed B');assert.equal((await state()).activeId,'chat-a')
  await right('chat-b');await action('置顶');await page.locator('.pinned-chats [data-chat-id="chat-b"]').waitFor()
  await right('chat-b');await action('标记为未读');await page.locator('[data-chat-id="chat-b"].unread').waitFor()
  await right('chat-b');await action('复制标题');assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'Renamed B')
  await right('chat-b');await action('复制聊天内容');assert.match(await app.evaluate(({clipboard})=>clipboard.readText()),/Chat B content/)
  const exportFile=path.join(data,'exported-chat.json')
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file})},exportFile)
  await right('chat-b');await action('导出聊天');await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('导出'))
  assert.equal(JSON.parse(fs.readFileSync(exportFile,'utf8')).title,'Renamed B')
  await page.locator('[data-chat-id="chat-b"]').focus();await page.keyboard.press('Shift+F10');await page.getByRole('menu',{name:'聊天操作'}).waitFor();await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'取消置顶');await page.keyboard.press('Escape')
  // Verify viewport clamping and keyboard dismissal.
  await page.locator('[data-chat-id="chat-b"]').dispatchEvent('contextmenu',{clientX:1430,clientY:950})
  const box=await page.getByRole('menu',{name:'聊天操作'}).boundingBox(),size=page.viewportSize()||await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=size.width&&box.y+box.height<=size.height)
  await page.screenshot({path:path.join(root,'artifacts/chat-context-menu.png')})
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('menu',{name:'聊天操作'}).count(),0)
  await app.close();await launch();assert.equal((await state()).sessions.find(s=>s.id==='chat-b').pinned,true);assert.equal((await state()).sessions.find(s=>s.id==='chat-b').unread,true)
  await page.locator('[data-chat-id="chat-b"]').click();assert.equal((await state()).sessions.find(s=>s.id==='chat-b').unread,false)
  await page.locator('[data-chat-id="chat-a"]').click()
  await right('chat-b');await action('归档');assert.equal((await state()).activeId,'chat-a');assert.equal(await page.locator('[data-chat-id="chat-b"]').count(),0)
  await page.getByRole('button',{name:'已归档',exact:true}).click();await right('chat-b');await action('取消归档');await page.getByRole('button',{name:'工作区',exact:true}).click()
  await right('chat-b');await action('创建聊天分支');await page.waitForFunction(()=>document.querySelector('.chat-title')?.textContent.includes('分支'))
  const forkState=await state(),fork=forkState.sessions.find(s=>s.id===forkState.activeId);assert.notEqual(fork.id,'chat-b');assert.equal(fork.messages[0].text,'Chat B content');assert.equal(fork.pinned,false)
  await page.locator('[data-chat-id="chat-a"]').click();await page.getByRole('textbox',{name:'消息输入'}).fill('等待停止');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByRole('button',{name:'停止执行',exact:true}).waitFor()
  await right('chat-a');assert.equal(await page.getByRole('menuitem',{name:'删除聊天',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('menuitem',{name:'创建聊天分支',exact:true}).isDisabled(),true)
  assert.match(await page.evaluate(async()=>{try{await window.workspace.deleteSession('chat-a');return ''}catch(e){return e.message}}),/停止/)
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'停止执行',exact:true}).click();await page.getByText('已停止 · 已完成的工作与会话会保留').waitFor()
  await page.evaluate(()=>window.workspace.saveSchedule({sessionId:'chat-b',prompt:'test',minutes:60,enabled:false}))
  await right('chat-b');page.once('dialog',d=>d.dismiss());await action('删除聊天');assert.ok((await state()).sessions.some(s=>s.id==='chat-b'))
  await right('chat-b');page.once('dialog',d=>d.accept());await action('删除聊天');await page.waitForFunction(async()=>!(await window.workspace.get()).sessions.some(s=>s.id==='chat-b'))
  assert.equal((await page.evaluate(()=>window.workspace.schedules())).length,0);assert.equal(fs.readFileSync(path.join(cwd,'keep.txt'),'utf8'),'project must survive')
  for(const id of (await state()).sessions.map(s=>s.id))await page.evaluate(id=>window.workspace.deleteSession(id),id)
  assert.equal((await state()).sessions.length,1);const finalState=await state();assert.ok(finalState.sessions.some(s=>s.id===finalState.activeId))
  assert.deepEqual(errors,[])
  console.log('Chat context UI passed: correct target, rename/pin/unread, clipboard, bounds and Escape, persistence, archive, independent fork, running guards, confirmed deletion and schedule cleanup, final-chat fallback. Isolated data: '+data)
}catch(e){if(page&&!page.isClosed())await page.screenshot({path:path.join(root,'artifacts/chat-context-failure.png')}).catch(()=>{});throw e}finally{if(app)await app.close()}
