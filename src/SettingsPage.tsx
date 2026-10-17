import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Search, Settings2, Plug, Shield, MessageSquare, FileText, Layers, SlidersHorizontal, ChevronRight, Folder, RefreshCw, Plus, X, AlertCircle, LoaderCircle, RotateCcw, Save, CheckCircle2, Eye, Pencil } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Configuration, ConfigScope, ConfigValue, Instruction, Preferences, Probe, Session, State } from './types'
import './settings.css'
const SettingsFeature = React.lazy(() => import('./Workbench').then(m => ({default:m.Workbench})))

const api = window.workspace
const sections = [
  { id: 'general', title: '常规', icon: Settings2, group: '应用', description: '应用偏好、Claude 安装与配置目录', keywords: '字体 路径 cli 通知 提醒 提示音 长任务' },
  { id: 'connection', title: '连接与模型', icon: Plug, group: 'Claude', description: '连接本机 Claude，管理模型与服务配置', keywords: 'api token key sonnet opus haiku 认证 推理' },
  { id: 'permissions', title: '权限与目录', icon: Shield, group: 'Claude', description: '决定 Claude 可以使用哪些工具与工作目录', keywords: '工具 allow ask deny 允许 拒绝 模式' },
  { id: 'responses', title: '回复偏好', icon: MessageSquare, group: 'Claude', description: '设置回复语言、表达风格和 Git 署名', keywords: 'language output attribution git 提交 PR' },
  { id: 'instructions', title: '项目说明与规则', icon: FileText, group: '项目', description: '为 Claude 编写项目约定与长期协作说明', keywords: 'CLAUDE.md 记忆 markdown rules 指令' },
  { id: 'memory', title: '记忆', icon: FileText, group: '项目', description: '控制自动记忆，并编辑当前项目的记忆文件', keywords: 'memory 记忆文件 自动' },
  { id: 'advanced', title: '上下文与历史', icon: SlidersHorizontal, group: '高级', description: '管理上下文自动压缩和原生会话保留', keywords: '压缩 token 历史 保留 清理' },
  { id: 'sources', title: '配置来源', icon: Layers, group: '高级', description: '查看配置位置、继承关系和当前聊天的覆盖', keywords: '全局 项目 个人 备份 继承 managed JSON' },
] as const
export type SettingsSection = typeof sections[number]['id']
const scopeLabels: Record<ConfigScope, string> = { app: '仅本应用', user: '全局个人', local: '项目个人', project: '项目共享' }
const scopeDescriptions: Record<ConfigScope, string> = { app: '只影响通过此应用发起的调用。', user: '影响本机各项目的 Claude Code。', local: '只影响你的当前项目，保存时会加入 Git 忽略。', project: '可随项目提交给团队共享。' }
const pretty = (v: ConfigValue | undefined) => v == null ? 'Claude 默认' : Array.isArray(v) ? `${v.length} 条规则` : typeof v === 'boolean' ? v ? '开启' : '关闭' : String(v)
const emptyChanges: Record<ConfigScope, Record<string, ConfigValue>> = { app: {}, user: {}, local: {}, project: {} }
type Props = { state: State; session: Session; probe: Probe | null; onProbe(): Promise<void>; onClose(): void; onError(error: unknown): void; initialSection?: SettingsSection }

function Row({ title, description, children, note, id }: {title: string; description?: React.ReactNode; children: React.ReactNode; note?: React.ReactNode; id?: string}) {
  return <div className="setting-row"><div className="setting-label">{id ? <label htmlFor={id}>{title}</label> : <strong>{title}</strong>}{description && <p>{description}</p>}{note && <small>{note}</small>}</div><div className="setting-control">{children}</div></div>
}
function Group({ title, children, caption }: {title: string; children: React.ReactNode; caption?: string}) {
  return <section className="setting-group"><h2>{title}</h2><div className="setting-card">{children}</div>{caption && <p className="group-caption">{caption}</p>}</section>
}
function Toggle({ value, onChange, label }: { value: boolean; onChange(v: boolean): void; label: string }) {
  return <button type="button" className={`setting-switch ${value ? 'on' : ''}`} role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)}><span/></button>
}

export function SettingsPage({ state, session, probe, onProbe, onClose: closeParent, onError, initialSection = 'general' }: Props) {
  const afterClose = useRef<(() => void) | null>(null)
  const finishClose = () => { const next = afterClose.current; afterClose.current = null; closeParent(); next?.() }
  const [section, setSection] = useState<SettingsSection>(initialSection)
  const [scope, setScope] = useState<ConfigScope>('app')
  const [search, setSearch] = useState('')
  const [config, setConfig] = useState<Configuration | null>(null)
  const [changes, setChanges] = useState(structuredClone(emptyChanges))
  const [preferences, setPreferences] = useState<Preferences>({ ...state.preferences })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [issue, setIssue] = useState('')
  const [preview, setPreview] = useState<'config' | 'app' | 'instruction' | ''>('')
  const [confirmExit, setConfirmExit] = useState(false)
  const [instructions, setInstructions] = useState<Instruction[]>([])
  const [document, setDocument] = useState<Instruction | null>(null)
  const [documentText, setDocumentText] = useState('')
  const [readPreview, setReadPreview] = useState(false)
  const [ruleName, setRuleName] = useState('')
  const [newRule, setNewRule] = useState(false)
  const [ruleScope, setRuleScope] = useState<'user' | 'project'>('project')
  const [newEntry, setNewEntry] = useState({ mode: 'allow', value: '' })
  const [switchDoc, setSwitchDoc] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const latest = useRef(0)
  const previousPreferences = useRef(state.preferences)
  const sectionInfo = sections.find(s => s.id === section)!
  const preferenceChanges = Object.fromEntries(Object.entries(preferences).filter(([k, v]) => v !== state.preferences[k as keyof Preferences]))
  const documentDirty = !!document && documentText !== document.content
  const changedCount = Object.values(changes).reduce((n, values) => n + Object.keys(values).length, 0)
  const [childDirty, setChildDirty] = useState(false)
  const dirty = childDirty || changedCount > 0 || Object.keys(preferenceChanges).length > 0 || documentDirty
  const activeChanges = changes[scope]
  const source = config?.sources[scope]
  const inherited = (key: string) => config?.origins[key]?.join('、') || 'Claude 默认'
  const owned = (key: string): ConfigValue => Object.hasOwn(activeChanges, key) ? activeChanges[key] : source?.values[key] ?? null
  const locked = (key: string) => config?.sources.managed.values[key] != null && !Array.isArray(config.sources.managed.values[key])
  const setValue = (key: string, value: ConfigValue) => setChanges(old => {
    const next = { ...old[scope] }
    if (JSON.stringify(source?.values[key] ?? null) === JSON.stringify(value)) delete next[key]; else next[key] = value
    return { ...old, [scope]: next }
  })
  const fail = (error: unknown) => { setIssue(error instanceof Error ? error.message : String(error)); setFeedback('') }
  const perform = async (fn: () => Promise<unknown>) => { setIssue(''); try { await fn() } catch (e) { fail(e) } }

  async function reload() {
    const generation = ++latest.current
    const [snapshot, files] = await Promise.all([api.config(session.id), api.instructions(session.id)])
    if (generation === latest.current) { setConfig(snapshot); setInstructions(files) }
  }
  useEffect(() => {
    setLoading(true)
    void reload().catch(fail).finally(() => setLoading(false))
    return () => { latest.current++ }
  }, [session.id])
  useEffect(() => { contentRef.current?.scrollTo(0, 0) }, [section])
  useEffect(() => {
    const before = previousPreferences.current, after = state.preferences
    setPreferences(draft => {
      const next = { ...draft }
      for (const key of Object.keys(after) as (keyof Preferences)[]) {
        const value = after[key]
        if (draft[key] === before[key] && value !== undefined) Object.assign(next, {[key]:value})
      }
      return next
    })
    previousPreferences.current = after
  }, [JSON.stringify(state.preferences)])
  useEffect(() => {
    const close = (event: Event) => { afterClose.current = (event as CustomEvent).detail?.afterClose || null; if (dirty) setConfirmExit(true); else finishClose() }
    window.addEventListener('settings:request-close', close)
    return () => window.removeEventListener('settings:request-close', close)
  }, [dirty])
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPreview(''); setConfirmExit(false); setNewRule(false); setSwitchDoc(null) }
    }; window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle)
  }, [])

  async function loadInstruction(id: string) { const file = await api.readInstruction(session.id, id); setDocument(file); setDocumentText(file.content || ''); setReadPreview(false) }
  function pickInstruction(id: string) { if (documentDirty) setSwitchDoc(id); else void perform(() => loadInstruction(id)) }
  async function save() {
    setSaving(true); setIssue('')
    try {
      if (preview === 'app') {
        if (preferences.configDir !== state.preferences.configDir && changedCount) throw new Error('请先保存或放弃其他配置修改，再更换配置目录。')
        await api.preferences(preferenceChanges)
        if (preferences.configDir !== state.preferences.configDir) { setDocument(null); setDocumentText('') }
        await reload(); setFeedback('应用设置已保存，新聊天会使用新的默认值。')
      } else if (preview === 'instruction' && document) {
        const result = await api.saveInstruction(session.id, { id: document.id, revision: document.revision!, content: documentText })
        await loadInstruction(document.id); await reload(); setFeedback(result.backup ? '说明已保存，原文件已自动备份。' : '说明文件已创建。')
      } else if (source) {
        const result = await api.saveConfig(session.id, { scope, revision: source.revision, changes: activeChanges })
        setChanges(old => ({ ...old, [scope]: {} })); await reload()
        setFeedback(result.backup ? '设置已保存，原文件已自动备份。后续调用生效。' : '设置已保存，后续调用生效。')
      }
      setPreview('')
    } catch (e) { setPreview(''); fail(e) }
    finally { setSaving(false) }
  }
  function field(key: string, title: string, description: string, options?: {values?: Record<string,string>; type?: string; placeholder?: string; min?: number; max?: number}) {
    const value = owned(key), id = `setting-${key}`, managed = locked(key)
    const note = managed ? '组织管理 · 此项只读' : value === null ? `继承 · ${inherited(key)}` : `${scopeLabels[scope]}覆盖${Object.hasOwn(activeChanges, key) ? ' · 未保存' : ''}`
    return <Row key={key} id={id} title={title} description={description} note={note}>
      {options?.values ? <select id={id} value={value == null ? '__inherit__' : String(value)} disabled={managed} onChange={e => setValue(key, e.target.value === '__inherit__' ? null : e.target.value)}><option value="__inherit__">继承配置</option>{Object.entries(options.values).map(([v,t]) => <option key={v} value={v}>{t}</option>)}</select>
        : <input id={id} type={options?.type || 'text'} min={options?.min} max={options?.max} disabled={managed} value={value == null ? '' : String(value)} placeholder={options?.placeholder || `继承：${pretty(config?.resolved[key])}`} onChange={e => setValue(key, e.target.value === '' && !key.startsWith('attribution.') ? null : e.target.value)}/>}
      {value !== null && !managed && <button className="inherit-button" title="移除此处覆盖，继承配置" aria-label={`${title}恢复继承`} onClick={() => setValue(key, null)}><RotateCcw size={13}/></button>}
    </Row>
  }
  const filteredSections = sections.filter(s => `${s.title} ${s.description} ${s.keywords}`.toLowerCase().includes(search.toLowerCase()))
  const running = session.messages.some(m => m.status === 'running')
  const showScope = ['permissions','responses','memory','advanced'].includes(section)
  return <div className="settings-layout">
    <aside className="settings-nav"><div className="settings-nav-title"><h1>设置</h1><button aria-label="返回聊天" title="返回聊天" onClick={() => dirty ? setConfirmExit(true) : finishClose()}><ArrowLeft size={17}/></button></div><div className="settings-search"><Search size={16}/><input aria-label="搜索设置" placeholder="搜索设置" value={search} onChange={e => setSearch(e.target.value)}/></div><nav aria-label="设置分类">{['应用','Claude','项目','高级'].map(group => <div className="settings-nav-group" key={group}>{filteredSections.some(s=>s.group===group) && <p>{group}</p>}{filteredSections.filter(s=>s.group===group).map(s => <button key={s.id} className={section===s.id?'selected':''} onClick={()=>{if(section===s.id)return;if(childDirty&&!window.confirm('有尚未保存的修改。放弃修改并切换分类？'))return;setChildDirty(false);setSection(s.id);setIssue('')}}><s.icon size={16}/><span>{s.title}</span>{s.id==='instructions'&&documentDirty&&<i/>}</button>)}</div>)}{!filteredSections.length&&<p className="settings-no-results">没有找到相关设置</p>}</nav><div className="settings-nav-bottom"><Folder size={14}/><span title={session.cwd}>{session.cwd.split(/[\\/]/).at(-1)}</span><small>本机工作区</small></div></aside>
    <div className="settings-main" ref={contentRef}><div className="settings-inner">
      <header className="settings-page-header"><h1>{sectionInfo.title}</h1><p>{sectionInfo.description}</p></header>
      {showScope && <div className="scope-bar"><div><Layers size={16}/><label htmlFor="config-scope">保存范围</label><select id="config-scope" value={scope} onChange={e=>{setScope(e.target.value as ConfigScope);setIssue('')}}>{Object.entries(scopeLabels).map(([v,t])=><option key={v} value={v}>{t}{Object.keys(changes[v as ConfigScope]).length?' · 未保存':''}</option>)}</select></div><span>{scopeDescriptions[scope]}</span></div>}
      {loading && <div className="settings-loading"><LoaderCircle size={19} className="spin"/>读取本机配置…</div>}
      {issue && <div className="settings-alert" role="alert"><AlertCircle size={17}/><div>{issue}</div><button title="关闭提示" onClick={()=>setIssue('')}><X size={14}/></button></div>}
      {feedback && <div className="settings-success" role="status"><CheckCircle2 size={16}/>{feedback}<button title="关闭提示" onClick={()=>setFeedback('')}><X size={14}/></button></div>}
      {source?.error && showScope && <div className="settings-alert"><AlertCircle size={17}/>{source.error}</div>}

      {section==='general'&&<>
        <Group title="Claude Code"><Row title="安装状态" description={probe?.version || '正在检测安装…'}><span className={`connection-pill ${probe?.loggedIn?'connected':''}`}><i/>{probe?probe.loggedIn?'已登录':'未登录':'检测中'}</span><button className="setting-action" onClick={()=>void perform(onProbe)}><RefreshCw size={14}/>重新检测</button></Row><Row id="cli-path" title="可执行文件" description="留空自动查找本机 Claude。可指定原生程序或 CLI 脚本。"><input id="cli-path" placeholder="自动检测" value={preferences.cliPath} onChange={e=>setPreferences({...preferences,cliPath:e.target.value})}/></Row><Row id="config-dir" title="Claude 配置目录" description="留空沿用 CLAUDE_CONFIG_DIR 或用户 .claude 目录。"><input id="config-dir" value={preferences.configDir||''} placeholder={config?.configHome||'使用默认位置'} onChange={e=>setPreferences({...preferences,configDir:e.target.value})}/><button title="选择配置目录" aria-label="选择配置目录" className="setting-action icon-only" onClick={()=>void perform(async()=>{const p=await api.folder();if(p)setPreferences({...preferences,configDir:p})})}><Folder size={15}/></button></Row></Group>
        <Group title="任务完成提醒" caption="仅提醒本次运行达到指定时长的主任务；子代理单独完成、手动停止和历史消息不会触发。失败时会明确提示执行失败。">
          <Row title="完成提示音" description="长任务结束时播放一次系统提示音。"><Toggle label="完成提示音" value={preferences.completionSound!==false} onChange={v=>setPreferences({...preferences,completionSound:v})}/></Row>
          <Row title="桌面通知" description="应用在后台，或任务属于其他聊天时显示通知；点击通知返回对应聊天。"><Toggle label="桌面通知" value={preferences.completionNotification!==false} onChange={v=>setPreferences({...preferences,completionNotification:v})}/></Row>
          <Row id="completion-min-seconds" title="长任务时长" description="运行达到此时长才提醒，避免短回复频繁打扰。"><select id="completion-min-seconds" value={preferences.completionMinSeconds??60} onChange={e=>setPreferences({...preferences,completionMinSeconds:Number(e.target.value)})}><option value={30}>30 秒</option><option value={60}>1 分钟</option><option value={180}>3 分钟</option><option value={300}>5 分钟</option></select></Row>
        </Group>
        <Group title="外观"><Row title="界面主题" description="与聊天工作区一致的深色外观。"><span className="theme-swatch"/>深色</Row><Row id="font-size" title="聊天字号" description="调整回复和消息输入的文字大小。"><select id="font-size" value={preferences.fontSize||'14'} onChange={e=>setPreferences({...preferences,fontSize:e.target.value})}>{[13,14,15,16,17,18].map(n=><option key={n} value={String(n)}>{n} px</option>)}</select></Row></Group>

      </>}

      {section==='connection'&&<React.Suspense fallback={<p>正在读取配置…</p>}><SettingsFeature session={session} initial="providers" host="settings" hideHeader onDirtyChange={setChildDirty} onClose={finishClose}/></React.Suspense>}
      {section==='permissions'&&config&&<>
        <Group title="执行权限">{field('permissions.defaultMode','默认权限模式','新聊天与未指定权限模式的调用使用此配置；当前聊天在输入区单独调整。',{values:{default:'标准权限',acceptEdits:'允许编辑',plan:'计划模式',auto:'自动审查',bypassPermissions:'完全访问',dontAsk:'拒绝所有需确认的操作'}})}<Row title="逐次权限审批" description="需要确认的工具、用户提问和计划会在聊天中显示，支持逐次确认与原生允许的会话授权。修改连接或配置会重新建立会话连接。"><span className="read-only-tag">已接入</span></Row></Group>
        {state.preferences.permission&&<Group title="旧版新聊天覆盖" caption="这是旧版本留下的独立权限默认值，优先于上面的配置。移除后，新聊天会继承所选配置；已有聊天不变。"><Row title="旧版权限覆盖" description={state.preferences.permission}><button className="setting-action" onClick={()=>void perform(async()=>{await api.preferences({permission:''});setFeedback('旧版权限默认值已移除，新聊天会继承权限配置。')})}>移除旧版权限覆盖</button></Row></Group>}
        <Group title="工具规则" caption="规则按拒绝 → 询问 → 允许处理。不同文件的规则会合并，移除此处的规则不会删除其他来源的规则。">
          <div className="rules-header"><span>规则</span><span>行为</span><span/></div>
          {(['deny','ask','allow'] as const).flatMap(mode=>((owned(`permissions.${mode}`) as string[]|null)||[]).map((rule,index)=><div className="permission-rule" key={`${mode}-${index}`}><code>{rule}</code><span className={`rule-mode ${mode}`}>{{allow:'允许',ask:'询问',deny:'拒绝'}[mode]}</span><button title="移除规则" aria-label={`移除规则 ${rule}`} onClick={()=>setValue(`permissions.${mode}`,((owned(`permissions.${mode}`) as string[])||[]).filter((_,i)=>i!==index))}><X size={14}/></button></div>))}
          {!['allow','ask','deny'].some(m=>(owned(`permissions.${m}`) as string[]|null)?.length)&&<div className="rules-empty">此范围没有单独配置工具规则，继续继承其他来源。</div>}
          <form className="add-rule" onSubmit={e=>{e.preventDefault();const key=`permissions.${newEntry.mode}`;if(newEntry.value.trim()){setValue(key,[...new Set([...(owned(key) as string[]||[]),newEntry.value.trim()])]);setNewEntry({...newEntry,value:''})}}}><input aria-label="工具规则" placeholder="例如 Bash(npm test *) 或 Read(./src/**)" value={newEntry.value} onChange={e=>setNewEntry({...newEntry,value:e.target.value})}/><select aria-label="规则行为" value={newEntry.mode} onChange={e=>setNewEntry({...newEntry,mode:e.target.value})}><option value="allow">允许</option><option value="ask">询问</option><option value="deny">拒绝</option></select><button className="setting-action" disabled={!newEntry.value.trim()}><Plus size={15}/>添加</button></form>
          <div className="rule-presets"><span>快速添加</span>{[['读取文件','Read'],['搜索文件','Glob'],['搜索内容','Grep']].map(([title,rule])=><button key={rule} onClick={()=>{const key='permissions.allow';setValue(key,[...new Set([...(owned(key) as string[]||[]),rule])])}}>{title}<Plus size={12}/></button>)}<button onClick={()=>['allow','ask','deny'].forEach(m=>setValue(`permissions.${m}`,null))}>恢复继承<RotateCcw size={12}/></button></div>
        </Group>
        <Group title="额外工作目录" caption="这些目录会授予 Claude 额外文件访问权限。"><div className="directory-list">{((owned('permissions.additionalDirectories') as string[]|null)||[]).map((p,i)=><div key={p}><Folder size={15}/><span>{p}</span><button aria-label={`移除目录 ${p}`} onClick={()=>setValue('permissions.additionalDirectories',(owned('permissions.additionalDirectories') as string[]).filter((_,n)=>n!==i))}><X size={14}/></button></div>)}</div><Row title="添加目录" description="默认已包含当前聊天的工作目录。"><button className="setting-action" onClick={()=>void perform(async()=>{const p=await api.folder();if(p)setValue('permissions.additionalDirectories',[...new Set([...(owned('permissions.additionalDirectories') as string[]||[]),p])])})}><Plus size={14}/>选择目录</button>{owned('permissions.additionalDirectories')!==null&&<button title="恢复继承" className="setting-action icon-only" onClick={()=>setValue('permissions.additionalDirectories',null)}><RotateCcw size={14}/></button>}</Row></Group>
        {(state.preferences.allowedTools||state.preferences.disallowedTools)&&<Group title="旧版应用规则" caption="旧版应用规则仍作为命令行参数生效。保存迁移后，可在此移除旧覆盖；不会修改 Claude 文件中的规则。"><Row title="自动允许" description={state.preferences.allowedTools||'未设置'}><button className="setting-action" onClick={()=>void perform(async()=>{await api.preferences({allowedTools:''});setPreferences(p=>({...p,allowedTools:''}));setFeedback('旧版允许规则已移除。')})}>移除旧覆盖</button></Row><Row title="拒绝" description={state.preferences.disallowedTools||'未设置'}><button className="setting-action" onClick={()=>void perform(async()=>{await api.preferences({disallowedTools:''});setPreferences(p=>({...p,disallowedTools:''}));setFeedback('旧版拒绝规则已移除。')})}>移除旧覆盖</button></Row></Group>}
      </>}

      {section==='responses'&&config&&<>
        <Group title="语言与表达">{field('language','回复语言','Claude 默认使用此语言回复，与应用界面语言分别管理。',{placeholder:'例如 中文、English、日本語'})}{field('outputStyle','输出风格','选择内置风格，也可填写已安装的自定义风格名称。',{placeholder:'default、Explanatory、Learning，或自定义名称'})}</Group>

        <Group title="Git 署名" caption="留空字符串可隐藏对应署名；点击右侧恢复按钮则回到继承状态。">{field('attribution.commit','提交署名','Claude 创建提交时附加的署名文本。',{placeholder:'继承 Claude 默认署名'})}{field('attribution.pr','PR 署名','Claude 创建 PR 时附加的署名文本。',{placeholder:'继承 Claude 默认署名'})}</Group>
      </>}

      {section==='memory'&&<>
        <Group title="自动记忆"><Row id="auto-memory" title="自动记忆" description="允许 Claude 跨会话保存协作偏好。实际启用还取决于启动环境。" note={owned('autoMemoryEnabled')===null?`继承 · ${inherited('autoMemoryEnabled')}`:scopeLabels[scope]+'覆盖'}><select id="auto-memory" value={owned('autoMemoryEnabled')===null?'inherit':String(owned('autoMemoryEnabled'))} disabled={locked('autoMemoryEnabled')} onChange={e=>setValue('autoMemoryEnabled',e.target.value==='inherit'?null:e.target.value==='true')}><option value="inherit">继承配置</option><option value="true">开启</option><option value="false">关闭</option></select></Row></Group>
        <React.Suspense fallback={<p>正在读取记忆文件…</p>}><SettingsFeature session={session} initial="documents" documentKind="memory" host="settings" hideHeader onDirtyChange={setChildDirty} onClose={finishClose}/></React.Suspense>
      </>}

      {section==='instructions'&&<>
        <Group title="说明文件" caption="CLAUDE.md 用于持久协作指令。修改保存在所选文件；保存现有文件前自动备份。"><div className="instruction-files">{instructions.map(file=><button key={file.id} className={document?.id===file.id?'selected':''} onClick={()=>pickInstruction(file.id)}><FileText size={17}/><div><strong>{file.title}</strong><small>{file.path}</small></div><span>{file.exists?'已存在':'可创建'}</span><ChevronRight size={15}/></button>)}</div><Row title="路径规则" description="新建规则后，可在文件顶部编写 paths 条件来限定适用文件。"><button className="setting-action" onClick={()=>setNewRule(true)}><Plus size={14}/>新建规则</button></Row></Group>
        {document?<section className="instruction-editor"><div className="editor-heading"><div><h2>{document.title}{documentDirty&&<i/>}</h2><p>{document.path}</p></div><div><button className={!readPreview?'selected':''} onClick={()=>setReadPreview(false)}><Pencil size={13}/>编辑</button><button className={readPreview?'selected':''} onClick={()=>setReadPreview(true)}><Eye size={13}/>预览</button></div></div>{readPreview?<div className="instruction-preview markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{a:({href,children})=><a href={href} onClick={e=>{e.preventDefault();if(href)void api.openLink(href)}}>{children}</a>}}>{documentText||'尚无说明内容。'}</ReactMarkdown></div>:<textarea aria-label="说明内容" value={documentText} spellCheck={false} onChange={e=>setDocumentText(e.target.value)} placeholder="在这里写下项目背景、开发命令、代码约定…"/>}</section>:<div className="settings-placeholder"><FileText size={27}/><p>选择一份说明文件开始编辑</p><span>全局约定、项目说明和个人偏好各自保存。</span></div>}
      </>}

      {section==='advanced'&&config&&<>
        <Group title="上下文">{field('autoCompactWindow','自动压缩窗口','到达此 token 窗口附近时自动压缩，实际值还受模型上下文容量限制。',{type:'number',min:100000,max:1000000,placeholder:'继承 Claude 默认窗口'})}</Group>
        <Group title="本地历史">{field('cleanupPeriodDays','Claude 历史保留天数','GUI 与 Claude CLI 共用原生会话，清理后两处都不再显示对应聊天；项目文件保留。',{type:'number',min:1,max:36500,placeholder:'默认 30 天'})}<Row title="共享聊天记录" description="GUI 与 Claude CLI 共用聊天记录；归档只整理列表，删除聊天会同步删除原生记录，项目文件保留。"><span className="read-only-tag">保存在本机</span></Row></Group>
      </>}

      {section==='sources'&&config&&<>
        <Group title="原生 CLI 连接覆盖（只读）" caption="这些值来自原生 CLI 配置或旧版应用配置，不再提供第二套接入表单。GUI 的供应商、密钥、默认模型和思考档位统一在“连接与模型”管理；订阅模式会隔离网关与模型映射。"><Row title="原生 API 地址" description={pretty(config.resolved['env.ANTHROPIC_BASE_URL'])}><span className="read-only-tag">只读</span></Row><Row title="原生认证信息" description="仅显示是否配置，不显示密钥内容。"><span className="read-only-tag">{config.resolved['env.ANTHROPIC_AUTH_TOKEN']||config.resolved['env.ANTHROPIC_API_KEY']?'已配置':'未配置'}</span></Row><div className="resolved-list">{['model','env.ANTHROPIC_MODEL','env.ANTHROPIC_DEFAULT_OPUS_MODEL','env.ANTHROPIC_DEFAULT_SONNET_MODEL','env.ANTHROPIC_DEFAULT_HAIKU_MODEL','env.CLAUDE_CODE_SUBAGENT_MODEL','effortLevel'].map(key=><div key={key}><code>{key}</code><span>{pretty(config.resolved[key])}</span><small>{inherited(key)}</small></div>)}</div></Group>
        {(state.preferences.model||state.preferences.effort)&&<Group title="旧版新聊天模型覆盖" caption="旧版本留下的启动默认值。移除后，新聊天会采用当前接入的默认模型和思考档位；已有聊天不变。"><Row title="旧版覆盖" description={`模型：${state.preferences.model||'继承'} · 思考：${state.preferences.effort||'继承'}`}><button className="setting-action" onClick={()=>void perform(async()=>{await api.preferences({model:'',effort:''});setFeedback('旧版新聊天模型覆盖已移除。')})}>移除旧版模型覆盖</button></Row></Group>}
        <Group title="配置位置" caption="这里预览本地文件与应用覆盖。组织远程策略、环境变量和模型专属规则仍由 Claude 决定最终结果。">{(['app','user','project','local','managed'] as const).map(key=><Row key={key} title={key==='managed'?'组织管理':scopeLabels[key]} description={<code className="source-path">{config.sources[key].path}</code>} note={config.sources[key].error||undefined}><span className={`source-tag ${config.sources[key].error?'invalid':''}`}>{config.sources[key].error?'格式异常':config.sources[key].exists?key==='managed'?'只读':'已读取':'未创建'}</span></Row>)}</Group>
        <Group title="当前聊天的覆盖" caption="已建立的聊天可能有独立模型、推理强度和权限。移除后将使用后续调用时加载的配置。"><Row title="会话参数" description={`模型：${session.model||'继承'} · 推理：${session.effort||'继承'} · 权限：${session.permission||'继承'}`}><span className="read-only-tag">在聊天输入区调整</span></Row></Group>
        <Group title="来源与继承"><div className="resolved-list">{['language','outputStyle','permissions.defaultMode'].map(key=><div key={key}><code>{key}</code><span>{pretty(config.resolved[key])}</span><small>{inherited(key)}</small></div>)}</div></Group>
        <Group title="备份与检查"><Row title="自动备份" description="保存已有配置或说明前，会备份原始文件。"><button className="setting-action" onClick={()=>void perform(()=>api.openBackups())}><Folder size={14}/>打开备份目录</button></Row><Row title="重新读取配置" description="读取其他客户端或编辑器刚刚保存的改动，不会改写文件。"><button className="setting-action" onClick={()=>void perform(async()=>{if(changedCount||documentDirty)throw new Error('请先保存或放弃当前修改，再重新读取。');await reload();setFeedback('已重新读取配置。')})}><RefreshCw size={14}/>重新读取</button></Row></Group>
      </>}

      <div className="settings-page-end"/>
    </div></div>
    {(Object.keys(activeChanges).length>0&&showScope||Object.keys(preferenceChanges).length>0&&section==='general'||documentDirty&&section==='instructions')&&<div className="settings-savebar"><div><span className="unsaved-dot"/><strong>有未保存的修改</strong><small>{section==='general'?'仅本应用':section==='instructions'?'说明文件':scopeLabels[scope]}</small></div><button onClick={()=>{if(section==='general')setPreferences({...state.preferences});else if(section==='instructions')setDocumentText(document?.content||'');else setChanges(old=>({...old,[scope]:{}}))}}>放弃修改</button><button className="settings-primary" disabled={saving||!!source?.error&&showScope} onClick={()=>setPreview(section==='general'?'app':section==='instructions'?'instruction':'config')}>查看修改并保存<ChevronRight size={14}/></button></div>}

    {preview&&<div className="settings-dialog-overlay"><div role="dialog" aria-modal="true" aria-label="保存修改" className="settings-dialog"><header><h2>保存修改</h2><button aria-label="关闭保存预览" disabled={saving} onClick={()=>setPreview('')}><X size={18}/></button></header><p>{preview==='instruction'?document?.path:preview==='app'?'仅修改本应用设置':source?.path}</p>{preview==='instruction'?<div className="instruction-diff"><strong>新内容</strong><pre>{documentText||'（空文件）'}</pre></div>:<div className="changes-preview">{Object.entries(preview==='app'?preferenceChanges:activeChanges).map(([key,value])=><div key={key}><code>{key}</code><span>{/TOKEN|API_KEY/.test(key)?value===null?'移除此处凭据':'替换认证信息（内容已隐藏）':value===null?'移除此处覆盖，恢复继承':Array.isArray(value)?value.join('\n')||'此处为空列表':String(value)||'（空字符串）'}</span></div>)}</div>}<small>已有文件会自动备份。设置在后续调用生效；正在执行的请求保持原配置。</small><footer><button disabled={saving} onClick={()=>setPreview('')}>继续编辑</button><button className="settings-primary" disabled={saving} onClick={()=>void save()}>{saving?<LoaderCircle size={15} className="spin"/>:<Save size={15}/>}保存修改</button></footer></div></div>}
    {confirmExit&&<div className="settings-dialog-overlay"><div role="dialog" aria-modal="true" aria-label="未保存的修改" className="settings-dialog small"><header><h2>保留正在编辑的内容？</h2></header><p>有设置或说明尚未保存。继续编辑可保留这些修改。</p><footer><button onClick={()=>{afterClose.current=null;setConfirmExit(false)}}>继续编辑</button><button className="settings-primary" onClick={finishClose}>放弃并返回聊天</button></footer></div></div>}
    {switchDoc&&<div className="settings-dialog-overlay"><div role="dialog" aria-modal="true" aria-label="切换说明文件" className="settings-dialog small"><header><h2>当前说明尚未保存</h2></header><p>请先保存当前说明，或放弃修改后切换。</p><footer><button onClick={()=>setSwitchDoc(null)}>继续编辑</button><button onClick={()=>{void perform(()=>loadInstruction(switchDoc));setSwitchDoc(null)}}>放弃并切换</button></footer></div></div>}
    {newRule&&<div className="settings-dialog-overlay"><form role="dialog" aria-modal="true" aria-label="新建规则" className="settings-dialog small" onSubmit={e=>{e.preventDefault();void perform(async()=>{const id=await api.createRule(session.id,{scope:ruleScope,name:ruleName});await reload();if(documentDirty)setSwitchDoc(id);else await loadInstruction(id);setNewRule(false);setRuleName('')})}}><header><h2>新建规则</h2><button type="button" aria-label="关闭新建规则" onClick={()=>setNewRule(false)}><X size={18}/></button></header><label htmlFor="rule-scope">适用范围</label><select id="rule-scope" value={ruleScope} onChange={e=>setRuleScope(e.target.value as 'user'|'project')}><option value="project">当前项目</option><option value="user">所有项目</option></select><label htmlFor="rule-name">规则名称</label><input id="rule-name" autoFocus placeholder="例如 coding-style.md" value={ruleName} onChange={e=>setRuleName(e.target.value)}/><footer><button type="button" onClick={()=>setNewRule(false)}>取消</button><button className="settings-primary" disabled={!ruleName.trim()}>创建规则</button></footer></form></div>}
  </div>
}
