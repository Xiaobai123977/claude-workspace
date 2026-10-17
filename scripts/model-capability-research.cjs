// Read-only research: CLI initialize and one Models GET. No generation requests.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const cli = require('../electron/claude.cjs')
const { InteractiveSession } = require('../electron/interactive.cjs')
const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'claude-model-research-'))
const configFile = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json')
const before = fs.existsSync(configFile) ? fs.readFileSync(configFile) : null
const saved = before ? JSON.parse(before.toString().replace(/^\uFEFF/, '')) : {}
const env = { ...saved.env }
const modelKeys = model => ({ id: model.id, keys: Object.keys(model), capabilities: model.capabilities,
  effort: model.effort, context_window: model.context_window, max_input_tokens: model.max_input_tokens,
  max_output_tokens: model.max_output_tokens, input_modalities: model.input_modalities,
  supported_endpoint_types: model.supported_endpoint_types })
;(async () => {
  const settings = path.join(root, 'settings.json')
  fs.writeFileSync(settings, JSON.stringify({ disableAllHooks: true, autoMemoryEnabled: false }))
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--permission-prompt-tool', 'stdio', '--tools', '', '--setting-sources', '', '--settings', settings,
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']
  const child = cli.launch(cli.resolveClaude(), args, root, env)
  const connection = new InteractiveSession(child, { terminate: cli.terminate })
  const report = { timestamp: new Date().toISOString(), cliVersion: (await cli.probe()).version }
  try {
    const info = await connection.initialize()
    report.cli = { models: info.models, capabilities: info.capabilities }
  } finally { connection.close() }
  const base = env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL
  const token = env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN
  const key = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  if (base && (token || key)) {
    const endpoint = new URL(base.replace(/\/+$/, '') + (/\/v\d+$/.test(base.replace(/\/+$/, '')) ? '/models' : '/v1/models'))
    const headers = { 'anthropic-version': '2023-06-01', ...(token ? { Authorization: `Bearer ${token}` } : { 'x-api-key': key }) }
    try {
      const response = await fetch(endpoint, { headers, redirect: 'manual', signal: AbortSignal.timeout(12000) })
      report.http = { status: response.status }
      if (response.ok) {
        const data = await response.json()
        report.http.keys = Object.keys(data)
        report.http.models = Array.isArray(data.data) ? data.data.slice(0, 20).map(modelKeys) : []
        report.http.total = Array.isArray(data.data) ? data.data.length : null
      }
    } catch { report.http = { error: 'Request failed or timed out; response/credentials omitted.' } }
  } else report.http = { skipped: 'No explicitly configured gateway and API credential; subscription credentials were not extracted.' }
  if (before) report.nativeSettingsUnchanged = fs.readFileSync(configFile).equals(before)
  fs.writeFileSync(path.resolve(__dirname, '../artifacts/model-capability-research.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
})().catch(e => { console.error(e.message); process.exitCode = 1 })
