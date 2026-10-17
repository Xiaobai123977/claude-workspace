// Opt-in verification against the installed CLI. Reads only a temporary fixture.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { JsonLines, TurnAccumulator } = require('../electron/stream.cjs')
const cli = require('../electron/claude.cjs')
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-gui-real-'))
const marker = 'GUI_SMOKE_20261014'
fs.writeFileSync(path.join(cwd, 'proof.md'), marker)
const session = { cwd, model: 'sonnet', effort: 'low', permission: 'default' }
async function turn(prompt, attachments = []) {
  const message = { text: '', tools: [], status: 'running' }
  const accumulator = new TurnAccumulator(message, id => { session.nativeId = id })
  const child = cli.launch(cli.resolveClaude(), [...cli.buildTurn(session, { allowedTools: 'Read,Glob,Grep' }, attachments), '--tools', 'Read,Glob,Grep', '--max-turns', '4'], cwd)
  let stderr = ''
  const parser = new JsonLines(e => accumulator.consume(e))
  child.stdout.on('data', data => parser.push(data)); child.stderr.on('data', data => stderr += data.toString())
  child.stdin.on('error', () => {})
  child.stdin.end(cli.makeInput(prompt, attachments) + '\n')
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cli.terminate(child); reject(new Error('真实 CLI 测试超时')) }, 120000)
    child.on('error', err => { clearTimeout(timer); reject(err) })
    child.on('close', code => { clearTimeout(timer); parser.end(); accumulator.finish(code, stderr); if (message.status !== 'done') reject(new Error(message.error)); else resolve(message) })
  })
}
;(async () => {
  const first = await turn('请用 Read 工具读取工作目录的 proof.md，然后只回复文件中的标记。')
  assert.match(first.text, new RegExp(marker)); assert.ok(first.tools.some(t => t.name === 'Read'))
  console.log('Real CLI: file read, tool results, streaming and session ID passed.')
  const second = await turn('上一轮读取的标记是什么？只回复标记，不要重新读取文件。')
  assert.match(second.text, new RegExp(marker))
  console.log('Real CLI: native session resume passed.')
  const image = process.argv[2]
  let vision = false
  if (image) {
    const third = await turn('这张截图中有聊天输入框吗？只回答“有”或“没有”，不要调用工具。', [{ kind: 'image', path: image, mime: 'image/png' }])
    assert.match(third.text, /有/); vision = true
    console.log('Real CLI: image stream-json input passed.')
  }
  fs.mkdirSync(path.resolve(__dirname, '../artifacts'), { recursive: true })
  fs.writeFileSync(path.resolve(__dirname, '../artifacts/real-smoke.json'), JSON.stringify({ version: (await cli.probe()).version, fileRead: true, resume: true, vision, nativeId: session.nativeId, fixtureDirectory: cwd, timestamp: new Date().toISOString() }, null, 2))
})().catch(err => { console.error(err.message); process.exitCode = 1 })
