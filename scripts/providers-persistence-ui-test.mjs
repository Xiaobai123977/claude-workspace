import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '..')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-provider-persistence-'))
const profile = path.join(data, 'profile'), cwd = path.join(data, 'project')
fs.mkdirSync(profile); fs.mkdirSync(cwd)
const id = 'persistence-fixture', key = 'PERSISTENCE_FIXTURE_KEY'
let authorizedRequests = 0, app, page
const server = http.createServer((req, res) => {
  assert.equal(req.headers.authorization, `Bearer ${key}`)
  authorizedRequests++
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({data:[{id:'visible-model',effort:{supported_levels:['low','high']}},{id:'hidden-model'}]}))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
fs.writeFileSync(path.join(data, 'workspace.json'), JSON.stringify({version:1, preferences:{cliPath:path.join(root,'tests/fake-claude.cjs'),configDir:profile,providerId:'',model:'',effort:'',permission:'default'},activeId:id,sessions:[{id,cwd,title:'Restart fixture',createdAt:Date.now(),updatedAt:Date.now(),providerId:'',model:'',effort:'',permission:'default',messages:[]}]}))
const env = {...process.env, CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native-profile')}; delete env.ELECTRON_RUN_AS_NODE
const errors = []
async function launch() {
  app = await electron.launch({executablePath:require('electron'),args:[root],env})
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
}
async function settings() {
  await page.getByRole('button',{name:'设置',exact:true}).last().click()
  await page.locator('.settings-nav').getByRole('button',{name:'连接与模型',exact:true}).click()
}
async function quitThroughWindow() {
  const exited = app.waitForEvent('close')
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click()
  await exited
  app = null
}
try {
  await launch(); await settings()
  await page.getByRole('button',{name:/自定义 API.*填写 API Key/}).click()
  await page.getByRole('button',{name:/添加新的供应商/}).click()
  assert.equal(await page.getByLabel('连接名称').inputValue(),'')
  await page.getByLabel('连接名称').fill('Persistent Provider')
  await page.getByLabel('接口协议').selectOption('chat')
  await page.getByLabel('API 地址').fill(`http://127.0.0.1:${server.address().port}/v1`)
  await page.getByLabel('API Key',{exact:true}).fill(key)
  await page.getByLabel('显示模型 hidden-model').waitFor()
  await page.getByLabel('显示模型 hidden-model').uncheck()
  await page.locator('.model-inventory').getByRole('button',{name:/visible-model/}).click()
  await page.getByLabel('此模型默认思考强度').selectOption('high')
  await page.getByRole('button',{name:'保存修改',exact:true}).click()
  await page.getByRole('status').filter({hasText:'连接已保存'}).waitFor()
  const providerFile = path.join(data, 'providers.json')
  const savedBytes = fs.readFileSync(providerFile, 'utf8')
  assert.ok(!savedBytes.includes(key))
  assert.equal((await page.evaluate(()=>window.workspace.get())).preferences.providerId,'')
  await quitThroughWindow()

  // Saved but not activated: reopening a subscription chat must still expose the saved connection.
  await launch(); await settings()
  await page.getByRole('region',{name:'已保存的供应商'}).getByRole('button',{name:/Persistent Provider/}).waitFor()
  await page.getByRole('region',{name:'已保存的供应商'}).getByRole('button',{name:/Persistent Provider/}).click()
  await page.getByLabel('连接名称').waitFor()
  assert.equal(await page.getByLabel('连接名称').inputValue(),'Persistent Provider')
  assert.equal(await page.getByLabel('API Key',{exact:true}).inputValue(),'')
  await page.getByRole('status').filter({hasText:'API Key 已加密保存'}).waitFor()
  assert.equal(await page.getByLabel('显示模型 hidden-model').isChecked(),false)
  assert.equal(await page.getByLabel('此模型默认思考强度').inputValue(),'high')
  assert.equal(fs.readFileSync(providerFile,'utf8'),savedBytes)
  // Cards start collapsed; switching tabs never opens an unrelated form.
  await page.getByRole('region',{name:'已保存的供应商'}).getByRole('button',{name:/Persistent Provider/}).click()
  assert.equal(await page.getByLabel('连接名称').count(),0)
  await page.getByRole('button',{name:/添加新的供应商/}).click()
  assert.equal(await page.getByLabel('连接名称').inputValue(),'')
  await page.getByLabel('连接名称').fill('Discard this draft')
  page.removeAllListeners('dialog');page.once('dialog',d=>d.dismiss())
  await page.getByRole('region',{name:'已保存的供应商'}).getByRole('button',{name:/Persistent Provider/}).click()
  assert.equal(await page.getByLabel('连接名称').inputValue(),'Discard this draft')
  page.on('dialog',d=>d.accept())
  await page.getByRole('region',{name:'已保存的供应商'}).getByRole('button',{name:/Persistent Provider/}).click()
  assert.equal(await page.getByLabel('连接名称').inputValue(),'Persistent Provider')
  for(const tab of ['模型服务池','导入、导出与备份']){
    await page.getByRole('button',{name:tab,exact:true}).click()
    assert.equal(await page.getByLabel('连接名称').count(),0)
    await page.getByRole('button',{name:'供应商与 Key',exact:true}).click()
    await page.getByRole('button',{name:'刷新列表',exact:true}).click()
    await page.getByRole('status').filter({hasText:'已重新读取本机供应商列表'}).waitFor()
  }
  await page.getByRole('region',{name:'已保存的供应商'}).getByRole('button',{name:/Persistent Provider/}).click()

  const requestsBefore = authorizedRequests
  await page.getByRole('button',{name:'获取模型列表',exact:true}).click()
  await page.getByRole('status').filter({hasText:'已读取 2 个模型'}).waitFor()
  assert.ok(authorizedRequests>requestsBefore) // The encrypted key decrypts after a real process restart.
  await page.getByRole('button',{name:'保存并启用自定义 API',exact:true}).click()
  await page.getByRole('status').filter({hasText:'已启用自定义 API'}).waitFor()
  const providerId = (await page.evaluate(()=>window.workspace.get())).preferences.providerId
  await quitThroughWindow()

  // Saved and activated: current session, default connection, key and model configuration all survive.
  await launch()
  const restored = await page.evaluate(()=>window.workspace.get())
  assert.equal(restored.preferences.providerId,providerId)
  assert.equal(restored.sessions.find(s=>s.id===id).providerId,providerId)
  await page.getByRole('button',{name:'模型与推理强度',exact:true}).click()
  await page.locator('.model-picker').getByRole('button',{name:/visible-model/}).waitFor()
  assert.equal(await page.locator('.model-picker').getByRole('button',{name:/hidden-model|Claude Opus/}).count(),0)
  await page.keyboard.press('Escape'); await settings()
  await page.getByRole('region',{name:'已保存的供应商'}).getByRole('button',{name:/Persistent Provider.*当前聊天使用/}).waitFor()
  assert.equal(await page.getByLabel('连接名称').count(),0)
  await page.getByRole('region',{name:'已保存的供应商'}).getByRole('button',{name:/Persistent Provider/}).click()
  assert.equal(await page.getByLabel('自定义连接',{exact:true}).count(),0)
  assert.equal(await page.getByLabel('连接名称').inputValue(),'Persistent Provider')
  assert.deepEqual(errors,[])
  console.log('Provider persistence passed: two real window-close/relaunch cycles, saved and activated states, encrypted key reuse, model visibility, effort defaults, saved-connection entry and active model picker.')
} finally {
  if(app) await app.close()
  server.close()
  console.log('Isolated persistence test data: '+data)
}
