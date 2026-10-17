import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'settings-dirty-ui-')),id='settings-dirty'
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native')};delete env.ELECTRON_RUN_AS_NODE
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs'),configDir:env.CLAUDE_CONFIG_DIR,modelImageInputs:{fixture:false}},activeId:id,sessions:[{id,cwd:data,title:'Settings test',messages:[],createdAt:Date.now(),updatedAt:Date.now(),model:'',effort:'',permission:'default',archived:false}]}))
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.on('pageerror',e=>errors.push(e.message))
const open=async()=>{await page.locator('.rail').getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'连接与模型',exact:true}).click();await page.locator('.provider-card-toggle').filter({hasText:'Fixture'}).click()}
const leave=async()=>{await page.getByRole('button',{name:'返回聊天',exact:true}).click();await page.locator('.settings-layout').waitFor({state:'hidden',timeout:3000})}
try{
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  const p=await page.evaluate(()=>window.workspace.saveProvider({name:'Fixture',protocol:'chat',baseUrl:'http://127.0.0.1:1/v1',auth:'none',models:[{id:'fixture',enabled:true}],defaultModel:'fixture'}))
  await page.evaluate(({id,pid})=>window.workspace.activateProvider(id,pid),{id,pid:p.id})
  await open()
  // IPC snapshots recreate nested preference objects without changing values.
  await page.evaluate(id=>window.workspace.update(id,{title:'Background state update'}),id)
  await leave()
  await open()
  const name=page.locator('#provider-editor').getByRole('textbox').first()
  await name.fill('Fixture edited')
  await page.getByRole('button',{name:'返回聊天',exact:true}).click()
  await page.getByRole('dialog',{name:'未保存的修改',exact:true}).waitFor()
  await page.getByRole('button',{name:'继续编辑',exact:true}).click()
  await page.getByRole('button',{name:'保存修改',exact:true}).click()
  await page.getByText('连接已保存，凭证已加密',{exact:true}).waitFor()
  await leave()
  assert.deepEqual(errors,[])
  console.log('Settings dirty UI passed: nested image preferences, background updates, clean model browsing, real edit protection and saved provider exit. '+data)
}finally{await app.close()}
