import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-project-menu-')),a=path.join(data,'Alpha'),b=path.join(data,'Beta');fs.mkdirSync(a);fs.mkdirSync(b);fs.writeFileSync(path.join(b,'keep.txt'),'project files stay')
const make=(id,cwd)=>({id,cwd,title:id,archived:false,createdAt:Date.now(),updatedAt:Date.now(),model:'',effort:'',permission:'default',messages:[]})
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:'a1',sessions:[make('a1',a),make('b1',b),make('b2',b)]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native-profile')};delete env.ELECTRON_RUN_AS_NODE
let app,page;const errors=[]
const launch=async()=>{app=await electron.launch({executablePath:require('electron'),args:[root],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('textbox',{name:'消息输入'}).waitFor()}
const project=cwd=>page.locator('[data-project-path]').filter({has:page.locator('.project-name')}).filter({hasText:cwd===a?'Alpha':'Renamed Beta'})
const right=async cwd=>{await page.locator('[data-project-path]').filter({hasText:cwd===a?'Alpha':(await page.getByText('Renamed Beta',{exact:true}).count()?'Renamed Beta':'Beta')}).click({button:'right'});await page.getByRole('menu',{name:'项目操作'}).waitFor()}
const action=name=>page.getByRole('menuitem',{name,exact:true}).click()
const state=()=>page.evaluate(()=>window.workspace.get())
try{
  await launch();await right(b);assert.equal((await state()).activeId,'a1')
  await action('重命名项目');await page.getByLabel('项目显示名称').fill('Renamed Beta');await page.getByRole('dialog',{name:'重命名'}).getByRole('button',{name:'保存',exact:true}).click()
  assert.equal((await state()).projectSettings[b].name,'Renamed Beta');assert.ok(fs.existsSync(b));assert.equal((await state()).sessions.find(s=>s.id==='b1').cwd,b)
  await right(b);await action('置顶项目');assert.equal(await page.locator('[data-project-path]').first().getAttribute('data-project-path'),b)
  await right(b);await action('折叠聊天列表');assert.equal(await page.locator('[data-chat-id="b1"]').count(),0);assert.equal((await state()).sessions.filter(s=>s.cwd===b).length,2)
  await app.close();await launch();assert.equal((await state()).projectSettings[b].collapsed,true);assert.equal(await page.locator('[data-project-path]').first().getAttribute('data-project-path'),b)
  await page.getByRole('button',{name:'展开项目 Renamed Beta',exact:true}).click();await page.locator('[data-chat-id="b1"]').waitFor()
  await right(b);await action('复制项目路径');assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),b)
  await right(b);await page.screenshot({path:path.join(root,'artifacts/project-context-menu.png')});await page.keyboard.press('Escape');assert.equal(await page.getByRole('menu',{name:'项目操作'}).count(),0)
  await page.getByRole('button',{name:'折叠项目 Renamed Beta',exact:true}).focus();await page.keyboard.press('Shift+F10');await page.getByRole('menu',{name:'项目操作'}).waitFor();await page.keyboard.press('Escape')
  await right(b);page.once('dialog',d=>d.dismiss());await action('归档全部聊天');assert.ok((await state()).sessions.filter(s=>s.cwd===b).every(s=>!s.archived))
  await right(b);page.once('dialog',d=>d.accept());await action('归档全部聊天');await page.waitForFunction(async b=>(await window.workspace.get()).sessions.filter(s=>s.cwd===b).every(s=>s.archived),b)
  assert.equal((await state()).sessions.find(s=>s.id==='a1').archived,false)
  await page.getByRole('button',{name:'已归档',exact:true}).click();await right(b);page.once('dialog',d=>d.accept());await action('取消归档全部聊天');await page.getByRole('button',{name:'工作区',exact:true}).click()
  await right(b);page.once('dialog',d=>d.accept());await action('从侧栏移除项目');await page.waitForFunction(async b=>(await window.workspace.get()).projectSettings[b].hidden,b)
  assert.equal(await page.locator('[data-chat-id="b1"]').count(),0);assert.equal((await state()).sessions.filter(s=>s.cwd===b).length,2);assert.equal(fs.readFileSync(path.join(b,'keep.txt'),'utf8'),'project files stay')
  await app.evaluate(({dialog},cwd)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[cwd]})},b)
  await page.getByRole('button',{name:'添加项目',exact:true}).click();await page.locator('[data-chat-id="b1"]').waitFor();assert.equal((await state()).projectSettings[b].hidden,false)
  await right(b);await action('新建聊天');await page.waitForFunction(async b=>(await window.workspace.get()).sessions.filter(s=>s.cwd===b).length===4,b)
  const current=(await state()).activeId
  await page.getByRole('textbox',{name:'消息输入'}).fill('等待停止');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByRole('button',{name:'停止执行',exact:true}).waitFor()
  await right(b);assert.equal(await page.getByRole('menuitem',{name:'归档全部聊天',exact:true}).isDisabled(),true)
  assert.match(await page.evaluate(async b=>{try{await window.workspace.archiveProject(b,true);return ''}catch(e){return e.message}},b),/停止/)
  assert.ok((await state()).sessions.filter(s=>s.cwd===b).every(s=>!s.archived))
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'停止执行',exact:true}).click();await page.getByText('已停止 · 已完成的工作与会话会保留').waitFor()
  assert.equal((await state()).activeId,current);assert.deepEqual(errors,[])
  console.log('Project context UI passed: correct scope, rename without disk rename, pin/collapse persistence, clipboard, keyboard, archive cancellation and restore, reversible sidebar removal, new chat and running guards. Isolated data: '+data)
}catch(e){if(page&&!page.isClosed())await page.screenshot({path:path.join(root,'artifacts/project-context-failure.png')}).catch(()=>{});throw e}finally{if(app)await app.close()}
