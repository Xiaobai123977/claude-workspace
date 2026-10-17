import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-commands-ui-')),id='commands'
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:id,sessions:[{id,cwd:root,title:'Commands fixture',suggestion:'/init',messages:[],model:'sonnet',effort:'medium',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'profile')};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message))
try{
  const input=page.getByRole('textbox',{name:'消息输入'});await input.waitFor();assert.equal(await page.locator('.prompt-suggestion').count(),0);await input.fill('/')
  let list=page.getByRole('listbox',{name:'命令菜单'});await list.getByRole('option').filter({hasText:'/code-review'}).waitFor()
  assert.equal(await list.getByText('连接与模型',{exact:true}).count(),0);assert.equal(await list.getByText('隔离工作区',{exact:true}).count(),0)
  const initialOptions=await list.getByRole('option').allTextContents()
  assert.ok(initialOptions.every(text=>!/^\/(model|config|mcp|cost|effort|tasks)\b/.test(text)))
  assert.ok(initialOptions.every(text=>/[\u3400-\u9fff]/.test(text)))
  assert.ok(initialOptions.some(text=>text.includes('创建或完善项目说明 CLAUDE.md')))
  assert.ok(initialOptions.some(text=>text.includes('/goal')&&text.includes('持续工作直到完成目标')))
  assert.ok(initialOptions.some(text=>text.includes('/loop')&&text.includes('重复执行')))
  assert.equal(await page.getByRole('button',{name:'目标与循环',exact:true}).count(),0)
  await input.fill('/model');await list.getByRole('option').filter({hasText:'/model'}).waitFor()
  assert.equal((await page.evaluate(()=>window.workspace.get())).sessions[0].messages.length,0)
  await input.fill('/code-review');await input.press('Tab');assert.equal(await input.inputValue(),'/code-review ')
  assert.equal((await page.evaluate(()=>window.workspace.get())).sessions[0].messages.length,0)
  await input.press('Enter');await page.getByText('最终输出已完整接收。',{exact:false}).waitFor();await page.waitForFunction(()=>!document.querySelector('.working'))
  assert.equal((await page.evaluate(()=>window.workspace.get())).sessions[0].messages[0].text,'/code-review ')
  await input.fill('保留这个草稿');await input.press('Control+k');await page.getByRole('listbox',{name:'应用操作'}).waitFor()
  await page.getByRole('textbox',{name:'搜索应用操作'}).fill('连接与模型');await page.getByRole('option').filter({hasText:'连接与模型'}).click();await page.getByRole('heading',{name:'连接与模型',exact:true}).waitFor()
  await page.getByRole('button',{name:'返回聊天',exact:true}).click();assert.equal(await input.inputValue(),'保留这个草稿')
  await input.press('Shift+Tab');await page.waitForFunction(async()=>{const s=await window.workspace.get();return s.sessions[0].permission==='acceptEdits'})
  await input.press('Shift+Tab');await page.waitForFunction(async()=>{const s=await window.workspace.get();return s.sessions[0].permission==='plan'})
  await input.fill('/cost');await input.press('Enter');await page.getByRole('dialog',{name:'使用情况',exact:true}).waitFor();assert.equal((await page.evaluate(()=>window.workspace.get())).sessions[0].messages.length,2)
  await page.keyboard.press('Escape');await input.fill('/clear');await input.press('Enter')
  await page.waitForFunction(async()=>{const s=await window.workspace.get();return s.activeId!=='commands'})
  const state=await page.evaluate(()=>window.workspace.get()),current=state.sessions.find(s=>s.id===state.activeId);assert.equal(current.messages.length,0);assert.equal(current.permission,'plan');assert.equal(state.sessions.find(s=>s.id==='commands').messages.length,2)
  await input.fill('/');await page.getByRole('option').filter({hasText:'/simplify'}).waitFor();fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/claude-commands.png')})
  await page.keyboard.press('Escape');await input.fill('');await page.getByTitle('代码变更',{exact:true}).click();assert.equal(await page.getByRole('button',{name:'审查代码',exact:true}).count(),0);await page.getByRole('button',{name:'关闭聊天工具',exact:true}).click();await input.fill('/code-review ');await input.press('Enter')
  await page.getByText('最终输出已完整接收。',{exact:false}).waitFor();await page.waitForFunction(()=>!document.querySelector('.working'))
  const reviewed=await page.evaluate(()=>window.workspace.get());assert.equal(reviewed.sessions.find(s=>s.id===reviewed.activeId).messages[0].text.trim(),'/code-review')
  await input.fill('/goal');await input.press('Tab');assert.equal(await input.inputValue(),'/goal ')
  await input.fill('/goal 仅仅是确认目标功能完好，请回复：功能正常！');await input.press('Enter')
  await page.waitForFunction(async()=>{const s=await window.workspace.get();return s.sessions.find(x=>x.id===s.activeId).messages.at(-1)?.status==='done'})
  const goalState=await page.evaluate(()=>window.workspace.get());assert.equal(goalState.sessions.find(s=>s.id===goalState.activeId).messages.at(-2).text,'/goal 仅仅是确认目标功能完好，请回复：功能正常！')
  assert.deepEqual(errors,[]);console.log('Commands passed: native catalog without a model call; native slash completion/execution; app actions preserve drafts; local cost/clear; permission shortcut; original history retained.')
}finally{await page.getByRole('textbox',{name:'消息输入'}).fill('').catch(()=>{});await app.close()}
