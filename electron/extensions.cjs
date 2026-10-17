const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const claude = require('./claude.cjs')
const exec = promisify(execFile)
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const DEFAULT_MARKETS = [
  { id: 'official', title: 'Anthropic 官方插件', repo: 'anthropics/claude-plugins-official', branch: 'main' },
  { id: 'anthropic-skills', title: 'Anthropic Skills', repo: 'anthropics/skills', branch: 'main' },
  { id: 'superpowers', title: 'Superpowers 社区', repo: 'obra/superpowers-marketplace', branch: 'main' },
]
function read(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) }
  catch { throw new Error('配置 JSON 无效，未改写：' + file) }
}
function inside(root, target) { const rel = path.relative(path.resolve(root), path.resolve(target)); return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel) }
function name(value) { if (typeof value !== 'string' || !/^[\w][\w.@:-]{0,199}$/.test(value)) throw new Error('名称格式无效'); return value }
function scope(value) { if (!['user', 'project', 'local'].includes(value)) throw new Error('作用域无效'); return value }
function repo(value) { if (typeof value !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(value) || value.includes('..')) throw new Error('请输入 GitHub owner/repository'); return value }
function safeRelative(value) { if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.split('/').some(p => !p || p === '..' || p === '.' || p.startsWith('-'))) throw new Error('仓库内路径无效'); return value }
function publicUrl(value) { const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('请输入 HTTP/HTTPS 地址'); return u }
function displayUrl(value) { try { const u = publicUrl(value); u.search = ''; u.hash = ''; return u.href } catch { return '地址已配置' } }
function summary(raw) {
  const text = raw.replace(/^\uFEFF/, '')
  const front = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] || ''
  const field = key => new RegExp('^' + key + ':\\s*[\'\"]?([^\\r\\n]+)', 'm').exec(front)?.[1]?.replace(/[\'"]$/, '').trim()
  return { name: field('name'), description: field('description') || '', userInvocable: !/^user-invocable:\s*false\s*$/m.test(front) }
}
function mcpTemplate(server) {
  const remote = server.remotes?.find(r => ['streamable-http', 'sse'].includes(r.type))
  if (remote) {
    const config = { type: remote.type === 'sse' ? 'sse' : 'http', url: remote.url }
    if (remote.headers?.length) config.headers = Object.fromEntries(remote.headers.map(h => [h.name, h.value || '${' + h.name.replace(/\W/g, '_').toUpperCase() + '}']))
    return config
  }
  const pkg = server.packages?.find(p => p.registryType === 'npm' && (!p.transport || p.transport.type === 'stdio'))
  if (!pkg || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(pkg.identifier) || !/^[\w.+-]+$/.test(pkg.version || '')) return null
  if (pkg.registryBaseUrl && pkg.registryBaseUrl.replace(/\/$/, '') !== 'https://registry.npmjs.org') return null
  const arg = a => a.value || '${' + (a.name || 'ARGUMENT').replace(/\W/g, '_').toUpperCase() + '}'
  const config = { type: 'stdio', command: 'npx', args: ['-y', `${pkg.identifier}@${pkg.version}`] }
  for (const a of pkg.packageArguments || []) { if (a.type === 'named' && a.name) config.args.push(a.name); config.args.push(arg(a)) }
  if (pkg.runtimeArguments?.length) return null // Do not guess runtime-specific argument placement.
  if (pkg.environmentVariables?.length) config.env = Object.fromEntries(pkg.environmentVariables.map(e => [e.name, e.value || '${' + e.name + '}']))
  return config
}

class ExtensionsService {
  constructor({ userData, configuration, preferences, fetcher = fetch, execute } = {}) {
    this.userData = userData; this.configuration = configuration; this.preferences = preferences; this.fetcher = fetcher; this.execute = execute
    this.cache = new Map(); this.items = new Map(); this.previews = new Map()
    this.marketFile = path.join(userData, 'extension-markets.json')
  }
  markets() { return [...DEFAULT_MARKETS, ...read(this.marketFile, [])] }
  fingerprint(cwd) {
    const { native, project } = this.mcpProfile(cwd)
    // .claude.json also contains frequently changing history/UI state. Only
    // connection-related fields should invalidate a live permission session.
    return hash(JSON.stringify({ user: native.mcpServers || {}, local: project.mcpServers || {},
      disabled: project.disabledMcpServers || [], enabled: project.enabledMcpServers || [],
      approvals: [project.enabledMcpjsonServers || [], project.disabledMcpjsonServers || []],
      shared: read(path.join(cwd, '.mcp.json')).mcpServers || {}, plugins: this.plugins(cwd) }))
  }
  async fetchText(url) {
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json, text/plain' } })
    if (!response.ok) throw new Error(`公开来源返回 HTTP ${response.status}`)
    const chunks = []; let size = 0
    for await (const chunk of response.body) { size += chunk.length; if (size > 5 * 1024 * 1024) { await response.body.cancel?.().catch(() => {}); throw new Error('来源内容超过 5 MB') }; chunks.push(Buffer.from(chunk)) }
    return Buffer.concat(chunks).toString('utf8')
  }
  async json(url) { try { return JSON.parse(await this.fetchText(url)) } catch (e) { throw new Error(e instanceof SyntaxError ? '来源没有返回有效 JSON' : e.message) } }
  async call(cwd, args, timeout = 120000) {
    if (this.execute) return this.execute(cwd, args)
    const runtime = this.configuration.runtime(cwd)
    const spec = claude.commandSpec(claude.resolveClaude(this.preferences().cliPath), args)
    try {
      const result = await exec(spec.command, spec.args, { cwd, env: claude.environment({ ...runtime.env, ...spec.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }), windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 })
      return result.stdout
    } catch (e) { throw new Error((e.stderr || e.stdout || e.message || 'Claude 命令失败').slice(-2500)) }
  }
  async catalog(id, query = '', cursor = '', refresh = false) {
    if (typeof query !== 'string' || query.length > 200 || typeof cursor !== 'string' || cursor.length > 2000) throw new Error('搜索参数无效')
    const key = JSON.stringify([id, id === 'mcp-registry' ? query : '', cursor])
    if (!refresh && this.cache.has(key) && Date.now() - this.cache.get(key).at < 300000) return this.cache.get(key).value
    let result
    if (id === 'mcp-registry') {
      const url = new URL('https://registry.modelcontextprotocol.io/v0.1/servers')
      url.search = new URLSearchParams({ limit: '30', version: 'latest', ...(query ? { search: query } : {}), ...(cursor ? { cursor } : {}) }).toString()
      const data = await this.json(url.href)
      if (!Array.isArray(data.servers)) throw new Error('Registry 数据格式无效')
      const items = data.servers.filter(e => !e._meta?.['io.modelcontextprotocol.registry/official']?.status || e._meta['io.modelcontextprotocol.registry/official'].status === 'active').map(e => {
        const server = e.server, itemId = 'mcp:' + hash(server.name + '@' + server.version)
        this.items.set(itemId, { kind: 'mcp', server })
        return { id: itemId, kind: 'mcp', name: server.title || server.name, description: server.description || '', version: server.version, source: 'MCP 官方 Registry', homepage: server.repository?.url || server.websiteUrl || '', config: mcpTemplate(server), auth: '服务鉴权与费用以提供方说明为准' }
      })
      result = { items, nextCursor: data.metadata?.nextCursor || '', fetchedAt: Date.now() }
    } else {
      const market = this.markets().find(m => m.id === id)
      if (!market) throw new Error('市场不存在')
      const data = await this.json(`https://raw.githubusercontent.com/${market.repo}/${market.branch}/.claude-plugin/marketplace.json`)
      if (!Array.isArray(data.plugins)) throw new Error('此仓库没有有效的 Claude 插件市场清单')
      name(data.name)
      const items = []
      for (const plugin of data.plugins) {
        name(plugin.name)
        const itemId = `plugin:${market.id}:${plugin.name}`
        this.items.set(itemId, { kind: 'plugin', market, marketplace: data.name, plugin })
        items.push({ id: itemId, kind: 'plugin', name: plugin.name, description: plugin.description || '', version: plugin.version || '', source: market.title, homepage: plugin.homepage || `https://github.com/${market.repo}`, components: ['skills', 'agents', 'hooks', 'mcpServers'].filter(k => plugin[k]), pluginId: `${plugin.name}@${data.name}` })
        if (market.id === 'anthropic-skills') for (const skillPath of plugin.skills || []) {
          const rel = safeRelative(skillPath.replace(/^\.\//, '')), slug = rel.split('/').at(-1), sid = 'skill:' + market.id + ':' + slug
          this.items.set(sid, { kind: 'skill', market, skillPath: rel, slug })
          if (!items.some(i => i.id === sid)) items.push({ id: sid, kind: 'skill', name: slug, description: '独立安装此 Skill 及配套文件，也可通过所属插件整组安装。', version: '', source: market.title, homepage: `https://github.com/${market.repo}/tree/${market.branch}/${rel}`, components: ['skills'] })
        }
      }
      result = { items, nextCursor: '', fetchedAt: Date.now(), marketplace: data.name }
    }
    this.cache.set(key, { at: Date.now(), value: result })
    return result
  }
  async addMarket(value) {
    const source = repo(value), id = 'github-' + hash(source).slice(0, 12)
    if (this.markets().some(m => m.repo.toLowerCase() === source.toLowerCase())) throw new Error('该市场已在列表中')
    const data = await this.json(`https://raw.githubusercontent.com/${source}/main/.claude-plugin/marketplace.json`)
    if (!Array.isArray(data.plugins)) throw new Error('仓库 main 分支没有插件市场清单')
    name(data.name)
    this.write(this.marketFile, [...read(this.marketFile, []), { id, title: data.name, repo: source, branch: 'main' }])
    return this.markets()
  }
  write(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true }); this.configuration.backup(file)
    const temp = file + '.' + crypto.randomUUID() + '.tmp'
    try { fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, file) }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp) }
  }
  settings(cwd) {
    const locations = this.configuration.locations(cwd)
    return Object.assign({}, ...['user', 'project', 'local', 'app', 'managed'].map(s => read(locations[s]).skillOverrides || {}))
  }
  plugins(cwd) {
    const locations = this.configuration.locations(cwd)
    const flags = Object.assign({}, ...['user', 'project', 'local', 'app', 'managed'].map(s => read(locations[s]).enabledPlugins || {}))
    const registry = read(path.join(this.configuration.configHome(), 'plugins', 'installed_plugins.json')).plugins || {}
    const result = []
    for (const [id, installs] of Object.entries(registry)) for (const install of Array.isArray(installs) ? installs : []) {
      if (install.scope !== 'user' && (!install.projectPath || path.resolve(install.projectPath).toLowerCase() !== path.resolve(cwd).toLowerCase())) continue
      result.push({ id, name: id.split('@')[0], version: install.version || '', scope: install.scope, path: install.installPath || '', enabled: flags[id] !== false })
    }
    return result
  }
  skills(cwd) {
    const result = [], overrides = this.settings(cwd)
    const roots = [{ root: path.join(this.configuration.configHome(), 'skills'), scope: 'user' }, { root: path.join(cwd, '.claude/skills'), scope: 'project' }]
    for (const plugin of this.plugins(cwd)) if (plugin.enabled && plugin.path) {
      const manifestPath = path.join(plugin.path, '.claude-plugin/plugin.json'), manifest = read(manifestPath)
      const knownMarket = read(path.join(this.configuration.configHome(), 'plugins/known_marketplaces.json'))[plugin.id.split('@')[1]]
      const marketEntry = knownMarket?.installLocation ? read(path.join(knownMarket.installLocation, '.claude-plugin/marketplace.json')).plugins?.find(p => p.name === plugin.name) : null
      const onlyDeclared = !fs.existsSync(manifestPath) && marketEntry?.strict === false && Array.isArray(marketEntry.skills)
      const dirs = onlyDeclared ? [] : [path.join(plugin.path, 'skills')]
      if (onlyDeclared) for (const rel of marketEntry.skills) {
        const target = path.resolve(plugin.path, rel)
        if (inside(plugin.path, target)) dirs.push(target)
      }
      for (const rel of Array.isArray(manifest.skills) ? manifest.skills : typeof manifest.skills === 'string' ? [manifest.skills] : []) {
        const target = path.resolve(plugin.path, rel)
        if (inside(plugin.path, target)) dirs.push(target)
      }
      for (const root of new Set(dirs)) roots.push({ root, scope: plugin.scope, plugin: plugin.id })
    }
    const walk = (dir, context, depth = 0) => {
      if (depth > 6 || !fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) return
      const file = path.join(dir, 'SKILL.md')
      if (fs.existsSync(file) && !fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).size < 1024 * 1024) {
        const info = summary(fs.readFileSync(file, 'utf8')), skillName = info.name || path.basename(dir)
        const command = context.plugin ? context.plugin.split('@')[0] + ':' + skillName : skillName
        result.push({ id: hash(file), name: command, description: info.description, path: dir, scope: context.scope, plugin: context.plugin, visibility: context.plugin ? 'plugin' : overrides[skillName] || 'on', userInvocable: info.userInvocable })
      } else for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.') && !e.isSymbolicLink()) walk(path.join(dir, e.name), context, depth + 1)
    }
    for (const context of roots) walk(context.root, context)
    return [...new Map(result.map(s => [s.id, s])).values()]
  }
  mcpProfile(cwd) {
    const custom = this.preferences().configDir || process.env.CLAUDE_CONFIG_DIR
    const file = custom ? path.join(this.configuration.configHome(), '.claude.json') : path.join(os.homedir(), '.claude.json')
    const native = read(file), key = Object.keys(native.projects || {}).find(p => path.resolve(p).toLowerCase() === path.resolve(cwd).toLowerCase()), project = native.projects?.[key] || {}
    return { file, native, key: key || cwd.replace(/\\/g, '/'), project }
  }
  mcp(cwd) {
    const { native, project } = this.mcpProfile(cwd)
    const groups = [['user', native.mcpServers || {}], ['project', read(path.join(cwd, '.mcp.json')).mcpServers || {}], ['local', project.mcpServers || {}]]
    return groups.flatMap(([scope, servers]) => Object.entries(servers).map(([serverName, server]) => ({ name: serverName, scope, transport: server.type || 'stdio', address: server.url ? displayUrl(server.url) : server.command || '', envKeys: Object.keys(server.env || {}), disabled: (project.disabledMcpServers || []).includes(serverName), status: '未检测' })))
  }
  async installed(cwd) {
    const results = {}, errors = []
    for (const [key, fn] of [['plugins', () => this.plugins(cwd)], ['skills', () => this.skills(cwd)], ['mcp', () => this.mcp(cwd)]]) {
      try { results[key] = fn() } catch (e) { results[key] = []; errors.push(e.message) }
    }
    try { results.nativeMarkets = JSON.parse(await this.call(cwd, ['plugin', 'marketplace', 'list', '--json'], 20000)) } catch (e) { results.nativeMarkets = []; errors.push('原生市场：' + e.message) }
    return { ...results, markets: this.markets(), errors }
  }
  async preview(itemId) {
    const item = this.items.get(itemId)
    if (!item) throw new Error('请先刷新市场，再选择条目')
    let text = '', license = ''
    if (item.kind === 'skill') text = await this.fetchText(`https://raw.githubusercontent.com/${item.market.repo}/${item.market.branch}/${item.skillPath}/SKILL.md`)
    else if (item.kind === 'plugin') text = JSON.stringify(item.plugin, null, 2)
    else text = JSON.stringify(item.server, null, 2)
    const revision = hash(text)
    this.previews.set(itemId, { revision, at: Date.now() })
    return { text, revision, kind: item.kind, license }
  }
  async install(cwd, { itemId, revision, scope: targetScope }) {
    scope(targetScope)
    const item = this.items.get(itemId), preview = this.previews.get(itemId)
    if (!item || !preview || preview.revision !== revision || Date.now() - preview.at > 1800000) throw new Error('请重新预览后安装')
    if (item.kind === 'plugin') {
      const latest = await this.json(`https://raw.githubusercontent.com/${item.market.repo}/${item.market.branch}/.claude-plugin/marketplace.json`)
      if (hash(JSON.stringify(latest.plugins?.find(p => p.name === item.plugin.name), null, 2) || '') !== revision) throw new Error('市场条目已变化，请重新预览')
      if (item.plugin.source?.source === 'command') throw new Error('此条目需要执行安装命令，请通过 Claude 终端查看并安装')
      await this.call(cwd, ['plugin', 'marketplace', 'add', item.market.repo, '--scope', targetScope])
      const result = await this.call(cwd, ['plugin', 'install', `${item.plugin.name}@${item.marketplace}`, '--scope', targetScope, '--json'])
      if (targetScope === 'local') this.configuration.ensureIgnore(cwd)
      return result
    }
    if (item.kind !== 'skill') throw new Error('MCP 请先检查连接配置再添加')
    if (!['user', 'project'].includes(targetScope)) throw new Error('独立 Skill 支持全局个人或项目目录')
    const targetRoot = targetScope === 'user' ? path.join(this.configuration.configHome(), 'skills') : path.join(cwd, '.claude/skills')
    const target = path.resolve(targetRoot, name(item.slug))
    if (!inside(targetRoot, target) || fs.existsSync(target)) throw new Error('目标技能目录已存在，未覆盖')
    fs.mkdirSync(targetRoot, { recursive: true })
    const canonical = fs.realpathSync(targetRoot), expected = path.resolve(targetRoot)
    if ((process.platform === 'win32' ? canonical.toLowerCase() !== expected.toLowerCase() : canonical !== expected)) throw new Error('技能根目录含链接，请在原生目录中管理')
    const stageRoot = path.join(this.userData, 'extension-staging'); fs.mkdirSync(stageRoot, { recursive: true })
    const stage = fs.mkdtempSync(path.join(stageRoot, 'skill-')), checkout = path.join(stage, 'repository'), output = path.join(stage, 'output')
    try {
      const env = claude.environment({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' })
      const noHooks = path.join(stage, 'empty-hooks'); fs.mkdirSync(noHooks)
      const gitConfig = ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=' + noHooks]
      await exec('git', [...gitConfig, 'clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', item.market.branch, '--', `https://github.com/${repo(item.market.repo)}.git`, checkout], { env, timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 })
      await exec('git', [...gitConfig, 'sparse-checkout', 'set', '--', item.skillPath], { cwd: checkout, env, timeout: 120000, windowsHide: true })
      const source = path.resolve(checkout, safeRelative(item.skillPath))
      if (!inside(checkout, source) || hash(fs.readFileSync(path.join(source, 'SKILL.md'))) !== revision) throw new Error('Skill 内容已变化，请重新预览')
      let files = 0, bytes = 0
      const copy = (from, to) => {
        const stat = fs.lstatSync(from)
        if (stat.isSymbolicLink()) throw new Error('技能包含链接，未安装')
        if (stat.isDirectory()) { fs.mkdirSync(to); for (const e of fs.readdirSync(from)) copy(path.join(from, e), path.join(to, e)) }
        else { files++; bytes += stat.size; if (files > 3000 || bytes > 30 * 1024 * 1024) throw new Error('技能文件过多或超过 30 MB'); fs.copyFileSync(from, to) }
      }
      copy(source, output)
      if (!inside(targetRoot, target) || fs.existsSync(target)) throw new Error('目标已变化，请重新加载')
      // Copy into an adjacent staging directory for atomic rename across drives.
      const adjacent = path.join(targetRoot, '.gui-' + crypto.randomUUID())
      try { fs.cpSync(output, adjacent, { recursive: true, errorOnExist: true }); fs.renameSync(adjacent, target) }
      finally { if (inside(targetRoot, adjacent) && fs.existsSync(adjacent)) fs.rmSync(adjacent, { recursive: true, force: true }) }
      return 'Skill 已安装到 ' + target
    } finally { if (inside(stageRoot, stage)) fs.rmSync(stage, { recursive: true, force: true }) }
  }
  async pluginAction(cwd, { id, action, scope: targetScope }) {
    name(id); scope(targetScope)
    if (!['enable', 'disable', 'update', 'uninstall'].includes(action)) throw new Error('插件操作无效')
    if (!this.plugins(cwd).some(p => p.id === id && p.scope === targetScope)) throw new Error('此作用域没有安装该插件')
    const args = ['plugin', action, id, '--scope', targetScope]
    if (action === 'uninstall') args.push('--keep-data')
    return this.call(cwd, args)
  }
  skillVisibility(cwd, { id, visibility }) {
    if (!['on', 'name-only', 'user-invocable-only', 'off'].includes(visibility)) throw new Error('技能可见性无效')
    const skill = this.skills(cwd).find(s => s.id === id)
    if (!skill || skill.plugin) throw new Error('插件技能请通过插件启停管理')
    const file = this.configuration.locations(cwd)[skill.scope === 'user' ? 'user' : 'local']
    const data = read(file); data.skillOverrides = { ...data.skillOverrides, [skill.name]: visibility }; this.write(file, data)
    if (skill.scope !== 'user') this.configuration.ensureIgnore(cwd)
    return '技能可见性已保存'
  }
  skillContent(cwd, id) {
    const skill = this.skills(cwd).find(s => s.id === id)
    if (!skill) throw new Error('技能不存在')
    return fs.readFileSync(path.join(skill.path, 'SKILL.md'), 'utf8')
  }
  async addMcp(cwd, { name: serverName, config, scope: targetScope }) {
    name(serverName); scope(targetScope)
    if (!config || typeof config !== 'object' || Array.isArray(config) || JSON.stringify(config).length > 100000) throw new Error('MCP 配置无效')
    if (this.mcp(cwd).some(m => m.name === serverName && m.scope === targetScope)) throw new Error('同名服务器已存在，未覆盖')
    if (['http', 'sse'].includes(config.type)) publicUrl(config.url)
    else if ((!config.type || config.type === 'stdio') && typeof config.command === 'string' && config.command.trim() && (!config.args || Array.isArray(config.args) && config.args.every(a => typeof a === 'string'))) { /* CLI validates remaining fields. */ }
    else throw new Error('仅支持 stdio、HTTP、SSE 配置')
    return this.call(cwd, ['mcp', 'add-json', serverName, JSON.stringify(config), '--scope', targetScope])
  }
  async mcpAction(cwd, { name: serverName, scope: targetScope, action }) {
    name(serverName); scope(targetScope)
    if (!this.mcp(cwd).some(m => m.name === serverName && m.scope === targetScope)) throw new Error('服务器已变化，请刷新')
    if (['enable', 'disable'].includes(action)) {
      const { file, native, key, project } = this.mcpProfile(cwd)
      const disabled = new Set(project.disabledMcpServers || [])
      if (action === 'disable') disabled.add(serverName); else disabled.delete(serverName)
      native.projects = { ...native.projects, [key]: { ...project, disabledMcpServers: [...disabled] } }
      this.write(file, native)
      return '项目中的 MCP 连接状态已保存'
    }
    if (action === 'remove') return this.call(cwd, ['mcp', 'remove', serverName, '--scope', targetScope])
    if (action === 'test') {
      const output = await this.call(cwd, ['mcp', 'get', serverName], 45000)
      return output.split(/\r?\n/).filter(line => /(?:^|\s)(?:Status:|Connected|Pending approval|Failed to connect|Needs authentication|Disabled|Rejected)/i.test(line)).join('\n') || '检测已完成，请在 Claude 的 /mcp 中查看连接状态。'
    }
    throw new Error('MCP 操作无效')
  }
}
module.exports = { ExtensionsService, DEFAULT_MARKETS, mcpTemplate, inside, summary }
