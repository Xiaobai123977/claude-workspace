import {_electron as electron} from 'playwright'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'claude-navigation-audit-')),cwd=path.join(data,'project'),profile=path.join(data,'profile'),id='audit'
fs.mkdirSync(cwd);fs.mkdirSync(profile);fs.mkdirSync(path.join(root,'artifacts'),{recursive:true})
fs.writeFileSync(path.join(data,'workspace.json'),JSON.stringify({version:1,activeId:id,preferences:{cliPath:path.join(root,'tests/fake-claude.cjs'),configDir:profile},sessions:[{id,cwd,title:'Navigation audit',messages:[],model:'',effort:'',permission:'default',createdAt:Date.now(),updatedAt:Date.now()}]}))
const env={...process.env,CLAUDE_GUI_DATA_DIR:data,CLAUDE_CONFIG_DIR:profile};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:require('electron'),args:[root],env}),page=await app.firstWindow(),errors=[]
page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message))
const button=name=>page.getByRole('button',{name,exact:true}),nav=name=>page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name,exact:true}),ext=name=>page.getByRole('navigation',{name:'扩展分类'}).getByRole('button',{name,exact:true})
let allow=false;page.on('dialog',d=>void (allow?d.accept():d.dismiss()).catch(()=>{}))
try{
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  assert.equal(await button('文件').count(),0)
  await button('添加附件或命令').click();assert.equal(await button('选择工作目录').count(),0);await page.keyboard.press('Escape')
  await button('设置').last().click()
  assert.deepEqual(await page.getByRole('navigation',{name:'设置分类'}).getByRole('button').allTextContents(),['常规','连接与模型','权限与目录','回复偏好','项目说明与规则','记忆','上下文与历史','配置来源'])
  await nav('记忆').click();await page.getByLabel('自动记忆',{exact:true}).waitFor();await page.getByRole('heading',{name:'记忆文件'}).waitFor()
  await nav('上下文与历史').click();assert.equal(await page.getByLabel('自动记忆',{exact:true}).count(),0);assert.ok((await page.locator('.settings-main').innerText()).includes('共用原生会话'))
  await nav('回复偏好').click();assert.equal(await page.getByLabel('提交署名',{exact:true}).count(),1)
  await button('扩展').click();await ext('Agents').click()
  await page.getByLabel('配置文件名称').fill('audit-agent.md');await button('创建草稿').click();await page.getByLabel('配置文档内容').fill('---\nname: audit\ndescription: audit\n---\nDraft preserved')
  await ext('Hooks').click();assert.equal(await page.getByLabel('配置文档内容').inputValue(),'---\nname: audit\ndescription: audit\n---\nDraft preserved')
  await button('设置').last().click();assert.equal(await page.getByLabel('配置文档内容').count(),1)
  await button('刷新扩展').click();assert.equal(await page.getByLabel('配置文档内容').count(),1)
  await page.keyboard.press('Escape');assert.equal(await page.getByLabel('配置文档内容').count(),1)
  allow=true;await ext('Hooks').click();await page.getByRole('heading',{name:'Hooks',exact:true}).waitFor();await ext('工作流').click();await page.getByRole('heading',{name:'工作流',exact:true}).waitFor()
  await page.screenshot({path:path.join(root,'artifacts/navigation-extensions.png')})
  await button('返回聊天').click()
  await button('聊天运行设置').click();assert.equal(await page.getByLabel('Ultracode 自动工作流').isVisible(),false)
  await page.getByText('高级运行选项',{exact:true}).click();assert.equal(await page.getByLabel('Ultracode 自动工作流').isVisible(),true)
  await page.getByLabel('最大 Agent 轮数').fill('8');await button('保存运行设置').click();await page.getByRole('status').filter({hasText:'运行设置已保存'}).waitFor();await button('关闭聊天工具').click()
  await page.locator('[data-project-path]').first().click({button:'right'})
  await page.getByRole('menuitem',{name:'隔离工作区',exact:true}).click();await page.getByLabel('隔离工作区名称').waitFor()
  assert.equal(await page.getByRole('textbox',{name:'消息输入'}).count(),1);await button('关闭聊天工具').click()
  await page.getByTitle('代码变更',{exact:true}).click();assert.equal(await page.getByLabel('隔离工作区名称').count(),0);await button('关闭聊天工具').click()
  await page.getByRole('textbox',{name:'消息输入'}).fill('/mcp');await page.getByRole('option').filter({hasText:'管理与检测 MCP 服务器'}).click()
  await page.getByRole('heading',{name:'MCP 服务器',exact:true}).waitFor();assert.equal((await page.evaluate(()=>window.workspace.get())).sessions[0].messages.length,0)
  assert.deepEqual(errors,[]);console.log('Navigation audit passed: categories, shared memory settings, draft guards across extension navigation/refresh/close, runtime grouping, project workspace ownership and MCP shortcut without model request.')
}catch(e){await page.screenshot({path:path.join(root,'artifacts/navigation-failure.png')}).catch(()=>{});throw e}finally{allow=true;await app.close()}
