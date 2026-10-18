import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-large-output-')),id='large-test'
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:id,sessions:[{id,cwd:root,title:'大输出测试',messages:[],createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native'),CLAUDE_GUI_TEST_LARGE_OUTPUT:'1'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env})
const previousClipboard=await app.evaluate(({clipboard})=>clipboard.readText())
try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  await app.evaluate(({BrowserWindow})=>{const wc=BrowserWindow.getAllWindows()[0].webContents,send=wc.send.bind(wc);global.largeSnapshots=0;wc.send=(channel,...args)=>{if(channel==='workspace:state')global.largeSnapshots++;return send(channel,...args)}})
  await page.getByRole('textbox',{name:'消息输入'}).fill('LARGE_OUTPUT_STRESS')
  const started=Date.now()
  await page.getByRole('button',{name:'发送消息',exact:true}).click()
  await page.waitForFunction(async()=>{const s=await window.workspace.get();return s.sessions[0].messages.at(-1)?.status==='done'},null,{timeout:60000,polling:1000})
  await page.getByRole('button',{name:'重新生成',exact:true}).waitFor({timeout:60000})
  const size=await page.evaluate(async()=>{const m=(await window.workspace.get()).sessions[0].messages.at(-1);return {text:m.text.length,thinking:m.thinking.length}})
  assert.equal(size.thinking,'思考数据流与实现细节。'.repeat(400).length*1024)
  assert.equal(size.text,('业务结果与验证记录。'.repeat(400)+'\n\n').length*512)
  assert.equal(await page.locator('.thinking .bounded-text').count(),0)
  const before=await page.evaluate(()=>document.body.innerText.length);assert.ok(before<100000,`DOM expanded unexpectedly: ${before}`)
  const answer=page.locator('.message.assistant .markdown').first()
  assert.equal(await page.getByRole('button',{name:'上一段'}).count(),0)
  await answer.locator('.content-chunk').first().scrollIntoViewIfNeeded()
  await page.waitForFunction(()=>!!document.querySelector('.message.assistant .markdown .content-chunk')?.textContent)
  await answer.locator('.content-chunk').last().scrollIntoViewIfNeeded()
  await page.waitForFunction(()=>!!document.querySelector('.message.assistant .markdown .content-chunk:last-child')?.textContent)
  await page.getByRole('button',{name:'复制回复',exact:true}).click()
  for(let i=0;i<50;i++){
    if(await app.evaluate(async({clipboard})=>(await clipboard.readText()).replace(/\r\n/g,'\n').length)===size.text)break
    await page.waitForTimeout(100)
  }
  assert.equal(await app.evaluate(async({clipboard})=>(await clipboard.readText()).replace(/\r\n/g,'\n').length),size.text)
  await page.locator('.thinking summary').click();await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.body.innerText.length)<150000)
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click()
  await app.evaluate(({app})=>app.emit('activate'))
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  const snapshots=await app.evaluate(()=>global.largeSnapshots)
  const elapsedMs=Date.now()-started
  assert.ok(snapshots<1536/4&&snapshots<=elapsedMs/120+5,`Too many full workspace copies: ${snapshots} in ${elapsedMs}ms`)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({passed:true,...size,snapshots,elapsedMs,domCharacters:before,fullCopyPreserved:true,thoughtLazy:true}))
}finally{await app.evaluate(({clipboard},text)=>clipboard.writeText(text),previousClipboard).catch(()=>{});await app.close();fs.rmSync(data,{recursive:true,force:true})}
