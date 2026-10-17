const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const claude = require('./claude.cjs')
const exec = promisify(execFile)
const hash = text => crypto.createHash('sha256').update(text).digest('hex')
const uuid = value => /^[0-9a-f-]{36}$/i.test(value || '')
async function git(cwd, args) {
  try { return (await exec('git', args, { cwd, windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 })).stdout }
  catch (e) { throw new Error((e.stderr || 'Git 操作失败，请确认这是一个 Git 仓库').slice(-2000)) }
}
function safeFile(root, name) {
  if (!/^[\w.-]{1,100}$/.test(name) || name.startsWith('.') || !/\.(md|js)$/.test(name)) throw new Error('请输入安全的配置文件名（.md / .js）')
  fs.mkdirSync(root, { recursive: true })
  const full = path.resolve(root, name)
  if (fs.existsSync(full) && (fs.lstatSync(full).isSymbolicLink() || fs.statSync(full).nlink > 1)) throw new Error('不编辑链接文件')
  const realRoot = fs.realpathSync(root), realFile = fs.existsSync(full) ? fs.realpathSync(full) : path.join(realRoot, name)
  if (path.dirname(realFile) !== realRoot) throw new Error('文件不在目标目录中')
  return full
}
class OperationsService {
  constructor({ userData, configuration, preferences }) { this.userData = userData; this.configuration = configuration; this.preferences = preferences }
  async call(cwd, args, extra = {}) {
    const runtime = this.configuration.prepareRuntime(cwd), spec = claude.commandSpec(claude.resolveClaude(this.preferences().cliPath), [...args, ...(args.includes('-p') && runtime.settingsPath ? ['--settings', runtime.settingsPath] : [])])
    try { return (await exec(spec.command, spec.args, { cwd, env: claude.environment({ ...runtime.env, ...spec.env, ...extra }), windowsHide: true, timeout: 45000, maxBuffer: 4 * 1024 * 1024 })).stdout }
    catch (e) { throw new Error((e.stderr || e.stdout || e.message).slice(-3000).replace(/(?:sk-ant-|sk-)[A-Za-z0-9_-]+/g, '[已隐藏凭据]')) }
    finally { runtime.cleanup() }
  }
  async createWorktree(cwd, name) {
    if (!/^[a-zA-Z0-9][\w-]{0,60}$/.test(name)) throw new Error('工作区名称仅允许字母、数字、短横线和下划线')
    const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
    const worktree = path.resolve(root, '.claude', 'worktrees', 'gui-' + name)
    if (fs.existsSync(worktree)) throw new Error('此工作区已经存在')
    fs.mkdirSync(path.dirname(worktree), { recursive: true })
    const resolvedParent = fs.realpathSync(path.dirname(worktree)), resolvedRoot = fs.realpathSync(root)
    if (!claude.isInside(resolvedRoot, resolvedParent)) throw new Error('工作区路径链接到了项目外部')
    await git(root, ['worktree', 'add', '-b', 'gui/' + name, worktree])
    return { cwd: worktree, root, name, branch: 'gui/' + name, base: (await git(root, ['rev-parse', 'HEAD'])).trim() }
  }
  async removeWorktree(worktree) {
    const target = path.resolve(worktree.cwd), expected = path.resolve(worktree.root, '.claude', 'worktrees', 'gui-' + worktree.name)
    if (target !== expected || !claude.isInside(path.resolve(worktree.root), target) || fs.lstatSync(target).isSymbolicLink()) throw new Error('工作区路径校验失败')
    if (!claude.isInside(fs.realpathSync(worktree.root), fs.realpathSync(target))) throw new Error('工作区实际路径不在项目中')
    if ((await git(target, ['status', '--porcelain'])).trim()) throw new Error('工作区存在未提交或未跟踪的文件，请先保存工作')
    const ahead = (await git(target, ['rev-list', '--count', 'HEAD', '--not', ...(worktree.base && /^[0-9a-f]{40,64}$/i.test(worktree.base) ? [worktree.base] : []), '--remotes'])).trim()
    if (Number(ahead) > 0) throw new Error('存在尚未推送的提交，请先推送后再移除工作区')
    await git(worktree.root, ['worktree', 'remove', target])
  }
  async diff(cwd) {
    const branch = (await git(cwd, ['branch', '--show-current'])).trim()
    const status = await git(cwd, ['status', '--short'])
    let hasHead=true;try{await git(cwd,['rev-parse','--verify','HEAD'])}catch{hasHead=false}
    const tracked = hasHead?await git(cwd, ['-c','core.quotePath=false','diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--']):''
    const untracked = [...new Set((await git(cwd, ['ls-files', ...(!hasHead?['--cached']:[]),'--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean))].slice(0, 100)
    let extra = ''
    for (const relative of untracked) {
      const full = path.resolve(cwd, relative)
      if (!claude.isInside(cwd, full)||!fs.existsSync(full) || fs.lstatSync(full).isSymbolicLink() || !fs.statSync(full).isFile()||!claude.isInside(fs.realpathSync(cwd),fs.realpathSync(full))) continue
      const header=`\ndiff --git a/${relative} b/${relative}\n--- /dev/null\n+++ b/${relative}\n`
      if (fs.statSync(full).size > 100000) { extra += header+'新增文件超过预览限制\n'; continue }
      const buf = fs.readFileSync(full)
      if (buf.includes(0)) { extra += header+'新增二进制文件\n'; continue }
      const lines=buf.toString().split('\n');if(lines.at(-1)==='')lines.pop()
      extra += header+`@@ -0,0 +1,${lines.length} @@\n`+lines.map(l => '+' + l).join('\n')+'\n'
      if (extra.length > 200000) break
    }
    return { branch, status, diff: (tracked + extra).slice(0, 500000), revision: hash(status + tracked + extra) }
  }
  documents(cwd) {
    const docs = []
    for (const [scope, root] of [['user', this.configuration.configHome()], ['project', path.join(cwd, '.claude')]]) {
      for (const kind of ['agents', 'workflows', 'rules']) {
        const dir = path.join(root, kind)
        for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) if (e.isFile() && e.name.endsWith(kind === 'workflows' ? '.js' : '.md')) docs.push({ scope, kind, name: e.name })
      }
    }
    const memoryRoot = path.join(this.configuration.configHome(), 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), 'memory')
    for (const e of fs.existsSync(memoryRoot) ? fs.readdirSync(memoryRoot, { withFileTypes: true }) : []) if (e.isFile() && e.name.endsWith('.md')) docs.push({ scope: 'memory', kind: 'memory', name: e.name })
    return docs
  }
  document(cwd, input) {
    if (!['user', 'project', 'memory'].includes(input.scope) || !['agents', 'workflows', 'rules', 'memory'].includes(input.kind)) throw new Error('文档类别无效')
    if ((input.scope === 'memory') !== (input.kind === 'memory')) throw new Error('文档范围无效')
    if (!input.name?.endsWith(input.kind === 'workflows' ? '.js' : '.md')) throw new Error('工作流请使用 .js，其余文档使用 .md')
    const root = input.scope === 'memory' ? path.join(this.configuration.configHome(), 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), 'memory') : path.join(input.scope === 'user' ? this.configuration.configHome() : path.join(cwd, '.claude'), input.kind)
    const file = safeFile(root, input.name), content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    if (content.length > 1000000) throw new Error('文档过大')
    return { ...input, path: file, content, revision: hash(content) }
  }
  saveDocument(cwd, input) {
    const doc = this.document(cwd, input)
    if (doc.revision !== input.revision) throw new Error('文件已被外部修改，请重新加载')
    if (typeof input.content !== 'string' || input.content.length > 1000000) throw new Error('内容过长')
    this.configuration.backup(doc.path)
    const temp = doc.path + '.tmp'; fs.writeFileSync(temp, input.content, { mode: 0o600 }); fs.renameSync(temp, doc.path)
    return this.document(cwd, input)
  }
  hooks(cwd) {
    return ['user', 'project', 'local', 'app', 'managed'].map(scope => {
      const file = this.configuration.locations(cwd)[scope], raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}'
      const data = JSON.parse(raw)
      return { scope, path: file, revision: hash(raw), hooks: data.hooks || {}, disabled: !!data.disableAllHooks, readOnly: scope === 'managed' }
    })
  }
  saveHooks(cwd, input) {
    if (!['user', 'project', 'local', 'app'].includes(input.scope)) throw new Error('此来源只读')
    const current = this.hooks(cwd).find(h => h.scope === input.scope)
    if (current.revision !== input.revision) throw new Error('配置已在外部修改，请重新加载')
    if (!input.hooks || typeof input.hooks !== 'object' || Array.isArray(input.hooks) || JSON.stringify(input.hooks).length > 200000) throw new Error('Hooks 必须是 JSON 对象')
    for (const entries of Object.values(input.hooks)) if (!Array.isArray(entries) || entries.some(e => !Array.isArray(e.hooks) || e.hooks.some(h => !['command', 'http', 'prompt', 'agent'].includes(h.type)))) throw new Error('Hook 配置格式无效')
    const data = fs.existsSync(current.path) ? JSON.parse(fs.readFileSync(current.path, 'utf8')) : {}
    data.hooks = input.hooks; data.disableAllHooks = !!input.disabled
    this.configuration.backup(current.path); fs.mkdirSync(path.dirname(current.path), { recursive: true })
    const temp = current.path + '.tmp'; fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 }); fs.renameSync(temp, current.path)
    return this.hooks(cwd)
  }
  mods(plugins) {
    return plugins.map(plugin => {
      const file = path.join(plugin.path, 'hooks', 'hooks.json')
      if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) return null
      try {
        const hooks = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (!JSON.stringify(hooks).includes('module')) return null
        return { id: plugin.id, name: plugin.name, enabled: plugin.enabled, path: plugin.path, local:!!plugin.local, definition: JSON.stringify(hooks, null, 2), status: plugin.local ? '当前聊天加载；原生面板不在 -p 中绘制' : '已安装；行为待会话加载验证，原生面板不在 -p 中绘制' }
      } catch { return { id: plugin.id, name: plugin.name, enabled: plugin.enabled, status: 'Hooks 定义无法读取' } }
    }).filter(Boolean)
  }
  nativeSessions(cwd) {
    const {SharedHistory}=require('./shared-history.cjs')
    return new SharedHistory(this.configuration).scan([cwd]).filter(s=>path.resolve(s.cwd)===path.resolve(cwd)).map(s=>({id:s.id,title:s.title,updatedAt:s.updatedAt}))
  }
  importSession(cwd,id) {
    const {SharedHistory}=require('./shared-history.cjs'),history=new SharedHistory(this.configuration)
    const entry=history.scan([cwd]).find(s=>s.id===id&&path.resolve(s.cwd)===path.resolve(cwd))
    if(!entry)throw new Error('未找到此项目的原生会话')
    const session={id,nativeId:id,nativeFile:entry.file,cwd,messages:[]}
    history.hydrate(session,true);return session.messages
  }
  async terminal(session, mode, channel) {
    if (process.platform !== 'win32') throw new Error('当前终端接力入口仅实现 Windows')
    const executable = claude.resolveClaude(this.preferences().cliPath), args = []
    if (session.nativeId && mode !== 'cloud') args.push('--resume', session.nativeId)
    if (mode === 'remote') args.push('--remote-control')
    else if (mode === 'chrome') args.push('--chrome')
    else if (mode === 'cloud') args.push('--cloud')
    else if (mode === 'channel') { if (!/^[\w:@.-]{1,200}$/.test(channel || '')) throw new Error('Channel 名称格式无效'); args.push('--channels', channel) }
    else if (!['terminal', 'teams'].includes(mode)) throw new Error('接力方式无效')
    const q = value => "'" + value.replace(/'/g, "''") + "'"
    const runtime = this.configuration.prepareRuntime(session.cwd)
    if (runtime.settingsPath) args.push('--settings', runtime.settingsPath)
    const spec = claude.commandSpec(executable, args)
    const script = (mode === 'teams' ? "$env:CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS='1'\n" : '') + `Set-Location -LiteralPath ${q(session.cwd)}\n& ${q(spec.command)} ${spec.args.map(q).join(' ')}`
    const child = spawn('powershell.exe', ['-NoProfile', '-NoExit', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { detached: true, windowsHide: false, stdio: 'ignore', env: claude.environment({...runtime.env,...spec.env}) })
    child.on('close', runtime.cleanup)
    await new Promise((resolve,reject) => {child.once('spawn',resolve);child.once('error',error=>{runtime.cleanup();reject(error)})}); child.unref()
    return '已打开交互终端；终端中的新消息会自动同步到 GUI。'
  }
  async rewind(session, checkpoint) {
    if (!uuid(session.nativeId) || !uuid(checkpoint)) throw new Error('没有可用的原生检查点')
    return this.call(session.cwd, ['-p', '--resume', session.nativeId, '--rewind-files', checkpoint], { CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: 'true' })
  }
}
class Scheduler {
  constructor(file, fire, changed) { this.file = file; this.fire = fire; this.changed = changed; this.busy = new Set(); this.timer = setInterval(() => this.tick().catch(e => { this.lastError = e.message; this.changed() }), 10000) }
  list() { if (!fs.existsSync(this.file)) return []; return JSON.parse(fs.readFileSync(this.file, 'utf8')) }
  write(items) { const temp = this.file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(items, null, 2), { mode: 0o600 }); fs.renameSync(temp, this.file) }
  save(input) {
    if (!input.prompt?.trim() || input.prompt.length > 30000 || !Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 525600) throw new Error('请输入任务内容和有效的分钟间隔')
    const all = this.list(), old = all.find(t => t.id === input.id)
    if (!old && all.length >= 100) throw new Error('最多创建 100 个计划')
    const item = { id: old?.id || crypto.randomUUID(), sessionId: input.sessionId, prompt: input.prompt, minutes: input.minutes, enabled: !!input.enabled, nextAt: Date.now() + input.minutes * 60000, lastAt: old?.lastAt, result: old?.result }
    this.write([...all.filter(t => t.id !== item.id), item]); return this.list()
  }
  remove(id) { this.write(this.list().filter(t => t.id !== id)) }
  async tick() {
    for (const t of this.list()) if (t.enabled && t.nextAt <= Date.now() && !this.busy.has(t.id)) {
      this.busy.add(t.id)
      this.write(this.list().map(x => x.id === t.id ? { ...x, nextAt: Date.now() + t.minutes * 60000, lastAt: Date.now(), result: '正在调度' } : x))
      let result
      let runningSessionId = t.runningSessionId
      try { runningSessionId = await this.fire(t); result = '已启动，执行结果见任务聊天' } catch (e) { result = e.message }
      this.write(this.list().map(x => x.id === t.id ? { ...x, result, runningSessionId } : x)); this.busy.delete(t.id); this.changed()
    }
  }
  close() { clearInterval(this.timer) }
}
module.exports = { OperationsService, Scheduler, git, hash }
