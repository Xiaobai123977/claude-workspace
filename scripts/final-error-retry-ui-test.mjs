import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'final-retry-ui-')),log=path.join(data,'attempts.jsonl'),id='final-retry-test'
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native'),CLAUDE_GUI_TEST_FINAL_RETRY:log};delete env.ELECTRON_RUN_AS_NODE
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs'),configDir:env.CLAUDE_CONFIG_DIR},activeId:id,sessions:[{id,cwd:data,title:'Outer retry test',createdAt:Date.now(),updatedAt:Date.now(),archived:false,messages:[],model:'',effort:'',permission:'default'}]}))
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.on('pageerror',e=>errors.push(e.message))
const attempts=prompt=>fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse).filter(e=>e.prompt===prompt)
const send=prompt=>page.evaluate(({id,prompt})=>window.workspace.send(id,prompt,[]),{id,prompt})
const settled=async()=>{const deadline=Date.now()+30000;while(Date.now()<deadline){const m=(await active()).messages.at(-1);if(m&&['done','error','stopped'].includes(m.status)&&!m.gatewayRetries?.length)return;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('Turn did not settle within 30 seconds')}
const active=()=>page.evaluate(async()=>{const s=await window.workspace.get();return s.sessions.find(x=>x.id===s.activeId)})
const timing=records=>{assert.equal(new Set(records.map(r=>r.id)).size,1);for(let i=1;i<records.length;i++)assert.ok(records[i].time-records[i-1].time>=2900)}
try{
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  await send('FINAL_RETRY_RECOVER')
  await page.getByRole('status').filter({hasText:'额外重试 1/3'}).waitFor()
  assert.equal(await page.locator('.error-box').count(),0)
  await page.locator('.thinking').waitFor({timeout:20000})
  assert.equal(await page.locator('.gateway-retry').count(),0,'Thinking output must replace the extra retry notice before the turn finishes')
  await settled();assert.equal((await active()).messages.at(-1).status,'done');assert.equal(attempts('FINAL_RETRY_RECOVER').length,3);timing(attempts('FINAL_RETRY_RECOVER'))
  const nativeId=(await active()).nativeId
  await send('FINAL_RETRY_FAIL');await settled()
  assert.equal(attempts('FINAL_RETRY_FAIL').length,4);timing(attempts('FINAL_RETRY_FAIL'))
  assert.equal((await active()).messages.at(-1).error,'fixture raw error: model unavailable HTTP 404')
  await send('FINAL_RETRY_EXIT');await settled();assert.equal(attempts('FINAL_RETRY_EXIT').length,4);timing(attempts('FINAL_RETRY_EXIT'))
  await send('FINAL_RETRY_STOP');await page.getByRole('status').filter({hasText:'额外重试 1/3'}).waitFor()
  await page.getByRole('button',{name:'停止执行',exact:true}).click();await settled()
  await page.waitForTimeout(3300);assert.equal(attempts('FINAL_RETRY_STOP').length,1)
  const s=await active();assert.equal(s.messages.at(-1).status,'stopped');assert.equal(s.nativeId,nativeId)
  assert.equal(s.messages.length,8);assert.equal((await page.evaluate(()=>window.workspace.get())).sessions.length,1);assert.deepEqual(errors,[])
  console.log('Final retry UI passed: arbitrary errors, 3 retries, 3 second gaps, recovery, CLI exit, stop, same conversation and no duplicate GUI turns. '+data)
}finally{await app.close()}
