import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..')
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'claude-window-restore-')),id='restore-test'
fs.writeFileSync(path.join(dataDir,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs'),permission:'default'},activeId:id,sessions:[{id,cwd:root,title:'恢复窗口测试',messages:[],createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:dataDir,CLAUDE_CONFIG_DIR:path.join(dataDir,'native-profile')};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env})
try{
  const page=await app.firstWindow(),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  const input=page.getByRole('textbox',{name:'消息输入'})
  await input.waitFor();await input.fill('恢复窗口后草稿必须保留')
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click()
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false)
  await app.evaluate(({app})=>app.emit('activate'))
  await input.waitFor();assert.equal(await input.inputValue(),'恢复窗口后草稿必须保留')
  await page.evaluate(()=>{window.__restoreSentinel='same-document'})
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling()),false)
  for(let index=0;index<4;index++){
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize())
    await app.evaluate(async({BrowserWindow})=>{await new Promise(r=>setTimeout(r,150));const w=BrowserWindow.getAllWindows()[0];w.restore();w.show();w.focus()})
    await input.waitFor();assert.equal(await input.inputValue(),'恢复窗口后草稿必须保留')
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide())
  await app.evaluate(async({BrowserWindow,powerMonitor})=>{await new Promise(r=>setTimeout(r,150));BrowserWindow.getAllWindows()[0].show();powerMonitor.emit('resume')})
  assert.equal(await page.evaluate(()=>window.__restoreSentinel),'same-document')
  await page.waitForTimeout(300)
  const screenshot=await app.evaluate(async({BrowserWindow})=>{
    const bitmap=(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toBitmap(),colors=new Set()
    for(let i=0;i<bitmap.length;i+=64)colors.add(bitmap.subarray(i,i+3).toString('hex'))
    return {bytes:bitmap.length,colors:colors.size}
  })
  assert.ok(screenshot.colors>25,`Restored window should render content: ${JSON.stringify(screenshot)}`)
  await input.fill('等待停止');await input.press('Enter')
  await page.getByRole('button',{name:'停止执行',exact:true}).waitFor()
  const before=await page.evaluate(()=>window.workspace.get())
  // Deliberately terminate only this isolated test renderer, leaving main/CLI alive.
  await app.evaluate(async({BrowserWindow})=>{
    const wc=BrowserWindow.getAllWindows()[0].webContents
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Renderer did not reload after crash')),15000)
      wc.once('did-finish-load',()=>{clearTimeout(timer);resolve()})
      setTimeout(()=>wc.forcefullyCrashRenderer(),50)
    })
  })
  const after=await app.evaluate(async({BrowserWindow})=>{
    const wc=BrowserWindow.getAllWindows()[0].webContents
    for(let i=0;i<50;i++){
      if(await wc.executeJavaScript('!!document.querySelector(\'[aria-label="停止执行"]\')'))return wc.executeJavaScript('window.workspace.get()')
      await new Promise(r=>setTimeout(r,100))
    }
    throw new Error('Live task UI missing after renderer recovery')
  })
  assert.equal(after.activeId,before.activeId)
  assert.equal(after.sessions[0].messages.length,before.sessions[0].messages.length)
  assert.equal(after.sessions[0].messages.at(-1).status,'running')
  await app.evaluate(async({BrowserWindow})=>{
    const wc=BrowserWindow.getAllWindows()[0].webContents
    await wc.executeJavaScript('document.querySelector(\'[aria-label="停止执行"]\').click()')
    for(let i=0;i<50;i++){
      if(await wc.executeJavaScript('document.body.innerText.includes("已停止 · 已完成的工作与会话会保留")'))return
      await new Promise(r=>setTimeout(r,100))
    }
    throw new Error('Recovered renderer could not stop live task')
  })
  const log=fs.readFileSync(path.join(dataDir,'diagnostics','window-rendering.jsonl'),'utf8')
  assert.ok(log.includes('renderer-reload'));assert.ok(!log.includes('repaint-failed'))
  assert.deepEqual(errors,[])
  console.log('PASS: minimize/restore, hide/show, resume, nonblank capture, draft retention and renderer crash recovery with live task retained')
}finally{await app.close();fs.rmSync(dataDir,{recursive:true,force:true})}
