import type { GatewayRetry, NativeCommand } from './types'
import type { SettingsSection } from './SettingsPage'
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {LargeContent,LazyThought} from './LargeContent'
import { MousePointer2, Globe, Home, History, Settings, Folder, Plus, SquarePen, Search, PanelLeft, ArrowUp, Square, ChevronDown, ChevronRight, ChevronLeft, GitBranch, X, Minus, Maximize2, Paperclip, FileText, Image as ImageIcon, Shield, ShieldCheck, Monitor, Zap, Archive, Gauge, SlidersHorizontal, CircleHelp, Check, Copy, Terminal, Brain, RefreshCw, MoreHorizontal, ExternalLink, Command, LoaderCircle, AlertCircle, CheckCircle2, FolderOpen, RotateCcw, Puzzle, Pin } from 'lucide-react'
import type { Attachment, BrowserContext, TopologyDraft, Message, Preferences, Probe, Session, Skill, State, Tool } from './types'
import './styles.css'
import {CommandMenu,type SlashEntry} from './CommandMenu'
import {commandPurpose, visibleCommands, visibleSuggestion} from './command-presentation'
import {AgentActivity} from './AgentActivity'
import {AgentProgress} from './AgentProgress'
import {ChangeSummaryCard} from './ChangeSummaryCard'
import type {ChangesRequest} from './ChangesPanel'
import {isAgentTool} from './agent-cards'
import {QuickMemory} from './QuickMemory'
import {appendQuickMemory,isQuickMemory,type MemoryScope} from './quick-memory'
import {UsageMeter,UsageDetails,tokenTotal} from './UsageMeter'
import { SettingsPage } from './SettingsPage'
import { ApprovalCard } from './ApprovalCard'
import { ExtensionsPage, type ExtensionView } from './ExtensionsPage'
import type { WorkTab } from './Workbench'
import type {ProjectAction} from './ProjectContextMenu'
const ProjectPicker=React.lazy(()=>import('./ProjectPicker').then(m=>({default:m.ProjectPicker})))
const ProjectContextMenu=React.lazy(()=>import('./ProjectContextMenu').then(m=>({default:m.ProjectContextMenu})))
import type {ChatAction} from './ChatContextMenu'
const ChatContextMenu=React.lazy(()=>import('./ChatContextMenu').then(m=>({default:m.ChatContextMenu})))
import { ModelPicker, ModelButton } from './ProvidersPage'
import './workbench.css'
const TopologyPanel = React.lazy(() => import('./TopologyPanel').then(module=>({default:module.TopologyPanel})))
const BrowserPanel = React.lazy(() => import('./BrowserPanel').then(module=>({default:module.BrowserPanel})))
const Workbench = React.lazy(() => import('./Workbench').then(module => ({default:module.Workbench})))

const api = window.workspace
const leaf = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) || p
const permissionNames: Record<string, string> = { '': '继承配置', default: '标准权限', acceptEdits: '允许编辑', plan: '计划模式', auto: '自动审查', dontAsk: '仅预授权', bypassPermissions: '完全访问' }
const effortNames: Record<string, string> = { '': '继承', none:'关闭', minimal:'极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高' }
const permissionHints: Record<string, string> = { auto:'由 Claude 原生分类器审查操作；可用性受模型、登录和组织策略限制。', dontAsk:'仅运行已预授权的工具，其他需要确认的操作直接拒绝。', '': '使用当前项目与 Claude 配置中的权限模式。', default: '沿用工具规则；需要确认时，在聊天中批准或拒绝。', acceptEdits: '自动允许普通文件编辑，其他操作仍受权限检查。', plan: '先阅读项目与制定计划，确认计划后继续执行。', bypassPermissions: '跳过大部分权限审批；原生规则与交互要求仍然有效。' }
type Menu = 'actions' | 'project' | '' | 'commands' | 'files' | 'model' | 'permission' | 'attach' | 'session'
type Modal = '' | 'settings' | 'status' | 'usage' | 'help' | 'rename' | 'resume'
type Draft = { text: string; attachments: Attachment[];browserContexts:BrowserContext[];topologyRequests:TopologyDraft[] }
const emptyDraft: Draft = { text: '', attachments: [],browserContexts:[],topologyRequests:[] }

function Mark({ small = false }: { small?: boolean }) {
  return <span className={`claude-mark ${small ? 'small' : ''}`} aria-hidden="true">✳</span>
}
const browserToolNames:Record<string,string>=Object.fromEntries(Object.entries({navigate:'打开网页',inspect:'检查页面',click:'点击元素',type:'输入内容',press:'按键',scroll:'滚动页面',screenshot:'截取页面',diagnostics:'检查控制台与网络',back:'网页后退',reload:'刷新网页'}).map(([key,value])=>['mcp__workspace_browser__'+key,'浏览器 · '+value]))
function ToolCard({ tool }: { tool: Tool }) {
  const [open, setOpen] = useState(false)
  return <div className={`tool-card ${tool.status}`}>
    <button className="tool-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
      {tool.status === 'waiting' ? <Shield size={15}/> : tool.status === 'running' ? <LoaderCircle size={15} className="spin"/> : tool.status === 'error' ? <AlertCircle size={15}/> : <Check size={15}/>}
      <span>{browserToolNames[tool.name]||tool.name}</span><span className="tool-hint">{tool.status === 'waiting' ? '等待确认' : tool.status === 'running' ? '执行中' : tool.status === 'stopped' ? '已停止' : tool.status === 'error' ? '执行失败' : '已完成'}</span><ChevronRight size={14} className={open ? 'rotated' : ''}/>
    </button>
    {open && <div className="tool-detail"><label>输入</label><LargeContent text={tool.input || '无参数'}/>{tool.output && <><label>结果</label><LargeContent text={tool.output}/></>}</div>}
  </div>
}
function ToolGroup({ tools }: { tools: Tool[] }) {
  const [open, setOpen] = useState(false)
  if (!tools.length) return null
  if (tools.length === 1) return <ToolCard tool={tools[0]}/>
  const active = tools.find(t => t.status === 'waiting') || tools.find(t => t.status === 'running')
  const errors = tools.filter(t => t.status === 'error').length
  const status = active?.status || (errors ? 'error' : tools.some(t => t.status === 'stopped') ? 'stopped' : 'done')
  return <div className={`tool-card tool-group ${status}`}>
    <button className="tool-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
      {status === 'waiting' ? <Shield size={15}/> : status === 'running' ? <LoaderCircle size={15} className="spin"/> : errors ? <AlertCircle size={15}/> : <Check size={15}/>}
      <span>工具调用 · {tools.length} 次</span><span className="tool-hint">{active ? `${browserToolNames[active.name] || active.name} · ${status === 'waiting' ? '等待确认' : '执行中'}` : errors ? `${errors} 次失败` : status === 'stopped' ? '已停止' : '已完成'}</span><ChevronRight size={14} className={open ? 'rotated' : ''}/>
    </button>
    {open && <div className="tool-group-items">{tools.map(tool => <ToolCard key={tool.id} tool={tool}/>)}</div>}
  </div>
}
function RetryNotice({items}: {items:GatewayRetry[]}) {
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),500);return()=>clearInterval(timer)},[])
  const retry=items.find(item=>item.phase==='waiting')||items[0]
  if(!retry)return null
  const reason=retry.reason==='turn'?`调用失败 · ${(retry.errorType||'').slice(0,180)}`:retry.reason==='pending'?'等待上游有效响应':retry.reason==='upstream'?`上游响应错误${retry.errorType?' · '+retry.errorType:retry.status?' · '+retry.status:''}`:retry.reason==='routing'?'本地线路冷却或路由不可用':retry.reason==='http'?`上游 HTTP ${retry.status}`:retry.reason==='timeout'?'上游请求超时':'上游网络连接失败'
  const retryLabel=retry.reason==='turn'?'额外重试':'重试'
  const seconds=Math.max(0,Math.ceil(((retry.nextAt||now)-now)/1000))
  const elapsed=retry.startedAt?Math.max(0,Math.floor((now-retry.startedAt)/1000)):0,remaining=retry.timeoutAt?Math.max(0,Math.ceil((retry.timeoutAt-now)/1000)):0
  return <div className="gateway-retry" role="status" aria-live="polite"><RefreshCw size={12} className={retry.phase==='attempting'?'spin':''}/><span>{reason} · {retry.reason==='pending'?`已等待 ${elapsed} 秒${retry.attempt?` · 第 ${retry.attempt}/${retry.maxRetries} 次重试`:''}`:retry.reason==='routing'?`等待 ${seconds} 秒后请求`:retry.phase==='waiting'&&seconds>0?`${seconds} 秒后${retryLabel} ${retry.attempt}/${retry.maxRetries}`:`正在${retryLabel} ${retry.attempt}/${retry.maxRetries}`}{retry.timeoutAt?` · 本次超时剩余 ${remaining} 秒`:''}{retry.providerName?` · ${retry.providerName} / ${retry.keyName}`:''}{items.length>1?` · 另有 ${items.length-1} 个请求等待响应或重试`:''}</span></div>
}
type AnswerVersion = {sessionId:string;messageId:string}
function MessageView({ message, sessionId, disabled, canRegenerate, retry = false, versions, onVersion, onBranch, onRegenerate, onChanges, onOpenLink }: { message: Message; sessionId: string; disabled:boolean;canRegenerate:boolean;retry?:boolean;versions:AnswerVersion[];onVersion(version:AnswerVersion):void;onBranch():void;onRegenerate():void;onChanges():void; onOpenLink(url:string):void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => { await navigator.clipboard.writeText(message.text); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const usage = message.usage
  const versionIndex=versions.findIndex(v=>v.sessionId===sessionId)
  return <article className={`message ${message.role}`} data-message-id={message.id}>
    {message.role === 'assistant' && <div className="message-avatar"><Mark small/></div>}
    <div className="message-body">
      {message.attachments?.length ? <div className="message-attachments">{message.attachments.map(a => <span key={a.id} title={a.path}>{a.preview ? <img src={a.preview} alt={a.name}/> : <FileText size={15}/>} {a.name}</span>)}</div> : null}
      {message.topologySelection&&<details className="topology-message-context"><summary>业务拓扑选区 · {message.topologySelection.requests.map(r=>r.summary).join('、')}</summary><pre>{message.topologySelection.context}</pre></details>}
      {message.browserContexts?.map((c,i)=><details className="browser-context" key={i}><summary>网页元素 · {c.tag} · {c.text.slice(0,60)||c.selector}</summary><pre>{JSON.stringify(c,null,2)}</pre></details>)}
      {message.thinking && <LazyThought text={message.thinking}/>}
      <div className="markdown"><LargeContent text={message.text} markdown onOpenLink={onOpenLink}/></div>
      <ToolGroup tools={message.tools.filter(tool=>!isAgentTool(tool))}/>
      {message.approvals?.map(card => <ApprovalCard key={card.id} card={card} sessionId={sessionId}/>)}
      <AgentActivity message={message} sessionId={sessionId} renderTools={tools=><ToolGroup tools={tools}/>} onOpenLink={onOpenLink}/>
      {message.changes?.files.length?<ChangeSummaryCard changes={message.changes} onOpen={onChanges}/>:null}
      {message.hooks?.length ? <details className="run-telemetry"><summary>Hooks · {message.hooks.length} 条事件</summary>{message.hooks.map((h,i)=><pre key={i}>{h.name} · {h.type}{'\n'}{h.output}</pre>)}</details> : null}
      {message.structured != null && <details className="run-telemetry" open><summary>结构化结果</summary><pre>{JSON.stringify(message.structured,null,2)}</pre><button onClick={() => void navigator.clipboard.writeText(JSON.stringify(message.structured,null,2))}>复制 JSON</button></details>}
      {message.status==='running'&&message.agentProgress&&!message.approvals?.some(c=>c.status==='pending')&&!message.gatewayRetries?.length&&<AgentProgress progress={message.agentProgress}/>}
      {message.status === 'running' && (!message.agentProgress||message.approvals?.some(c=>c.status==='pending')) && (!message.gatewayRetries?.length||message.approvals?.some(c=>c.status==='pending')) && <div className={`working ${message.approvals?.some(c => c.status === 'pending') ? 'approval-waiting' : ''}`}><span className="pulse-dot"/>{message.approvals?.some(c => c.status === 'pending') ? '等待你的确认' : message.text || message.tools.length ? '继续处理中' : 'Claude 正在思考'}<span className="working-dots">…</span></div>}
      {message.changeError&&<div className="notice">文件变更预览：{message.changeError}</div>}
      {message.notice && <div className="notice"><CircleHelp size={14}/>{message.notice}</div>}
      {!!message.imageReferences&&<div className="gateway-route">为兼容当前模型，图片已转为文件路径引用，未直接发送图片内容。</div>}
      {message.gatewayRoute&&<div className="gateway-route" title={`实际上游模型：${message.gatewayRoute.model}`}>{message.gatewayRoute.providerName} · {message.gatewayRoute.keyName}</div>}
      {message.status==='running'&&!!message.gatewayRetries?.length&&<RetryNotice items={message.gatewayRetries}/>}
      {message.error && <div className="error-box"><AlertCircle size={16}/><div><span>{/522|Connection timed out/i.test(message.error) ? '模型服务连接超时（522）。请稍后发送消息重试，当前会话已保留。' : message.error.length > 350 ? message.error.slice(0, 250) + '…' : message.error}</span>{message.error.length > 350 && <details className="error-details"><summary>查看完整错误</summary><pre>{message.error}</pre></details>}</div></div>}
      {message.status === 'stopped' && <div className="notice">已停止 · 已完成的工作与会话会保留</div>}
      {message.role==='user'&&<div className="checkpoint-actions message-inline-actions"><button title="从这里创建分支" aria-label="从这里创建分支" disabled={disabled} onClick={onBranch}><GitBranch size={14}/></button></div>}
      {message.role === 'assistant' && message.status !== 'running' && <div className="message-footer"><button title="复制回复" aria-label="复制回复" onClick={() => void copy()}>{copied ? <Check size={14}/> : <Copy size={14}/>}</button><button title="从这里创建分支" aria-label="从这里创建分支" disabled={disabled} onClick={onBranch}><GitBranch size={14}/></button><button title={retry?'在当前会话重试，不创建新的聊天文件':'生成新的回答版本，保留旧回答；不会回退项目文件'} aria-label={retry?'重试':'重新生成'} disabled={disabled||!canRegenerate} onClick={onRegenerate}><RotateCcw size={14}/></button>{versions.length>1&&<div className="answer-versions" role="group" aria-label="回答版本"><button aria-label="上一个回答版本" title="上一个回答版本" disabled={disabled||versionIndex<=0} onClick={()=>onVersion(versions[versionIndex-1])}><ChevronLeft size={13}/></button><span>{versionIndex+1} / {versions.length}</span><button aria-label="下一个回答版本" title="下一个回答版本" disabled={disabled||versionIndex<0||versionIndex>=versions.length-1} onClick={()=>onVersion(versions[versionIndex+1])}><ChevronRight size={13}/></button></div>}<span>{message.model || ''}</span>{usage && <span>{tokenTotal(usage).toLocaleString()} tokens{usage.duration ? ` · ${(usage.duration / 1000).toFixed(1)}s` : ''}</span>}</div>}
    </div>
  </article>
}

function App() {
  const [state, setState] = useState<State | null>(null)
  const [probe, setProbe] = useState<Probe | null>(null)
  const [toast, setToast] = useState('')
  const [menu, setMenu] = useState<Menu>('')
  const [modal, setModal] = useState<Modal>('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (Object.values(drafts).some(d => d.text.trim() || d.attachments.length)) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [drafts])
  const [files, setFiles] = useState<string[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [filter, setFilter] = useState('')
  const [searchVisible, setSearchVisible] = useState(false)
  const [archived, setArchived] = useState(false)
  const [sidebar, setSidebar] = useState(true)
  const [busy, setBusy] = useState(false)
  const [memoryScope,setMemoryScope]=useState<MemoryScope>('project')
  const answerFocus=useRef<AnswerVersion|null>(null)
  const [menuIndex, setMenuIndex] = useState(0)
  const [actionSearch,setActionSearch]=useState(''),[commandCatalog,setCommandCatalog]=useState<{id:string;items:NativeCommand[]}|null>(null),[commandsLoading,setCommandsLoading]=useState(false),[commandIssue,setCommandIssue]=useState(''),[commandRevision,setCommandRevision]=useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [extensionsOpen, setExtensionsOpen] = useState(false)
  const [extensionsView,setExtensionsView]=useState<ExtensionView>('plugins')
  const [settingsSection,setSettingsSection] = useState<SettingsSection>('general')
  const [plansOpen,setPlansOpen] = useState(false)
  const [workTab, setWorkTab] = useState<WorkTab | 'browser' | 'topology' | null>(null)
  const [topologyExpanded,setTopologyExpanded]=useState(true)
  const [changesRequest,setChangesRequest]=useState<ChangesRequest|undefined>(undefined)
  const [browserRequest,setBrowserRequest]=useState<{id:string;sessionId:string;url:string}|null>(null)
  const [chatContext,setChatContext]=useState<{id:string;x:number;y:number}|null>(null)
  const [projectContext,setProjectContext]=useState<{cwd:string;x:number;y:number}|null>(null)
  const [renameProject,setRenameProject]=useState<string|null>(null)
  const [renameId,setRenameId]=useState<string|null>(null)
  const [rename, setRename] = useState('')
  const [resumeId, setResumeId] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null), scrollRef = useRef<HTMLDivElement>(null), stickToEnd = useRef(true), lastScrollTop = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const error = (e: unknown) => { setToast(e instanceof Error ? e.message : String(e)); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 7000) }
  const run = async (fn: () => Promise<unknown>) => { try { await fn() } catch (e) { error(e) } }
  const checkClaude = async () => { try { setProbe(await api.probe()) } catch (e) { error(e) } }
  useEffect(() => {
    if (!api) { error('请通过桌面应用打开：npm start'); return }
    const unsubscribe = api.subscribe(setState)
    void run(async () => setState(await api.get())); void checkClaude()
    return unsubscribe
  }, [])
  const session = state?.sessions.find(s => s.id === state.activeId)
  const draft = session ? drafts[session.id] || emptyDraft : emptyDraft
  const running = session?.messages.some(m => m.status === 'running') || false
  useEffect(() => {
    if (!session) return
    setChatContext(null);setProjectContext(null);setMenu(''); setFiles([]); setSkills([])
    let cancelled = false
    void api.projectFiles(session.id).then(v => { if (!cancelled) setFiles(v) }).catch(error)
    void api.skills(session.id).then(v => { if (!cancelled) setSkills(v) }).catch(error)
    return () => { cancelled = true }
  }, [session?.id, session?.cwd])
  useEffect(()=>{
    if(menu!=='commands'||!session)return
    let active=true;setCommandsLoading(true);setCommandIssue('')
    void api.commands(session.id).then(items=>{if(active)setCommandCatalog({id:session.id,items})}).catch(e=>{if(active)setCommandIssue(e.message)}).finally(()=>{if(active)setCommandsLoading(false)})
    return()=>{active=false}
  },[menu,session?.id,commandRevision])
  const chatVisible=!settingsOpen&&!extensionsOpen&&!plansOpen
  useLayoutEffect(()=>{
    if(!chatVisible)return
    stickToEnd.current=true
    const el=scrollRef.current
    if(el)el.scrollTop=el.scrollHeight
  },[session?.id,chatVisible])
  useLayoutEffect(() => { if (stickToEnd.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [session?.messages,chatVisible])
  useEffect(()=>{
    const el=scrollRef.current,content=el?.firstElementChild
    if(!chatVisible||!el||!content)return
    // Markdown, images and panel resizing may change height after React commits.
    const observer=new ResizeObserver(()=>{if(stickToEnd.current)el.scrollTop=el.scrollHeight})
    observer.observe(content);observer.observe(el)
    return()=>observer.disconnect()
  },[session?.id,chatVisible,!!session?.messages.length])
  useEffect(()=>{const target=answerFocus.current;if(!target||target.sessionId!==session?.id)return;const node=Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]')).find(el=>el.dataset.messageId===target.messageId);if(node){stickToEnd.current=false;node.scrollIntoView({block:'center'});answerFocus.current=null}},[session?.id,session?.messages])
  useEffect(() => {
    if (menu !== 'files' || !session) return
    let cancelled = false
    void api.projectFiles(session.id).then(v => { if (!cancelled) setFiles(v) }).catch(error)
    return () => { cancelled = true }
  }, [menu, session?.id])
  useEffect(() => { if (inputRef.current) { inputRef.current.style.height = 'auto'; inputRef.current.style.height = `${Math.min(180, Math.max(54, inputRef.current.scrollHeight))}px` } }, [draft.text])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!settingsOpen&&!extensionsOpen&&!plansOpen&&!modal){if(workTab==='topology')setTopologyExpanded(false);e.preventDefault();setActionSearch('');setMenuIndex(0);setMenu('actions');return}
      if(e.key==='Escape'&&menu){e.preventDefault();setMenu('');return}
      if(chatContext||projectContext){if(e.key==='Escape'){e.preventDefault();setChatContext(null);setProjectContext(null)}return}
      if(workTab==='topology'&&e.key==='Escape'){const floating=document.querySelector<HTMLButtonElement>('[aria-label="收起拓扑批注窗口"]');if(floating){e.preventDefault();floating.click();return}}
      if ((workTab||plansOpen) && e.key === 'Escape') {closeWorkbench();return}
      if (extensionsOpen && e.key === 'Escape') { if (!document.querySelector('.extension-overlay')) closeExtensions(); return }
      if (settingsOpen && e.key === 'Escape') return
      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !settingsOpen && !extensionsOpen && !workTab && !plansOpen) { e.preventDefault(); void run(() => api.create(session?.cwd)) }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); openSettings() }
      if (e.key === 'Escape') { if (modal) setModal(''); else if (menu) setMenu(''); else if (running && session) void run(() => api.stop(session.id)) }
    }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [session?.id, running, menu, modal, settingsOpen, extensionsOpen, workTab, plansOpen, chatContext, projectContext])

  function setDraft(patch: Partial<Draft>, id = session?.id) { if (id) setDrafts(old => ({ ...old, [id]: { ...(old[id] || emptyDraft), ...patch } })) }
  function closeWorkbench(afterClose?:()=>void) {const event=new CustomEvent('workbench:request-close',{cancelable:true,detail:{afterClose}});window.dispatchEvent(event);if(!event.defaultPrevented){setWorkTab(null);setPlansOpen(false);afterClose?.()}}
  function openSettings() { openSettingsAt('general') }
  function openSettingsAt(section:SettingsSection) {
    if(!allowExtensionsClose())return
    const show=()=>{setPlansOpen(false);setWorkTab(null);setExtensionsOpen(false);setSettingsSection(section);setSettingsOpen(true);setModal('');setMenu('')}
    if(workTab||plansOpen)closeWorkbench(show);else if(settingsOpen)window.dispatchEvent(new CustomEvent('settings:request-close',{detail:{afterClose:show}}));else show()
  }
  function openWorkbench(tab:WorkTab|'browser'|'topology'='runtime',afterOpen?:()=>void) {
    if(!allowExtensionsClose())return
    const next=()=>{setPlansOpen(false);setSettingsOpen(false);setExtensionsOpen(false);setMenu('');setModal('');setWorkTab(tab);if(tab==='browser'&&!afterOpen)setBrowserRequest(null);afterOpen?.()}
    if(settingsOpen)window.dispatchEvent(new CustomEvent('settings:request-close',{detail:{afterClose:next}}));else if(workTab||plansOpen)closeWorkbench(next);else next()
  }
  function openChanges(messageId?:string,restore=false){
    if(!session)return
    openWorkbench('diff',()=>setChangesRequest({sessionId:session.id,messageId,restore,nonce:Date.now()}))
  }
  function locateMessage(id:string){
    const element=Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]')).find(el=>el.dataset.messageId===id)
    if(element){stickToEnd.current=false;element.scrollIntoView({block:'center',behavior:'smooth'})}
  }
  function openChatLink(url:string) {
    try{const parsed=new URL(url);if(!['http:','https:','file:'].includes(parsed.protocol))throw new Error('支持 HTTP / HTTPS 或当前项目的本地 HTML 链接');if(!session)return;const request={id:crypto.randomUUID(),sessionId:session.id,url:parsed.href};openWorkbench('browser',()=>setBrowserRequest(request))}catch(e){setToast(e instanceof Error?e.message:String(e))}
  }
  function openPlans() {
    if(!allowExtensionsClose())return
    const show=()=>{setWorkTab(null);setSettingsOpen(false);setExtensionsOpen(false);setMenu('');setPlansOpen(true)}
    if(settingsOpen)window.dispatchEvent(new CustomEvent('settings:request-close',{detail:{afterClose:show}}));else if(workTab||plansOpen)closeWorkbench(show);else show()
  }
  function allowExtensionsClose(){if(!extensionsOpen)return true;const e=new Event('extensions:request-close',{cancelable:true});window.dispatchEvent(e);return !e.defaultPrevented}
  function closeExtensions() { if(!allowExtensionsClose())return false;setExtensionsOpen(false); if (session) void api.skills(session.id).then(setSkills).catch(error);return true }
  function openExtensions(view:ExtensionView='plugins') {
    if(extensionsOpen)return
    setExtensionsView(view)
    if(workTab||plansOpen){closeWorkbench(()=>{setPlansOpen(false);setExtensionsOpen(true);setMenu('');setModal('')});return}
    setWorkTab(null)
    setMenu(''); setModal('')
    if (settingsOpen) window.dispatchEvent(new CustomEvent('settings:request-close', { detail: { afterClose: () => setExtensionsOpen(true) } }))
    else setExtensionsOpen(true)
  }
  function closeSettings() { window.dispatchEvent(new Event('settings:request-close')) }
  function changeChat(action:()=>Promise<unknown>) { const next=()=>void run(action);if(workTab)closeWorkbench(next);else next() }
  function answerVersions(messageId:string):AnswerVersion[]{
    if(!state||!session)return []
    const origin=session.regeneration?.answerId===messageId?session.regeneration.origin:{sessionId:session.id,messageId}
    const root=state.sessions.find(s=>s.id===origin.sessionId)
    const siblings=state.sessions.filter(s=>s.regeneration?.answerId&&s.regeneration.origin.sessionId===origin.sessionId&&s.regeneration.origin.messageId===origin.messageId).sort((a,b)=>a.createdAt-b.createdAt)
    return [...(root?[{sessionId:root.id,messageId:origin.messageId}]:[]),...siblings.map(s=>({sessionId:s.id,messageId:s.regeneration!.answerId}))]
  }
  function selectAnswerVersion(version:AnswerVersion){changeChat(async()=>{answerFocus.current=version;try{await api.select(version.sessionId)}catch(e){answerFocus.current=null;throw e}})}
  function messageAction(messageId:string,action:'branch'|'regenerate'){
    if(!session||busy||running)return
    const id=session.id
    changeChat(async()=>{setBusy(true);try{if(action==='branch')await api.branchMessage(id,messageId);else await api.regenerate(id,messageId);setArchived(false);inputRef.current?.focus()}finally{setBusy(false)}})
  }
  async function chooseProject() { const cwd = await api.folder(); if (cwd) await api.create(cwd) }
  async function patchSession(patch: Partial<Session>) { if (session) await api.update(session.id, patch); setMenu('') }
  function chooseComposerProject(cwd?:string){
    if(cwd===session?.cwd){setMenu('');return}
    if(workTab)closeWorkbench(()=>void applyComposerProject(cwd));else void applyComposerProject(cwd)
  }
  async function applyComposerProject(cwd?:string){
    if(!session||running||busy)return
    const sourceId=session.id
    setBusy(true)
    try{
      const target=cwd||await api.folder();if(!target)return
      const next=await api.changeProject(sourceId,target)
      if(next.id!==sourceId)setDrafts(old=>{const copy={...old,[next.id]:old[sourceId]||emptyDraft};delete copy[sourceId];return copy})
      setArchived(false);setMenu('');inputRef.current?.focus()
    }catch(e){error(e)}finally{setBusy(false)}
  }
  function projectAction(cwd:string,action:ProjectAction){
    setProjectContext(null)
    const target=state?.sessions.find(s=>s.cwd===cwd),settings=state?.projectSettings?.[cwd]||{}
    if(action==='new'){changeChat(()=>api.create(cwd));return}
    if(action==='workspace'){changeChat(async()=>{if(target)await api.select(target.id);else await api.create(cwd);setWorkTab('workspace')});return}
    if(action==='rename'){setRenameProject(cwd);setRenameId(null);setRename(settings.name||leaf(cwd));setModal('rename');return}
    if(action==='pin'){void run(()=>api.updateProject(cwd,{pinned:!settings.pinned}));return}
    if(action==='collapse'){void run(()=>api.updateProject(cwd,{collapsed:!settings.collapsed}));return}
    if(action==='copy'){void run(async()=>{await navigator.clipboard.writeText(cwd);setToast('项目路径已复制')});return}
    if(action==='folder'){void run(()=>api.openProject(cwd));return}
    if(action==='archive'){if(window.confirm(`${archived?'取消归档':'归档'}项目“${settings.name||leaf(cwd)}”内的全部聊天？`))void run(()=>api.archiveProject(cwd,!archived));return}
    if(action==='remove'){if(window.confirm('从侧栏移除此项目？聊天记录和项目文件都会保留，可通过“添加项目”重新显示。'))void run(()=>api.updateProject(cwd,{hidden:true}));return}
  }
  function chatAction(target:Session,action:ChatAction){
    setChatContext(null)
    if(action==='rename'){setRenameProject(null);setRenameId(target.id);setRename(target.title);setModal('rename');return}
    if(action==='pin'){void run(()=>api.organize(target.id,{pinned:!target.pinned}));return}
    if(action==='unread'){void run(()=>api.organize(target.id,{unread:!target.unread}));return}
    if(action==='fork'){changeChat(()=>api.fork(target.id));return}
    if(action==='folder'){void run(()=>api.openFolder(target.id));return}
    if(action==='export'){void run(async()=>{const file=await api.exportSession(target.id);if(file)setToast('聊天已导出')});return}
    if(action==='archive'){void run(()=>api.update(target.id,{archived:!target.archived}));return}
    if(action==='delete'){
      const d=drafts[target.id],unsaved=d&&(d.text.trim()||d.attachments.length)?'此聊天还有未发送的草稿。\n':''
      if(!window.confirm(`${unsaved}删除聊天“${target.title}”？将同时删除 Claude CLI 对应的会话记录及本应用关联计划，项目里的代码和文件会保留。`))return
      const remove=async()=>{await api.deleteSession(target.id);setDrafts(old=>{const next={...old};delete next[target.id];return next})}
      if(target.id===session?.id)changeChat(remove);else void run(remove)
      return
    }
    void run(async()=>{const source=action==='copy-title'?target:await api.readSession(target.id)
      const content=action==='copy-title'?source.title:source.messages.map(m=>`## ${m.role==='user'?'用户':'Claude'}\n\n${m.text}${m.attachments?.length?'\n\n'+m.attachments.map(a=>a.path).join('\n'):''}`).join('\n\n')
      await navigator.clipboard.writeText(content);setToast(action==='copy-title'?'标题已复制':'聊天内容已复制')})
  }
  function appendAttachments(items: Attachment[], id = session?.id) {
    if (!id) return
    setDrafts(old => { const d = old[id] || emptyDraft; const unique = [...new Map([...d.attachments, ...items].map(a => [a.path, a])).values()]; return { ...old, [id]: { ...d, attachments: unique } } })
  }
  async function addFiles() { const id = session?.id; const items = await api.files(); appendAttachments(items, id); setMenu(''); inputRef.current?.focus() }
  async function importFiles(list: File[]) {
    const id = session?.id
    const items = await Promise.all(list.map(async file => {
      const p = api.pathForFile(file)
      if (p) return { path: p }
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) })
      return { name: file.name, data }
    })); appendAttachments(await api.importFiles(items), id)
  }
  async function saveQuickMemory() {
    if(!session||running||busy)return
    const id=session.id,text=draft.text,scope=memoryScope
    if(!isQuickMemory(text))return
    setBusy(true);setMenu('')
    try{
      const doc=await api.readInstruction(id,scope)
      const result=await api.saveInstruction(id,{id:scope,revision:doc.revision!,content:appendQuickMemory(doc.content||'',text)})
      setDraft({text:''},id)
      setToast(`记忆已保存：${result.path}。后续 CLI 请求加载。`)
    }catch(e){error(e)}finally{setBusy(false);inputRef.current?.focus()}
  }
  async function send(override?: string, literal = false) {
    if (!session || running || busy) return
    if(!literal&&override===undefined&&isQuickMemory(draft.text)){await saveQuickMemory();return}
    const id = session.id, text = override ?? draft.text, items = draft.attachments
    const control=!override&&controls.find(c=>text.trim()==='/'+c.key)
    if(control){setDraft({text:''});setMenu('');await control.action();return}
    if (!text.trim() && !items.length) return
    setBusy(true); setMenu(''); stickToEnd.current = true
    try { await api.send(id, text, items.map(a => a.id),override?[]:draft.browserContexts,override?[]:draft.topologyRequests); if (!override) setDraft({ text: '', attachments: [],browserContexts:[],topologyRequests:[] }, id) }
    catch (e) { error(e) } finally { setBusy(false);if(!document.querySelector('.chat-context-menu'))inputRef.current?.focus() }
  }
  function revealTasks(){
    const cards=Array.from(document.querySelectorAll<HTMLElement>('[data-task-card]'))
    const target=cards.find(c=>c.dataset.taskActive==='true')||cards.at(-1)
    if(!target){setToast('当前聊天暂无代理或后台任务');return}
    const toggle=target.querySelector<HTMLButtonElement>('.agent-activity-summary')
    if(toggle?.getAttribute('aria-expanded')==='false')toggle.click()
    target.scrollIntoView({block:'center',behavior:'smooth'})
  }
  const applicationActions = [
    { key: 'connections', title: '连接与模型', description: '管理服务商连接和模型能力', icon: SlidersHorizontal, action: () => openSettingsAt('connection') },
    { key: 'diff', title: '代码变更', description: '按轮次或整个工作目录查看代码差异', icon: FileText, action: () => openChanges() },
    { key: 'topology', title: '业务拓扑', description: '查看模块关系，选中模块或数据流批注与修改', icon: GitBranch, action: () => openWorkbench('topology') },
    { key: 'workspace', title: '隔离工作区', description: '为项目创建独立 Git 工作区', icon: GitBranch, action: () => openWorkbench('workspace') },
    { key: 'extensions', title: '扩展', description: '插件、Skills、Agents、Hooks 与市场', icon: Puzzle, action: () => openExtensions() },
    { key: 'mcp', title: 'MCP', description: '管理与检测 MCP 服务器', icon: Paperclip, action: () => openExtensions('mcp') },
    { key: 'usage', title: '上下文与用量', description: '查看上下文、缓存与 Token 统计', icon: Gauge, action: () => setModal('usage') },
    { key: 'status', title: '状态', description: '查看安装版本、登录与工作目录', icon: Monitor, action: () => { setModal('status'); void checkClaude() } },
    { key: 'resume', title: '恢复聊天', description: '通过 Claude 会话 ID 继续', icon: History, action: () => { setResumeId(''); setModal('resume') } },
    { key: 'fork', title: '创建聊天分支', description: '从当前会话开始独立的后续聊天', icon: SquarePen, action: () => api.fork(session!.id) },
    { key: 'new', title: '新聊天', description: '在当前项目开始新会话', icon: SquarePen, action: () => api.create(session?.cwd) },
    { key: 'archive', title: session?.archived ? '取消归档' : '归档', description: '整理本地聊天列表', icon: Archive, action: () => patchSession({ archived: !session?.archived }) },
    { key: 'model', title: '模型', description: `当前 ${session?.model || '默认模型'}`, icon: Zap, action: () => setMenu('model') },
    { key: 'effort', title: '推理', description: effortNames[session?.effort || ''], icon: Brain, action: () => setMenu('model') },
    { key: 'fast', title: '快速', description: '在高级运行选项中调整原生快速模式', icon: Zap, action: () => openWorkbench('runtime') },
    { key: 'permissions', title: '权限', description: permissionNames[session?.permission || ''], icon: Shield, action: () => setMenu('permission') },
    { key: 'help', title: '帮助', description: '输入与快捷键', icon: CircleHelp, action: () => setModal('help') },
  ]
  const controls:SlashEntry[]=[
    {key:'model',description:'选择当前聊天的模型',source:'界面',action:()=>setMenu('model')},
    {key:'effort',description:'选择当前模型支持的思考档位',source:'界面',action:()=>setMenu('model')},
    {key:'permissions',description:'切换当前聊天的权限模式',source:'界面',action:()=>setMenu('permission')},
    {key:'config',description:'打开 Claude 与应用设置',source:'界面',action:()=>openSettings()},
    ...['context','cost','usage'].map(key=>({key,description:key==='context'?'读取 CLI 上下文报告':'查看 CLI 返回的 Token、缓存与费用',source:'界面',action:()=>setModal('usage')})),
    {key:'mcp',description:'管理与检测 MCP 服务器',source:'界面',action:()=>openExtensions('mcp')},
    {key:'tasks',description:'展开并定位聊天中的代理与后台任务',source:'界面',action:revealTasks},
    {key:'fast',description:'打开高级运行选项，调整原生快速模式',source:'界面',action:()=>openWorkbench('runtime')},
    {key:'clear',description:'开始新的上下文，保留原聊天和当前接入选择',source:'界面',action:()=>changeChat(()=>api.clear(session!.id))},
    {key:'help',description:'查看当前可用的 Claude 命令和技能',source:'界面',action:()=>{setDraft({text:'/'});setMenu('commands');inputRef.current?.focus()}},
  ].map(c=>({...c,local:true}))
  const discovered=commandCatalog&&commandCatalog.id===session?.id?commandCatalog.items:[]
  const skillCommands=[...new Map([...discovered,...skills.filter(c=>!session?.options?.safeMode&&!discovered.some(n=>n.name===c.name)).map(c=>({...c,argumentHint:''}))].filter(c=>!controls.some(h=>h.key===c.name)).map(c=>[c.name,c])).values()]
  const priority=['code-review','simplify','security-review','init']
  skillCommands.sort((a,b)=>(priority.includes(a.name)?priority.indexOf(a.name):99)-(priority.includes(b.name)?priority.indexOf(b.name):99)||a.name.localeCompare(b.name))
  const commands:SlashEntry[]=[...skillCommands.map(c=>({key:c.name,source:c.source,description:commandPurpose(c),argumentHint:c.argumentHint,action:()=>{setDraft({text:'/'+c.name+' '});inputRef.current?.focus()}})),...controls]
  const commandQuery=draft.text.startsWith('/')?draft.text.slice(1).toLowerCase():''
  const filteredCommands=visibleCommands(commands,commandQuery)
  const filteredActions=applicationActions.filter(c=>(c.key+' '+c.title+' '+c.description).toLowerCase().includes(actionSearch.toLowerCase()))
  const atMatch = /(?:^|\s)@([^\s]*)$/.exec(draft.text)
  const filteredFiles = files.filter(p => p.toLowerCase().includes((atMatch?.[1] || '').toLowerCase())).slice(0, 40)
  async function pickFile(relative: string) {
    if (!session) return
    const a = await api.reference(session.id, relative); appendAttachments([a])
    setDraft({ text: draft.text.replace(/@[^\s]*$/, `@${relative.replace(/\\/g, '/')} `) }); setMenu(''); inputRef.current?.focus()
  }
  function onInput(text: string) {
    setDraft({ text }); setMenuIndex(0)
    if (/^\/[^\s]*$/.test(text)) setMenu('commands')
    else if (/(?:^|\s)@[^\s]*$/.test(text)) setMenu('files')
    else setMenu('')
  }
  function executeCommand(index: number) {
    const command = menu==='actions'?filteredActions[index]:filteredCommands[index]
    if (!command || ('disabled' in command && command.disabled)) return
    if(menu!=='actions')setDraft({text:''});setMenu('');void run(async()=>{await command.action()})
  }
  function onInputKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if(e.key==='Tab'&&e.shiftKey&&!running){e.preventDefault();const modes=['default','acceptEdits','plan'];void run(()=>patchSession({permission:modes[(modes.indexOf(session?.permission||'default')+1)%modes.length]}));return}
    if ((menu === 'commands' || menu === 'files') && ['ArrowDown','ArrowUp','Tab','Enter'].includes(e.key) && !e.shiftKey) {
      const count = menu === 'commands' ? filteredCommands.length : filteredFiles.length
      if (count) {
        e.preventDefault()
        if (e.key === 'ArrowDown') setMenuIndex(i => (i + 1) % count)
        else if (e.key === 'ArrowUp') setMenuIndex(i => (i + count - 1) % count)
        else if(menu==='commands'&&e.key==='Tab'){setDraft({text:'/'+filteredCommands[menuIndex].key+' '});setMenu('')}else if (menu === 'commands') executeCommand(menuIndex); else void run(() => pickFile(filteredFiles[menuIndex]))
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
  }

  if (!state || !session) return <div className="loading"><Mark/><p>{toast || '正在打开工作区…'}</p></div>
  const visible = state.sessions.filter(s => !state.projectSettings?.[s.cwd]?.hidden && s.archived === archived && (!filter || `${s.title} ${s.cwd} ${s.messages.map(m => m.text).join(" ")}`.toLowerCase().includes(filter.toLowerCase())))
  const knownProjects=[...new Set([...state.sessions.map(s=>s.cwd),...Object.keys(state.projectSettings||{})])]
  const groups = [...new Set([...visible.map(s => s.cwd),...(!archived?knownProjects.filter(cwd=>!state.projectSettings?.[cwd]?.hidden&&(!filter||((state.projectSettings?.[cwd]?.name||leaf(cwd))+' '+cwd).toLowerCase().includes(filter.toLowerCase()))):[])])].sort((a,b)=>Number(!!state.projectSettings?.[b]?.pinned)-Number(!!state.projectSettings?.[a]?.pinned))
  const contextSession=state.sessions.find(s=>s.id===chatContext?.id)
  const chatRow=(s:Session)=><button key={s.id} data-chat-id={s.id} className={`session-row ${s.id===session.id?'selected':''} ${s.unread?'unread':''} ${chatContext?.id===s.id?'context-selected':''}`} onClick={()=>changeChat(()=>api.select(s.id))} onContextMenu={e=>{e.preventDefault();setProjectContext(null);setMenu('');setChatContext({id:s.id,x:e.clientX,y:e.clientY})}} onKeyDown={e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();setProjectContext(null);const r=e.currentTarget.getBoundingClientRect();setChatContext({id:s.id,x:r.left+20,y:r.bottom})}}} title={s.title}>{s.pinned&&<Pin size={12}/>}<span>{s.title}</span>{s.unread&&<i className="chat-unread-dot" aria-label="未读"/>}{s.messages.some(m=>m.status==='running')&&<LoaderCircle size={13} className="spin"/>}</button>
  return <div className="app" style={{ '--chat-font-size': `${state.preferences.fontSize || 14}px` } as React.CSSProperties} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!settingsOpen && !extensionsOpen && !workTab && !plansOpen && e.dataTransfer.files.length) void run(() => importFiles(Array.from(e.dataTransfer.files))) }}>
    <header className="titlebar"><div className="titlebar-left"><button title="切换侧栏" aria-label="切换侧栏" onClick={() => setSidebar(!sidebar)}><PanelLeft size={16}/></button><span className="titlebar-label">Claude Workspace</span><button onClick={openSettings}>设置</button><button onClick={() => setModal('help')}>帮助</button></div><div className="window-buttons"><button aria-label="最小化" onClick={() => void api.window('minimize')}><Minus size={16}/></button><button aria-label="最大化" onClick={() => void api.window('maximize')}><Maximize2 size={13}/></button><button aria-label="关闭窗口" onClick={() => void api.window('close')}><X size={17}/></button></div></header>
    <div className="app-content">
      <nav className="rail"><button className={!settingsOpen && !extensionsOpen && !plansOpen && !archived ? 'active' : ''} title="工作区" aria-label="工作区" onClick={() => { if (settingsOpen) closeSettings(); else { if(workTab||plansOpen)closeWorkbench(()=>{if(closeExtensions()){setPlansOpen(false);setArchived(false)}});else{setPlansOpen(false);closeExtensions();setArchived(false)} } }}><Home size={21}/></button><button className={!settingsOpen && !extensionsOpen && !plansOpen && archived ? 'active' : ''} title="已归档" aria-label="已归档" onClick={() => { if (settingsOpen) closeSettings(); else { if(workTab||plansOpen)closeWorkbench(()=>{if(closeExtensions()){setPlansOpen(false);setArchived(true)}});else{setPlansOpen(false);closeExtensions();setArchived(true)} } }}><Archive size={20}/></button><button title="恢复 Claude 会话" aria-label="恢复 Claude 会话" onClick={() => setModal('resume')}><History size={21}/></button><div className="rail-divider"/><button title="计划任务" aria-label="计划任务" className={plansOpen?'active':''} onClick={openPlans}><SlidersHorizontal size={20}/></button><button title="扩展" aria-label="扩展" className={extensionsOpen ? 'active' : ''} onClick={()=>openExtensions()}><Puzzle size={20}/></button><div className="rail-bottom"><button title="设置" aria-label="设置" onClick={openSettings}><Settings size={21}/></button><span className="user-avatar">C</span></div></nav>
      {plansOpen ? <React.Suspense fallback={<div className="loading">正在打开计划任务…</div>}><Workbench session={session} initial="automation" host="page" onClose={()=>setPlansOpen(false)}/></React.Suspense> : extensionsOpen ? <ExtensionsPage key={`${session.id}:${extensionsView}`} initialView={extensionsView} session={session} onClose={closeExtensions}/> : settingsOpen ? <SettingsPage state={state} session={session} probe={probe} onProbe={checkClaude} onClose={() => setSettingsOpen(false)} onError={error} key={settingsSection} initialSection={settingsSection}/> : <>
      {sidebar && <aside className="sidebar"><div className="sidebar-heading"><span className="brand">Claude</span><button title="搜索聊天" aria-label="搜索聊天" onClick={() => setSearchVisible(!searchVisible)}><Search size={18}/></button></div><button className="new-chat" onClick={() => changeChat(() => api.create(session.cwd))}><SquarePen size={17}/>新聊天 <span>Ctrl N</span></button>{searchVisible && <input autoFocus className="sidebar-search" placeholder="搜索聊天或项目" value={filter} onChange={e => setFilter(e.target.value)}/>}
      <div className="session-list">{archived && <div className="section-label">已归档的聊天</div>}{visible.some(s=>s.pinned)&&<section className="project pinned-chats"><div className="section-label">置顶</div>{visible.filter(s=>s.pinned).map(chatRow)}</section>}{groups.map(cwd => {const project=state.projectSettings?.[cwd]||{},name=project.name||leaf(cwd);return <section className="project" key={cwd}>
        <div data-project-path={cwd} className={`project-heading ${cwd===session.cwd?'selected':''} ${projectContext?.cwd===cwd?'context-selected':''}`} title={cwd} onContextMenu={e=>{e.preventDefault();setChatContext(null);setMenu('');setProjectContext({cwd,x:e.clientX,y:e.clientY})}} onKeyDown={e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();setChatContext(null);const r=e.currentTarget.getBoundingClientRect();setProjectContext({cwd,x:r.left+20,y:r.bottom})}}}>
          <button className="project-fold" aria-label={`${project.collapsed?'展开':'折叠'}项目 ${name}`} onClick={()=>void run(()=>api.updateProject(cwd,{collapsed:!project.collapsed}))}><ChevronRight size={13} className={!project.collapsed?'rotated':''}/></button>
          <button className="project-name" onClick={()=>changeChat(()=>visible.some(s=>s.cwd===cwd)?api.select(visible.find(s=>s.cwd===cwd)!.id):api.create(cwd))}><Folder size={17}/><span>{name}</span>{project.pinned&&<Pin size={12}/>}</button>
          <button className="project-add" aria-label={`在 ${name} 新建聊天`} onClick={e=>{e.stopPropagation();changeChat(()=>api.create(cwd))}}><Plus size={14}/></button>
        </div>{!project.collapsed&&visible.filter(s=>s.cwd===cwd&&!s.pinned).map(chatRow)}</section>})}{!visible.length && <div className="sidebar-empty">{filter ? '没有匹配的聊天' : archived?'暂无归档聊天':groups.length?'':'点击添加项目开始'}</div>}</div>
      <button className="add-project" onClick={() => void run(chooseProject)}><Plus size={16}/>添加项目</button><div className="sidebar-status"><span className={`status-dot ${(session.providerId?probe?.path:probe?.loggedIn) ? 'online' : ''}`}/><span>{session.providerId?(probe?.path?'自定义 API · CLI 已就绪':'请检查 CLI 安装'):probe ? probe.loggedIn ? 'Claude 已连接' : 'Claude 未登录' : '检测 Claude…'}</span><button title="连接状态" aria-label="连接状态" onClick={() => setModal('status')}><ChevronRight size={13}/></button></div></aside>}
      <main className="main"><div className="chat-header"><div><span className="breadcrumb">{leaf(session.cwd)}</span>{session.messages.length > 0 && <><ChevronRight size={13}/><span className="chat-title">{session.title}</span></>}</div><div className="chat-actions"><button title="业务拓扑" aria-label="业务拓扑" onClick={()=>openWorkbench("topology")}><GitBranch size={17}/></button><button title="内置浏览器" aria-label="内置浏览器" onClick={()=>openWorkbench("browser")}><Globe size={17}/></button><button title="代码变更" aria-label="代码变更" onClick={() => openChanges()}><FileText size={17}/></button><button title="打开项目目录" aria-label="打开项目目录" onClick={() => void run(() => api.openFolder(session.id))}><FolderOpen size={17}/></button><button title="聊天选项" aria-label="聊天选项" onClick={() => setMenu(menu === 'session' ? '' : 'session')}><MoreHorizontal size={20}/></button></div>{menu === 'session' && <div className="header-menu popover"><button onClick={() => { setRenameProject(null);setRenameId(null);setRename(session.title); setModal('rename'); setMenu('') }}><SquarePen size={16}/>重命名</button><button disabled={running} onClick={() => void run(() => patchSession({ archived: !session.archived }))}><Archive size={16}/>{session.archived ? '取消归档' : '归档聊天'}</button><button onClick={() => { setModal('usage'); setMenu('') }}><Gauge size={16}/>使用情况</button><button disabled={running} onClick={()=>void run(()=>patchSession({model:'',effort:'',permission:''}))}><RefreshCw size={16}/>重置模型、思考与权限</button><button onClick={()=>openWorkbench('diagnostics')}><Monitor size={16}/>会话与诊断</button></div>}</div>
      <div className="chat-scroll" ref={scrollRef} onScroll={e => { const el = e.currentTarget; const nearEnd=el.scrollHeight-el.scrollTop-el.clientHeight<120; if(el.scrollTop<lastScrollTop.current||nearEnd)stickToEnd.current=nearEnd; lastScrollTop.current=el.scrollTop }}>
        {session.messages.length === 0 ? <div className="welcome"><Mark/><h1>我们应该在 <span>{leaf(session.cwd)}</span> 中做些什么？</h1><p>和 Claude 一起，让想法成为现实。</p><div className="suggestions"><button onClick={() => { setDraft({ text: '先浏览这个项目，介绍它的结构和开发方式。' }); inputRef.current?.focus() }}><Folder size={16}/>了解这个项目</button><button onClick={() => { setDraft({ text: '检查当前代码，找出最值得修复的问题。' }); inputRef.current?.focus() }}><Search size={16}/>检查代码</button><button onClick={() => { setDraft({ text: '帮我规划下一步实现，先提出方案。' }); inputRef.current?.focus() }}><Brain size={16}/>制定计划</button></div></div> : <div className="messages">{session.messages.map(m => <MessageView key={m.id} message={m} sessionId={session.id} disabled={busy||running} retry={m===session.messages.at(-1)&&['error','stopped'].includes(m.status)} canRegenerate={session.messages.slice(0,session.messages.indexOf(m)).some(p=>p.role==='user')} versions={answerVersions(m.id)} onVersion={selectAnswerVersion} onBranch={()=>messageAction(m.id,'branch')} onRegenerate={()=>messageAction(m.id,'regenerate')} onChanges={()=>openChanges(m.id)} onOpenLink={openChatLink}/>)}</div>}
      </div>
      <div className="composer-area"><div className="composer-container">
        {menu==='commands'&&<CommandMenu searching={!!commandQuery} entries={filteredCommands.map(c=>({...c,disabled:running||c.disabled}))} index={menuIndex} loading={commandsLoading} error={commandIssue} onIndex={setMenuIndex} onPick={executeCommand} onRefresh={()=>setCommandRevision(v=>v+1)}/>}
        {menu==='actions'&&<div className="actions-menu popover" role="listbox" aria-label="应用操作"><div className="action-search"><input autoFocus aria-label="搜索应用操作" placeholder="搜索设置、项目、任务…" value={actionSearch} onChange={e=>{setActionSearch(e.target.value);setMenuIndex(0)}} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setMenuIndex(i=>filteredActions.length?(i+(e.key==='ArrowDown'?1:filteredActions.length-1))%filteredActions.length:0)}if(e.key==='Enter'){e.preventDefault();executeCommand(menuIndex)}}}/></div>{filteredActions.map((c,i)=><button key={c.key} role="option" aria-selected={menuIndex===i} className={menuIndex===i?'highlighted':''} onMouseEnter={()=>setMenuIndex(i)} onClick={()=>executeCommand(i)}><c.icon size={16}/><span className="command-title">{c.title}</span><span className="command-description">{c.description}</span></button>)}</div>}
        {menu === 'files' && <div className="file-menu popover" role="listbox" aria-label="项目文件"><div className="menu-caption">引用项目文件 <span>选中后 Claude 按需读取</span></div>{filteredFiles.map((file, i) => <button key={file} role="option" aria-selected={menuIndex === i} className={menuIndex === i ? 'highlighted' : ''} onMouseEnter={() => setMenuIndex(i)} onClick={() => void run(() => pickFile(file))}><FileText size={16}/><span>{file}</span></button>)}{!filteredFiles.length && <div className="menu-empty">没有匹配文件</div>}</div>}
        {menu === 'model' && <div className="model-menu popover"><ModelPicker session={session} running={running} onChange={patch=>'effort' in patch&&!('model' in patch)?api.update(session.id,patch):patchSession(patch)} onManage={() => openSettingsAt('connection')}/></div>}
        {menu === 'permission' && <div className="permission-menu popover"><div className="menu-caption">权限模式</div>{Object.entries(permissionNames).map(([v, label]) => <button disabled={running} key={v} onClick={() => void run(() => patchSession({ permission: v }))}><Shield size={18}/><span><strong>{label}</strong><small>{permissionHints[v]}</small></span>{session.permission === v && <Check size={16}/>}</button>)}<button onClick={()=>openSettingsAt('permissions')}><SlidersHorizontal size={16}/>设置工具允许与拒绝规则</button></div>}
        {menu === 'attach' && <div className="attach-menu popover"><button onClick={() => void run(addFiles)}><Paperclip size={17}/>添加文件或图片</button><button onClick={() => { setMenu('commands'); setMenuIndex(0) }}><Command size={17}/>Claude 命令与技能</button><button onClick={()=>{setActionSearch('');setMenuIndex(0);setMenu('actions')}}><Search size={17}/>应用操作<small>Ctrl K</small></button></div>}
        <div className="workspace-tab"><div className="workspace-project-selector"><button aria-label="选择项目" aria-expanded={menu==='project'} aria-haspopup="dialog" title={session.cwd} disabled={running||busy} onClick={()=>setMenu(menu==='project'?'':'project')}><Folder size={15}/>{state.projectSettings?.[session.cwd]?.name||leaf(session.cwd)}<ChevronDown size={12}/></button>{menu==='project'&&<React.Suspense fallback={null}><ProjectPicker projects={knownProjects.filter(cwd=>!state.projectSettings?.[cwd]?.hidden||cwd===session.cwd).map(cwd=>({cwd,name:state.projectSettings?.[cwd]?.name||leaf(cwd)}))} current={session.cwd} busy={busy} onSelect={cwd=>void chooseComposerProject(cwd)} onAdd={()=>void chooseComposerProject()}/></React.Suspense>}</div>{running && <span className="tab-running"><LoaderCircle size={13} className="spin"/>运行中</span>}</div>
        <div className={`composer ${running ? 'is-running' : ''}`}>
          {draft.topologyRequests.length>0&&<div className="topology-context-chips">{draft.topologyRequests.map((c,i)=><span key={i} title={c.targets.map(t=>t.id).join('、')}><GitBranch size={13}/>{c.summary}<button aria-label={`移除拓扑选区 ${i+1}`} onClick={()=>setDraft({topologyRequests:draft.topologyRequests.filter((_,n)=>n!==i)})}><X size={12}/></button></span>)}</div>}
          {draft.browserContexts.length>0&&<div className="browser-context-chips">{draft.browserContexts.map((c,i)=><span key={i} title={c.selector}><MousePointer2 size={13}/>网页元素 · {c.text.slice(0,35)||c.tag}<button aria-label={`移除网页元素 ${i+1}`} onClick={()=>setDraft({browserContexts:draft.browserContexts.filter((_,n)=>n!==i)})}><X size={12}/></button></span>)}</div>}
          {isQuickMemory(draft.text)&&<QuickMemory sessionId={session.id} text={draft.text} scope={memoryScope} busy={busy||running} onScope={setMemoryScope} onSave={()=>void saveQuickMemory()} onSend={()=>void send(undefined,true)}/>}
          {draft.attachments.length > 0 && <div className="attachments">{draft.attachments.map(a => <div className="attachment" key={a.id} title={a.path}>{a.preview ? <img src={a.preview} alt={a.name}/> : a.kind === 'image' ? <ImageIcon size={17}/> : <FileText size={17}/>}<span>{a.name}</span><button aria-label={`移除 ${a.name}`} onClick={() => setDraft({ attachments: draft.attachments.filter(x => x.id !== a.id) })}><X size={12}/></button></div>)}</div>}
          {visibleSuggestion(session.suggestion) && !running && !draft.text && <button className="prompt-suggestion" onClick={() => setDraft({text: session.suggestion || ''})}>建议：{session.suggestion}</button>}<textarea ref={inputRef} aria-label="消息输入" placeholder={running ? '可以先写好下一条消息…' : '输入消息，/ Claude 命令与技能，@ 引用文件'} value={draft.text} onChange={e => onInput(e.target.value)} onKeyDown={onInputKey} onPaste={e => { const pasted = Array.from(e.clipboardData.files); if (pasted.length) { e.preventDefault(); void run(() => importFiles(pasted)) } }}/>
          <div className="composer-toolbar"><div><button className="add-button" title="添加附件或命令" aria-label="添加附件或命令" onClick={() => setMenu(menu === 'attach' ? '' : 'attach')}><Plus size={21}/></button><button className={`permission-button ${session.permission === 'bypassPermissions' ? 'full-access' : ''}`} title={permissionHints[session.permission]} onClick={() => setMenu(menu === 'permission' ? '' : 'permission')}>{session.permission === 'acceptEdits' ? <ShieldCheck size={15}/> : <Shield size={15}/>}<span>{permissionNames[session.permission]}</span><ChevronDown size={12}/></button><button title="聊天运行设置" aria-label="聊天运行设置" onClick={()=>openWorkbench('runtime')}><SlidersHorizontal size={16}/></button></div><div><ModelButton session={session} onClick={() => setMenu(menu === 'model' ? '' : 'model')}/>{running ? <button className="send-button stop" title="停止执行 (Esc)" aria-label="停止执行" onClick={() => void run(() => api.stop(session.id))}><Square size={15} fill="currentColor"/></button> : <button className="send-button" title="发送消息 (Enter)" aria-label="发送消息" disabled={busy || (!draft.text.trim() && !draft.attachments.length)} onClick={() => void send()}>{busy ? <LoaderCircle size={17} className="spin"/> : <ArrowUp size={19}/>}</button>}</div></div>
        </div><div className="composer-footnote"><UsageMeter key={session.id} session={session}/><span>Shift Enter 换行</span></div>
      </div></div></main>
      {workTab&&<aside className={`conversation-panel ${workTab==='browser'?'browser-conversation-panel':workTab==='diff'?'diff-conversation-panel':workTab==='topology'?`topology-conversation-panel ${topologyExpanded?'topology-fullscreen':''}`:''}`} aria-label="聊天工具面板"><header className="conversation-panel-header"><span>{workTab==='browser'?'内置浏览器':workTab==='diff'?'代码变更':workTab==='topology'?'业务拓扑':'当前聊天'}</span><button aria-label="关闭聊天工具" onClick={()=>closeWorkbench()}><X size={18}/></button></header><React.Suspense fallback={<p>正在读取…</p>}>{workTab==='topology'?<TopologyPanel key={session.id+':'+session.cwd} session={session} expanded={topologyExpanded} onToggleExpanded={()=>setTopologyExpanded(value=>!value)} onClose={()=>setWorkTab(null)} onAttach={(text,context)=>{setTopologyExpanded(false);setDraft({text:[draft.text,text].filter(Boolean).join('\n\n'),topologyRequests:context?[...draft.topologyRequests,context]:draft.topologyRequests});requestAnimationFrame(()=>inputRef.current?.focus())}}/>:workTab==='browser'?<BrowserPanel key={session.id} session={session} obscured={!!modal||!!menu||!!chatContext||!!projectContext} navigation={browserRequest?.sessionId===session.id?browserRequest:undefined} onAttach={(text,attachments,context)=>{setDraft({browserContexts:context?[...draft.browserContexts,context]:draft.browserContexts,text:[draft.text,text].filter(Boolean).join('\n\n'),attachments:[...draft.attachments,...attachments]});inputRef.current?.focus()}}/>:<Workbench key={`${session.id}:${workTab}`} session={session} initial={workTab} changesRequest={changesRequest?.sessionId===session.id?changesRequest:undefined} onLocateMessage={locateMessage} onClose={()=>setWorkTab(null)}/>}</React.Suspense></aside>}
      </>}
    </div>
    {menu && <div className="menu-dismiss" onClick={() => setMenu('')}/>}
    {toast && <div className="toast" role="alert"><AlertCircle size={17}/><span>{toast}</span><button onClick={() => setToast('')}><X size={15}/></button></div>}
    {projectContext&&<React.Suspense fallback={null}><ProjectContextMenu cwd={projectContext.cwd} name={state.projectSettings?.[projectContext.cwd]?.name||leaf(projectContext.cwd)} settings={state.projectSettings?.[projectContext.cwd]||{}} archived={archived} running={state.sessions.some(s=>s.cwd===projectContext.cwd&&s.messages.some(m=>m.status==='running'))} empty={!state.sessions.some(s=>s.cwd===projectContext.cwd)} x={projectContext.x} y={projectContext.y} onClose={()=>setProjectContext(null)} onAction={action=>projectAction(projectContext.cwd,action)}/></React.Suspense>}
    {chatContext&&contextSession&&<React.Suspense fallback={null}><ChatContextMenu session={contextSession} x={chatContext.x} y={chatContext.y} onClose={()=>setChatContext(null)} onAction={action=>chatAction(contextSession,action)}/></React.Suspense>}
    {modal && <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setModal('') }}><div className={`modal ${modal === 'settings' ? 'settings-modal' : ''}`} role="dialog" aria-modal="true" aria-label={{ settings: '设置', status: '连接状态', usage: '使用情况', help: '帮助', rename: '重命名', resume: '恢复聊天' }[modal]}><header><h2>{{ settings: '设置', status: '连接状态', usage: '使用情况', help: '帮助', rename: renameProject?'重命名项目':'重命名聊天', resume: '恢复 Claude 会话' }[modal]}</h2><button aria-label="关闭对话框" onClick={() => setModal('')}><X size={19}/></button></header>
    {modal === 'status' && <><div className="connection-state">{(session.providerId?probe?.path:probe?.loggedIn) ? <CheckCircle2 size={22}/> : <AlertCircle size={22}/>}<strong>{session.providerId?(probe?.path?'自定义 API · CLI 已就绪':'请检查 Claude Code 安装'):probe?.loggedIn ? 'Claude Code 已连接' : '请检查 Claude Code 登录'}</strong><button title="重新检测" aria-label="重新检测" onClick={() => void checkClaude()}><RefreshCw size={16}/></button></div><dl><dt>版本</dt><dd>{probe?.version || '尚未检测到'}</dd><dt>登录方式</dt><dd>{probe?.authMethod || '未知'}</dd><dt>可执行文件</dt><dd>{probe?.path || '自动检测'}</dd><dt>工作目录</dt><dd>{session.cwd}</dd><dt>原生会话 ID</dt><dd>{session.nativeId || '首次发送后建立'}</dd><dt>接入方式</dt><dd>claude -p · stream-json</dd></dl>{session.providerId&&<p className="modal-description">当前使用自定义 API，无需 Claude 订阅登录。此处检查 CLI 安装；上游连通性请在模型详情中验证。</p>}{!session.providerId&&!probe?.loggedIn && <p className="modal-description">请在终端执行 <code>claude auth login</code>，登录后重新检测。</p>}</>}
    {modal === 'usage' && <UsageDetails key={session.id} session={session}/>}
    {modal === 'help' && <><p className="modal-description">在本地项目中与 Claude 协作。文件、命令与会话都在此计算机上运行。</p><div className="help-rows">{[['Enter','发送消息'],['Shift + Enter','换行'],['/','读取当前 CLI 命令与技能；选择后可补充参数再发送'],['Ctrl + K','搜索应用操作，保留聊天草稿'],['Shift + Tab','在标准、允许编辑、计划模式间切换'],['@','搜索项目文件，并附加路径引用'],['#规则','快速追加到项目或个人 CLAUDE.md；Enter 保存'],['Ctrl + N','在当前项目新建聊天'],['Ctrl + ,','打开设置'],['Esc','关闭菜单，或停止正在执行的回复']].map(([key, text]) => <div key={key}><kbd>{key}</kbd><span>{text}</span></div>)}</div><p className="modal-description">支持粘贴图片、拖入附件。需要确认的操作会显示审批卡片，可允许、拒绝或回答问题。中文输入法选词不会触发发送。</p></>}
    {modal === 'rename' && <form onSubmit={e => { e.preventDefault(); void run(async () => { if(renameProject)await api.updateProject(renameProject,{name:rename.trim()||leaf(renameProject)});else await api.update(renameId||session.id,{title:rename.trim()||'新聊天'}); setModal('') }) }}><label>{renameProject?'项目显示名称':'聊天名称'}<input autoFocus value={rename} onChange={e => setRename(e.target.value)} maxLength={100}/></label><div className="modal-buttons"><button className="primary" disabled={!renameProject&&state.sessions.find(s=>s.id===(renameId||session.id))?.messages.some(m=>m.status==='running')}>保存</button></div></form>}
    {modal === 'resume' && <form onSubmit={e => { e.preventDefault(); void run(async () => { if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(resumeId.trim())) throw new Error('请输入有效的 Claude 会话 UUID'); await api.importSession(session.id,resumeId.trim()); setModal('') }) }}><p className="modal-description">打开本机 Claude 的会话，直接读取同一份历史记录。已有会话会直接切换，不会重复导入。</p><label>Claude 会话 ID<input autoFocus placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={resumeId} onChange={e => setResumeId(e.target.value)}/></label><div className="modal-buttons"><button className="primary" disabled={!resumeId.trim()}>恢复聊天</button></div></form>}
    </div></div>}
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
