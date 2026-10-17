import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-changes-ui-')),project=path.join(data,'project'),id='changes-ui'
fs.mkdirSync(project)
const git=args=>execFileSync('git',args,{cwd:project,windowsHide:true,encoding:'utf8'})
git(['init','-q']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);git(['config','core.autocrlf','false'])
fs.writeFileSync(path.join(project,'app.txt'),'BASE\n');fs.writeFileSync(path.join(project,'pre-existing.txt'),'HEAD_VALUE\n');git(['add','.']);git(['commit','-qm','fixture']);fs.writeFileSync(path.join(project,'pre-existing.txt'),'EXISTING_DIRTY_VALUE\n')
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:id,sessions:[{id,cwd:project,title:'Changes UI',archived:false,messages:[],model:'sonnet',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'profile')};delete env.ELECTRON_RUN_AS_NODE
let app,page;const errors=[]
async function launch(){app=await electron.launch({executablePath:require('electron'),args:[root],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.getByRole('textbox',{name:'消息输入'}).waitFor()}
try{
  await launch();let input=page.getByRole('textbox',{name:'消息输入'})
  await input.fill('变更审阅验证 第一轮');await input.press('Enter')
  const cards=page.getByRole('region',{name:'本轮文件变更'});await cards.first().waitFor();await cards.first().getByText('已更改 2 个文件',{exact:true}).waitFor()
  const state=await page.evaluate(()=>window.workspace.get()),first=state.sessions.find(s=>s.id===state.activeId).messages.at(-1)
  await cards.first().locator('.change-summary-open').click();await page.locator('.change-file-header').filter({hasText:'app.txt'}).waitFor()
  assert.equal(await page.locator('.change-file').count(),2);assert.equal(await page.locator('.diff-split').count(),2)
  assert.equal(await page.locator('.change-file-header').filter({hasText:'pre-existing.txt'}).count(),0)
  assert.equal(await page.getByRole('button',{name:'审查代码',exact:true}).count(),0);assert.equal(await page.getByRole('group',{name:'消息前的文件恢复点'}).count(),0)
  await page.getByRole('combobox',{name:'变更范围'}).selectOption('workspace');await page.locator('.change-file-header').filter({hasText:'pre-existing.txt'}).waitFor()
  await page.getByRole('textbox',{name:'搜索变更文件'}).fill('does-not-match');await page.getByText('没有匹配的文件',{exact:true}).waitFor();assert.equal(await page.locator('.diff-lines').count(),0)
  await page.getByRole('textbox',{name:'搜索变更文件'}).fill('');await page.getByRole('button',{name:'全部折叠',exact:true}).click();assert.equal(await page.locator('.diff-lines').count(),0);await page.getByRole('button',{name:'全部展开',exact:true}).click()
  await page.getByRole('button',{name:'关闭聊天工具',exact:true}).click()
  await input.fill('变更审阅验证 第二轮');await input.press('Enter');await cards.nth(1).waitFor();await cards.nth(1).getByText('已更改 1 个文件',{exact:true}).waitFor()
  await cards.first().locator('.change-summary-open').click();await page.locator('.diff-lines').getByText('FIRST_TURN',{exact:true}).waitFor();assert.equal(await page.locator('.diff-lines').getByText('SECOND_TURN',{exact:true}).count(),0)
  const original=await page.evaluate(({id,message})=>window.workspace.turnChanges(id,message),{id,message:first.id});assert.equal(original.files.length,2)
  await page.getByRole('button',{name:'原生文件恢复',exact:true}).click();await page.getByRole('group',{name:'消息前的文件恢复点'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'恢复此处文件',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'恢复文件和对话',exact:true}).count(),0)
  let confirmation='';page.once('dialog',dialog=>{confirmation=dialog.message();void dialog.dismiss()});await page.getByRole('button',{name:'恢复此处文件',exact:true}).click();assert.match(confirmation,/聊天记录保留/);assert.equal(fs.readFileSync(path.join(project,'app.txt'),'utf8'),'SECOND_TURN\n')
  await page.getByRole('button',{name:'返回代码变更',exact:true}).click();await page.getByRole('combobox',{name:'变更范围'}).selectOption('workspace');await page.locator('.diff-lines').getByText('SECOND_TURN',{exact:true}).waitFor()
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/changes-panel-redesign.png')})
  await app.close();await launch();input=page.getByRole('textbox',{name:'消息输入'});await page.getByRole('region',{name:'本轮文件变更'}).first().locator('.change-summary-open').click();await page.locator('.diff-lines').getByText('FIRST_TURN',{exact:true}).waitFor()
  await page.evaluate(id=>window.workspace.deleteSession(id),id)
  assert.equal(fs.existsSync(path.join(data,'changes',first.id+'.json')),false)
  assert.equal(fs.readFileSync(path.join(project,'app.txt'),'utf8'),'SECOND_TURN\n')
  assert.deepEqual(errors,[]);console.log('Changes UI passed: per-turn cards, pre-existing edits excluded, fixed historical diffs, entire workspace scope, continuous file review, split/unified controls, filter/collapse, secondary native recovery and confirmation, reload persistence; no upstream requests.')
}finally{await page?.getByRole('textbox',{name:'消息输入'}).fill('').catch(()=>{});await app?.close()}
