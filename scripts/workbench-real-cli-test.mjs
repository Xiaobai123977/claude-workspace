// Full Electron host + installed CLI + local mock API; no paid model requests.
import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..')
const data=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'claude-host-real-')),cwd=path.join(data,'project'),profile=path.join(data,'profile'),file=path.join(cwd,'checkpoint.txt')
fs.mkdirSync(cwd);fs.mkdirSync(profile);fs.writeFileSync(file,'before')
const mod=path.join(data,'fixture-mod');fs.mkdirSync(path.join(mod,'.claude-plugin'),{recursive:true});fs.mkdirSync(path.join(mod,'hooks'))
fs.writeFileSync(path.join(mod,'.claude-plugin/plugin.json'),JSON.stringify({name:'fixture-mod',version:'1.0.0',description:'Isolated prompt middleware fixture'}))
fs.writeFileSync(path.join(mod,'hooks/hooks.json'),JSON.stringify({modules:['./register.js']}))
fs.writeFileSync(path.join(mod,'hooks/register.js'),`export function register(on) { on('prompt.submit', async ($, e, next) => next({ ...e, text: e.text + '\\nLOCAL_MOD_VERIFIED' })) }`)
const bodies=[]
const server=http.createServer(async(req,res)=>{
  if(req.url.endsWith('/models')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'fixture-model'}]}));return}
  let raw='';for await(const chunk of req)raw+=chunk
  const body=JSON.parse(raw);bodies.push(body)
  const count=bodies.length
  const delta=count<=2?{tool_calls:[{index:0,id:'tool_'+count,function:{name:count===1?'Read':'Write',arguments:JSON.stringify(count===1?{file_path:file}:{file_path:file,content:'after'})}}]}:{content:'Host protocol OK'}
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  for(const e of [{choices:[{delta,finish_reason:count<=2?'tool_calls':'stop'}]},{choices:[],usage:{prompt_tokens:10,completion_tokens:5}}])res.write('data: '+JSON.stringify(e)+'\n\n')
  res.end('data: [DONE]\n\n')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const id='host-real-fixture',preferences={cliPath:'',configDir:profile,model:'',effort:'',permission:'acceptEdits',allowedTools:'Read,Write',disallowedTools:''}
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences,activeId:id,sessions:[{id,cwd,title:'真实宿主测试',createdAt:Date.now(),updatedAt:Date.now(),archived:false,model:'',effort:'',permission:'acceptEdits',messages:[]}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native-profile'),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow()
const finish=async()=>{
  const deadline=Date.now()+45000
  while(Date.now()<deadline){
    const state=await page.evaluate(()=>window.workspace.get()),s=state.sessions.find(x=>x.id===state.activeId),m=s.messages.at(-1)
    if(m?.role==='assistant'&&m.status==='error')throw Error(m.error)
    if(m?.role==='assistant'&&m.status==='done'&&m.text.includes('Host protocol OK'))return s
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw Error('Host test timed out')
}
try{
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  await page.evaluate(async({id,mod})=>window.workspace.tryMod(id,mod),{id,mod})
  const provider=await page.evaluate(async url=>window.workspace.saveProvider({name:'Local fixture',protocol:'chat',baseUrl:url,auth:'none',models:[{id:'fixture-model'}],defaultModel:'fixture-model'}),`http://127.0.0.1:${server.address().port}/v1`)
  await page.evaluate(async({id,provider})=>{const state=await window.workspace.get();await window.workspace.update(id,{providerId:provider.id,options:{...state.sessions[0].options,maxTurns:6}});await window.workspace.send(id,'FIRST_HOST_PROMPT: update the isolated fixture file.',[])},{id,provider})
  const first=await finish();assert.equal(fs.readFileSync(file,'utf8'),'after');assert.ok(first.messages[0].checkpointId);assert.ok(first.messages[1].nativeUUID);assert.match(first.messages[1].text,/Host protocol OK/)
  await page.getByRole('region',{name:'本轮文件变更'}).waitFor({timeout:15000})
  const firstChange=await page.evaluate(async id=>{const state=await window.workspace.get(),s=state.sessions.find(s=>s.id===id),m=s.messages.find(m=>m.changes?.files.length);return window.workspace.turnChanges(id,m.id)},id)
  assert.equal(firstChange.files.length,1);assert.match(firstChange.files[0].patch,/-before/);assert.match(firstChange.files[0].patch,/\+after/)
  assert.ok(JSON.stringify(bodies[0].messages).includes('LOCAL_MOD_VERIFIED'),'Mod prompt middleware should run inside the actual -p session')
  await page.evaluate(async id=>window.workspace.send(id,'SECOND_HOST_PROMPT: record this turn.',[]),id)
  const second=await finish(),secondUser=second.messages.filter(m=>m.role==='user')[1]
  assert.ok(secondUser.checkpointId)
  await page.evaluate(async({id,messageId})=>window.workspace.checkpoint(id,messageId,'conversation'),{id,messageId:secondUser.id})
  const fork=await page.evaluate(async()=>{const state=await window.workspace.get();return state.sessions.find(s=>s.id===state.activeId)})
  await page.evaluate(async id=>window.workspace.send(id,'FORK_HOST_PROMPT: continue the earlier branch.',[]),fork.id)
  const branched=await finish();assert.notEqual(branched.nativeId,first.nativeId)
  const history=JSON.stringify(bodies.at(-1).messages)
  assert.ok(history.includes('FIRST_HOST_PROMPT'));assert.ok(!history.includes('SECOND_HOST_PROMPT'))
  await page.evaluate(async({id,messageId})=>window.workspace.checkpoint(id,messageId,'code'),{id,messageId:first.messages[0].id})
  assert.equal(fs.readFileSync(file,'utf8'),'before')
  const imported=await page.evaluate(async id=>window.workspace.nativeSessions(id),id);assert.ok(imported.length>=2)
  const canonical=await page.evaluate(id=>window.workspace.readSession(id),id)
  assert.ok(canonical.messages.some(m=>m.text.includes('FIRST_HOST_PROMPT')));assert.ok(canonical.messages.some(m=>m.text.includes('SECOND_HOST_PROMPT')));assert.ok(canonical.messages.some(m=>m.tools.some(t=>t.name==='Write')))
  const nativeChange=canonical.messages.find(m=>m.changes?.files.length);assert.ok(nativeChange,'Change metadata survives native history hydration')
  assert.match((await page.evaluate(({id,messageId})=>window.workspace.turnChanges(id,messageId),{id,messageId:nativeChange.id})).files[0].patch,/\+after/)
  const report={time:new Date().toISOString(),realCLI:true,providerRuntime:true,readWriteToolLoop:true,localModValidation:true,modMiddleware:true,checkpointCapture:true,conversationForkAtCheckpoint:true,fileRewind:true,nativeSessions:true,requests:bodies.length}
  fs.writeFileSync(path.join(root,'artifacts/workbench-real-cli-test.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
}finally{await app.close();server.close();console.log('Isolated fixture: '+data)}
