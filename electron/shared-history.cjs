const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { isInside } = require('./claude.cjs')
const {normalizeUsage,mergeUsage,sumUsage}=require('./token-usage.cjs')
const {commandText}=require('./command-text.cjs')
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')
const projectKey = cwd => cwd.replace(/[^a-zA-Z0-9]/g, '-')
const records = text => text.split('\n').flatMap(line => { try { const e=JSON.parse(line);return e&&typeof e==='object'&&!Array.isArray(e)?[e]:[] } catch { return [] } })
const content = message => typeof message?.content === 'string' ? [{type:'text', text:message.content}] : Array.isArray(message?.content) ? message.content : []
const display = blocks => typeof blocks === 'string' ? blocks : (blocks || []).map(b => b.type === 'image' ? '[图片]' : b.text || '').filter(Boolean).join('\n')
const interruption = e => e.type==='user'&&content(e.message).length>0&&content(e.message).every(b=>b.type==='text')&&/^\[Request interrupted by user(?: for tool use)?\]$/.test(display(content(e.message)).trim())
// CLI-generated summaries are serialized with role=user, but are context transport,
// not human input. Keep them in the ancestry graph, never in visible messages.
const internalMessage = e => !!e.isMeta || !!e.isCompactSummary
const revision = stat => `${stat.size}:${stat.mtimeMs}`
const metadataKeys = ['id','attachments','topologySelection','browserContexts','approvals','gatewayRoute','imageReferences','notice','error','structured','tasks','usage','lastRequestUsage','modelUsage','cacheReporting','contextKey','changes','changeError','internalUserIds']

// The CLI transcript is canonical. This parser groups one agent turn (including
// intermediate tool calls) into one GUI message without copying the JSONL store.
function parseMessages(events,hiddenUserIds=new Set()) {
  const unique = new Map()
  for (const e of events) if (e.uuid && !e.isSidechain && !e.parent_tool_use_id && !e.parentToolUseID) unique.set(e.uuid, e)
  const ordered = [...unique.values()]
  const leaf = ordered.findLast(e => !internalMessage(e) && !hiddenUserIds.has(e.uuid) && !interruption(e) && (e.type==='assistant'||e.type==='user'&&display(content(e.message).filter(b=>['text','image'].includes(b.type)))))
  let chain
  if (leaf?.parentUuid && unique.has(leaf.parentUuid)) {
    chain = new Set(); let e = leaf
    while (e && !chain.has(e.uuid)) { chain.add(e.uuid); e = unique.get(e.parentUuid) }
    // A compact boundary starts a fresh parent chain. Older turns are still
    // conversation history, so retain their display records before that boundary.
    const first = ordered.findIndex(e => chain.has(e.uuid))
    if (ordered[first]?.type === 'system' && ordered[first]?.subtype === 'compact_boundary') for (const e of ordered.slice(0,first)) chain.add(e.uuid)
  }
  const messages = [], tools = new Map(); let assistant,requestUsages=new Map()
  for (const e of ordered) {
    if(e.type==='system'&&e.subtype==='compact_boundary'&&(!chain||chain.has(e.uuid))){assistant=null;requestUsages=new Map()}
    if(interruption(e)){
      // CLI writes this control marker as a user record. Associate it with its
      // own ancestor turn, including markers flushed after a newer answer.
      let ancestor=unique.get(e.parentUuid),target,index=-1;const visited=new Set()
      while(ancestor&&!visited.has(ancestor.uuid)){
        visited.add(ancestor.uuid)
        index=messages.findIndex(m=>m.id===ancestor.uuid||m.checkpointId===ancestor.uuid||m.nativeUUIDs?.includes(ancestor.uuid))
        if(index>=0){target=messages[index];break}
        ancestor=unique.get(ancestor.parentUuid)
      }
      if(!target)continue
      if(target.role==='user'){
        target=messages[index+1]?.role==='assistant'?messages[index+1]:null
        if(!target){target={id:e.uuid,checkpointId:e.uuid,role:'assistant',text:'',time:Date.parse(e.timestamp)||0,tools:[],status:'stopped'};messages.splice(index+1,0,target)}
      }
      target.status='stopped';delete target.error
      if(target===assistant){assistant=null;requestUsages=new Map()}
      continue
    }
    if (chain && !chain.has(e.uuid) || !['user','assistant'].includes(e.type) || !e.message) continue
    const blocks = content(e.message)
    for (const b of blocks) if (b.type === 'tool_result') {
      const tool = tools.get(b.tool_use_id)
      if (tool) { tool.output = display(b.content); tool.status = b.is_error ? 'error' : 'done' }
    }
    const text = display(blocks.filter(b => ['text','image'].includes(b.type)))
    if (e.type === 'user') {
      if (!text || internalMessage(e) || hiddenUserIds.has(e.uuid)) continue
      assistant = null
      requestUsages=new Map()
      messages.push({id:e.uuid, checkpointId:e.uuid, role:'user', text:commandText(text), time:Date.parse(e.timestamp)||0, tools:[], status:'done'})
      continue
    }
    if (!assistant) { assistant = {id:e.uuid, nativeUUID:e.uuid, role:'assistant', text:'', thinking:'', time:Date.parse(e.timestamp)||0, tools:[], status:'done'}; messages.push(assistant) }
    assistant.nativeUUID = e.uuid
    assistant.nativeUUIDs ||= []; assistant.nativeUUIDs.push(e.uuid)
    if (e.isApiErrorMessage) { assistant.error = text; assistant.status = 'error' }
    else if (text) assistant.text += (assistant.text ? '\n\n' : '') + text
    const thought = blocks.filter(b => b.type === 'thinking').map(b => b.thinking || '').join('\n')
    if (thought) assistant.thinking += (assistant.thinking ? '\n\n' : '') + thought
    if (e.message.model) assistant.model = e.message.model
    if(e.message.usage){const id=e.message.id||e.uuid;requestUsages.set(id,mergeUsage(requestUsages.get(id),normalizeUsage(e.message.usage)));assistant.usage=sumUsage([...requestUsages.values()]);assistant.lastRequestUsage=requestUsages.get(id)}
    for (const b of blocks) if (b.type === 'tool_use') {
      const tool = {id:b.id, name:b.name, input:JSON.stringify(b.input || {}), output:'', status:'done'}
      assistant.tools.push(tool); tools.set(b.id,tool)
    }
  }
  // Background tools may return on an older parent after a newer visible turn.
  // Update the matching tool without making that invisible result the chat leaf.
  for(const e of ordered)for(const block of content(e.message))if(block.type==='tool_result'){
    const tool=tools.get(block.tool_use_id)
    if(tool){tool.output=display(block.content);tool.status=block.is_error?'error':'done'}
  }
  return messages
}

class SharedHistory {
  constructor(configuration) { this.configuration = configuration; this.cache = new Map(); this.loaded = new Map() }
  home() { return path.resolve(this.configuration.configHome()) }
  // Resolve every component before reads/mutations; never follow session links
  // into projects or unrelated directories, including Windows junctions.
  checked(file) {
    const home = this.home(), full = path.resolve(file)
    if (!isInside(home,full) || full === home) throw new Error('会话路径不在 Claude 配置目录内')
    let current = home
    for (const part of path.relative(home,full).split(path.sep)) {
      current = path.join(current,part)
      if (!fs.existsSync(current)) break
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('不操作链接会话路径')
      if (!isInside(fs.realpathSync(home),fs.realpathSync(current))) throw new Error('会话实际路径越界')
    }
    return full
  }
  read(file) { return records(fs.readFileSync(this.checked(file),'utf8')) }
  descriptor(file, fallbackCwd) {
    file = this.checked(file)
    const stat = fs.statSync(file), rev = revision(stat), cached = this.cache.get(file)
    if (cached?.revision === rev && (cached.cwd || !fallbackCwd)) return cached
    const fd = fs.openSync(file,'r'), length = Math.min(stat.size,128*1024), head = Buffer.alloc(length), tail = Buffer.alloc(Math.min(stat.size,64*1024))
    try { fs.readSync(fd,head,0,head.length,0); fs.readSync(fd,tail,0,tail.length,Math.max(0,stat.size-tail.length)) } finally { fs.closeSync(fd) }
    const events = records(head.toString()), ending = stat.size > length ? records(tail.toString()) : events
    const visible=[...events,...ending]
    const first = visible.find(e => e.type === 'user' && !internalMessage(e) && !e.isSidechain && !interruption(e) && display(content(e.message)))
    const cwd = visible.find(e => typeof e.cwd === 'string' && path.isAbsolute(e.cwd) && !e.isSidechain)?.cwd || fallbackCwd
    const customTitle = [...ending].reverse().find(e => e.type === 'custom-title')?.customTitle || [...events].reverse().find(e => e.type === 'custom-title')?.customTitle
    const item = {id:path.basename(file,'.jsonl'),file,cwd,revision:rev,hasMessages:visible.some(e=>['user','assistant'].includes(e.type)&&!internalMessage(e)&&!interruption(e)&&!e.isSidechain&&e.message),title:customTitle || commandText(display(content(first?.message))).slice(0,100) || 'Claude 会话',customTitle,createdAt:Date.parse(first?.timestamp)||stat.birthtimeMs,updatedAt:stat.mtimeMs}
    this.cache.set(file,item); return item
  }
  scan(knownCwds = []) {
    const root = this.checked(path.join(this.home(),'projects')), result = []
    if (!fs.existsSync(root)) return result
    const known = new Map(knownCwds.map(cwd => [projectKey(cwd),cwd]))
    for (const dir of fs.readdirSync(root,{withFileTypes:true})) {
      if (!dir.isDirectory() || dir.isSymbolicLink()) continue
      const folder = this.checked(path.join(root,dir.name))
      for (const e of fs.readdirSync(folder,{withFileTypes:true})) {
        if (!e.isFile() || !e.name.endsWith('.jsonl') || !uuid(e.name.slice(0,-6))) continue
        try { const item = this.descriptor(path.join(folder,e.name),known.get(dir.name)); if (item.cwd && item.hasMessages) result.push(item) } catch { /* A concurrently replaced or inaccessible record is left alone. */ }
      }
    }
    return result.sort((a,b) => b.updatedAt-a.updatedAt)
  }
  locate(session) {
    if (!uuid(session.nativeId) || session.forkPending) return null
    if (session.nativeHome && path.resolve(session.nativeHome) !== this.home()) return null
    if (session.nativeFile) {
      const file = this.checked(session.nativeFile)
      if (path.basename(file) !== session.nativeId+'.jsonl') throw new Error('会话文件与 ID 不匹配')
      return fs.existsSync(file) ? file : null
    }
    const file = this.checked(path.join(this.home(),'projects',projectKey(session.cwd),session.nativeId+'.jsonl'))
    if (fs.existsSync(file)) {
      const d = this.descriptor(file,session.cwd)
      if (d.cwd && path.resolve(d.cwd) !== path.resolve(session.cwd)) throw new Error('会话工作目录不匹配')
      return file
    }
    return null
  }
  metadata(session) {
    const saved = {...session.messageMetadata}
    for (const m of session.messages) {
      const key = m.role === 'user' ? m.checkpointId || m.id : m.nativeUUID
      if (key) saved[key] = Object.fromEntries(metadataKeys.filter(k => m[k] !== undefined).map(k => [k,m[k]]))
    }
    return saved
  }
  hydrate(session, force = false) {
    const file = this.locate(session)
    if (!file) return false
    const stat = fs.statSync(file), rev = revision(stat)
    if (!force && this.loaded.get(session.id) === rev) return false
    const events = this.read(file), meta = this.metadata(session),hiddenUserIds=new Set(Object.values(meta).flatMap(m=>m.internalUserIds||[])),parsed = parseMessages(events,hiddenUserIds)
    if (!parsed.length) return false // CLI may currently be writing the first record.
    for (const m of parsed) {
      const extra = meta[m.checkpointId || m.nativeUUID] || m.nativeUUIDs?.map(id => meta[id]).find(Boolean)
      if (extra) Object.assign(m,extra)
      if(m.role==='user'&&m.topologySelection)m.text=m.topologySelection.displayText
    }
    // Streaming can finish before JSONL flushes its final snapshot. Keep only
    // explicitly pending GUI messages until their own UUID is observed on disk.
    // Known native branch changes remain authoritative for all other records.
    const nativeIds=new Set(events.map(e=>e.uuid).filter(Boolean))
    for(let i=0;i<session.messages.length;i++){
      const message=session.messages[i]
      if(!message.pendingNative||nativeIds.has(message.checkpointId||message.nativeUUID||message.id))continue
      const user=message.role==='assistant'?session.messages.slice(0,i).findLast(m=>m.role==='user'):null
      const userIndex=user?parsed.findIndex(m=>m.role==='user'&&(m.checkpointId||m.id)===(user.checkpointId||user.id)):-1
      if(userIndex>=0&&parsed[userIndex+1]?.role==='assistant')parsed.splice(userIndex+1,1,message)
      else parsed.push(message)
    }
    const agentsDir=this.checked(path.join(path.dirname(file),session.nativeId,'subagents'))
    if(fs.existsSync(agentsDir))for(const entry of fs.readdirSync(agentsDir,{withFileTypes:true})){
      if(!entry.isFile()||!/^agent-[\w-]+\.jsonl$/.test(entry.name))continue
      const agentEvents=this.read(path.join(agentsDir,entry.name)),parts=parseMessages(agentEvents.map(e=>({...e,isSidechain:false,parent_tool_use_id:null,parentToolUseID:null}))).filter(m=>m.role==='assistant')
      if(!parts.length)continue
      const parentId=agentEvents.find(e=>e.parentToolUseID||e.parent_tool_use_id)
      const toolId=parentId?.parentToolUseID||parentId?.parent_tool_use_id
      const agentId=entry.name.slice(6,-6),answers=parsed.filter(m=>m.role==='assistant')
      const parent=parsed.find(m=>m.tools.some(tool=>tool.id===toolId||['Agent','Task'].includes(tool.name)&&tool.output.includes('agentId: '+agentId)))||(answers.length===1?answers[0]:null)
      if(parent){
        const launch=parent.tools.find(tool=>tool.id===toolId||['Agent','Task'].includes(tool.name)&&tool.output.includes('agentId: '+agentId))
        const child={id:launch?.id||toolId||entry.name.slice(0,-6),text:parts.map(m=>m.text).filter(Boolean).join('\n\n'),thinking:parts.map(m=>m.thinking).filter(Boolean).join('\n\n'),tools:parts.flatMap(m=>m.tools),status:parts.some(m=>m.status==='error')?'error':'done'}
        parent.subagents??=[];const index=parent.subagents.findIndex(a=>a.id===child.id)
        if(index<0)parent.subagents.push(child)
        else if(!parent.pendingNative||child.text.length>=parent.subagents[index].text.length)parent.subagents[index]=child
      }
    }
    // A transport failure may have no CLI message at all; retain that diagnostic,
    // while the actual conversation body always comes from JSONL.
    const matched = new Set(parsed.flatMap(m => [m.id,m.checkpointId,m.nativeUUID,...(m.nativeUUIDs||[])]))
    const local = session.messages.filter(m => m.role === 'assistant' && m.status === 'error' && !m.nativeUUID && !matched.has(m.id))
    session.messages = [...parsed,...local].sort((a,b) => a.time-b.time)
    session.messageMetadata = meta
    session.nativeFile = file; session.nativeHome = this.home(); session.nativeObserved = true
    session.nativeRevision = rev; this.loaded.set(session.id,rev)
    return true
  }
  sync(state, busy = () => false, changedExternally = () => {}) {
    const entries = this.scan([...Object.keys(state.projectSettings||{}),...state.sessions.map(s => s.cwd)])
    let changed = false
    const present = new Set(entries.map(e => e.file))
    for (const entry of entries) {
      let session = state.sessions.find(s => !s.forkPending && s.nativeId === entry.id && (!s.nativeHome || s.nativeHome === this.home()))
      if (!session) {
        session = {id:crypto.randomUUID(),cwd:entry.cwd,title:entry.title,createdAt:entry.createdAt,updatedAt:entry.updatedAt,archived:false,messages:[],model:state.preferences?.providerId?'':state.preferences?.model||'',effort:state.preferences?.effort||'',permission:state.preferences?.permission||'',providerId:state.preferences?.providerId||'',nativeId:entry.id,nativeFile:entry.file,nativeHome:this.home(),nativeObserved:true}
        state.sessions.push(session); changed = true
      }
      state.projectSettings ??= {}; state.projectSettings[session.cwd] ??= {}
      if (busy(session.id)) continue
      session.nativeFile = entry.file; session.nativeHome = this.home(); session.nativeObserved = true
      if(session.nativeTitlePending){this.rename(session,session.title);delete session.nativeTitlePending;entry.customTitle=session.title;changed=true}
      if(entry.updatedAt>session.updatedAt){session.updatedAt=entry.updatedAt;changed=true}
      if (entry.customTitle && entry.customTitle !== session.title) { session.title = entry.customTitle; changed = true }
      const rev = this.loaded.get(session.id)
      if (session.id === state.activeId || session.messages.length || rev) {
        const last = session.messages.findLast(m => m.role === 'assistant')?.nativeUUID
        if (this.hydrate(session)) {
          if (rev && last !== session.messages.findLast(m => m.role === 'assistant')?.nativeUUID) changedExternally(session)
          session.updatedAt = Math.max(session.updatedAt,entry.updatedAt); changed = true
        }
      }
    }
    const removed = state.sessions.filter(s => !busy(s.id) && !s.forkPending && s.nativeObserved && s.nativeHome === this.home() && s.nativeFile && !present.has(s.nativeFile) && !fs.existsSync(this.checked(s.nativeFile)))
    if (removed.length) {
      for (const s of removed) changedExternally(s)
      state.sessions = state.sessions.filter(s => !removed.includes(s)); changed = true
    }
    if (!state.sessions.some(s => s.id === state.activeId)) state.activeId = state.sessions.find(s => !s.archived)?.id || state.sessions[0]?.id || null
    return changed
  }
  serialize(state) {
    return {...state, sessions:state.sessions.map(s => {
      const file=this.locate(s)
      if (!file || !this.descriptor(file,s.cwd).hasMessages) return s // Unsaved new turns/old GUI-only records are not discarded.
      const messageMetadata = this.metadata(s)
      return {...s,messageMetadata,messages:s.messages.filter(m => m.pendingNative || m.role === 'assistant' && m.status === 'error' && !m.nativeUUID)}
    })}
  }
  rename(session,title) {
    const file = this.locate(session)
    if (file) fs.appendFileSync(file,'\n'+JSON.stringify({type:'custom-title',customTitle:title,sessionId:session.nativeId})+'\n')
    return !!file
  }
  replayInput(session,user,imageReference) {
    const file=this.locate(session)
    const record=file?this.read(file).find(e=>e.type==='user'&&e.uuid===(user.checkpointId||user.id)):null
    if(!record)return user.text+(user.topologySelection?.context?'\n\n'+user.topologySelection.context:'')
    return commandText(content(record.message).filter(b=>['text','image'].includes(b.type)).map(b=>b.type==='image'?imageReference(b):b.text||'').join('\n'))
  }
  fork(session, title, resumeAt) {
    const source = this.locate(session)
    if (!source) return null
    const id = crypto.randomUUID(), file = this.checked(path.join(path.dirname(source),id+'.jsonl'))
    let events = this.read(source)
    if (resumeAt) { const index = events.findIndex(e => e.uuid === resumeAt); if (index < 0) throw new Error('分支检查点不存在'); events = events.slice(0,index+1) }
    events = events.map(e => ({...e,...(e.sessionId ? {sessionId:id} : {})})).filter(e => e.type !== 'custom-title')
    events.push({type:'custom-title',customTitle:title,sessionId:id})
    const copies=[[path.join(this.home(),'file-history',session.nativeId),path.join(this.home(),'file-history',id)],[path.join(path.dirname(source),session.nativeId),path.join(path.dirname(source),id)]]
    const created=[]
    try{
      for(const [from,to]of copies)if(fs.existsSync(this.checked(from))){this.checked(to);if(fs.existsSync(to))throw new Error('分支目录已存在');created.push(to);fs.cpSync(from,to,{recursive:true,errorOnExist:true,force:false,filter:source=>{this.checked(source);return true}})}
      fs.writeFileSync(file,events.map(e => JSON.stringify(e)).join('\n')+'\n',{flag:'wx',mode:0o600})
    }catch(error){for(const target of created)if(fs.existsSync(target))fs.rmSync(this.checked(target),{recursive:true,force:true});throw error}
    return {nativeId:id,nativeFile:file,nativeHome:this.home(),nativeObserved:true,forkPending:false,resumeAt:undefined}
  }
  remove(session) {
    if(session.nativeHome && path.resolve(session.nativeHome)!==this.home())throw new Error('请切回此聊天使用的 Claude 配置目录后再删除')
    const file = this.locate(session)
    if (!file) return
    const home = this.home(), id = session.nativeId
    // Preflight all paths before any delete. Only exact session-owned history
    // directories are removed; never cwd, worktrees, memory or attachments.
    const targets = [file,path.join(path.dirname(file),id),path.join(home,'file-history',id),path.join(home,'session-env',id)].map(p => this.checked(p))
    const indexFile = this.checked(path.join(path.dirname(file),'sessions-index.json'))
    const historyFile = this.checked(path.join(home,'history.jsonl'))
    let index
    if (fs.existsSync(indexFile)) { index = JSON.parse(fs.readFileSync(indexFile,'utf8')); if (!Array.isArray(index.entries)) throw new Error('Claude 会话索引格式无效，尚未删除记录'); index.entries = index.entries.filter(e => e.sessionId !== id) }
    let history
    if(fs.existsSync(historyFile)){
      const before=revision(fs.statSync(historyFile)),raw=fs.readFileSync(historyFile,'utf8')
      history=raw.split('\n').filter(line=>{try{return JSON.parse(line)?.sessionId!==id}catch{return true}}).join('\n')
      if(before!==revision(fs.statSync(historyFile)))throw new Error('Claude 历史正在写入，请稍后删除')
      if(history===raw)history=undefined
    }
    for (const target of targets) if (fs.existsSync(target)) fs.rmSync(target,{recursive:fs.statSync(target).isDirectory(),force:true})
    if (index) { const temp = indexFile+'.gui-tmp'; fs.writeFileSync(temp,JSON.stringify(index,null,2)); fs.renameSync(temp,indexFile) }
    if(history!==undefined){const temp=historyFile+'.gui-tmp';fs.writeFileSync(temp,history,{mode:0o600});fs.renameSync(temp,historyFile)}
    this.cache.delete(file); this.loaded.delete(session.id)
  }
}
module.exports = { SharedHistory, parseMessages, projectKey }
