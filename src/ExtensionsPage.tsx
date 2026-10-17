import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Puzzle, Sparkles, Plug, Store, Search, RefreshCw, ArrowLeft, ArrowUpRight, Download, X, CheckCircle2, LoaderCircle, Plus, Layers, FileText, SlidersHorizontal } from 'lucide-react'
import type { CatalogItem, CatalogResult, ExtensionPreview, ExtensionsState, InstalledPlugin, Session } from './types'
import './extensions.css'
const ExtensionFeature=lazy(()=>import('./Workbench').then(m=>({default:m.Workbench})))
const api = window.workspace
const scopes: Record<string, string> = { user: '全局个人', local: '项目个人', project: '项目共享' }
const visibility: Record<string, string> = { on: '开启', 'name-only': '仅显示名称', 'user-invocable-only': '仅手动调用', off: '关闭' }
type View = 'plugins' | 'skills' | 'mcp' | 'markets' | 'mods' | 'agents' | 'workflows' | 'hooks'
export type ExtensionView=View
type Detail = { item?: CatalogItem; preview?: ExtensionPreview; skillText?: string; plugin?: InstalledPlugin; mcp?: boolean; title: string }

export function ExtensionsPage({ session, onClose, initialView='plugins' }: { session: Session; onClose(): void; initialView?:View }) {
  const [view, setView] = useState<View>(initialView), [data, setData] = useState<ExtensionsState | null>(null)
  const [source, setSource] = useState('official'), [catalog, setCatalog] = useState<CatalogResult | null>(null)
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [detail, setDetail] = useState<Detail | null>(null)
  const [installScope, setInstallScope] = useState('local'), [serverName, setServerName] = useState(''), [serverConfig, setServerConfig] = useState('')
  const [marketRepo, setMarketRepo] = useState(''), [addingMarket, setAddingMarket] = useState(false)
  const [childDirty,setChildDirty]=useState(false),[featureRevision,setFeatureRevision]=useState(0)
  const canLeave=()=>!childDirty||window.confirm('有尚未保存的扩展修改。放弃修改并离开？')
  const selectView=(next:View)=>{if(next===view||!canLeave())return;setChildDirty(false);setView(next);setError('');setNotice('')}
  const close=()=>onClose()
  useEffect(()=>{const guard=(event:Event)=>{if(!canLeave())event.preventDefault()};window.addEventListener('extensions:request-close',guard);return()=>window.removeEventListener('extensions:request-close',guard)},[childDirty])
  const catalogRequest = useRef(0), detailRequest = useRef(0)
  const report = (e: unknown) => setError(e instanceof Error ? e.message : String(e))
  async function refresh() { try { setData(await api.extensions(session.id)) } catch (e) { report(e) } }
  async function browse(selected = source, search = query, cursor = '', refreshCache = false) {
    const request = ++catalogRequest.current
    setLoading(true); setError('')
    try {
      const result = await api.extensionCatalog(session.id, selected, search, cursor, refreshCache)
      if (catalogRequest.current === request) setCatalog(old => cursor && old ? { ...result, items: [...old.items, ...result.items] } : result)
    } catch (e) { if (catalogRequest.current === request) report(e) }
    finally { if (catalogRequest.current === request) setLoading(false) }
  }
  useEffect(() => { void refresh(); return () => { catalogRequest.current++; detailRequest.current++ } }, [session.id])
  useEffect(() => { if (view === 'markets') { setQuery(''); setCatalog(null); void browse(source, '') } else { catalogRequest.current++; setLoading(false) } }, [view, source])
  async function mutate(action: string, payload: Record<string, unknown>, message = '已保存，下次发送消息时生效。') {
    if (busy) return false
    setBusy(true); setError(''); setNotice('')
    try { const result = await api.extensionMutation(session.id, action, payload); setNotice(message || String(result || '操作完成')); await refresh(); return true }
    catch (e) { report(e); return false }
    finally { setBusy(false) }
  }
  async function selectItem(item: CatalogItem) {
    const request = ++detailRequest.current
    setError(''); setInstallScope(item.kind === 'skill' ? 'project' : 'local'); setDetail({ item, title: item.name })
    setServerName(item.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+/, '').slice(0, 60) || 'my-server')
    setServerConfig(JSON.stringify(item.config || { type: 'stdio', command: '', args: [] }, null, 2))
    try { const preview = await api.extensionPreview(session.id, item.id); if (detailRequest.current === request) setDetail({ item, preview, title: item.name }) }
    catch (e) { if (detailRequest.current === request) report(e) }
  }
  function closeDetail() { if (busy) return; detailRequest.current++; setDetail(null); setError('') }
  async function install() {
    if (!detail) return
    if (detail.mcp || detail.item?.kind === 'mcp') {
      let config
      try { config = JSON.parse(serverConfig) } catch { setError('连接配置不是有效 JSON'); return }
      if (await mutate('mcp-add', { name: serverName, config, scope: installScope })) closeDetail()
    } else if (detail.item && detail.preview) {
      if (await mutate('install', { itemId: detail.item.id, revision: detail.preview.revision, scope: installScope })) closeDetail()
    }
  }
  async function removePlugin() {
    if (detail?.plugin && await mutate('plugin', { id: detail.plugin.id, action: 'uninstall', scope: detail.plugin.scope })) closeDetail()
  }
  const entries = catalog?.items.filter(item => !query || source === 'mcp-registry' || `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())) || []
  const headings: Record<View, string> = { agents:'Agents',workflows:'工作流',hooks:'Hooks',mods:'Mods', plugins: '插件', skills: 'Skills', mcp: 'MCP 服务器', markets: '浏览市场' }
  const descriptions: Record<View, string> = { agents:'管理项目与个人子代理定义；在聊天运行设置中选择使用。',workflows:'管理项目与个人工作流脚本；在聊天中通过 /名称 调用。',hooks:'管理工具与会话事件钩子，并查看最近执行记录。',mods:'管理和试用本地 Mods，应用到当前聊天。', plugins: '管理 Claude 原生插件。插件可以包含 Skills、代理、Hooks 和 MCP。', skills: '查看本地技能、调整调用方式，或从公开来源安装。', mcp: '管理 user、project、local 作用域的服务器；插件自带 MCP 随插件管理。检测连接时才会启动或连接服务。', markets: '公开目录无需登录；具体扩展可能需要授权、运行依赖或付费。' }
  return <div className="extensions-layout">
    <aside className="extensions-sidebar"><div className="extensions-sidebar-title"><button aria-label="返回聊天" onClick={close}><ArrowLeft size={18}/></button><strong>扩展</strong></div>
      <nav aria-label="扩展分类">{([{ id: 'plugins', label: '插件', icon: Puzzle }, { id: 'skills', label: 'Skills', icon: Sparkles }, { id: 'agents', label: 'Agents', icon: Layers }, { id: 'workflows', label: '工作流', icon: FileText }, { id: 'mcp', label: 'MCP', icon: Plug }, { id: 'hooks', label: 'Hooks', icon: SlidersHorizontal }, { id: 'mods', label: 'Mods', icon: Puzzle }, { id: 'markets', label: '市场', icon: Store }] as const).map(tab => <button key={tab.id} className={view === tab.id ? 'selected' : ''} onClick={() => selectView(tab.id)}><tab.icon size={17}/>{tab.label}</button>)}</nav>
      <div className="extensions-sidebar-note">当前项目<span title={session.cwd}>{session.cwd.split(/[\\/]/).at(-1)}</span><small>通过 Claude 原生配置接入</small></div>
    </aside>
    <main className="extensions-main"><div className="extensions-content"><header className="extensions-heading"><div><h1>{headings[view]}</h1><p>{descriptions[view]}</p></div><button disabled={busy || loading} aria-label="刷新扩展" onClick={() => { if(!canLeave())return;setChildDirty(false);setFeatureRevision(v=>v+1);void refresh(); if (view === 'markets') void browse(source, query, '', true) }}><RefreshCw size={18} className={loading ? 'spin' : ''}/></button></header>
      {notice && <div className="extensions-notice" role="status"><CheckCircle2 size={16}/><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={14}/></button></div>}
      {error && !detail && <div className="extensions-error" role="alert">{error}</div>}
      {data?.errors.map((e, i) => <div key={i} className="extensions-error">{e}</div>)}
      {!data && !['mods','agents','workflows','hooks'].includes(view) && <div className="extensions-empty"><LoaderCircle size={20} className="spin"/>读取本地扩展…</div>}
      {['mods','agents','workflows','hooks'].includes(view)&&<Suspense fallback={<p>正在读取扩展配置…</p>}><ExtensionFeature key={`${view}:${featureRevision}`} session={session} initial={view==='mods'?'mods':view==='hooks'?'hooks':'documents'} documentKind={view==='agents'?'agents':view==='workflows'?'workflows':undefined} host="extensions" hideHeader onDirtyChange={setChildDirty} onClose={close}/></Suspense>}
      {view === 'plugins' && data && <>
        <div className="extensions-section-heading"><span>已安装 · {data.plugins.length}</span><button onClick={() => setView('markets')}><Plus size={15}/>浏览市场</button></div>
        {!data.plugins.length && <div className="extensions-empty"><Puzzle size={29}/><strong>还没有安装插件</strong><span>从官方或社区市场浏览，安装前查看来源和作用域。</span><button className="ext-primary" onClick={() => setView('markets')}>浏览市场</button></div>}
        {data.plugins.map(p => <article className="extension-row" key={p.id + p.scope}><Puzzle size={20}/><div><h3>{p.name}<small>{p.enabled ? '已启用' : '已停用'}</small></h3><p>{p.id} · {p.version || '版本未报告'} · {scopes[p.scope]}</p></div><div className="extension-actions"><button disabled={busy} onClick={() => void mutate('plugin', { id: p.id, action: p.enabled ? 'disable' : 'enable', scope: p.scope })}>{p.enabled ? '停用' : '启用'}</button><button disabled={busy} onClick={() => void mutate('plugin', { id: p.id, action: 'update', scope: p.scope })}>更新</button><button disabled={busy} onClick={() => setDetail({ plugin: p, title: '卸载 ' + p.name })}>卸载</button></div></article>)}
      </>}
      {view === 'skills' && data && <>
        <div className="extensions-section-heading"><span>本地与插件技能 · {data.skills.length}</span><button onClick={() => { setSource('anthropic-skills'); setView('markets') }}><Download size={15}/>寻找 Skills</button></div>
        {!data.skills.length && <div className="extensions-empty"><Sparkles size={29}/><strong>尚未发现 Skills</strong><span>扫描用户、项目 skills 目录及已启用插件。</span></div>}
        {data.skills.map(s => <article className="extension-row" key={s.id}><Sparkles size={20}/><div><h3>/{s.name}</h3><p>{s.description || '本地 Skill'}</p><small>{s.plugin ? '来自插件 ' + s.plugin : scopes[s.scope]} · {s.path}</small></div><div className="extension-actions"><button disabled={busy} onClick={() => void api.skillContent(session.id, s.id).then(skillText => setDetail({ skillText, title: s.name })).catch(report)}>查看内容</button>{s.plugin ? <span className="extension-tag">随插件管理</span> : <select aria-label={`${s.name} 调用方式`} disabled={busy} value={s.visibility} onChange={e => void mutate('skill-visibility', { id: s.id, visibility: e.target.value })}>{Object.entries(visibility).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>}</div></article>)}
      </>}
      {view === 'mcp' && data && <>
        <div className="extensions-section-heading"><span>已配置 · {data.mcp.length}</span><div><button onClick={() => { setSource('mcp-registry'); setView('markets') }}>浏览 Registry</button><button onClick={() => { setDetail({ mcp: true, title: '添加 MCP 服务器' }); setInstallScope('local'); setServerName(''); setServerConfig('{\n  "type": "http",\n  "url": "https://example.com/mcp"\n}') }}><Plus size={15}/>手动添加</button></div></div>
        {!data.mcp.length && <div className="extensions-empty"><Plug size={29}/><strong>还没有配置 MCP 服务器</strong><span>从官方 Registry 选择，或添加 stdio / HTTP / SSE 配置。</span></div>}
        {data.mcp.map(m => <article className="extension-row" key={m.name + m.scope}><Plug size={20}/><div><h3>{m.name}<small>{m.disabled ? '项目中已停用' : '已配置 · 尚未检测连接'}</small></h3><p>{m.transport} · {scopes[m.scope]} · {m.address}</p>{m.envKeys.length > 0 && <small>环境变量：{m.envKeys.join('、')}</small>}</div><div className="extension-actions"><button disabled={busy} onClick={() => void mutate('mcp', { name: m.name, scope: m.scope, action: m.disabled ? 'enable' : 'disable' })}>{m.disabled ? '启用' : '停用'}</button><button disabled={busy} onClick={() => void mutate('mcp', { name: m.name, scope: m.scope, action: 'test' }, '')}>检测连接</button><button disabled={busy} onClick={() => setDetail({ title: '移除 ' + m.name, item: { id: m.name, kind: 'mcp', name: m.name, source: m.scope, version: '', description: 'remove', homepage: '' } })}>移除</button></div></article>)}
      </>}
      {view === 'markets' && data && <>
        <div className="market-sources" aria-label="市场来源">{data.markets.map(m => <button key={m.id} className={source === m.id ? 'selected' : ''} onClick={() => setSource(m.id)}>{m.title}</button>)}<button className={source === 'mcp-registry' ? 'selected' : ''} onClick={() => setSource('mcp-registry')}>MCP Registry</button><button onClick={() => setAddingMarket(!addingMarket)}><Plus size={14}/>添加来源</button></div>
        {addingMarket && <form className="market-add" onSubmit={e => { e.preventDefault(); void mutate('market-add', { repo: marketRepo }, '公开市场来源已添加。').then(ok => { if (ok) { setMarketRepo(''); setAddingMarket(false) } }) }}><input aria-label="GitHub 市场仓库" placeholder="owner/repository（main 分支）" value={marketRepo} onChange={e => setMarketRepo(e.target.value)}/><button disabled={busy || !marketRepo.trim()}>添加公开市场</button></form>}
        <form className="extensions-search" onSubmit={e => { e.preventDefault(); void browse() }}><Search size={17}/><input aria-label="搜索扩展市场" placeholder={source === 'mcp-registry' ? '输入名称并搜索 MCP Registry…' : '搜索当前市场…'} value={query} onChange={e => setQuery(e.target.value)}/><button disabled={loading}>搜索</button></form>
        <div className="extensions-section-heading"><span>{loading ? '正在读取公开目录…' : `${entries.length} 个条目`}</span><small>{catalog && `更新于 ${new Date(catalog.fetchedAt).toLocaleTimeString()}`}</small></div>
        <div className="extension-grid">{entries.map((item, i) => <article className="extension-tile" key={item.id + i}><header>{item.kind === 'mcp' ? <Plug size={21}/> : item.kind === 'skill' ? <Sparkles size={21}/> : <Puzzle size={21}/>}<span className="extension-tag">{item.kind === 'skill' ? 'Skill' : item.kind === 'mcp' ? 'MCP' : '插件'}</span></header><h3>{item.name}</h3><p>{item.description}</p><footer><small>{item.version || item.source}</small><button aria-label={`查看 ${item.name}`} disabled={busy} onClick={() => void selectItem(item)}>查看<ArrowUpRight size={14}/></button></footer></article>)}</div>
        {!loading && !entries.length && <div className="extensions-empty">{error ? '暂时无法读取市场，请重试或切换来源。' : '没有匹配的条目。'}</div>}
        {catalog?.nextCursor && <button className="extensions-more" disabled={loading} onClick={() => void browse(source, query, catalog.nextCursor)}>加载更多</button>}
      </>}
    </div></main>
    {detail && <div className="extension-overlay"><section className="extension-detail" role="dialog" aria-modal="true" aria-label={detail.title}><header><h2>{detail.title}</h2><button aria-label="关闭扩展详情" disabled={busy} onClick={closeDetail}><X size={19}/></button></header>
      <div className="extension-detail-body">
        {detail.item && detail.item.description !== 'remove' && <><p>{detail.item.description}</p><div className="extension-detail-source">{detail.item.source}{detail.item.homepage && <button onClick={() => void api.openLink(detail.item!.homepage).catch(report)}>来源页面<ArrowUpRight size={13}/></button>}</div></>}
        {detail.plugin && <p>从{scopes[detail.plugin.scope]}卸载此插件，保留插件数据目录。</p>}
        {detail.item?.description === 'remove' && <p>从{scopes[detail.item.source]}移除此服务器配置。</p>}
        {(detail.mcp || detail.item?.kind === 'mcp' && detail.item.description !== 'remove') ? <>
          <p className="extension-detail-hint">检查服务地址、参数和环境变量引用后添加。添加配置不会自动验证服务鉴权，也不保证服务免费。</p>
          <label>服务器名称<input aria-label="MCP 服务器名称" value={serverName} onChange={e => setServerName(e.target.value)}/></label>
          <label>连接配置<textarea aria-label="MCP 连接配置" value={serverConfig} onChange={e => setServerConfig(e.target.value)} spellCheck={false}/></label>
          {!detail.mcp && !detail.item?.config && <p>该条目没有可自动转换的连接配置，请根据来源说明填写。</p>}
        </> : detail.skillText != null || detail.preview?.kind === 'skill' ? <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} onClick={e => { e.preventDefault(); if (href) void api.openLink(href).catch(report) }}>{children}</a> }}>{detail.skillText ?? detail.preview?.text ?? ''}</ReactMarkdown></div>
          : detail.preview ? <details open><summary>安装清单</summary><pre>{detail.preview.text}</pre></details> : detail.item && detail.item.description !== 'remove' ? <p>正在读取安装清单…</p> : null}
        {error && <div className="extensions-error" role="alert">{error}</div>}
      </div>
      <footer>{!detail.plugin && detail.skillText == null && detail.item?.description !== 'remove' && <label>安装范围<select aria-label="扩展安装范围" value={installScope} disabled={busy} onChange={e => setInstallScope(e.target.value)}>{Object.entries(scopes).filter(([key]) => detail.item?.kind !== 'skill' || key !== 'local').map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label>}
        <button disabled={busy} onClick={closeDetail}>关闭</button>
        {detail.plugin ? <button className="ext-danger" disabled={busy} onClick={() => void removePlugin()}>确认卸载</button>
          : detail.item?.description === 'remove' ? <button className="ext-danger" disabled={busy} onClick={() => void mutate('mcp', { name: detail.item!.name, scope: detail.item!.source, action: 'remove' }).then(ok => { if (ok) closeDetail() })}>确认移除</button>
            : detail.skillText == null && <button className="ext-primary" disabled={busy || (!detail.mcp && !detail.preview)} onClick={() => void install()}>{busy && <LoaderCircle size={14} className="spin"/>}{busy ? '处理中…' : detail.mcp || detail.item?.kind === 'mcp' ? '添加服务器' : '安装'}</button>}
      </footer>
    </section></div>}
  </div>
}
