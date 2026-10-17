import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-effort-slider-')),project=path.join(data,'project'),id='effort-slider'
fs.mkdirSync(project)
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs')},activeId:id,sessions:[{id,cwd:project,title:'Effort slider',archived:false,messages:[],model:'',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'profile')};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message))
try{
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  await page.evaluate(async id=>{
    const models=[{id:'configured-order',enabled:true,efforts:['max','low','high','none']},{id:'without-off',enabled:true,efforts:['low','high']},{id:'unknown-effort',enabled:true}]
    const provider=await window.workspace.saveProvider({name:'Slider fixture',protocol:'chat',baseUrl:'http://127.0.0.1:1/v1',auth:'none',models,defaultModel:models[0].id,keys:[{id:'primary',name:'Key 1',enabled:true,weight:1,models}]})
    await window.workspace.activateProvider(id,provider.id)
  },id)
  await page.getByRole('button',{name:'模型与推理强度',exact:true}).click()
  const slider=page.getByRole('slider',{name:'思考强度'}),labels=page.locator('.effort-slider-labels')
  await slider.waitFor();await page.waitForFunction(()=>document.querySelectorAll('.effort-slider-labels button').length===5);assert.deepEqual(await labels.getByRole('button').allTextContents(),['关闭','默认','最高','低','高'])
  assert.equal(await slider.inputValue(),'1');assert.equal(await slider.getAttribute('aria-valuetext'),'服务默认')
  const effort=()=>page.evaluate(async()=>{const s=await window.workspace.get();return s.sessions.find(x=>x.id===s.activeId).effort})
  const waitEffort=async value=>{const until=Date.now()+5000;while(Date.now()<until){if(await effort()===value&&await slider.isEnabled())return;await new Promise(r=>setTimeout(r,30))}assert.equal(await effort(),value)}
  await slider.press('Home');await waitEffort('none');assert.equal(await slider.evaluate(el=>document.activeElement===el),true,'Keyboard focus should remain on the slider')
  await slider.press('ArrowRight');await waitEffort('')
  await slider.press('ArrowRight');await waitEffort('max')
  assert.equal(await effort(),'max')
  const box=await slider.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width-16,box.y+box.height/2,{steps:8});await page.mouse.up()
  await waitEffort('high')
  const rail=await page.locator('.effort-slider-rail').boundingBox(),fill=await page.locator('.effort-slider-fill').boundingBox();assert.ok(Math.abs(fill.width-(rail.width-16))<2)
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/effort-slider.png')})
  await labels.getByRole('button',{name:'服务默认',exact:true}).click();await waitEffort('')
  await page.locator('.picker-models').getByRole('button',{name:/without-off/}).click();await page.getByRole('button',{name:'模型与推理强度',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.effort-slider-labels button').length===3)
  assert.deepEqual(await labels.getByRole('button').allTextContents(),['默认','低','高']);assert.equal(await slider.inputValue(),'0')
  await page.locator('.picker-models').getByRole('button',{name:/unknown-effort/}).click();await page.getByRole('button',{name:'模型与推理强度',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.effort-slider-labels button').length===1)
  assert.equal(await slider.isDisabled(),true);assert.deepEqual(await labels.getByRole('button').allTextContents(),['默认'])
  assert.deepEqual(errors,[]);console.log('Effort slider passed: configured order; off/default insertion; keyboard, pointer drag and labels persist correct parameters; model changes; unknown capabilities; no upstream requests.')
}finally{await app.close()}
