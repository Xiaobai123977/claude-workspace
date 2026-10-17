import {browserRequest,respond} from './browser-upstream-fixture.mjs'
// Installed Claude CLI + Electron + real MCP stdio bridge. All model responses and web pages are local fixtures.
import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),{git}=require('../electron/operations.cjs')
const data=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'claude-browser-native-')),cwd=path.join(data,'project'),profile=path.join(data,'profile');fs.mkdirSync(cwd);fs.mkdirSync(profile)
const file=path.join(cwd,'index.html');fs.writeFileSync(file,'<!doctype html><title>Native Browser Fixture</title><style>body{font:20px sans-serif;padding:40px}button{padding:12px;background:#4169e1;color:white}</style><h1 id="headline">Original heading</h1><input id="name"/><button id="save" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#name\').value">Save</button><p id="result"></p>')
await git(cwd,['init']);await git(cwd,['config','user.name','Fixture']);await git(cwd,['config','user.email','fixture@example.invalid']);await git(cwd,['add','.']);await git(cwd,['commit','-m','fixture'])
const protocol=process.env.CLAUDE_GUI_TEST_PROTOCOL||'anthropic'
let url,pageUrl,previewUrl,steps;const calls=[],failures=[],seenResults=[]
const server=http.createServer(async(req,res)=>{
  if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'fixture-browser'}]}));return}
  if(!['/v1/messages','/v1/chat/completions','/v1/responses'].includes(req.url)){res.setHeader('Content-Type','text/html');res.end(fs.readFileSync(file));return}
  try{
    let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw)
    const parsed=browserRequest(body,protocol),results=parsed.results
    if(results.some(r=>r.is_error))failures.push(...results.filter(r=>r.is_error).map(r=>r.content))
    seenResults.push(...results)
    const suggestion=JSON.stringify(parsed.source.at(-1)).includes('[SUGGESTION MODE:')
    const step=suggestion?null:steps[results.length]
    if(step){
      assert.ok(parsed.names.includes(step.name),'CLI did not discover tool '+step.name)
      if(!results.length){
        assert.ok(JSON.stringify(parsed.source).includes('当前聊天已启用内置浏览器 workspace_browser'),'active browser context missing from CLI request')
        assert.ok(JSON.stringify(parsed.source).includes(previewUrl),'current browser URL missing from CLI request')
        assert.ok(JSON.stringify(parsed.source).includes('h1#headline'),'selected element context missing from CLI request')
        assert.equal(parsed.userImage,false,'attachments must be file references, not embedded images');assert.ok(JSON.stringify(parsed.source).includes('browser-preview.png'),'screenshot file reference missing')
      }
      if(results.length>=5)assert.ok(JSON.stringify(results).includes('browser-captures'),'browser tool screenshot file reference missing')
      calls.push(step.name)
    }
    respond(res,protocol,step,results.length)
  }catch(e){failures.push(e.message);res.writeHead(500);res.end('Fixture failed')}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}/`
pageUrl=process.env.CLAUDE_GUI_TEST_LOCAL_HTML?pathToFileURL(file).href:url
steps=[['navigate',{url:pageUrl}],['inspect',{}],['type',{selector:'#name',text:'Real CLI browser control'}],['click',{selector:'#save'}],['screenshot',{}],['diagnostics',{}],['Read',{file_path:file}],['Edit',{file_path:file,old_string:'Original heading',new_string:'Updated by native CLI'}],['reload',{}],['inspect',{}]].map(([name,input])=>({name:['Read','Edit'].includes(name)?name:'mcp__workspace_browser__'+name,input}))
const id='native-browser-fixture';fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:'',configDir:profile},activeId:id,sessions:[{id,cwd,title:'Native browser fixture',createdAt:Date.now(),updatedAt:Date.now(),model:'',effort:'',permission:'bypassPermissions',browserEnabled:true,options:{maxTurns:15},messages:[]}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native-profile'),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ENABLE_TOOL_SEARCH:'false'};delete env.ELECTRON_RUN_AS_NODE
let app,page
try{
  app=await electron.launch({executablePath:process.env.CLAUDE_GUI_TEST_EXECUTABLE||require('electron'),args:process.env.CLAUDE_GUI_TEST_EXECUTABLE?[]:[root],env});page=await app.firstWindow();await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  await page.evaluate(async({id,url,protocol,textOnly})=>{const p=await window.workspace.saveProvider({name:'Local browser fixture',protocol,baseUrl:url+'v1',auth:'none',models:[{id:'fixture-browser',vision:!textOnly,tools:true,context:200000}],defaultModel:'fixture-browser'});await window.workspace.activateProvider(id,p.id)}, {id,url,protocol,textOnly:!!process.env.CLAUDE_GUI_TEST_TEXT_MODEL})
  await page.getByRole('button',{name:'内置浏览器',exact:true}).click()
  await page.getByLabel('浏览器地址').fill(pageUrl);await page.getByRole('button',{name:'打开',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('button[aria-label="选择网页元素"]').disabled)
  previewUrl=(await page.evaluate(id=>window.workspace.browserState(id),id)).url
  await page.getByRole('button',{name:'选择网页元素'}).click()
  await app.evaluate(async({webContents},url)=>{const wc=webContents.getAllWebContents().find(w=>w.getURL()===url);const point=await wc.executeJavaScript('(()=>{const r=document.querySelector("#headline").getBoundingClientRect();return {x:Math.round(r.x+10),y:Math.round(r.y+10)}})()');wc.sendInputEvent({type:'mouseMove',...point});wc.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});wc.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1})},previewUrl)
  await page.getByLabel('元素修改要求').fill('Change this heading to Updated by native CLI. Edit the source, reload and verify with workspace_browser.')
  await page.getByRole('button',{name:'将元素与修改要求加入聊天'}).click()
  await page.waitForFunction(()=>document.querySelector('textarea[aria-label="消息输入"]').value.includes('Updated by native CLI'))
  await page.getByRole('button',{name:'发送消息',exact:true}).click()
  await page.getByText('NATIVE_BROWSER_VERIFIED',{exact:true}).waitFor({timeout:90000})
  assert.deepEqual(failures,[]);assert.deepEqual(calls,steps.map(s=>s.name))
  assert.match(fs.readFileSync(file,'utf8'),/Updated by native CLI/)
  assert.ok(seenResults.some(r=>JSON.stringify(r.content).includes('Updated by native CLI')))
  assert.ok(seenResults.some(r=>JSON.stringify(r.content).includes('browser-captures')))
  const message=await page.evaluate(async()=>{const state=await window.workspace.get();return state.sessions.find(s=>s.id===state.activeId).messages.at(-1)})
  assert.equal(message.status,'done');assert.equal(message.tools.filter(t=>t.name.startsWith('mcp__workspace_browser__')).length,8)
  await page.getByTitle('文件差异与检查点',{exact:true}).click();await page.locator('.diff-lines').getByText(/Updated by native CLI/).waitFor()
  await page.screenshot({path:path.join(root,'artifacts/browser-real-cli-'+protocol+'.png')})
  console.log(protocol+' real CLI browser passed: actual MCP discovery and calls, inspect/type/click/screenshot/diagnostics, native Read/Edit source update, reload and verification, rendered code diff. Local fixtures only; no paid models.')
}catch(e){console.log('Native fixture calls:',calls,'errors:',failures);if(page&&!page.isClosed())await page.screenshot({path:path.join(root,'artifacts/browser-native-failure.png')}).catch(()=>{});throw e}finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});server.close();console.log('Isolated native browser fixture: '+data)}
