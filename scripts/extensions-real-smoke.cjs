// No model calls. Native CLI operations are confined to an isolated config profile.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict')
const { SettingsService } = require('../electron/settings.cjs')
const { ExtensionsService } = require('../electron/extensions.cjs')
const base = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'claude-extensions-real-'))
const cwd = path.join(base, 'project'), configDir = path.join(base, 'config'), userData = path.join(base, 'app'), market = path.join(base, 'market')
for (const dir of [cwd, configDir, userData, path.join(market, '.claude-plugin'), path.join(market, 'plugins/demo/.claude-plugin'), path.join(market, 'plugins/demo/skills/demo-skill')]) fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'gui-test-market', owner: { name: 'GUI test' }, plugins: [{ name: 'gui-demo', source: './plugins/demo' }] }))
fs.writeFileSync(path.join(market, 'plugins/demo/.claude-plugin/plugin.json'), JSON.stringify({ name: 'gui-demo', version: '1.0.0', description: 'Isolated integration fixture' }))
fs.writeFileSync(path.join(market, 'plugins/demo/skills/demo-skill/SKILL.md'), '---\nname: demo-skill\ndescription: Fixture skill\n---\nReply FIXTURE_OK.\n')
const watched = [path.join(os.homedir(), '.claude.json'), path.join(os.homedir(), '.claude/settings.json'), path.join(os.homedir(), '.claude/plugins/installed_plugins.json')]
const before = watched.map(file => fs.existsSync(file) ? fs.readFileSync(file) : null)
const preferences = () => ({ configDir, cliPath: '' })
const configuration = new SettingsService({ userData, preferences, secureStorage: { isEncryptionAvailable: () => false } })
const service = new ExtensionsService({ userData, configuration, preferences })
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
  let raw = ''; for await (const chunk of req) raw += chunk
  const message = JSON.parse(raw)
  if (!('id' in message)) { res.writeHead(202); res.end(); return }
  const result = message.method === 'initialize' ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'GUI health fixture', version: '1.0.0' } } : message.method === 'tools/list' ? { tools: [] } : {}
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
})
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await service.call(cwd, ['plugin', 'marketplace', 'add', market, '--scope', 'user'])
    await service.call(cwd, ['plugin', 'install', 'gui-demo@gui-test-market', '--scope', 'local', '--json'])
    const plugin = service.plugins(cwd)[0]
    assert.equal(plugin.id, 'gui-demo@gui-test-market'); assert.equal(plugin.scope, 'local'); assert.equal(plugin.enabled, true)
    assert.ok(service.skills(cwd).some(s => s.name === 'gui-demo:demo-skill'))
    await service.pluginAction(cwd, { id: plugin.id, scope: 'local', action: 'disable' })
    assert.equal(service.plugins(cwd)[0].enabled, false)
    assert.equal(service.skills(cwd).some(s => s.plugin), false)
    await service.pluginAction(cwd, { id: plugin.id, scope: 'local', action: 'enable' })
    assert.equal(service.plugins(cwd)[0].enabled, true)
    const address = `http://127.0.0.1:${server.address().port}/mcp`
    await service.addMcp(cwd, { name: 'gui-test-mcp', scope: 'local', config: { type: 'http', url: address } })
    assert.ok(service.mcp(cwd).some(m => m.name === 'gui-test-mcp' && m.scope === 'local'))
    const health = await service.mcpAction(cwd, { name: 'gui-test-mcp', scope: 'local', action: 'test' })
    assert.match(health, /Connected/i)
    await service.mcpAction(cwd, { name: 'gui-test-mcp', scope: 'local', action: 'remove' })
    assert.equal(service.mcp(cwd).length, 0)
    await service.pluginAction(cwd, { id: plugin.id, scope: 'local', action: 'uninstall' })
    assert.equal(service.plugins(cwd).length, 0)
    const catalogs = []
    for (const id of ['official', 'anthropic-skills', 'superpowers', 'mcp-registry']) {
      const catalog = await service.catalog(id); assert.ok(catalog.items.length)
      catalogs.push({ id, count: catalog.items.length }); console.log('Public catalog', id, catalog.items.length)
    }
    // Test the standalone installer against a public skill and its supporting files.
    const skills = await service.catalog('anthropic-skills'), item = skills.items.find(i => i.kind === 'skill' && i.name === 'frontend-design')
    assert.ok(item)
    const preview = await service.preview(item.id)
    await service.install(cwd, { itemId: item.id, revision: preview.revision, scope: 'project' })
    assert.ok(fs.existsSync(path.join(cwd, '.claude/skills/frontend-design/SKILL.md')))
    const installed = service.skills(cwd).find(s => s.name === 'frontend-design')
    service.skillVisibility(cwd, { id: installed.id, visibility: 'user-invocable-only' })
    assert.equal(service.skills(cwd).find(s => s.id === installed.id).visibility, 'user-invocable-only')
    for (let i = 0; i < watched.length; i++) assert.equal(fs.existsSync(watched[i]) ? fs.readFileSync(watched[i]).equals(before[i] || Buffer.alloc(0)) : before[i] === null, true, watched[i] + ' changed')
    fs.writeFileSync(path.resolve(__dirname, '../artifacts/extensions-real-smoke.json'), JSON.stringify({ timestamp: new Date().toISOString(), fixtureDirectory: base, catalogs, nativePluginLifecycle: true, pluginSkillDiscovered: true, nativeMcpLifecycle: true, actualMcpHealth: health, standalonePublicSkillInstalled: true, skillVisibility: true, nativeConfigUnchanged: true }, null, 2))
    console.log('Extensions real smoke passed: native plugin install/enable/disable/uninstall, MCP add/health/remove, public catalogs, public standalone skill install, visibility, native config unchanged.')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})().catch(e => { console.error(e.stack); process.exitCode = 1 })
