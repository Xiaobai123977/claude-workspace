const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { subscriptionOverlay } = require('./subscription.cjs')

const SCOPES = ['app', 'user', 'project', 'local']
const LABELS = { app: '仅本应用', user: '全局个人', project: '项目共享', local: '项目个人', managed: '组织管理', environment: '启动环境' }
const FIELDS = {
  model: 'string', effortLevel: 'effort', language: 'string', outputStyle: 'string', fastMode: 'boolean', ultracode: 'boolean', disableAllHooks: 'boolean',
  autoCompactWindow: 'window', cleanupPeriodDays: 'days', autoMemoryEnabled: 'boolean',
  'permissions.defaultMode': 'mode', 'permissions.allow': 'rules', 'permissions.ask': 'rules', 'permissions.deny': 'rules', 'permissions.additionalDirectories': 'directories',
  'env.ANTHROPIC_BASE_URL': 'url', 'env.ANTHROPIC_MODEL': 'string', 'env.ANTHROPIC_DEFAULT_OPUS_MODEL': 'string', 'env.ANTHROPIC_DEFAULT_SONNET_MODEL': 'string', 'env.ANTHROPIC_DEFAULT_HAIKU_MODEL': 'string', 'env.CLAUDE_CODE_SUBAGENT_MODEL': 'string',
  'env.ANTHROPIC_API_KEY': 'secret', 'env.ANTHROPIC_AUTH_TOKEN': 'secret', 'env.API_TIMEOUT_MS': 'timeout',
  'attribution.commit': 'string', 'attribution.pr': 'string',
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const object = value => value && typeof value === 'object' && !Array.isArray(value)
function get(data, key) { return key.split('.').reduce((a, k) => object(a) && Object.hasOwn(a, k) ? a[k] : undefined, data) }
function set(data, key, value) {
  const parts = key.split('.'); let target = data
  for (const part of parts.slice(0, -1)) {
    if (!object(target[part])) target[part] = {}
    target = target[part]
  }
  if (value === null) delete target[parts.at(-1)]; else target[parts.at(-1)] = value
}
function readDocument(file) {
  if (!fs.existsSync(file)) return { path: file, exists: false, revision: hash(''), data: {}, raw: '' }
  const raw = fs.readFileSync(file, 'utf8')
  try {
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (!object(data)) throw new Error('not an object')
    return { path: file, exists: true, revision: hash(raw), data, raw }
  } catch { return { path: file, exists: true, revision: hash(raw), data: {}, raw, error: 'JSON 格式无效，未读取也不会覆盖此文件。请先修复文件。' } }
}
function writeDocument(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let backup = null
  if (fs.existsSync(file)) {
    // Keep backups out of project repositories; callers provide their own directory.
    backup = file
  }
  const temp = file + '.' + crypto.randomUUID() + '.tmp'
  try { fs.writeFileSync(temp, content, { mode: 0o600 }); fs.renameSync(temp, file) }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  return backup
}
function validate(key, value) {
  if (!Object.hasOwn(FIELDS, key)) throw new Error('不支持的配置项：' + key)
  if (value === null) return
  const kind = FIELDS[key]
  if (kind === 'boolean') { if (typeof value !== 'boolean') throw new Error('请设置有效的开关值'); return }
  if (['rules', 'directories'].includes(kind)) {
    if (!Array.isArray(value) || value.length > 500 || value.some(v => typeof v !== 'string' || !v.trim() || v.length > 3000 || /[\r\n\0]/.test(v))) throw new Error('规则或目录格式无效')
    if (kind === 'rules' && value.some(v => !/^[A-Za-z_*][\w*]*(?:\([^\r\n]+\))?$/.test(v))) throw new Error('工具规则格式无效，例如 Read 或 Bash(npm test *)')
    if (kind === 'directories' && value.some(v => !path.isAbsolute(v))) throw new Error('额外目录请使用完整路径')
    return
  }
  if (['window', 'days', 'timeout'].includes(kind)) {
    const min = kind === 'window' ? 100000 : kind === 'days' ? 1 : 1000
    const max = kind === 'window' ? 1000000 : kind === 'days' ? 36500 : 3600000
    const n = Number(value)
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`数值应为 ${min}–${max} 的整数`)
    return
  }
  if (typeof value !== 'string' || value.length > 10000 || value.includes('\0')) throw new Error('配置值无效')
  if (kind === 'effort' && !['low','medium','high','xhigh'].includes(value)) throw new Error('默认推理强度无效；max 仅可用于会话')
  if (kind === 'mode' && !['default','acceptEdits','plan','auto','bypassPermissions','dontAsk'].includes(value)) throw new Error('权限模式无效')
  if (kind === 'url') {
    let url; try { url = new URL(value) } catch { throw new Error('请输入完整 API 地址') }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址应使用 HTTP/HTTPS，且不能包含认证信息或查询参数')
  }
}

class SettingsService {
  constructor({ userData, preferences, secureStorage, environment = process.env, home = os.homedir() }) {
    this.userData = userData; this.preferences = preferences; this.secureStorage = secureStorage; this.environment = environment; this.home = home
    this.backupDir = path.join(userData, 'settings-backups')
  }
  configHome() { return path.resolve(this.preferences().configDir || this.environment.CLAUDE_CONFIG_DIR || path.join(this.home, '.claude')) }
  locations(cwd) {
    const home = this.configHome()
    return {
      app: path.join(this.userData, 'claude-settings.json'), user: path.join(home, 'settings.json'),
      project: path.join(cwd, '.claude', 'settings.json'), local: path.join(cwd, '.claude', 'settings.local.json'),
      managed: this.environment.CLAUDE_GUI_TEST_MANAGED_FILE || (process.platform === 'win32' ? path.join(this.environment.ProgramFiles || 'C:\\Program Files', 'ClaudeCode', 'managed-settings.json') : '/etc/claude-code/managed-settings.json'),
    }
  }
  decrypt(data) {
    const result = structuredClone(data); delete result._encryptedEnv
    for (const [key, value] of Object.entries(data._encryptedEnv || {})) {
      try { set(result, 'env.' + key, this.secureStorage.decryptString(Buffer.from(value, 'base64'))) }
      catch { throw new Error('无法解密本应用的认证信息，请在连接设置中重新保存凭据') }
    }
    return result
  }
  values(data) {
    return Object.fromEntries(Object.entries(FIELDS).map(([key, kind]) => {
      const value = get(data, key)
      if (kind === 'secret') return [key, value || data._encryptedEnv?.[key.slice(4)] ? true : null]
      return [key, value ?? null]
    }))
  }
  read(cwd, session = {}) {
    const locations = this.locations(cwd)
    const docs = Object.fromEntries(Object.entries(locations).map(([scope, p]) => [scope, readDocument(p)]))
    const resolved = {}, origins = {}
    for (const scope of ['user', 'project', 'local', 'app', 'managed']) {
      const values = this.values(docs[scope].data)
      for (const [key, value] of Object.entries(values)) {
        if (value === null || (FIELDS[key] === 'secret' && !value)) continue
        if (Array.isArray(value)) { resolved[key] = [...new Set([...(resolved[key] || []), ...value])]; origins[key] = [...new Set([...(origins[key] || []), LABELS[scope]])] }
        else { resolved[key] = value; origins[key] = [LABELS[scope]] }
      }
    }
    // This is a local preview; remotely supplied policy and per-key CLI rules remain authoritative.
    for (const key of Object.keys(FIELDS).filter(k => k.startsWith('env.'))) {
      const value = this.environment[key.slice(4)]
      if (value && resolved[key] == null) { resolved[key] = FIELDS[key] === 'secret' ? true : value; origins[key] = [LABELS.environment] }
    }
    const overrides = { model: session.model || null, effortLevel: session.effort || null, 'permissions.defaultMode': session.permission || null }
    const selectedModel = overrides.model || resolved['env.ANTHROPIC_MODEL'] || resolved.model || 'default'
    const alias = /^(sonnet|opus|haiku)(\[1m\])?$/.exec(selectedModel)
    const model = alias ? resolved[`env.ANTHROPIC_DEFAULT_${alias[1].toUpperCase()}_MODEL`] || selectedModel : selectedModel
    return {
      configHome: this.configHome(), resolved, origins, overrides, model, selectedModel,
      secureStorageAvailable: !!this.secureStorage?.isEncryptionAvailable(),
      sources: Object.fromEntries(Object.entries(docs).map(([scope, doc]) => [scope, { path: doc.path, exists: doc.exists, revision: doc.revision, error: doc.error, values: this.values(doc.data), writable: scope !== 'managed' }])),
    }
  }
  backup(file) {
    if (!fs.existsSync(file)) return null
    fs.mkdirSync(this.backupDir, { recursive: true })
    const backup = path.join(this.backupDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${path.basename(file)}-${crypto.randomUUID().slice(0, 8)}.bak`)
    fs.copyFileSync(file, backup); fs.chmodSync(backup, 0o600); return backup
  }
  save(cwd, { scope, revision, changes }) {
    if (!SCOPES.includes(scope)) throw new Error('该配置来源不可编辑')
    const file = this.locations(cwd)[scope], doc = readDocument(file)
    if (doc.error) throw new Error(doc.error)
    if (revision !== doc.revision) throw new Error('配置已被其他程序修改。请重新加载后再保存，避免覆盖外部更改。')
    if (!object(changes) || Object.keys(changes).length > 50) throw new Error('无效的设置修改')
    const data = structuredClone(doc.data)
    for (const [key, raw] of Object.entries(changes)) {
      validate(key, raw)
      if (FIELDS[key] === 'secret') {
        if (scope !== 'app' && ['project','local'].includes(scope)) throw new Error('认证信息请保存到仅本应用或全局个人范围')
        if (scope === 'app') {
          if (!object(data._encryptedEnv)) data._encryptedEnv = {}
          if (raw === null) delete data._encryptedEnv[key.slice(4)]
          else {
            if (!this.secureStorage?.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，无法保存应用认证信息')
            data._encryptedEnv[key.slice(4)] = this.secureStorage.encryptString(raw).toString('base64')
          }
          set(data, key, null)
        } else set(data, key, raw)
      } else {
        const value = raw === null ? null : FIELDS[key] === 'timeout' ? String(Number(raw)) : ['window','days'].includes(FIELDS[key]) ? Number(raw) : raw
        set(data, key, value)
      }
    }
    const backup = this.backup(file)
    writeDocument(file, JSON.stringify(data, null, 2) + '\n')
    if (scope === 'local') this.ensureIgnore(cwd)
    return { path: file, backup, changed: Object.keys(changes) }
  }
  ensureIgnore(cwd) {
    const file = path.join(cwd, '.gitignore')
    const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    if (!raw.split(/\r?\n/).some(line => ['.claude/settings.local.json','/.claude/settings.local.json','**/.claude/settings.local.json','.claude/','.claude'].includes(line.trim()))) {
      this.backup(file); writeDocument(file, raw + (raw && !raw.endsWith('\n') ? '\n' : '') + '\n# Personal Claude configuration\n.claude/settings.local.json\n')
    }
  }
  runtime(cwd, {subscription=false}={}) {
    const docs = Object.entries(this.locations(cwd)).map(([scope, p]) => [scope, readDocument(p)])
    const invalid = docs.find(([, d]) => d.error)
    if (invalid) throw new Error(`${LABELS[invalid[0]]}配置格式无效，请在设置的配置来源页检查。`)
    const data = this.decrypt(docs.find(([scope]) => scope === 'app')[1].data)
    // Setting CLAUDE_CONFIG_DIR also relocates .claude.json (personal MCPs).
    // Preserve the native default unless the user explicitly selected a profile.
    const custom = this.preferences().configDir || this.environment.CLAUDE_CONFIG_DIR
    const isolated=subscription?subscriptionOverlay(data,docs,this.environment):{settings:data,env:{}}
    return { settings: isolated.settings, env: {...(custom?{CLAUDE_CONFIG_DIR:this.configHome()}:{}),...isolated.env} }
  }
  prepareRuntime(cwd, options) {
    const runtime = this.runtime(cwd, options)
    if (!Object.keys(runtime.settings).length) return { env: runtime.env, cleanup() {} }
    const directory = path.join(this.userData, 'runtime-settings')
    fs.mkdirSync(directory, { recursive: true })
    const file = path.join(directory, crypto.randomUUID() + '.json')
    fs.writeFileSync(file, JSON.stringify(runtime.settings), { mode: 0o600 })
    return { env: runtime.env, settingsPath: file, cleanup() { fs.rmSync(file, { force: true }) } }
  }
  cleanupStaleRuntime() {
    const directory = path.resolve(this.userData, 'runtime-settings')
    if (!fs.existsSync(directory) || fs.lstatSync(directory).isSymbolicLink()) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[0-9a-f-]{36}\.json$/i.test(entry.name)) continue
      const target = path.resolve(directory, entry.name)
      if (path.dirname(target) === directory) fs.rmSync(target, { force: true })
    }
  }
  instructionList(cwd) {
    const entries = [
      { id: 'user', title: '全局说明', path: path.join(this.configHome(), 'CLAUDE.md'), description: '适用于本机所有项目' },
      { id: 'project', title: '项目说明', path: path.join(cwd, 'CLAUDE.md'), description: '与团队共享的项目约定' },
      { id: 'project-dot', title: '.claude 项目说明', path: path.join(cwd, '.claude', 'CLAUDE.md'), description: '项目 .claude 目录中的说明' },
      { id: 'local', title: '项目个人说明', path: path.join(cwd, 'CLAUDE.local.md'), description: '只适用于你的项目偏好' },
    ]
    for (const [scope, root] of [['user', path.join(this.configHome(), 'rules')], ['project', path.join(cwd, '.claude', 'rules')]]) {
      const walk = (dir, depth = 0) => {
        if (depth > 8) return
        for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
          if (e.isSymbolicLink()) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) walk(full, depth + 1)
          else if (e.name.endsWith('.md')) entries.push({ id: `rule:${scope}:${path.relative(root, full).replace(/\\/g, '/')}`, title: e.name, path: full, description: scope === 'user' ? '全局规则' : '项目规则' })
        }
      }; walk(root)
    }
    return entries.map(e => ({ ...e, exists: fs.existsSync(e.path) }))
  }
  instruction(cwd, id) {
    const entry = this.instructionList(cwd).find(e => e.id === id)
    if (!entry) throw new Error('说明文件不存在')
    if (entry.exists && fs.statSync(entry.path).size > 1024 * 1024) throw new Error('文件过大，请在外部编辑器中打开')
    const content = entry.exists ? fs.readFileSync(entry.path, 'utf8') : ''
    return { ...entry, content, revision: hash(content) }
  }
  saveInstruction(cwd, { id, revision, content }) {
    const doc = this.instruction(cwd, id)
    if (revision !== doc.revision) throw new Error('文件已在外部修改，请重新加载后保存')
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 1024 * 1024) throw new Error('说明内容过长')
    const backup = this.backup(doc.path); writeDocument(doc.path, content)
    if (id === 'local') {
      const ignore = path.join(cwd, '.gitignore'), raw = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : ''
      if (!raw.split(/\r?\n/).some(line => ['CLAUDE.local.md','/CLAUDE.local.md','**/CLAUDE.local.md'].includes(line.trim()))) { this.backup(ignore); writeDocument(ignore, raw + (raw.endsWith('\n') || !raw ? '' : '\n') + 'CLAUDE.local.md\n') }
    }
    return { path: doc.path, backup }
  }
  createRule(cwd, { scope, name }) {
    if (!['user','project'].includes(scope) || typeof name !== 'string' || !/^[\p{L}\p{N}_-][\p{L}\p{N}_ .-]{0,80}$/u.test(name) || name.includes('..')) throw new Error('请输入有效的规则文件名')
    const filename = name.endsWith('.md') ? name : name + '.md'
    const root = scope === 'user' ? path.join(this.configHome(), 'rules') : path.join(cwd, '.claude', 'rules')
    const file = path.join(root, filename)
    if (fs.existsSync(file)) throw new Error('同名规则已存在')
    fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(file, '# ' + filename.slice(0, -3) + '\n\n', { flag: 'wx', mode: 0o600 })
    return `rule:${scope}:${filename}`
  }
}
module.exports = { SettingsService, FIELDS, get, readDocument, hash }
