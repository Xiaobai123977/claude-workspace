// Opt-in end-to-end real model test through the Electron renderer and IPC.
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '..')
const cli = require('../electron/claude.cjs')
const nativeConfig = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json')
const before = fs.existsSync(nativeConfig) ? fs.readFileSync(nativeConfig) : null
const connectionEnv = before ? JSON.parse(before.toString().replace(/^\uFEFF/, '')).env || {} : {}
const base = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'claude-approvals-real-'))
const dataDir = path.join(base, 'app'), cwd = path.join(base, 'project'), config = path.join(base, 'config')
for (const dir of [dataDir, cwd, config]) fs.mkdirSync(dir)
fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false, plansDirectory: path.join(cwd, 'plans') }))
const id = 'real-approval-session'
const preferences = { cliPath: cli.resolveClaude(), configDir: config, fontSize: '14', model: '', effort: 'low', permission: 'default', allowedTools: '', disallowedTools: '' }
fs.writeFileSync(path.join(dataDir, 'workspace.json'), JSON.stringify({ version: 1, preferences, activeId: id, sessions: [{ id, cwd, title: '真实审批接入验证', createdAt: Date.now(), updatedAt: Date.now(), archived: false, model: '', effort: 'low', permission: 'default', messages: [] }] }))
const env = { ...process.env, ...connectionEnv, CLAUDE_GUI_DATA_DIR: dataDir, CLAUDE_CONFIG_DIR: config, CLAUDE_GUI_TEST_MANAGED_FILE: path.join(base, 'managed.json') }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: require('electron'), args: [root], env })
const passed = [], errors = []
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(120000)
  page.on('pageerror', e => errors.push(e.message))
  const input = page.getByRole('textbox', { name: '消息输入' })
  const card = page.locator('.approval-card')
  const idle = () => page.waitForFunction(() => !document.querySelector('.working'), { timeout: 120000 })
  const send = async text => { await input.fill(text); await input.press('Enter') }
  const latest = () => page.evaluate(id => window.workspace.get().then(s => s.sessions.find(s => s.id === id).messages.at(-1)), id)
  await input.waitFor()
  await send('Protocol verification only. Use Write exactly once with relative file_path "approved.txt" and content "REAL_APPROVAL_OK" in the current directory. No other tools. After success reply WRITE_OK. If permission is denied do not retry.')
  await card.getByRole('button', { name: '允许一次', exact: true }).waitFor()
  assert.equal(fs.existsSync(path.join(cwd, 'approved.txt')), false)
  await page.screenshot({ path: path.join(root, 'artifacts/approval-real-tool.png') })
  await card.getByRole('button', { name: '允许一次', exact: true }).click(); await idle()
  assert.equal((await latest()).status, 'done')
  assert.match(fs.readFileSync(path.join(cwd, 'approved.txt'), 'utf8'), /REAL_APPROVAL_OK/)
  passed.push('approval-before-write'); console.log('PASS real approval-before-write')
  await send('Use Write exactly once to create relative file_path "denied.txt" containing "MUST_NOT_EXIST". No other tools. If denied, quote the denial reason, do not retry or use alternatives.')
  await card.waitFor(); await card.locator('.approval-reject summary').click()
  await card.getByLabel('拒绝原因', { exact: true }).fill('REAL_DENIAL_941: leave the file absent.')
  await card.getByRole('button', { name: '拒绝', exact: true }).click(); await idle()
  assert.equal(fs.existsSync(path.join(cwd, 'denied.txt')), false)
  assert.match((await latest()).text, /REAL_DENIAL_941/)
  passed.push('deny-with-reason'); console.log('PASS real deny-with-reason')
  await send('You must call AskUserQuestion to ask which output style I want, with exactly two options: Compact and Detailed. Wait for my answer. Then only reply CHOICE_<selected option>. No other tools.')
  await card.getByRole('radio', { name: /Detailed/ }).check()
  await page.screenshot({ path: path.join(root, 'artifacts/approval-real-question.png') })
  await card.getByRole('button', { name: '提交回答', exact: true }).click(); await idle()
  assert.match((await latest()).text, /CHOICE_Detailed/)
  passed.push('question-answer'); console.log('PASS real question-answer')
  await send('Use Write exactly once to create relative file_path "cancelled.txt" containing "MUST_NOT_EXIST". No other tools. Wait for permission, do not retry if cancelled.')
  await card.waitFor(); await page.getByRole('button', { name: '停止执行', exact: true }).click(); await idle()
  assert.equal((await latest()).status, 'stopped')
  assert.equal((await latest()).approvals[0].status, 'cancelled')
  assert.equal(fs.existsSync(path.join(cwd, 'cancelled.txt')), false)
  await send('The previous task was cancelled. Do not write anything or use tools. Only reply GUI_CONTINUE_OK.')
  await idle(); assert.match((await latest()).text, /GUI_CONTINUE_OK/)
  passed.push('cancel-and-continue'); console.log('PASS real cancel-and-continue')
  await page.evaluate(id => window.workspace.update(id, { permission: 'plan' }), id)
  await send('Plan approval protocol test. Prepare a minimal plan to create example.txt, then call ExitPlanMode to request host approval. Do not create example.txt. After approval only reply GUI_PLAN_APPROVED and stop, without implementing.')
  await card.getByRole('button', { name: '批准并继续', exact: true }).waitFor()
  await page.screenshot({ path: path.join(root, 'artifacts/approval-real-plan.png') })
  await card.getByRole('button', { name: '批准并继续', exact: true }).click(); await idle()
  assert.match((await latest()).text, /GUI_PLAN_APPROVED/)
  assert.equal(fs.existsSync(path.join(cwd, 'example.txt')), false)
  passed.push('plan-approval'); console.log('PASS real plan-approval')
  assert.deepEqual(errors, [])
  if (before) assert.equal(fs.readFileSync(nativeConfig).equals(before), true)
  const state = await page.evaluate(() => window.workspace.get())
  fs.writeFileSync(path.join(root, 'artifacts/approvals-real-smoke.json'), JSON.stringify({ timestamp: new Date().toISOString(), version: (await cli.probe()).version, passed, model: state.sessions[0].messages.filter(m => m.model).at(-1)?.model, nativeSettingsUnchanged: true, fixtureDirectory: base }, null, 2))
  console.log('Real Electron approvals smoke passed.')
} finally { await app.close(); console.log('Isolated real fixture:', base) }
