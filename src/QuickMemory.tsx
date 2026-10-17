import {useEffect, useState} from 'react'
import type {MemoryScope} from './quick-memory'
import {memoryText} from './quick-memory'

export function QuickMemory({sessionId,text,scope,busy,onScope,onSave,onSend}:{sessionId:string;text:string;scope:MemoryScope;busy:boolean;onScope(scope:MemoryScope):void;onSave():void;onSend():void}) {
  const [target,setTarget]=useState<{key:string;path:string}|null>(null)
  const [issue,setIssue]=useState('')
  const key=sessionId+':'+scope
  useEffect(()=>{
    let active=true;setIssue('')
    void window.workspace.instructions(sessionId).then(files=>{
      const file=files.find(f=>f.id===scope)
      if(active)setTarget(file?{key,path:file.path}:null)
    }).catch(e=>{if(active)setIssue(String(e.message||e))})
    return()=>{active=false}
  },[sessionId,scope,key])
  return <section className="quick-memory" aria-label="快速记忆">
    <header><strong># 快速记忆</strong><select aria-label="记忆保存范围" value={scope} disabled={busy} onChange={e=>onScope(e.target.value as MemoryScope)}><option value="project">当前项目</option><option value="user">个人 · 所有项目</option></select></header>
    <p>把 # 后的内容追加到 CLAUDE.md，作为后续遵循的规则。</p>
    <small>{target?.key===key?target.path:issue||'读取保存位置…'}</small>
    <footer><button type="button" disabled={busy} onClick={onSend}>作为普通消息发送</button><button type="button" className="primary" disabled={busy||!memoryText(text)} onClick={onSave}>{busy?'正在保存…':'保存记忆'}</button></footer>
  </section>
}
