import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'claude-usage-ui-')),proof=path.join(dataDir,'context-calls'),id='usage-fixture'
const key=JSON.stringify(['','sonnet','medium'])
const session={id,cwd:root,title:'Usage fixture',model:'sonnet',effort:'medium',permission:'default',createdAt:Date.now(),updatedAt:Date.now(),archived:false,messages:[{id:'u',role:'user',text:'Fixture',tools:[],time:Date.now(),status:'done'},{id:'a',role:'assistant',text:'Usage answer',tools:[],time:Date.now(),status:'done',model:'sonnet',contextKey:key,usage:{input_tokens:2000,output_tokens:1000,cache_read_input_tokens:7000,cache_creation_input_tokens:1000},lastRequestUsage:{input_tokens:1000,output_tokens:500,cache_read_input_tokens:3000,cache_creation_input_tokens:1000},modelUsage:{sonnet:{contextWindow:100000}}}]}
fs.writeFileSync(path.join(dataDir,'workspace.json'),JSON.stringify({version:1,activeId:id,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs'),model:'sonnet',effort:'medium',permission:'default'},sessions:[session]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:dataDir,CLAUDE_CONFIG_DIR:path.join(dataDir,'native'),CLAUDE_GUI_TEST_CONTEXT:proof};delete env.ELECTRON_RUN_AS_NODE
const launch=()=>electron.launch({executablePath:require('electron'),args:[root],env})
let app=await launch();const errors=[]
try{
  let page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message))
  const open=async()=>{await page.getByRole('button',{name:'上下文与 Token 统计',exact:true}).click();return page.getByRole('dialog',{name:'上下文与 Token 统计详情'})}
  let dialog=await open();await dialog.getByText('待读取 CLI 上下文',{exact:true}).waitFor()
  assert.equal(await dialog.locator('.usage-context-count strong').innerText(),'—')
  assert.deepEqual(await dialog.locator('.usage-cache strong').allTextContents(),['70.0%','70.0%'])
  assert.deepEqual(await dialog.locator('tbody tr').last().locator('td').allTextContents(),['11,000','11,000'])
  assert.equal(await dialog.getByRole('button',{name:'读取 CLI 上下文',exact:true}).isDisabled(),true)
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'上下文与 Token 统计详情'}).count(),0)
  assert.equal(fs.existsSync(proof),false)
  await app.close();app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message))
  dialog=await open();await dialog.getByText('待读取 CLI 上下文',{exact:true}).waitFor();assert.equal(await dialog.locator('.usage-context-count strong').innerText(),'—')
  await page.keyboard.press('Escape')
  await page.getByRole('textbox',{name:'消息输入'}).fill('Usage fixture continuation')
  await page.getByRole('button',{name:'发送消息',exact:true}).click()
  await page.getByText('最终输出已完整接收。',{exact:false}).waitFor();await page.waitForFunction(()=>!document.querySelector('.working'))
  assert.equal(fs.existsSync(proof),false)
  dialog=await open();await dialog.getByText('未报告',{exact:true}).first().waitFor()
  await dialog.getByRole('button',{name:'读取 CLI 上下文',exact:true}).click();await dialog.getByText('CLI 上下文报告',{exact:true}).waitFor()
  assert.equal(await dialog.locator('.usage-context-count strong').innerText(),'25,000')
  assert.equal(await dialog.getByRole('progressbar').getAttribute('aria-valuenow'),'25')
  assert.equal(fs.readFileSync(proof,'utf8'),'context\n')
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/usage.png')})
  await app.close();app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message))
  dialog=await open();await dialog.getByText('CLI 上下文报告',{exact:true}).waitFor();assert.equal(await dialog.locator('.usage-context-count strong').innerText(),'25,000')
  await page.keyboard.press('Escape')
  await page.getByRole('textbox',{name:'消息输入'}).fill('等待停止');await page.getByRole('button',{name:'发送消息',exact:true}).click()
  await page.getByRole('button',{name:'停止执行',exact:true}).waitFor();dialog=await open();await dialog.getByText('待读取 CLI 上下文',{exact:true}).waitFor();assert.equal(await dialog.locator('.usage-context-count strong').innerText(),'—');await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('button',{name:'停止执行',exact:true}).count(),1)
  await page.getByRole('button',{name:'停止执行',exact:true}).click()
  assert.deepEqual(errors,[]);console.log('PASS: CLI-only context, no request/model-window estimate, weighted cache and token totals; restart; native refresh only on demand; Escape does not interrupt generation')
}finally{await app.close()}

