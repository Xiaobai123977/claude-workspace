// Launch the self-extracting EXE from an unrelated directory with isolated application data.
import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const root=path.resolve(import.meta.dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,exe=path.resolve(process.argv[2]||path.join(root,'release',`Claude-Workspace-${version}-x64.exe`))
if(!fs.existsSync(exe))throw new Error('Build the portable EXE with npm run pack:win first')
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'claude-portable-smoke-')),data=path.join(temp,'profile'),project=path.join(temp,'project');fs.mkdirSync(data);fs.mkdirSync(project)
fs.writeFileSync(path.join(project,'hello.html'),'<title>Portable preview</title><h1>PACKAGED_LOCAL_PREVIEW_OK</h1>')
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native-profile'),CLAUDE_GUI_INITIAL_CWD:project};delete env.ELECTRON_RUN_AS_NODE
const startedAt=Date.now()
const child=spawn(exe,['--remote-debugging-port=0'],{cwd:temp,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000)});child.stdout.resume()
let browser,page,closed=false
try{
  const portFile=path.join(data,'DevToolsActivePort'),deadline=Date.now()+90000
  while(!fs.existsSync(portFile)){if(child.exitCode!==null)throw new Error('Portable launcher exited: '+child.exitCode+' '+stderr);if(Date.now()>deadline)throw new Error('Portable startup timeout: '+stderr);await new Promise(r=>setTimeout(r,250))}
  const port=fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0]
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+port)
  page=browser.contexts()[0].pages().find(p=>p.url().includes('index.html'))||await browser.contexts()[0].waitForEvent('page')
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  const startupMs=Date.now()-startedAt
  const state=await page.evaluate(()=>window.workspace.get());assert.equal(state.sessions.find(s=>s.id===state.activeId).cwd,project)
  const probe=await page.evaluate(()=>window.workspace.probe());assert.ok(probe.version)
  assert.equal((await page.evaluate(()=>window.workspace.providers())).length,0)
  await page.getByRole('button',{name:'内置浏览器',exact:true}).click();await page.getByLabel('浏览器地址').fill(pathToFileURL(path.join(project,'hello.html')).href);await page.getByRole('button',{name:'打开',exact:true}).click()
  await page.waitForFunction(async id=>{try{const r=await window.workspace.browserAction(id,'inspect');return r.content[0].text.includes('PACKAGED_LOCAL_PREVIEW_OK')}catch{return false}},state.activeId)
  await page.screenshot({path:path.join(root,'artifacts/portable-exe.png')})
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click();closed=true
  console.log(JSON.stringify({portable:exe,bytes:fs.statSync(exe).size,startupMs,cliVersion:probe.version,isolatedData:data,sourceWorkspaceRequired:false,localPreview:true},null,2))
}finally{
  if(page&&!closed&&!page.isClosed())await page.evaluate(()=>window.workspace.window('close')).catch(()=>{})
  if(browser)await browser.close().catch(()=>{})
}
