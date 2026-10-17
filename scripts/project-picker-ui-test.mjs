import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-project-picker-')),dirs=['Alpha','Beta','Gamma'].map(n=>path.join(data,n));for(const d of dirs)fs.mkdirSync(d)
const make=(id,cwd)=>({id,cwd,title:'新聊天',createdAt:Date.now(),updatedAt:Date.now(),archived:false,messages:[],model:'',effort:'',permission:'default'})
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},projectSettings:{[dirs[1]]:{name:'My Beta'}},activeId:'a',sessions:[make('a',dirs[0]),make('b',dirs[1])]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native-profile')};delete env.ELECTRON_RUN_AS_NODE
let app,page;const errors=[]
const state=()=>page.evaluate(()=>window.workspace.get())
const picker=()=>page.getByRole('dialog',{name:'选择项目',exact:true})
try{
  app=await electron.launch({executablePath:require('electron'),args:[root],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  await app.evaluate(({shell})=>{globalThis.folderOpens=0;shell.openPath=async()=>{globalThis.folderOpens++;return ''}})
  await page.getByRole('textbox',{name:'消息输入'}).fill('draft follows project')
  await page.getByRole('button',{name:'选择项目',exact:true}).click();await picker().getByRole('option',{name:/My Beta/}).waitFor()
  assert.equal(await page.locator('.workspace-tab').getByText('此计算机',{exact:true}).count(),0)
  await picker().getByRole('textbox',{name:'搜索项目'}).fill('My Beta');assert.equal(await picker().getByRole('option').count(),1)
  await page.screenshot({path:path.join(root,'artifacts/project-picker.png')})
  await picker().getByRole('option',{name:/My Beta/}).click();await page.waitForFunction(async cwd=>(await window.workspace.get()).sessions.find(s=>s.id==='a').cwd===cwd,dirs[1])
  assert.equal((await state()).activeId,'a');assert.equal((await state()).sessions.length,2);assert.equal(await page.getByRole('textbox',{name:'消息输入'}).inputValue(),'draft follows project');assert.equal(await app.evaluate(()=>globalThis.folderOpens),0)
  await page.getByRole('button',{name:'选择项目',exact:true}).click();await picker().getByRole('option',{name:/My Beta/}).click();assert.equal((await state()).sessions.length,2)
  await page.getByRole('textbox',{name:'消息输入'}).fill('hello');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByText('你好，我已连接到 Claude 工作区。',{exact:true}).waitFor()
  await page.getByRole('textbox',{name:'消息输入'}).fill('carry to new project')
  await page.getByRole('button',{name:'选择项目',exact:true}).click();await picker().getByRole('option',{name:/Alpha/}).click()
  await page.waitForFunction(async()=>{const s=await window.workspace.get();return s.activeId!=='a'})
  const changed=await state(),next=changed.sessions.find(s=>s.id===changed.activeId)
  assert.equal(next.cwd,dirs[0]);assert.equal(changed.sessions.find(s=>s.id==='a').cwd,dirs[1]);assert.equal(changed.sessions.find(s=>s.id==='a').messages.length,2);assert.equal(await page.getByRole('textbox',{name:'消息输入'}).inputValue(),'carry to new project')
  await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]})})
  await page.getByRole('button',{name:'选择项目',exact:true}).click();await picker().getByRole('button',{name:'添加新项目…',exact:true}).click();assert.equal((await state()).activeId,next.id)
  await app.evaluate(({dialog},cwd)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[cwd]})},dirs[2])
  await picker().getByRole('button',{name:'添加新项目…',exact:true}).click();await page.waitForFunction(async cwd=>{const s=await window.workspace.get();return s.sessions.find(v=>v.id===s.activeId).cwd===cwd},dirs[2])
  assert.equal((await state()).activeId,next.id);assert.equal(await page.getByRole('textbox',{name:'消息输入'}).inputValue(),'carry to new project')
  assert.equal(await app.evaluate(()=>globalThis.folderOpens),0)
  assert.match(await page.evaluate(async()=>{try{await window.workspace.changeProject('a','relative/path');return ''}catch(e){return e.message}}),/有效/)
  assert.deepEqual(errors,[])
  console.log('Composer project picker passed: existing project search, empty chat directory switch, used-chat preservation, draft transfer, folder picker cancel/add, no file-manager launch. Isolated data: '+data)
}catch(e){if(page&&!page.isClosed())await page.screenshot({path:path.join(root,'artifacts/project-picker-failure.png')}).catch(()=>{});throw e}finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{})}
