const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { SettingsService } = require('../electron/settings.cjs')
const { buildTurn } = require('../electron/claude.cjs')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-gui-settings-'))
  const home = path.join(root, 'home'), cwd = path.join(root, 'project'), userData = path.join(root, 'app')
  for (const d of [home, cwd, userData]) fs.mkdirSync(d, { recursive: true })
  const prefs = { configDir: '' }
  const secureStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from('sealed:' + value), decryptString: value => value.toString().slice(7) }
  const service = new SettingsService({ home, userData, secureStorage, preferences: () => prefs, environment: { CLAUDE_GUI_TEST_MANAGED_FILE: path.join(root, 'managed.json') } })
  const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)) }
  const save = (scope, changes) => service.save(cwd, { scope, revision: service.read(cwd).sources[scope].revision, changes })
  return { root, home, cwd, userData, prefs, service, save, write }
}
test('scope writes preserve unknown keys and nested env, make exact backups, and reject stale saves', () => {
  const f = fixture(), file = f.service.locations(f.cwd).user
  f.write(file, { theme: 'dark', env: { EXISTING_EXTENSION: 'preserve', ANTHROPIC_AUTH_TOKEN: 'do-not-return' }, permissions: { allow: ['Read'], unknownFlag: true } })
  const original = fs.readFileSync(file, 'utf8'), snap = f.service.read(f.cwd)
  assert.ok(!JSON.stringify(snap).includes('do-not-return'))
  assert.equal(snap.sources.user.values['env.ANTHROPIC_AUTH_TOKEN'], true)
  const result = f.service.save(f.cwd, { scope: 'user', revision: snap.sources.user.revision, changes: { language: '中文', 'permissions.deny': ['Bash(git push *)'] } })
  const data = JSON.parse(fs.readFileSync(file))
  assert.equal(data.env.EXISTING_EXTENSION, 'preserve'); assert.equal(data.permissions.unknownFlag, true)
  assert.equal(fs.readFileSync(result.backup,'utf8'), original)
  assert.throws(() => f.service.save(f.cwd, { scope: 'user', revision: snap.sources.user.revision, changes: { language: 'English' } }), /其他程序修改/)
  assert.equal(JSON.parse(fs.readFileSync(file)).language, '中文')
})
test('removing a local override reveals global values, while permission rules merge across files', () => {
  const f = fixture()
  f.save('user', { model: 'opus', 'permissions.allow': ['Read'] })
  f.save('local', { model: 'sonnet', 'permissions.allow': ['Glob'] })
  assert.equal(f.service.read(f.cwd).resolved.model, 'sonnet')
  assert.deepEqual(f.service.read(f.cwd).resolved['permissions.allow'], ['Read', 'Glob'])
  f.save('local', { model: null })
  assert.equal(f.service.read(f.cwd).resolved.model, 'opus')
  assert.match(fs.readFileSync(path.join(f.cwd, '.gitignore'),'utf8'), /\.claude\/settings.local.json/)
})
test('app credentials are encrypted at rest, masked in snapshots, and do not enter the process argument list', () => {
  const f = fixture(), secret = 'private-test-token-123'
  f.save('app', { 'env.ANTHROPIC_AUTH_TOKEN': secret, 'env.ANTHROPIC_BASE_URL': 'https://example.test' })
  assert.ok(!fs.readFileSync(f.service.locations(f.cwd).app, 'utf8').includes(secret))
  assert.ok(!JSON.stringify(f.service.read(f.cwd)).includes(secret))
  const runtime = f.service.prepareRuntime(f.cwd)
  const args = buildTurn({ cwd: f.cwd, permission: '', model: '', effort: '' }, {}, [], runtime)
  assert.ok(!args.join(' ').includes(secret)); assert.ok(args.includes('--settings'))
  assert.equal(JSON.parse(fs.readFileSync(runtime.settingsPath)).env.ANTHROPIC_AUTH_TOKEN, secret)
  assert.ok(!args.includes('--model')); assert.ok(!args.includes('--permission-mode')); assert.ok(!args.includes('--effort'))
  runtime.cleanup(); assert.equal(fs.existsSync(runtime.settingsPath), false)
})
test('corrupt JSON and invalid values cannot overwrite existing files', () => {
  const f = fixture(), file = f.service.locations(f.cwd).user
  fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file, '{corrupt')
  assert.throws(() => f.save('user', { model: 'opus' }), /格式无效/)
  assert.equal(fs.readFileSync(file,'utf8'), '{corrupt')
  assert.throws(() => f.save('app', { cleanupPeriodDays: 0 }), /整数/)
  assert.throws(() => f.save('app', { 'env.ANTHROPIC_BASE_URL': 'https://example.test?api_key=secret' }), /API 地址/)
  assert.throws(() => f.save('app', { 'permissions.allow': ['not a rule'] }), /规则格式无效/)
  assert.throws(() => f.save('app', { '__proto__.polluted': true }), /不支持/)
  assert.equal({}.polluted, undefined)
})
test('managed values are read-only and a custom config directory changes discovery and launch environment', () => {
  const f = fixture()
  f.write(path.join(f.root,'managed.json'), { language: 'English' })
  f.save('user', { language: '中文' })
  assert.equal(f.service.read(f.cwd).resolved.language, 'English')
  assert.throws(() => f.save('managed', { language: '中文' }), /不可编辑/)
  const custom = path.join(f.root,'another-config'); fs.mkdirSync(custom)
  f.prefs.configDir = custom; f.write(path.join(custom,'settings.json'), { model: 'haiku' })
  assert.equal(f.service.read(f.cwd).resolved.model, 'haiku')
  assert.equal(f.service.runtime(f.cwd).env.CLAUDE_CONFIG_DIR, custom)
})
test('instruction editing detects external writes, backs up content and keeps private instructions out of git', () => {
  const f = fixture()
  const initial = f.service.instruction(f.cwd, 'project')
  f.service.saveInstruction(f.cwd, { id: 'project', revision: initial.revision, content: '# 项目约定\n使用测试验证修改。' })
  const old = f.service.instruction(f.cwd, 'project')
  fs.appendFileSync(old.path, '\n外部编辑')
  assert.throws(() => f.service.saveInstruction(f.cwd, { id: 'project', revision: old.revision, content: 'overwrite' }), /外部修改/)
  const local = f.service.instruction(f.cwd,'local')
  f.service.saveInstruction(f.cwd, { id:'local', revision:local.revision, content:'个人约定' })
  assert.match(fs.readFileSync(path.join(f.cwd,'.gitignore'),'utf8'), /CLAUDE.local.md/)
  assert.throws(() => f.service.createRule(f.cwd,{scope:'project',name:'../outside.md'}), /文件名/)
  const ruleId = f.service.createRule(f.cwd,{scope:'project',name:'coding-style'})
  assert.equal(f.service.instruction(f.cwd,ruleId).title,'coding-style.md')
})
test('startup cleanup only removes owned temporary settings records and is idempotent', () => {
  const f = fixture()
  f.save('app', { language: '中文' })
  const runtime = f.service.prepareRuntime(f.cwd)
  const unrelated = path.join(path.dirname(runtime.settingsPath), 'keep-notes.json')
  fs.writeFileSync(unrelated, '{"keep":true}')
  f.service.cleanupStaleRuntime()
  assert.equal(fs.existsSync(runtime.settingsPath), false)
  assert.equal(fs.existsSync(unrelated), true)
  assert.equal(fs.existsSync(f.service.locations(f.cwd).app), true)
  runtime.cleanup()
})


test('subscription launch isolates gateway credentials and model aliases without changing native configuration',()=>{
  const f=fixture();f.write(f.service.locations(f.cwd).user,{env:{ANTHROPIC_MODEL:'deepseek-v4.1-flash',ANTHROPIC_DEFAULT_OPUS_MODEL:'deepseek-v4.1-flash',ANTHROPIC_DEFAULT_OPUS_MODEL_NAME:'DeepSeek',ANTHROPIC_BASE_URL:'https://gateway.invalid',ANTHROPIC_AUTH_TOKEN:'test-secret'},permissions:{deny:['Bash(rm *)']}})
  f.save('app',{language:'中文',model:'deepseek-v4.1-flash'})
  f.service.environment.ANTHROPIC_API_KEY='shell-key';f.service.environment.CLAUDE_CODE_USE_BEDROCK='1';f.service.environment.CLAUDE_CODE_OAUTH_TOKEN='subscription-token'
  const file=f.service.locations(f.cwd).user,before=fs.readFileSync(file,'utf8'),runtime=f.service.prepareRuntime(f.cwd,{subscription:true})
  try{
    const settings=JSON.parse(fs.readFileSync(runtime.settingsPath,'utf8'))
    assert.equal(settings.model,'default');assert.equal(settings.language,'中文');assert.equal(settings.apiKeyHelper,'')
    assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN,'');assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME,'');assert.equal(settings.env.ANTHROPIC_BASE_URL,'https://api.anthropic.com')
    assert.equal(runtime.env.ANTHROPIC_API_KEY,null);assert.equal(runtime.env.CLAUDE_CODE_USE_BEDROCK,null);assert.equal(runtime.env.CLAUDE_CODE_OAUTH_TOKEN,undefined)
    assert.ok(!JSON.stringify(settings).includes('test-secret'));assert.equal(fs.readFileSync(file,'utf8'),before)
    const args=buildTurn({cwd:f.cwd},{},[],runtime);assert.ok(!args.includes('--setting-sources'))
    const {environment}=require('../electron/claude.cjs');assert.equal(environment({ANTHROPIC_API_KEY:null}).ANTHROPIC_API_KEY,undefined)
  }finally{runtime.cleanup()}
})

test('subscription mode refuses managed routing and rejects externally mapped CLI model lists',()=>{
  const f=fixture();f.write(f.service.locations(f.cwd).managed,{env:{ANTHROPIC_MODEL:'deepseek'}})
  assert.throws(()=>f.service.prepareRuntime(f.cwd,{subscription:true}),/组织策略/)
  const {assertSubscriptionModels}=require('../electron/subscription.cjs')
  assert.throws(()=>assertSubscriptionModels({models:[{value:'opus',displayName:'deepseek-v4.1-flash'}]}),/外部路由/)
  assert.throws(()=>assertSubscriptionModels({models:[{value:'opus',resolvedModel:'deepseek-v4.1-flash'}]}),/外部路由/)
  assert.deepEqual(assertSubscriptionModels({models:[{value:'default',displayName:'Default'},{value:'default'}]}).models,[{value:'default',displayName:'Default'}])
})
