import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-edit-menu-')),id='edit-menu'
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:id,sessions:[{id,cwd:root,title:'Clipboard fixture',archived:false,messages:[{id:'a',role:'assistant',text:'可复制的回答 Copy this answer',tools:[],status:'done',time:Date.now()}],model:'',effort:'',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'profile')};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>void d.accept().catch(()=>{}));page.setDefaultTimeout(10000)
try{
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  await app.evaluate(async({Menu,clipboard})=>{
    globalThis.__clipboardBefore=await Promise.race([clipboard.readText(),new Promise(resolve=>setTimeout(()=>resolve(undefined),1500))])
    const build=Menu.buildFromTemplate;globalThis.__editMenuCount=0
    Menu.buildFromTemplate=function(template){const menu=build.call(this,template);menu.popup=()=>{globalThis.__editMenu=menu;globalThis.__editMenuCount++};return menu}
  })
  const menu=async target=>{const before=await app.evaluate(()=>globalThis.__editMenuCount);await target.click({button:'right'});await page.waitForFunction(()=>true);for(let i=0;i<40;i++){if(await app.evaluate(()=>globalThis.__editMenuCount)>before)return;await new Promise(r=>setTimeout(r,25))}throw Error('Native edit menu did not open')}
  const items=()=>app.evaluate(()=>globalThis.__editMenu.items.filter(i=>i.id).map(i=>({id:i.id,label:i.label,enabled:i.enabled})))
  const choose=id=>app.evaluate(({BrowserWindow},id)=>{const item=globalThis.__editMenu.getMenuItemById(id);if(!item?.enabled)throw Error('Disabled edit item '+id);const window=BrowserWindow.getAllWindows()[0];window.focus();item.click(undefined,window,window.webContents)},id)
  const paragraph=page.locator('.markdown p').first()
  await paragraph.evaluate(node=>{document.activeElement?.blur();const range=document.createRange();range.selectNodeContents(node);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range)})
  await menu(paragraph);assert.deepEqual((await items()).map(i=>i.label),['复制']);await choose('edit-copy')
  for(let i=0;i<40;i++){if(await page.evaluate(()=>navigator.clipboard.readText())==='可复制的回答 Copy this answer')break;await new Promise(r=>setTimeout(r,25))}
  assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'可复制的回答 Copy this answer')
  const input=page.getByRole('textbox',{name:'消息输入'});await input.fill('草稿：');await input.press('End')
  await menu(input);assert.equal((await items()).find(i=>i.id==='edit-paste').enabled,true);await choose('edit-paste')
  await page.waitForFunction(()=>document.querySelector('textarea[aria-label="消息输入"]').value.includes('可复制的回答 Copy this answer'))
  assert.equal(await input.inputValue(),'草稿：可复制的回答 Copy this answer')
  await input.press('Control+A');await menu(input);await choose('edit-cut');await page.waitForFunction(()=>document.querySelector('textarea[aria-label="消息输入"]').value==='')
  await menu(input);await choose('edit-undo');await page.waitForFunction(()=>document.querySelector('textarea[aria-label="消息输入"]').value==='草稿：可复制的回答 Copy this answer')
  await page.locator('[data-chat-id]').first().click({button:'right'});await page.getByRole('menu',{name:'聊天操作'}).waitFor();await page.keyboard.press('Escape')
  assert.deepEqual(errors,[]);console.log('Edit menu passed: native selection copy; paste/cut/undo updates React drafts; sidebar context menu remains available.')
}catch(e){console.error('edit test stage failure',e.message);throw e}finally{await page.getByRole('textbox',{name:'消息输入'}).fill('').catch(()=>{});await app.evaluate(async({clipboard})=>{if(typeof globalThis.__clipboardBefore==='string')await clipboard.writeText(globalThis.__clipboardBefore)}).catch(()=>{});await app.close()}
