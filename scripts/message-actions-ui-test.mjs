import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),base=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'claude-message-actions-'))),data=path.join(base,'gui'),profile=path.join(base,'native'),cwd=path.join(base,'project')
for(const p of [data,profile,cwd])fs.mkdirSync(p)
fs.writeFileSync(path.join(cwd,'keep.txt'),'project unchanged')
const requests=[],errors=[],id='message-actions-root'
const server=http.createServer(async(req,res)=>{
  if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'fixture-model'}]}));return}
  let raw='';for await(const c of req)raw+=c
  const body=JSON.parse(raw),lastUser=body.messages.filter(m=>m.role==='user').at(-1),blocks=typeof lastUser?.content==='string'?[lastUser.content]:(lastUser?.content||[]).map(b=>b.text||'')
  const isAnswer=blocks.some(text=>text.trim().startsWith('QUESTION_'))
  if(isAnswer)requests.push(body)
  const answer=isAnswer?'ANSWER_'+requests.length:'Fixture auxiliary response'
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  for(const e of [{choices:[{delta:{content:answer},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:10,completion_tokens:5}}])res.write('data: '+JSON.stringify(e)+'\n\n')
  res.end('data: [DONE]\n\n')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{configDir:profile},activeId:id,sessions:[{id,cwd,title:'Message actions',createdAt:Date.now(),updatedAt:Date.now(),archived:false,messages:[],model:'',effort:'',permission:'default'}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:profile,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};delete env.ELECTRON_RUN_AS_NODE
let app,page
const launch=async()=>{app=await electron.launch({executablePath:require('electron'),args:[root],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('textbox',{name:'消息输入'}).waitFor()}
const state=()=>page.evaluate(()=>window.workspace.get())
const active=async()=>{const s=await state();return s.sessions.find(x=>x.id===s.activeId)}
const finish=async(answer)=>{await page.locator('.markdown').getByText(answer,{exact:true}).waitFor({timeout:60000});await page.waitForFunction(async()=>{const s=await window.workspace.get();return !s.sessions.find(x=>x.id===s.activeId).messages.some(m=>m.status==='running')});return active()}
const select=async(sid)=>page.evaluate(id=>window.workspace.select(id),sid)
const article=mid=>page.locator(`[data-message-id="${mid}"]`)
try{
  await launch()
  const provider=await page.evaluate(async url=>window.workspace.saveProvider({name:'Local fixture',protocol:'chat',baseUrl:url,auth:'none',models:[{id:'fixture-model'}],defaultModel:'fixture-model'}),`http://127.0.0.1:${server.address().port}/v1`)
  await page.evaluate(async({id,pid})=>{await window.workspace.activateProvider(id,pid);await window.workspace.send(id,'QUESTION_ONE',[])},{id,pid:provider.id})
  const first=await finish('ANSWER_1'),firstAnswer=first.messages.find(m=>m.role==='assistant'),firstUser=first.messages.find(m=>m.role==='user')
  await page.getByRole('textbox',{name:'消息输入'}).fill('QUESTION_TWO');await page.getByRole('button',{name:'发送消息',exact:true}).click();await finish('ANSWER_2')
  const original=await active(),secondAnswer=original.messages.findLast(m=>m.role==='assistant'),nativeId=original.nativeId
  // Branch at an earlier answer using the inline button, not the session menu.
  await article(firstAnswer.id).getByRole('button',{name:'从这里创建分支',exact:true}).click()
  await page.waitForFunction(async id=>(await window.workspace.get()).activeId!==id,id)
  const branch=await active();assert.notEqual(branch.nativeId,nativeId);assert.deepEqual(branch.messages.map(m=>m.text),['QUESTION_ONE','ANSWER_1']);assert.ok(fs.existsSync(branch.nativeFile));assert.equal(requests.length,2)
  await select(id)
  await article(firstUser.id).getByRole('button',{name:'从这里创建分支',exact:true}).click();await page.waitForFunction(async id=>(await window.workspace.get()).activeId!==id,id)
  const userBranch=await active();assert.equal(userBranch.messages.length,1);assert.equal(userBranch.messages[0].role,'user')
  await select(id)
  await article(firstAnswer.id).getByRole('button',{name:'重新生成',exact:true}).click()
  const regenerated=await finish('ANSWER_3'),newAnswer=regenerated.messages.findLast(m=>m.role==='assistant')
  assert.notEqual(regenerated.nativeId,nativeId);assert.equal(regenerated.providerId,provider.id);assert.deepEqual(regenerated.regeneration.origin,{sessionId:id,messageId:firstAnswer.id})
  const request3=JSON.stringify(requests[2].messages);assert.ok(request3.includes('QUESTION_ONE'));assert.ok(!request3.includes('QUESTION_TWO'));assert.ok(!request3.includes('ANSWER_1'));assert.ok(!request3.includes('ANSWER_2'))
  await article(newAnswer.id).getByRole('button',{name:'上一个回答版本',exact:true}).click();await page.waitForFunction(async id=>(await window.workspace.get()).activeId===id,id)
  await article(firstAnswer.id).getByRole('button',{name:'下一个回答版本',exact:true}).click();await page.waitForFunction(async id=>(await window.workspace.get()).activeId===id,regenerated.id)
  // A retry of the new answer is version 3 of the same original answer.
  await article(newAnswer.id).getByRole('button',{name:'重新生成',exact:true}).click();const third=await finish('ANSWER_4')
  assert.deepEqual(third.regeneration.origin,regenerated.regeneration.origin);await article(third.messages.findLast(m=>m.role==='assistant').id).getByText('3 / 3',{exact:true}).waitFor()
  await select(id);await article(secondAnswer.id).getByRole('button',{name:'重新生成',exact:true}).click();await finish('ANSWER_5')
  const request5=JSON.stringify(requests[4].messages);assert.ok(request5.includes('QUESTION_ONE'));assert.ok(request5.includes('ANSWER_1'));assert.ok(request5.includes('QUESTION_TWO'));assert.ok(!request5.includes('ANSWER_2'));assert.ok(!request5.includes('ANSWER_3'));assert.ok(!request5.includes('ANSWER_4'))
  // Replay the exact original native input once, retaining attachment paths and
  // selected-element context even after the attachment registry is rebuilt.
  await select(id)
  const attachment=await page.evaluate(async()=> (await window.workspace.importFiles([{name:'refs.txt',data:btoa('attachment contents')}]))[0])
  const context={url:'https://example.test',title:'Fixture',selector:'#fixture-target',tag:'button',text:'Fixture button',html:'<button>Fixture button</button>'}
  await page.evaluate(async({id,attachment,context})=>window.workspace.send(id,'QUESTION_WITH_FILE',[attachment.id],[context]),{id,attachment,context});const withFile=await finish('ANSWER_6'),fileAnswer=withFile.messages.findLast(m=>m.role==='assistant')
  await app.close();await launch();await select(id)
  await article(fileAnswer.id).getByRole('button',{name:'重新生成',exact:true}).click();const fileRetry=await finish('ANSWER_7')
  const latest=JSON.stringify(requests[6].messages.filter(m=>m.role==='user').at(-1));assert.equal((latest.match(/refs\.txt/g)||[]).length,1);assert.equal((latest.match(/#fixture-target/g)||[]).length,1);assert.equal(fileRetry.messages.filter(m=>m.role==='user').at(-1).attachments[0].path,attachment.path)
  // Version links survive reload, while original and later answers remain intact.
  await select(regenerated.id);await article(newAnswer.id).getByText('2 / 3',{exact:true}).waitFor();await select(id)
  const unchanged=await active();assert.ok(unchanged.messages.some(m=>m.text==='ANSWER_1'));assert.ok(unchanged.messages.some(m=>m.text==='ANSWER_2'));assert.ok(unchanged.messages.some(m=>m.text==='ANSWER_6'))
  assert.equal(fs.readFileSync(path.join(cwd,'keep.txt'),'utf8'),'project unchanged');assert.deepEqual(errors,[])
  console.log('Message actions passed: native CLI, inline user/answer branches, exact regeneration context, independent native IDs, old answers and later turns preserved, version navigation and reload, attachments and element context replayed once. Local fixture only: '+base)
}finally{await app?.close().catch(()=>{});server.closeAllConnections();server.close()}
