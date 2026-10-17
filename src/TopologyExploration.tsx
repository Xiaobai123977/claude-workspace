import React,{useEffect,useState} from 'react'
import {GitBranch,RefreshCw,Users,X} from 'lucide-react'
import type {TopologyData,TopologyDraft} from './types'
import {normalizeTopologyModules} from './topology-selection'
const api=window.workspace
export type TopologyOperation={mode:'explore'|'regenerate';nodeId?:string;nodeIds?:string[];depth?:'auto';data:TopologyData}
export function TopologyExploration({sessionId,operation,running,onClose,onReady}:{sessionId:string;operation:TopologyOperation;running:boolean;onClose():void;onReady(text:string,context:TopologyDraft,backup?:string):void}){
  const initialIds=operation.nodeIds|| (operation.nodeId?[operation.nodeId]:[])
  const [moduleIds,setModuleIds]=useState(initialIds),[scope,setScope]=useState(initialIds.length>1?'@multiple':initialIds[0]||''),[depth,setDepth]=useState(operation.depth||'2'),[customDepth,setCustomDepth]=useState('3'),[parallel,setParallel]=useState(true),[busy,setBusy]=useState(false),[issue,setIssue]=useState('')
  const regenerate=operation.mode==='regenerate',nodes=operation.data.graph?.nodes||[],chosenIds=scope==='@multiple'?moduleIds:scope?[scope]:[],chosen=nodes.filter(n=>chosenIds.includes(n.id)),normalized=normalizeTopologyModules(nodes,chosenIds),label=regenerate?'重新生成':'并发探索'
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!busy)onClose()}};window.addEventListener('keydown',escape,true);return()=>window.removeEventListener('keydown',escape,true)},[busy,onClose])
  const submit=async()=>{
    const value=depth==='auto'?'auto':Number(depth==='custom'?customDepth:depth)
    if(value!=='auto'&&(!Number.isInteger(value)||value<1||value>100)){setIssue('探索深度应为 1–100 层');return}
    if((scope==='@multiple'&&!chosenIds.length)||chosenIds.length>20){setIssue('请选择 1–20 个业务模块');return}
    if(chosen.length!==chosenIds.length){setIssue('所选模块已不存在，请重新选择');return}
    const target=chosen.length?`模块「${chosen.map(n=>n.label).join('、')}」`:'整个项目',depthText=value==='auto'?'由模型自行判断探索结束':`探索 ${value} 层`,text=`请${label}${target}的业务拓扑，${depthText}。`
    const request:TopologyDraft={revision:operation.data.revision,targets:chosenIds.map(id=>({kind:'node',id})),action:operation.mode,text,depth:value,parallel:regenerate?parallel:true,summary:`${label} · ${chosen.length>1?chosen.length+' 个模块':chosen[0]?.label||'整个项目'} · ${value==='auto'?'自动深度':value+' 层'}`}
    setBusy(true);setIssue('')
    try{const result=await api.prepareTopologyOperation(sessionId,request);onReady(text,request,result.backup)}catch(error){setIssue(error instanceof Error?error.message:String(error))}finally{setBusy(false)}
  }
  return <div className="topology-operation-shade"><section className="topology-operation-dialog" role="dialog" aria-label={regenerate?'重新生成拓扑设置':'并发探索设置'}>
    <header>{regenerate?<RefreshCw size={18}/>:<Users size={18}/>}<strong>{regenerate?'重新生成拓扑 / 节点':'并发探索业务逻辑'}</strong><button disabled={busy} aria-label="关闭拓扑探索设置" onClick={onClose}><X size={17}/></button></header>
    <div className="topology-operation-body"><p>{regenerate?'根据当前代码重新推导所选范围。准备任务时会备份现有图，再交给主模型重新生成。':'主模型拆分业务模块，尽可能使用原生子代理的可用并发能力，分批覆盖各层并统一汇总。'}</p>
      <label>探索范围<select autoFocus aria-label="拓扑探索范围" disabled={busy} value={scope} onChange={event=>setScope(event.target.value)}><option value="">整个项目</option>{!!nodes.length&&<option value="@multiple">多个模块（勾选）</option>}{nodes.map(n=><option key={n.id} value={n.id}>{n.label} · {n.id}</option>)}</select></label>
      {scope==='@multiple'&&<fieldset className="topology-operation-modules"><legend>选择模块 · {chosenIds.length} / 20</legend>{nodes.map(n=><label key={n.id}><input type="checkbox" aria-label={`探索模块 ${n.label} · ${n.id}`} disabled={busy} checked={moduleIds.includes(n.id)} onChange={event=>setModuleIds(old=>event.target.checked?[...old,n.id]:old.filter(id=>id!==n.id))}/><span>{n.label}<small>{n.id}</small></span></label>)}</fieldset>}
      {normalized.overlapping.length>0&&<p className="topology-operation-overlap">已选 {chosenIds.length} 个模块，合并为 {normalized.roots.length} 个探索范围。父子重叠部分只探索一次。</p>}
      <label>探索深度<select aria-label="拓扑探索深度" disabled={busy} value={depth} onChange={event=>setDepth(event.target.value)}><option value="1">1 层</option><option value="2">2 层</option><option value="custom">N 层（自定义）</option><option value="auto">模型自行判断结束</option></select></label>
      {depth==='custom'&&<label>层数<input aria-label="自定义拓扑层数" type="number" min={1} max={100} step={1} disabled={busy} value={customDepth} onChange={event=>setCustomDepth(event.target.value)}/></label>}
      <div className="topology-operation-depth"><GitBranch size={14}/><span>{scope?'最外层选中模块的直接子模块算第 1 层。':'项目顶层业务模块算第 1 层。'}{depth==='auto'?'逐层核实到业务叶子或外部边界，应用检查缺口并继续下一批；最多 8 批，连续两轮无进展会暂停并明确保留未完成范围。':'已有更深且仍有效的子树会保留。'}</span></div>
      {regenerate?<label className="topology-operation-parallel"><input type="checkbox" disabled={busy} checked={parallel} onChange={event=>setParallel(event.target.checked)}/>并行派出子代理探索</label>:<small>并发数量取决于当前 CLI、模型和供应商的实际能力；不可独立的任务由主模型按依赖顺序处理。</small>}
      <p className="topology-operation-note">子代理只读探索，主模型统一写图。只处理拓扑，不修改业务代码。达到图容量或运行限制时，会要求模型列明未完成范围。</p>
      {issue&&<p className="topology-error" role="alert">{issue}</p>}
    </div><footer><small>加入输入框后，发送消息开始执行。</small><button disabled={busy||running} onClick={()=>void submit()}>{busy?'正在准备…':`准备${label}`}</button></footer>
  </section></div>
}
