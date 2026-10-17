import {useEffect,useRef,useState} from 'react'
import {History,RefreshCw,ArrowLeft} from 'lucide-react'
import type {Session,TurnChangeRecord} from './types'
import {DiffReview} from './DiffReview'
import './changes-panel.css'
export type ChangesRequest={sessionId:string;messageId?:string;restore?:boolean;nonce:number}
export function ChangesPanel({session,request,onLocate}:{session:Session;request?:ChangesRequest;onLocate?(id:string):void}){
  const api=window.workspace,turns=session.messages.filter(m=>m.role==='assistant'&&m.changes?.files.length),points=session.messages.filter(m=>m.role==='user'&&m.checkpointId).slice().reverse()
  const [scope,setScope]=useState(request?.messageId&&!request.restore?request.messageId:turns.at(-1)?.id||'workspace'),[recovery,setRecovery]=useState(!!request?.restore),[point,setPoint]=useState(request?.restore?request.messageId||'':points[0]?.id||'')
  const [workspace,setWorkspace]=useState<{branch:string;status:string;diff:string}|null>(null),[turn,setTurn]=useState<TurnChangeRecord|null>(null),[loading,setLoading]=useState(false),[issue,setIssue]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0)
  const generation=useRef(0),running=session.messages.some(m=>m.status==='running')
  const wasRunning=useRef(running)
  useEffect(()=>{if(wasRunning.current&&!running&&scope==='workspace')setRevision(v=>v+1);wasRunning.current=running},[running,scope])
  useEffect(()=>{if(request){setRecovery(!!request.restore);if(request.restore)setPoint(request.messageId||points[0]?.id||'');else setScope(request.messageId||turns.at(-1)?.id||'workspace')}},[request?.nonce])
  useEffect(()=>{
    if(recovery)return
    let active=true;const token=++generation.current;setIssue('');setLoading(true)
    void(scope==='workspace'?api.diff(session.id).then(value=>{if(active&&token===generation.current)setWorkspace(value)}):api.turnChanges(session.id,scope).then(value=>{if(active&&token===generation.current)setTurn(value)})).catch(e=>{if(active)setIssue(String(e.message||e))}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[session.id,scope,recovery,revision])
  useEffect(()=>{if(recovery||scope!=='workspace')return;const refresh=()=>setRevision(v=>v+1);window.addEventListener('focus',refresh);const timer=running?setInterval(refresh,3000):undefined;return()=>{window.removeEventListener('focus',refresh);clearInterval(timer)}},[scope,recovery,running])
  const selected=points.find(m=>m.id===point)||points[0]
  const source=scope==='workspace'?workspace?.diff||'':turn?.messageId===scope?turn.files.map(f=>f.patch||`diff --git a/${f.path} b/${f.path}\n--- a/${f.path}\n+++ b/${f.path}\n${f.reason||'没有文本预览'}\n`).join('\n'):''
  async function restore(){
    if(!selected||running||busy)return
    if(!window.confirm(`将 Claude 跟踪的文件恢复到这条消息发送之前？\n\n${selected.text.slice(0,200)}\n\n当前磁盘上的相关编辑会被覆盖，聊天记录保留。这不撤销 Git 提交、Shell 或远端操作。`))return
    setBusy(true);setIssue('');setNotice('')
    try{await api.checkpoint(session.id,selected.id,'code');setNotice('文件已恢复，聊天记录保留。');setRevision(v=>v+1)}catch(e){setIssue(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  return <div className="changes-panel">
    <header className="changes-toolbar">{recovery?<><button aria-label="返回代码变更" onClick={()=>{setRecovery(false);setIssue('')}}><ArrowLeft size={15}/></button><strong>恢复文件</strong></>:<><select aria-label="变更范围" value={scope} onChange={e=>{setScope(e.target.value);setNotice('')}}><option value="workspace">工作目录全部变更</option>{turns.slice().reverse().map((m,i)=><option value={m.id} key={m.id}>{i===0?'最近一轮':'较早一轮'} · {new Date(m.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · {m.changes!.files.length} 个文件</option>)}</select><button title="刷新变更" aria-label="刷新变更" disabled={loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={15} className={loading?'spin':''}/></button><button title="原生文件恢复" aria-label="原生文件恢复" onClick={()=>{setRecovery(true);setIssue('');setNotice('')}}><History size={15}/></button></>}</header>
    {!recovery&&<p className="changes-scope-hint">{scope==='workspace'?`当前项目全部未提交修改，包含原先已有的改动${workspace?.branch?' · '+workspace.branch:''}`:'这一轮开始到结束之间的文件改动；预览固定保留。'}</p>}
    {notice&&<p className="changes-notice" role="status">{notice}</p>}{issue&&<p className="changes-error" role="alert">{issue}</p>}
    {recovery?<div className="file-recovery"><p>选择消息前的 Claude 原生恢复点，只恢复它跟踪的文件。聊天分支请使用消息旁的分支按钮。</p>{!points.length?<div className="changes-empty">当前聊天还没有原生文件恢复点。</div>:<><div className="recovery-points" role="group" aria-label="消息前的文件恢复点">{points.map(m=><button key={m.id} aria-pressed={m.id===selected?.id} onClick={()=>{setPoint(m.id);setNotice('')}}><span>{m.text.slice(0,100)||'附件消息'}</span><small>{new Date(m.time).toLocaleString()}</small></button>)}</div>{selected&&<section className="recovery-selection"><strong>恢复到此消息发送之前</strong><p>{selected.text}</p><div><button disabled={running||busy} onClick={()=>void restore()} className="primary">{busy?'正在恢复…':'恢复此处文件'}</button>{onLocate&&<button onClick={()=>onLocate(selected.id)}>查看原消息</button>}</div>{running&&<small>当前正在运行，结束或停止后可恢复文件。</small>}</section>}</>}</div>:<div className="changes-content">{loading&&!source?<p>正在读取变更…</p>:!issue&&<DiffReview patch={source} status={scope==='workspace'?workspace?.status||'':turn?.files.length?'changed':''}/>} {scope!=='workspace'&&turn?.limited&&<p className="changes-scope-hint">部分文件仅记录路径，未提供文本预览。</p>}{scope!=='workspace'&&turn?.coverage==='tools'&&<p className="changes-scope-hint">此目录未使用 Git，本轮按 Claude 原生文件编辑工具记录。</p>}</div>}
  </div>
}
