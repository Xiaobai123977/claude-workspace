import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-scroll-ui-'))
const sessions=['long-a','long-b'].map(id=>({id,cwd:root,title:id,createdAt:Date.now(),updatedAt:Date.now(),archived:false,model:'',effort:'',permission:'default',messages:Array.from({length:80},(_,i)=>({id:id+'-'+i,role:i%2?'assistant':'user',text:`${id} message ${i}\n\n`+'Long history content. '.repeat(30),time:Date.now()+i,tools:[],status:'done'}))}))
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs'),configDir:path.join(data,'native')},activeId:'long-a',sessions}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native')};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.on('pageerror',e=>errors.push(e.message))
const atEnd=()=>page.waitForFunction(()=>{const el=document.querySelector('.chat-scroll');return el&&el.scrollHeight-el.scrollTop-el.clientHeight<3})
const scrollUp=async()=>{await page.locator('.chat-scroll').evaluate(el=>{el.scrollTop=0});await page.waitForFunction(()=>document.querySelector('.chat-scroll').scrollTop===0)}
try{
  await page.getByRole('textbox',{name:'消息输入'}).waitFor();await atEnd()
  await scrollUp()
  await page.evaluate(()=>window.workspace.select('long-b'));await atEnd()
  await scrollUp()
  await page.evaluate(()=>window.workspace.select('long-a'));await atEnd()
  // Keep following content whose height changes after layout (image/markdown).
  await page.locator('.messages').evaluate(el=>{const node=document.createElement('div');node.style.height='700px';el.append(node)});await atEnd()
  await scrollUp()
  await page.locator('.messages').evaluate(el=>{const node=document.createElement('div');node.style.height='700px';el.append(node)})
  await page.waitForTimeout(150);assert.equal(await page.locator('.chat-scroll').evaluate(el=>el.scrollTop),0)
  await page.locator('.rail').getByRole('button',{name:'设置',exact:true}).click()
  await page.getByRole('button',{name:'返回聊天',exact:true}).click();await atEnd()
  assert.deepEqual(errors,[])
  console.log('Chat scroll passed: initial history, switching chats, delayed content, manual scroll and returning from settings.')
}finally{await app.close()}
