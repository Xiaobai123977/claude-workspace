import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-image-input-')),project=path.join(data,'project'),id='image-input',log=path.join(data,'args.jsonl'),cli=path.join(data,'cli.cjs')
fs.mkdirSync(project)
fs.writeFileSync(cli,`require('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');require(${JSON.stringify(path.join(root,'tests/fake-claude.cjs'))})`)
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:cli},activeId:id,sessions:[{id,cwd:project,title:'Image input',archived:false,messages:[],model:'',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'profile')};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))
try{
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  await page.evaluate(async id=>{
    const models=[{id:'vision',enabled:true,vision:true},{id:'text',enabled:true,vision:false}]
    const p=await window.workspace.saveProvider({name:'Images fixture',protocol:'chat',baseUrl:'http://127.0.0.1:1/v1',auth:'none',models,defaultModel:'vision',keys:[{id:'primary',name:'Key',enabled:true,models}]})
    await window.workspace.activateProvider(id,p.id)
  },id)
  const open=()=>page.getByRole('button',{name:'模型与推理强度',exact:true}).click(),toggle=page.getByRole('checkbox',{name:'接受图片输入'})
  await open();await toggle.waitFor();await toggle.isEnabled();await page.waitForFunction(()=>!document.querySelector('.picker-image-input input')?.disabled)
  assert.equal(await toggle.isChecked(),true)
  await toggle.uncheck();await page.waitForFunction(()=>!document.querySelector('.picker-image-input input')?.disabled)
  assert.equal(await page.evaluate(async id=>(await window.workspace.modelImageInput(id)).enabled,id),false)
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/model-image-input.png')})
  await page.locator('.picker-models').getByRole('button',{name:/text/}).click();await open();await page.waitForFunction(()=>!document.querySelector('.picker-image-input input')?.disabled);assert.equal(await toggle.isChecked(),false)
  await page.locator('.picker-models').getByRole('button',{name:/vision/}).click();await open();await page.waitForFunction(()=>!document.querySelector('.picker-image-input input')?.disabled);assert.equal(await toggle.isChecked(),false)
  await page.reload();await page.getByRole('textbox',{name:'消息输入'}).waitFor();await open();await page.waitForFunction(()=>!document.querySelector('.picker-image-input input')?.disabled);assert.equal(await toggle.isChecked(),false)
  await page.evaluate(async id=>{const value=await window.workspace.modelImageInput(id);await window.workspace.modelImageInput(id,value.key,true);await window.workspace.update(id,{model:'text'});let rejected=false;try{await window.workspace.modelImageInput(id,value.key,false)}catch{rejected=true}if(!rejected)throw new Error('Stale model writes must fail');await window.workspace.update(id,{model:'vision'});await window.workspace.modelImageInput(id,value.key,false);await window.workspace.send(id,'hello',[])},id)
  for(let n=0;n<150;n++){const busy=await page.evaluate(async id=>(await window.workspace.get()).sessions.find(s=>s.id===id).messages.some(m=>m.status==='running'),id);if(!busy)break;await new Promise(r=>setTimeout(r,40))}
  const calls=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse),request=calls.filter(args=>args.includes('-p')).at(-1)
  assert.ok(request.includes('--append-system-prompt'));assert.match(request[request.indexOf('--append-system-prompt')+1],/非多模态/)
  const current=await page.evaluate(async id=>window.workspace.readSession(id),id)
  assert.ok(current.messages.some(m=>m.role==='user'&&m.text==='hello'),'System instruction must not become a visible user message')
  for(let n=0;n<150;n++){const saved=await page.evaluate(async id=>{try{const value=await window.workspace.modelImageInput(id);await window.workspace.modelImageInput(id,value.key,true);return true}catch{return false}},id);if(saved)break;await new Promise(r=>setTimeout(r,40))}
  await page.evaluate(async id=>window.workspace.send(id,'hello again',[]),id)
  for(let n=0;n<150;n++){const busy=await page.evaluate(async id=>(await window.workspace.get()).sessions.find(s=>s.id===id).messages.some(m=>m.status==='running'),id);if(!busy)break;await new Promise(r=>setTimeout(r,40))}
  const last=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse).filter(args=>args.includes('-p')).at(-1)
  assert.equal(last.includes('--append-system-prompt'),false,'Enabling image input reconnects CLI without text-only instruction')
  assert.deepEqual(errors,[]);console.log('Image input UI passed: capability defaults, per-model persistence, reload, stale-write guard, actual CLI arguments and prompt removal on re-enable. Isolated fixture; no upstream calls.')
}finally{await app.close()}
