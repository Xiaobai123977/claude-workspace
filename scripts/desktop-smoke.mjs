import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.CLAUDE_GUI_DATA_DIR
const app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env })
try {
  const page = await app.firstWindow()
  app.process().stderr.on('data', chunk => { const text = chunk.toString(); if (/Error|Exception/.test(text)) console.error(text.trim()) })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const input = page.getByRole('textbox', { name: '消息输入' })
  await input.waitFor()
  assert.equal((await page.evaluate(() => window.workspace.probe())).loggedIn, true)
  await page.screenshot({ path: path.join(root, 'artifacts/desktop-home.png') })
  await page.evaluate(async () => {
    const s = await window.workspace.get()
    const created = await window.workspace.create(s.sessions.find(x => x.id === s.activeId).cwd)
    await window.workspace.update(created.id, { title: '连接验证', effort: 'low', permission: 'default' })
  })
  await input.fill('这是 GUI 连接验证。不要调用工具，只回复：桌面连接成功。')
  await input.press('Enter')
  await page.locator('.message.assistant').last().waitFor()
  await page.waitForFunction(() => document.querySelectorAll('.working').length === 0, null, { timeout: 120000 })
  const state = await page.evaluate(() => window.workspace.get())
  const session = state.sessions.find(s => s.id === state.activeId)
  await page.screenshot({ path: path.join(root, 'artifacts/desktop-connected.png') })
  assert.equal(session.messages.at(-1).status, 'done', session.messages.at(-1).error)
  assert.match(session.messages.at(-1).text, /桌面连接成功/)
  assert.ok(session.nativeId)
  await page.evaluate(async () => { const s = await window.workspace.get(); await window.workspace.create(s.sessions.find(x => x.id === s.activeId).cwd) })
  await input.fill('/')
  await page.getByRole('listbox', { name: '命令菜单' }).waitFor()
  await page.screenshot({ path: path.join(root, 'artifacts/desktop-commands.png') })
  await input.fill('')
  assert.deepEqual(errors, [])
  console.log('Real Electron desktop: authentication, IPC, live CLI chat and persistence passed.')
} finally { await app.close() }
