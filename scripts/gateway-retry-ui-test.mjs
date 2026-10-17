// Actual Electron + installed Claude CLI + local upstream fixtures. No paid model endpoint.
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import assert from 'node:assert/strict'

const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..')
const data=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'claude-retry-ui-')),cwd=path.join(data,'project'),profile=path.join(data,'profile')
fs.mkdirSync(cwd);fs.mkdirSync(profile)
let mode='recover',requests=0
const bodies=[]
const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk
  const body=JSON.parse(raw)
  // Native prompt suggestions are separate requests, not retries of the task under test.
  if(body.messages?.some(m=>typeof m.content==='string'&&m.content.startsWith('[SUGGESTION MODE:'))){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:''},finish_reason:'stop'}]})+'\n\n');return}
  bodies.push(body);requests++
  if(mode==='heartbeat'&&requests===1){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': keepalive\n\n');const timer=setInterval(()=>res.write(': keepalive\n\n'),2000);res.on('close',()=>clearInterval(timer));return}
  if(mode==='stream-error'&&requests===1){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({error:{type:'overloaded_error',message:'RAW_STREAM_OVERLOAD'}})+'\n\n');return}
  const status=['heartbeat','stream-error'].includes(mode)?200:mode==='recover'?(requests===1?429:requests===2?503:200):mode==='unauthorized'?401:mode==='exhausted'?503:429
  if(status!==200){res.writeHead(status,{'Content-Type':'application/json','retry-after-ms':mode==='exhausted'?'1':mode==='waiting'?'10000':'1200'});res.end(JSON.stringify({error:{message:'PRIVATE_FIXTURE_ERROR'}}));return}
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.write('data: '+JSON.stringify({choices:[{delta:{content:'Retry fixture recovered'},finish_reason:'stop'}]})+'\n\n')
  res.write('data: '+JSON.stringify({choices:[],usage:{prompt_tokens:10,completion_tokens:5}})+'\n\n')
  res.end('data: [DONE]\n\n')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const id='retry-ui-fixture'
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:'',configDir:profile,model:'',effort:'',permission:'default',allowedTools:'',disallowedTools:''},activeId:id,sessions:[{id,cwd,title:'Retry test',createdAt:Date.now(),updatedAt:Date.now(),archived:false,model:'',effort:'',permission:'default',messages:[]}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native-profile'),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.on('pageerror',e=>errors.push(e.message))
async function send(text){await page.getByRole('textbox',{name:'消息输入'}).fill(text);await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.waitForFunction(()=>document.querySelector('textarea[aria-label="消息输入"]').value==='')}
async function finished(){await page.getByRole('button',{name:'发送消息',exact:true}).waitFor({timeout:45000});return page.evaluate(async()=>{const state=await window.workspace.get();return state.sessions.find(s=>s.id===state.activeId).messages.at(-1)})}
try{
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  const provider=await page.evaluate(url=>window.workspace.saveProvider({name:'Retry fixture',protocol:'chat',baseUrl:url,auth:'none',models:[{id:'retry-model',enabled:true}],defaultModel:'retry-model'}),`http://127.0.0.1:${server.address().port}/v1`)
  await page.evaluate(({id,providerId})=>window.workspace.activateProvider(id,providerId),{id,providerId:provider.id})
  await send('Recovery fixture, no tools.')
  await page.locator('.gateway-retry').filter({hasText:/HTTP 429.*1\/10/}).waitFor({timeout:30000})
  await page.locator('.gateway-retry').filter({hasText:/HTTP 503.*2\/10/}).waitFor()
  await page.screenshot({path:path.join(root,'artifacts/gateway-retry-waiting.png')})
  const recovered=await finished();assert.equal(recovered.status,'done');assert.match(recovered.text,/Retry fixture recovered/)
  assert.equal(requests,3);assert.equal(new Set(bodies.map(body=>JSON.stringify(body))).size,1)
  assert.equal(await page.locator('.gateway-retry').count(),0);assert.equal(recovered.gatewayRetries,undefined)

  mode='waiting';requests=0
  await send('Cancellation fixture, no tools.')
  await page.locator('.gateway-retry').filter({hasText:/HTTP 429.*1\/10/}).waitFor()
  // Another chat using the same provider must not receive this chat's status or cancellation.
  const other=await page.evaluate(async cwd=>window.workspace.create(cwd),cwd)
  assert.equal(await page.locator('.gateway-retry').count(),0)
  await page.evaluate(id=>window.workspace.select(id),id)
  await page.locator('.gateway-retry').waitFor()
  await page.getByRole('button',{name:'停止执行',exact:true}).click()
  await finished();assert.equal(requests,1);assert.equal(await page.locator('.gateway-retry').count(),0)
  const stopped=await page.evaluate(async id=>(await window.workspace.get()).sessions.find(s=>s.id===id).messages.at(-1),id)
  assert.equal(stopped.status,'stopped')

  await page.evaluate(id=>window.workspace.select(id),other.id)
  await page.evaluate(async()=>{const p=(await window.workspace.providers())[0];await window.workspace.saveProvider(p)})
  mode='unauthorized';requests=0
  await send('Permanent error fixture, no tools.')
  const unauthorized=await finished();assert.equal(unauthorized.status,'error');assert.equal(requests,1)
  assert.equal(await page.locator('.gateway-retry').count(),0)

  await page.evaluate(async()=>{const p=(await window.workspace.providers())[0];await window.workspace.saveProvider(p)})
  mode='exhausted';requests=0
  await send('Retry exhaustion fixture, no tools.')
  const exhausted=await finished();assert.equal(exhausted.status,'error');assert.equal(requests,44) // 11 original attempts in each of four outer attempts.
  assert.match(exhausted.error,/PRIVATE_FIXTURE_ERROR/) // Preserve the fixture's actual upstream wording; this is not a configured credential.
  assert.equal(await page.locator('.gateway-retry').count(),0)
  mode='stream-error';requests=0
  await page.evaluate(async()=>{const p=(await window.workspace.providers())[0];await window.workspace.saveProvider({...p,timeout:15000})})
  await send('HTTP 200 stream-error fixture, no tools.')
  await page.locator('.gateway-retry').filter({hasText:/上游响应错误.*overloaded_error.*1\/10/}).waitFor()
  const streamRecovered=await finished();assert.equal(streamRecovered.status,'done');assert.equal(requests,2)
  mode='heartbeat';requests=0
  await page.evaluate(async()=>{const p=(await window.workspace.providers())[0];await window.workspace.saveProvider({...p,timeout:15000})})
  await send('Heartbeat-only stall fixture, no tools.')
  await page.locator('.gateway-retry').filter({hasText:/等待上游有效响应.*已等待.*本次超时剩余/}).waitFor({timeout:20000})
  await page.screenshot({path:path.join(root,'artifacts/gateway-response-waiting.png')})
  await page.locator('.gateway-retry').filter({hasText:/上游请求超时.*1\/10/}).waitFor({timeout:10000})
  const heartbeatRecovered=await finished();assert.equal(heartbeatRecovered.status,'done');assert.equal(requests,2)
  assert.deepEqual(errors,[])
  console.log('Gateway retry UI passed with real CLI: unchanged 429/503 recovery, identical bodies, stop, isolation, 401 key suspension, ten gateway retries per outer attempt (44 requests total), status cleanup, HTTP-200 stream errors and heartbeat-only timeout/recovery.')
}finally{await app.close();server.close();console.log('Isolated retry fixture: '+data)}
