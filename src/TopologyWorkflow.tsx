import React,{useEffect,useState} from 'react'
import {GitBranch,X} from 'lucide-react'
import type {TopologyData,TopologyDraft} from './types'
export type WorkflowMode='design'|'implement'|'sync'
const modes:Record<WorkflowMode,{label:string;description:string;placeholder:string}>={
  design:{label:'从需求设计 / 补全拓扑',description:'先设计模块、输入输出、连接和验收条件，只写拓扑。没有代码也可以开始；已有实现会保留。',placeholder:'描述项目要解决的问题、用户流程、约束，或需要补全的模块…'},
  implement:{label:'按照拓扑开发',description:'读取所选模块及其子树，按输入输出和验收条件实现代码，完成后回填实际代码位置与验证记录。',placeholder:'可补充技术栈、实施顺序、这一轮希望完成的范围…'},
  sync:{label:'核对代码与拓扑',description:'比较真实代码与设计，同步已经实现的关系，标出缺口和偏离；保留尚未实现的计划，不修改业务代码。',placeholder:'可指定重点核对的流程、近期改动或你怀疑的差异…'}
}
export function TopologyWorkflow({sessionId,workflow,running,onClose,onReady}:{sessionId:string;workflow:{mode:WorkflowMode;nodeIds:string[];data:TopologyData};running:boolean;onClose():void;onReady(text:string,request:TopologyDraft):void}){
  const [mode,setMode]=useState(workflow.mode),[scope,setScope]=useState(workflow.nodeIds.length?'selected':''),[text,setText]=useState(''),[busy,setBusy]=useState(false),[issue,setIssue]=useState('')
  const nodes=workflow.data.graph?.nodes||[],selected=nodes.filter(n=>workflow.nodeIds.includes(n.id)),info=modes[mode]
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!busy)onClose()}};window.addEventListener('keydown',escape,true);return()=>window.removeEventListener('keydown',escape,true)},[busy,onClose])
  const submit=async()=>{
    const ids=scope==='selected'?workflow.nodeIds:scope?[scope]:[]
    if(mode==='design'&&!text.trim()){setIssue('请先填写设计需求。');return}
    const target=ids.length?nodes.filter(n=>ids.includes(n.id)).map(n=>n.label).join('、'):'整个项目',description=`请${info.label}，范围：${target}。${text.trim()?`\n要求：${text.trim()}`:''}`
    const request:TopologyDraft={revision:workflow.data.revision,targets:ids.map(id=>({kind:'node',id})),action:mode,text:description,summary:`${mode==='design'?'设计拓扑':mode==='implement'?'按图开发':'核对代码'} · ${target}`}
    setBusy(true);setIssue('')
    try{await window.workspace.prepareTopologyWorkflow(sessionId,request);onReady(description,request)}catch(error){setIssue(error instanceof Error?error.message:String(error))}finally{setBusy(false)}
  }
  return <div className="topology-operation-shade"><section className="topology-operation-dialog" role="dialog" aria-label="拓扑设计与开发">
    <header><GitBranch size={18}/><strong>设计与开发</strong><button disabled={busy} aria-label="关闭拓扑设计与开发" onClick={onClose}><X size={17}/></button></header>
    <div className="topology-operation-body">
      <label>工作方式<select aria-label="拓扑工作方式" value={mode} disabled={busy} onChange={e=>{setMode(e.target.value as WorkflowMode);setIssue('')}}>{Object.entries(modes).map(([key,value])=><option key={key} value={key} disabled={key!=='design'&&!workflow.data.graph}>{value.label}</option>)}</select></label>
      <p>{info.description}</p>
      <label>处理范围<select aria-label="拓扑开发范围" value={scope} disabled={busy} onChange={e=>setScope(e.target.value)}><option value="">整个项目</option>{!!workflow.nodeIds.length&&<option value="selected">当前选区 · {selected.map(n=>n.label).join('、')}</option>}{nodes.map(n=><option key={n.id} value={n.id}>{n.label} · {n.id}</option>)}</select></label>
      <label>要求<textarea autoFocus aria-label="拓扑设计开发要求" value={text} disabled={busy} onChange={e=>setText(e.target.value)} maxLength={5000} placeholder={info.placeholder}/></label>
      <p className="topology-operation-note">计划中的节点与连接会明确标记。按图开发前检查数据流和验收条件；设计通过、代码已写入、测试报告通过是不同状态。普通聊天修改代码时，也会提示 AI 同步维护已有拓扑。</p>
      {issue&&<p className="topology-error" role="alert">{issue}</p>}
    </div><footer><small>加入输入框后，发送消息开始执行。</small><button disabled={busy||running} onClick={()=>void submit()}>{busy?'正在准备…':'加入对话'}</button></footer>
  </section></div>
}
