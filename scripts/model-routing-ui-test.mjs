// Real CLI, real Electron, local upstream only. Credentials are disposable test values.
import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..')
const data=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'claude-pool-ui-')),cwd=path.join(data,'project'),profile=path.join(data,'profile')
fs.mkdirSync(cwd);fs.mkdirSync(profile)
const catalogs=[],generations=[]
const mainGenerations=()=>generations.filter(g=>!JSON.stringify(g.body).includes('[SUGGESTION MODE:'))
const server=http.createServer(async(req,res)=>{
  const auth=req.headers.authorization||req.headers['x-api-key'],owner=String(auth).split(' ').at(-1)
  if(req.url.endsWith('/models')){
    catalogs.push({url:req.url,owner})
    const models=owner==='PRIVATE_A1'?[{id:'shared',effort:{supported_levels:['low']}},{id:'only-key-1'}]:owner==='PRIVATE_A2'?[{id:'shared',effort:{supported_levels:['high']}},{id:'only-key-2'}]:[{id:'upstream-alias-b',effort:{supported_levels:['high']}},{id:'shared',effort:{supported_levels:['high']}}]
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:models}));return
  }
  let raw='';for await(const chunk of req)raw+=chunk
  const body=JSON.parse(raw);generations.push({owner,url:req.url,body})
  if(owner==='PRIVATE_A2'){res.writeHead(429,{'Content-Type':'application/json','retry-after':'30'});res.end(JSON.stringify({error:{message:'PRIVATE_UPSTREAM_BODY'}}));return}
  assert.equal(owner,'PRIVATE_B1');assert.equal(body.model,'upstream-alias-b');assert.equal(body.reasoning.effort,'high')
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  for(const event of [{type:'response.output_item.added',output_index:0,item:{type:'message',id:'msg1',role:'assistant',content:[]}},{type:'response.output_text.delta',item_id:'msg1',delta:'Pool routing verified'},{type:'response.completed',response:{status:'completed',usage:{input_tokens:10,output_tokens:5}}}])res.write('data: '+JSON.stringify(event)+'\n\n')
  res.end()
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const id='pool-ui-fixture'
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,preferences:{cliPath:'',configDir:profile,model:'',effort:'',permission:'default',allowedTools:'',disallowedTools:''},activeId:id,sessions:[{id,cwd,title:'Routing fixture',createdAt:Date.now(),updatedAt:Date.now(),archived:false,model:'',effort:'',permission:'default',messages:[]}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:path.join(data,'native-profile'),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};delete env.ELECTRON_RUN_AS_NODE
let app,page
const errors=[]
async function launch(){app=await electron.launch({executablePath:require('electron'),args:[root],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>void d.accept().catch(()=>{}));await page.getByRole('textbox',{name:'消息输入'}).waitFor()}
async function settings(){await page.getByRole('button',{name:'设置',exact:true}).last().click();await page.locator('.settings-nav').getByRole('button',{name:'连接与模型',exact:true}).click()}
async function finish(){await page.getByRole('button',{name:'发送消息',exact:true}).waitFor({timeout:45000});return page.evaluate(async()=>{const s=await window.workspace.get();return s.sessions.find(x=>x.id===s.activeId).messages.at(-1)})}
try{
  await launch();await settings()
  await page.getByRole('button',{name:/自定义 API.*填写 API Key/}).click()
  await page.getByRole('button',{name:/添加新的供应商/}).click()
  await page.getByLabel('连接名称',{exact:true}).fill('Supplier A')
  await page.getByText('供应商路由与分配',{exact:true}).click()
  await page.getByLabel('供应商权重',{exact:true}).fill('2')
  await page.getByLabel('接口协议',{exact:true}).selectOption('chat')
  await page.getByLabel('API 地址',{exact:true}).fill(`http://127.0.0.1:${server.address().port}/a/v1`)
  await page.getByLabel('API Key',{exact:true}).fill('PRIVATE_A1')
  await page.getByLabel('显示模型 only-key-1',{exact:true}).waitFor()
  await page.getByRole('button',{name:'添加 Key',exact:true}).click()
  await page.getByLabel('Key 2 权重',{exact:true}).fill('3')
  await page.getByLabel('Key 2 API Key',{exact:true}).fill('PRIVATE_A2')
  await page.getByLabel('显示模型 only-key-2',{exact:true}).waitFor()
  await page.getByRole('button',{name:'保存修改',exact:true}).click()
  await page.getByRole('status').filter({hasText:'连接已保存'}).waitFor()
  const a=(await page.evaluate(()=>window.workspace.providers()))[0]
  assert.deepEqual(a.keys[0].models.map(m=>m.id),['shared','only-key-1'])
  assert.deepEqual(a.keys[1].models.map(m=>m.id),['shared','only-key-2'])
  assert.ok(catalogs.some(r=>r.owner==='PRIVATE_A1'));assert.ok(catalogs.some(r=>r.owner==='PRIVATE_A2'))
  await page.screenshot({path:path.join(root,'artifacts/routing-provider-keys.png')})

  await page.getByRole('button',{name:/添加新的供应商/}).click()
  await page.getByLabel('连接名称',{exact:true}).fill('Supplier B')
  await page.getByLabel('接口协议',{exact:true}).selectOption('responses')
  await page.getByLabel('API 地址',{exact:true}).fill(`http://127.0.0.1:${server.address().port}/b/v1`)
  await page.getByLabel('API Key',{exact:true}).fill('PRIVATE_B1')
  await page.getByLabel('显示模型 upstream-alias-b',{exact:true}).waitFor()
  await page.getByRole('button',{name:'保存修改',exact:true}).click()
  await page.getByRole('status').filter({hasText:'连接已保存'}).waitFor()
  const b=(await page.evaluate(()=>window.workspace.providers())).find(p=>p.name==='Supplier B')
  const disk=fs.readFileSync(path.join(data,'providers.json'),'utf8')
  assert.ok(!['PRIVATE_A1','PRIVATE_A2','PRIVATE_B1'].some(k=>disk.includes(k)))

  await page.getByRole('button',{name:'模型服务池',exact:true}).click()
  await page.getByLabel('搜索模型覆盖').waitFor()
  const coverage=await page.evaluate(()=>window.workspace.routing())
  assert.equal(coverage.coverage.find(c=>c.model==='shared').providerCount,2)
  assert.equal(coverage.coverage.find(c=>c.model==='shared').keyCount,3)
  await page.getByLabel('模型池名称',{exact:true}).fill('Unified service')
  await page.getByLabel('模型池模型 ID',{exact:true}).fill('unified-model')
  await page.getByRole('button',{name:'添加供应商线路',exact:true}).click()
  await page.getByLabel('池线路 1 供应商',{exact:true}).selectOption(a.id)
  await page.getByLabel('池线路 1 上游模型 ID',{exact:true}).fill('shared')
  await page.getByRole('button',{name:'添加供应商线路',exact:true}).click()
  await page.getByLabel('池线路 2 供应商',{exact:true}).selectOption(b.id)
  await page.getByLabel('池线路 2 上游模型 ID',{exact:true}).fill('upstream-alias-b')
  await page.getByLabel('模型池默认思考档位',{exact:true}).selectOption('high')
  await page.getByRole('button',{name:'保存并启用模型池',exact:true}).click()
  await page.getByRole('status').filter({hasText:'模型池已保存并启用'}).waitFor()
  await page.screenshot({path:path.join(root,'artifacts/routing-model-pool.png')})
  await page.getByRole('button',{name:'工作区',exact:true}).click()
  await page.getByRole('button',{name:'模型与推理强度',exact:true}).click()
  await page.locator('.model-picker').getByText(/2 个供应商 \/ 3 个 Key/).waitFor()
  assert.equal(await page.locator('.model-picker').getByRole('button',{name:/Claude Opus|only-key/}).count(),0)
  await page.keyboard.press('Escape')
  await page.getByRole('textbox',{name:'消息输入'}).fill('POOL_FIRST: reply once, do not use tools.')
  await page.getByRole('button',{name:'发送消息',exact:true}).click()
  const first=await finish();assert.equal(first.status,'done');assert.match(first.text,/Pool routing verified/)
  assert.equal(mainGenerations().length,2);assert.equal(mainGenerations()[0].owner,'PRIVATE_A2');assert.ok(generations.slice(1).every(g=>g.owner==='PRIVATE_B1'))
  assert.equal(first.gatewayRoute.providerName,'Supplier B');assert.equal(first.gatewayRoute.model,'upstream-alias-b')
  const state=await page.evaluate(()=>window.workspace.get()),poolId=state.preferences.providerId
  const exited=app.waitForEvent('close',{timeout:15000})
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click()
  await exited;app=null

  // Affinity survives a real process restart while the supplier/key secrets stay encrypted.
  await launch()
  assert.equal((await page.evaluate(()=>window.workspace.get())).preferences.providerId,poolId)
  await page.getByRole('textbox',{name:'消息输入'}).fill('POOL_SECOND: continue, no tools.')
  await page.getByRole('button',{name:'发送消息',exact:true}).click()
  const second=await finish();assert.equal(second.status,'done');assert.equal(mainGenerations().length,3);assert.ok(generations.slice(1).every(g=>g.owner==='PRIVATE_B1'));assert.match(JSON.stringify(mainGenerations()[2].body),/POOL_SECOND/)
  assert.ok(!JSON.stringify(second).includes('PRIVATE_'));assert.deepEqual(errors,[])
  console.log('Routing UI passed: per-Key independent catalogs, two levels of weights, coverage counts, manual cross-ID and cross-protocol pool mapping, capability filtering, 429 failover, visible serving route, encrypted persistence and sticky routing across real CLI/Electron restarts.')
}catch(error){console.log('Routing call trace:',JSON.stringify(generations.map(g=>({owner:g.owner.replace('PRIVATE_',''),url:g.url,model:g.body.model,stream:g.body.stream}))));if(page&&!page.isClosed())await page.screenshot({path:path.join(root,'artifacts/routing-test-failure.png')}).catch(()=>{});throw error}finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});server.close();console.log('Isolated routing fixture: '+data)}
