import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-memory-ui-'))
const project=path.join(data,'project'),profile=path.join(data,'profile'),id='memory'
fs.mkdirSync(project);fs.mkdirSync(profile)
fs.writeFileSync(path.join(project,'CLAUDE.md'),'# Existing project rules\r\nKeep this.\r\n')
fs.writeFileSync(path.join(profile,'CLAUDE.md'),'# Personal\nExisting preference.\n')
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:id,sessions:[{id,cwd:project,title:'Memory test',archived:false,messages:[],model:'sonnet',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:profile};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message))
try{
  const input=page.getByRole('textbox',{name:'消息输入'})
  await input.fill('#先运行测试再提交');const panel=page.getByRole('region',{name:'快速记忆'})
  await panel.getByText(path.join(project,'CLAUDE.md'),{exact:true}).waitFor()
  await panel.getByRole('button',{name:'保存记忆',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="消息输入"]').value==='')
  assert.equal(fs.readFileSync(path.join(project,'CLAUDE.md'),'utf8'),'# Existing project rules\r\nKeep this.\r\n\r\n- 先运行测试再提交\r\n')
  assert.equal((await page.evaluate(()=>window.workspace.get())).sessions[0].messages.length,0)
  await input.fill('#尽量用中文回答');await panel.getByRole('combobox',{name:'记忆保存范围'}).selectOption('user')
  await panel.getByText(path.join(profile,'CLAUDE.md'),{exact:true}).waitFor()
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/quick-memory.png')})
  await input.press('Enter');await page.waitForFunction(()=>document.querySelector('[aria-label="消息输入"]').value==='')
  assert.equal(fs.readFileSync(path.join(profile,'CLAUDE.md'),'utf8'),'# Personal\nExisting preference.\n\n- 尽量用中文回答\n')
  await input.fill('#');assert.equal(await panel.getByRole('button',{name:'保存记忆',exact:true}).isDisabled(),true)
  await input.fill('## 普通标题');assert.equal(await panel.count(),0)
  await input.fill('#这是普通消息');await panel.getByRole('button',{name:'作为普通消息发送'}).click()
  await page.getByText('最终输出已完整接收。',{exact:false}).waitFor();await page.waitForFunction(()=>!document.querySelector('.working'))
  assert.equal((await page.evaluate(()=>window.workspace.get())).sessions[0].messages[0].text,'#这是普通消息')
  assert.ok(!fs.readFileSync(path.join(profile,'CLAUDE.md'),'utf8').includes('这是普通消息'))
  assert.deepEqual(errors,[])
  console.log('Quick memory passed: isolated project/global CLAUDE.md append; original content retained; no model call for saving; Enter saves; empty rule disabled; ordinary markdown/message escape retained.')
}finally{await page.getByRole('textbox',{name:'消息输入'}).fill('').catch(()=>{});await app.close()}
