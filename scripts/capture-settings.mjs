import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..')
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.CLAUDE_GUI_DATA_DIR
const app=await electron.launch({executablePath:require('electron'),args:[root],cwd:root,env})
try{
  const page=await app.firstWindow()
  await page.getByRole('textbox',{name:'消息输入'}).waitFor()
  const state=await page.evaluate(()=>window.workspace.get())
  const config=await page.evaluate(id=>window.workspace.config(id),state.activeId)
  const file=config.sources.user.path
  const digest=()=>fs.existsSync(file)?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):'absent'
  const before=digest()
  await page.getByRole('button',{name:'设置',exact:true}).first().click()
  await page.locator('.settings-layout').waitFor()
  await page.getByText('Claude Code',{exact:true}).waitFor()
  const installation=await page.evaluate(()=>window.workspace.probe())
  await page.getByText(installation.version,{exact:true}).waitFor()
  await page.screenshot({path:path.join(root,'artifacts/settings-desktop-general.png')})
  for(const [title,name] of [['连接与模型','connection'],['权限与目录','permissions'],['回复偏好','responses'],['项目说明与规则','instructions'],['上下文与数据','advanced'],['配置来源','sources']]){
    await page.getByRole('button',{name:title,exact:true}).click()
    await page.screenshot({path:path.join(root,`artifacts/settings-desktop-${name}.png`)})
  }
  // Check the narrow desktop layout for accidental document overflow.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,760))
  await page.getByRole('button',{name:'连接与模型',exact:true}).click()
  await page.screenshot({path:path.join(root,'artifacts/settings-desktop-narrow.png')})
  const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:window.innerWidth}))
  if(overflow.width>overflow.viewport)throw new Error('Settings layout overflows the viewport')
  if(before!==digest())throw new Error('Opening settings changed native settings unexpectedly')
  console.log('Real settings page captured: all sections render; native settings unchanged; 960px layout fits.')
}finally{await app.close()}
