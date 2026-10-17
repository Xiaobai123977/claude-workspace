// Opt-in real CLI experiments. No app state or native settings are changed.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const cli = require('../electron/claude.cjs')
const { JsonLines } = require('../electron/stream.cjs')
const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'claude-gui-interactive-'))
const configHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const configPath = path.join(configHome, 'settings.json')
const configBefore = fs.existsSync(configPath) ? fs.readFileSync(configPath) : null
const connectionEnv = configBefore ? JSON.parse(configBefore.toString().replace(/^\uFEFF/, '')).env || {} : {}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const reports = []

class Host {
  constructor(name, tools, mode = 'manual') {
    this.name = name; this.events = []; this.stderr = ''; this.closed = false
    this.cwd = path.join(root, name); fs.mkdirSync(this.cwd)
    const settings = path.join(this.cwd, 'test-settings.json')
    fs.writeFileSync(settings, JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false,
      plansDirectory: path.join(this.cwd, 'plans'),
      permissions: { ask: ['AskUserQuestion', 'ExitPlanMode'] } }))
    this.args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--replay-user-messages', '--permission-prompt-tool', 'stdio',
      '--permission-mode', mode, '--setting-sources', '', '--settings', settings,
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', tools,
      '--effort', 'low', '--no-session-persistence']
    this.child = cli.launch(cli.resolveClaude(), this.args, this.cwd, connectionEnv)
    this.parser = new JsonLines(event => {
      this.events.push({ at: Date.now(), event })
      if (event.type === 'control_request') console.log(name, 'request:', event.request?.subtype, event.request?.tool_name || '')
      if (event.type === 'result') console.log(name, 'result:', event.subtype, String(event.result || '').slice(0, 160))
    })
    this.child.stdout.on('data', b => this.parser.push(b))
    this.child.stderr.on('data', b => { this.stderr += b.toString() })
    this.child.stdin.on('error', () => {})
    this.child.on('error', e => { this.stderr += e.message })
    this.child.on('close', code => { this.parser.end(); this.closed = true; this.code = code })
    this.timeout = setTimeout(() => cli.terminate(this.child), 150000)
  }
  write(event) { this.child.stdin.write(JSON.stringify(event) + '\n') }
  user(text) { this.write({ type: 'user', uuid: crypto.randomUUID(), message: { role: 'user', content: text }, parent_tool_use_id: null }) }
  async wait(predicate, after = 0, ms = 90000) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const match = this.events.slice(after).find(x => predicate(x.event))
      if (match) return match.event
      if (this.closed) throw new Error(`CLI exited ${this.code}: ${this.stderr.slice(0, 500)}`)
      await delay(30)
    }
    throw new Error(`Timed out waiting in ${this.name}; types=${this.events.map(x => x.event.type + ':' + (x.event.subtype || '')).slice(-12).join(',')}`)
  }
  async rpc(request) {
    const id = crypto.randomUUID()
    this.write({ type: 'control_request', request_id: id, request })
    const reply = await this.wait(e => e.type === 'control_response' && e.response?.request_id === id, 0, 20000)
    assert.equal(reply.response.subtype, 'success', JSON.stringify(reply.response))
    return reply.response.response
  }
  async init() {
    const info = await this.rpc({ subtype: 'initialize', hooks: {} })
    this.initInfo = { keys: Object.keys(info || {}), commands: info?.commands?.map(c => c.name), models: info?.models?.map(m => m.value) }
  }
  respond(request, response) {
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response } })
  }
  request(tool) { return this.wait(e => e.type === 'control_request' && e.request?.subtype === 'can_use_tool' && (!tool || e.request.tool_name === tool)) }
  result(after = 0) { return this.wait(e => e.type === 'result', after) }
  async close() {
    this.child.stdin.end()
    for (let i = 0; i < 100 && !this.closed; i++) await delay(50)
    if (!this.closed) cli.terminate(this.child)
    clearTimeout(this.timeout)
    // Evidence deliberately excludes system init payload, environment and thinking.
    const evidence = this.events.map(({ at, event: e }) => ({ at, type: e.type, subtype: e.subtype,
      request: e.type === 'control_request' ? e.request : undefined,
      request_id: e.request_id, response: e.type === 'control_response'
        ? { subtype: e.response?.subtype, request_id: e.response?.request_id, responseKeys: Object.keys(e.response?.response || {}), error: e.response?.error } : undefined,
      result: e.type === 'result' ? e.result : undefined, is_error: e.is_error,
      errors: e.type === 'result' ? e.errors : undefined,
      model: e.type === 'assistant' ? e.message?.model : undefined,
      content: ['assistant', 'user'].includes(e.type) && Array.isArray(e.message?.content)
        ? e.message.content.filter(c => ['text', 'tool_use', 'tool_result'].includes(c.type)) : undefined }))
    fs.writeFileSync(path.join(root, this.name + '.json'), JSON.stringify({ init: this.initInfo, events: evidence }, null, 2))
    const evidenceDir = path.resolve(__dirname, '../artifacts/interactive-protocol')
    fs.mkdirSync(evidenceDir, { recursive: true })
    this.evidencePath = path.join(evidenceDir, this.name + '.json')
    fs.writeFileSync(this.evidencePath, JSON.stringify({ init: this.initInfo, events: evidence }, null, 2))
  }
}

async function experiment(name, tools, run, mode) {
  const host = new Host(name, tools, mode)
  try { await host.init(); const detail = await run(host); reports.push({ name, passed: true, detail }); console.log('PASS', name, JSON.stringify(detail)) }
  catch (e) { reports.push({ name, passed: false, error: e.message }); console.log('FAIL', name, e.message) }
  finally {
    await host.close(); reports.at(-1).evidence = host.evidencePath
    reports.at(-1).model = host.events.find(x => x.event.type === 'assistant')?.event.message?.model
  }
}

;(async () => {
  console.log('CLI', (await cli.probe()).version, 'fixtures', root)
  const selected = new Set(process.argv.slice(2))
  const run = async (name, tools, fn, mode) => { if (!selected.size || selected.has(name)) await experiment(name, tools, fn, mode) }
  await run('allow-write', 'Write', async h => {
    const target = path.join(h.cwd, 'allowed.txt')
    h.user(`Use Write to create ${JSON.stringify(target)} containing APPROVAL_ALLOWED. Do not use other tools. After it succeeds reply WRITE_OK.`)
    const req = await h.request('Write')
    await delay(600); assert.equal(fs.existsSync(target), false, 'File was written before approval')
    h.respond(req, { behavior: 'allow', updatedInput: req.request.input })
    const result = await h.result(); assert.equal(result.is_error, false)
    assert.match(fs.readFileSync(target, 'utf8'), /APPROVAL_ALLOWED/)
    return { waitedForApproval: true, writeAfterAllow: true }
  })
  await run('deny-write', 'Write', async h => {
    const target = path.join(h.cwd, 'denied.txt')
    h.user(`Use Write once to create ${JSON.stringify(target)} containing MUST_NOT_EXIST. If denied, do not retry; quote the denial reason and stop.`)
    const req = await h.request('Write')
    h.respond(req, { behavior: 'deny', message: 'GUI_USER_DENIED_731: do not write this file.' })
    const result = await h.result(); assert.equal(result.is_error, false)
    assert.equal(fs.existsSync(target), false)
    assert.match(JSON.stringify(h.events), /GUI_USER_DENIED_731/)
    return { fileAbsent: true, denialDelivered: true, response: result.result }
  })
  await run('ask-user', 'AskUserQuestion', async h => {
    h.user('Protocol test: you MUST call AskUserQuestion before answering. Ask which output style I want, with options Compact and Detailed. Do not answer your own question. After receiving my choice, reply exactly CHOICE_<selected label>.')
    const req = await h.request('AskUserQuestion')
    const questions = req.request.input.questions; assert.ok(questions?.length)
    const answers = Object.fromEntries(questions.map(q => [q.question, 'Detailed']))
    h.respond(req, { behavior: 'allow', updatedInput: { ...req.request.input, answers } })
    const result = await h.result(); assert.equal(result.is_error, false); assert.match(result.result, /CHOICE_Detailed/)
    return { questionReceived: true, answerApplied: true, response: result.result }
  })
  await run('plan-confirm', 'ExitPlanMode,Write,Read', async h => {
    h.user('This is a plan-approval protocol test. Prepare a minimal plan to create example.txt in this temporary project, then call ExitPlanMode to request host approval. Do not create example.txt. After approval only reply PLAN_APPROVED and stop; do not implement the plan.')
    let cursor = 0
    for (;;) {
      const req = await h.wait(e => e.type === 'control_request' && e.request?.subtype === 'can_use_tool', cursor)
      cursor = h.events.length
      if (req.request.tool_name === 'ExitPlanMode') {
        h.respond(req, { behavior: 'allow', updatedInput: req.request.input })
        const result = await h.result(); assert.equal(result.is_error, false); assert.match(result.result, /PLAN_APPROVED/)
        assert.equal(fs.existsSync(path.join(h.cwd, 'example.txt')), false)
        return { planApprovalReceived: true, response: result.result }
      }
      // Only permit Claude's temporary plan file, never project source changes.
      const input = req.request.input
      if (req.request.tool_name === 'Write' && /[\\/]plans[\\/]/.test(input.file_path || '')) {
        h.respond(req, { behavior: 'allow', updatedInput: { ...input, file_path: path.join(h.cwd, 'test-plan.md') } })
      } else h.respond(req, { behavior: 'deny', message: 'Only ExitPlanMode is approved for this test.' })
    }
  }, 'plan')
  await run('interrupt-continue', '', async h => {
    h.user('Write a numbered list of 500 detailed tips about organizing a bookshelf. Each item must have at least 25 words. Begin immediately, do not use tools.')
    await h.wait(e => e.type === 'stream_event' && e.event?.delta?.type === 'text_delta')
    const before = h.events.length
    const started = Date.now(); await h.rpc({ subtype: 'interrupt' })
    const result = await h.result(before); const elapsedMs = Date.now() - started
    assert.equal(h.closed, false)
    const next = h.events.length
    h.user('The prior output was intentionally interrupted. Ignore that task. Reply exactly AFTER_INTERRUPT_OK. No tools.')
    const continued = await h.result(next); assert.equal(continued.is_error, false); assert.match(continued.result, /AFTER_INTERRUPT_OK/)
    return { interruptAcknowledged: true, resultSubtype: result.subtype, elapsedMs, sameProcessContinued: true }
  })
  await run('midturn-message', 'Write', async h => {
    const target = path.join(h.cwd, 'queued.txt')
    h.user(`First use Write to create ${JSON.stringify(target)} containing QUEUE_FILE. After the write succeeds reply FIRST_DONE.`)
    const req = await h.request('Write')
    const before = h.events.length
    h.user('Additional user message sent while the previous task is waiting for approval: after that write completes, reply SECOND_SEEN_842. Do not call any further tools.')
    await delay(500); assert.equal(fs.existsSync(target), false)
    h.respond(req, { behavior: 'allow', updatedInput: req.request.input })
    await h.wait(e => e.type === 'result' && /SECOND_SEEN_842/.test(e.result || ''), before)
    assert.equal(fs.existsSync(target), true)
    const results = h.events.slice(before).filter(x => x.event.type === 'result').map(x => x.event.result)
    return { messageSentBeforeApproval: true, followupApplied: true, resultCount: results.length, results }
  })
  await run('permission-lifetime', 'Write', async h => {
    const write = label => h.user(`Use Write exactly once with the relative file_path ${JSON.stringify(label + '.txt')} in the current directory, containing ${label}. After success reply ${label}_DONE.`)
    write('ONCE')
    const first = await h.request('Write')
    h.respond(first, { behavior: 'allow', updatedInput: first.request.input })
    await h.result()
    let cursor = h.events.length
    write('SESSION')
    const second = await h.wait(e => e.type === 'control_request' && e.request?.tool_name === 'Write', cursor)
    h.respond(second, { behavior: 'allow', updatedInput: second.request.input,
      updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'session' }] })
    await h.result(cursor)
    cursor = h.events.length
    write('REMEMBERED')
    const third = await h.wait(e => e.type === 'result' || (e.type === 'control_request' && e.request?.tool_name === 'Write'), cursor)
    assert.equal(third.type, 'result', 'Session rule did not prevent a subsequent permission request')
    assert.equal(third.is_error, false)
    assert.equal(fs.readFileSync(path.join(h.cwd, 'REMEMBERED.txt'), 'utf8').trim(), 'REMEMBERED')
    return { approveOnceStillPromptsNextTurn: true, sessionAllowSkipsThirdPrompt: true }
  })
  await run('cancel-pending-approval', 'Write', async h => {
    const target = path.join(h.cwd, 'cancelled.txt')
    h.user(`Use Write to create ${JSON.stringify(target)} containing MUST_NOT_EXIST, then stop.`)
    const req = await h.request('Write')
    const cursor = h.events.length
    await h.rpc({ subtype: 'interrupt' })
    await h.result(cursor)
    assert.equal(fs.existsSync(target), false)
    const cancelled = h.events.some(x => x.event.type === 'control_cancel_request' && x.event.request_id === req.request_id)
    const next = h.events.length
    h.user('The previous write is cancelled. Do not write anything. Only reply CANCEL_CONTINUE_OK.')
    const result = await h.result(next); assert.match(result.result, /CANCEL_CONTINUE_OK/)
    assert.equal(fs.existsSync(target), false)
    return { fileAbsent: true, cancelNotificationReceived: cancelled, sameProcessContinued: true }
  })
  await run('interrupt-running-tool', 'Bash', async h => {
    const command = 'node -e "require(\'fs\').writeFileSync(\'started.txt\',\'started\');setTimeout(()=>require(\'fs\').writeFileSync(\'late.txt\',\'should-not-run\'),15000)"'
    h.user(`Run exactly this Bash command once in the current working directory, do not run it in background: ${command}. Do not use other commands. After it finishes reply TOOL_FINISHED.`)
    const req = await h.request('Bash')
    assert.equal(req.request.input.command, command)
    h.respond(req, { behavior: 'allow', updatedInput: { ...req.request.input, timeout: 30000, run_in_background: false } })
    const limit = Date.now() + 20000
    while (!fs.existsSync(path.join(h.cwd, 'started.txt')) && Date.now() < limit) await delay(30)
    assert.equal(fs.existsSync(path.join(h.cwd, 'started.txt')), true, 'Command did not actually start')
    const cursor = h.events.length
    await h.rpc({ subtype: 'interrupt' }); await h.result(cursor)
    // Wait beyond the command's timer to detect an orphan child that keeps writing.
    await delay(16000)
    assert.equal(fs.existsSync(path.join(h.cwd, 'late.txt')), false, 'Tool child kept running after interrupt')
    const next = h.events.length
    h.user('The command was intentionally interrupted. Do not run any more commands. Reply TOOL_INTERRUPT_OK.')
    const result = await h.result(next); assert.match(result.result, /TOOL_INTERRUPT_OK/)
    return { toolActuallyStarted: true, delayedSideEffectPrevented: true, observationMs: 16000, sameProcessContinued: true }
  })
  if (configBefore) assert.equal(fs.readFileSync(configPath).equals(configBefore), true, 'Native settings changed')
  fs.mkdirSync(path.resolve(__dirname, '../artifacts'), { recursive: true })
  const reportPath = path.resolve(__dirname, '../artifacts/interactive-protocol-smoke.json')
  const previous = selected.size && fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath)).reports : []
  const report = { timestamp: new Date().toISOString(), cliVersion: (await cli.probe()).version, fixtureDirectory: root, nativeSettingsUnchanged: true,
    reports: [...previous.filter(r => !reports.some(n => n.name === r.name)), ...reports] }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log('REPORT', reportPath)
  if (reports.some(r => !r.passed)) process.exitCode = 1
})().catch(e => { console.error(e.message); process.exitCode = 1 })
