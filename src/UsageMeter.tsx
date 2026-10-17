import {memo,useEffect,useRef,useState} from 'react'
import {Gauge,RefreshCw,X} from 'lucide-react'
import type {Session,TokenStats,UsageReport,TokenUsage} from './types'
import './usage.css'
export const tokenTotal=(u:TokenUsage)=>['input_tokens','cache_read_input_tokens','cache_creation_input_tokens','output_tokens'].reduce((sum,k)=>sum+(u[k as keyof TokenUsage]||0),0)
const number=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('zh-CN')
const compact=(n:number|null|undefined)=>n==null?'—':new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(n)
const percent=(n:number|null|undefined)=>n==null?'—':`${n.toFixed(1)}%`
function useUsage(session:Session){
  const [value,setValue]=useState<{id:string;report:UsageReport}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const signature=JSON.stringify([session.providerId,session.model,session.effort,session.contextReport,session.messages.map(m=>[m.id,m.status,m.usage,m.lastRequestUsage,m.modelUsage,m.cacheReporting])])
  const currentId=useRef(session.id);currentId.current=session.id
  useEffect(()=>{let cancelled=false;setError('');void window.workspace.usage(session.id).then(report=>{if(!cancelled)setValue({id:session.id,report})}).catch(e=>{if(!cancelled)setError(e.message)});return()=>{cancelled=true}},[session.id,signature])
  const refresh=async()=>{if(loading)return;setLoading(true);setError('');const id=session.id;try{const report=await window.workspace.usage(id,true);if(currentId.current===id)setValue({id,report})}catch(e){if(currentId.current===id)setError(e instanceof Error?e.message:String(e))}finally{if(currentId.current===id)setLoading(false)}}
  return{report:value?.id===session.id?value.report:null,loading,error,refresh}
}
const cacheText=(s:TokenStats)=>!s.known?'暂无用量':!s.cacheKnown?'未报告':s.cacheRate==null?'暂无输入用量':percent(s.cacheRate)
function Details({report,loading,error,refresh}:{report:UsageReport|null;loading:boolean;error:string;refresh():void}){
  const c=report?.context
  return <div className="usage-details">
    <section><div className="usage-section-title"><strong>上下文窗口</strong><span>{c?.source==='cli'?'CLI 上下文报告':'待读取 CLI 上下文'}</span></div>
      <div className="usage-context-count"><strong>{number(c?.used)}</strong><span>/ {number(c?.max)} tokens</span><b>{percent(c?.percentage)}</b></div>
      <div className={'usage-track'+((c?.percentage||0)>=90?' high':'')} role="progressbar" aria-label="上下文占用" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c?.percentage==null?undefined:Math.min(100,c.percentage)}><i style={{width:`${Math.min(100,Math.max(0,c?.percentage||0))}%`}}/></div>
      {c?.source!=='cli'&&<p>上下文占用与容量仅采用 CLI 上下文报告，请点击下方按钮读取。</p>}
      {c?.rawMax&&c.rawMax!==c.max?<p>模型窗口：{number(c.rawMax)} tokens；上方为 CLI 当前窗口。</p>:null}
      {!!c?.categories.length&&<details className="usage-categories"><summary>上下文组成</summary>{c.categories.map((v,i)=><div key={i}><span>{v.name}{v.kind==='deferred'?'（延迟加载）':v.kind==='free'?'（空闲）':v.kind==='buffer'?'（预留）':''}</span><span>{number(v.tokens)}</span></div>)}</details>}
      <button className="usage-refresh" disabled={loading||!report?.connected||report.running} onClick={refresh}><RefreshCw size={12} className={loading?'spin':''}/>{loading?'正在读取…':'读取 CLI 上下文'}</button>
      {!report?.connected&&<p>发送消息后可读取 CLI 上下文报告。</p>}{error&&<p className="usage-error" role="status">{error}</p>}
    </section>
    <section><div className="usage-section-title"><strong>缓存命中率</strong><span>缓存读取 / 总输入</span></div><div className="usage-cache"><div><small>最近回答</small><strong>{report?cacheText(report.latest):'—'}</strong></div><div><small>分支合计</small><strong>{report?cacheText(report.totals):'—'}</strong></div></div>{report?.latest.known&&!report.latest.cacheKnown&&<p>上游未报告缓存统计。</p>}</section>
    <section><div className="usage-section-title"><strong>Token 统计</strong><span>包含工具调用</span></div><table><thead><tr><th>类型</th><th>最近回答</th><th>分支合计</th></tr></thead><tbody>{([['总输入','input'],['普通输入','uncached'],['缓存读取','cacheRead'],['缓存写入','cacheWrite'],['输出','output'],['总计','total']] as const).map(([title,key])=><tr key={key}><th>{title}</th><td>{number(report?.latest[key])}</td><td>{number(report?.totals[key])}</td></tr>)}</tbody></table><p>总输入包含已报告的缓存读取和写入。分支合计包含继承的历史。</p>{report?.cost!=null&&<p>最近 CLI 费用报告：${report.cost.toFixed(4)}</p>}</section>
  </div>
}
export function UsageDetails({session}:{session:Session}){return <Details {...useUsage(session)}/>}
export const UsageMeter=memo(function UsageMeter({session}:{session:Session}){
  const usage=useUsage(session),[open,setOpen]=useState(false),ref=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),r=usage.report,c=r?.context
  useEffect(()=>{if(!open)return;const pointer=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false)},key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);button.current?.focus()}};document.addEventListener('pointerdown',pointer,true);document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('keydown',key,true)}},[open])
  return <div className="usage-meter" ref={ref}><button ref={button} className="usage-meter-button" aria-label="上下文与 Token 统计" aria-expanded={open} aria-haspopup="dialog" onClick={()=>setOpen(!open)}><Gauge size={12}/><span>上下文 {c?.source==='cli'?percent(c.percentage):'待读取'}</span><i>·</i><span title="最近回答的缓存命中率">缓存 {r?.latest.cacheRate!=null?percent(r.latest.cacheRate):'—'}</span><i>·</i><span title="此分支已记录的输入（含缓存）与输出 Token">↑ {compact(r?.totals.input)} ↓ {compact(r?.totals.output)}</span></button>{open&&<div className="usage-popover" role="dialog" aria-label="上下文与 Token 统计详情"><header><strong>上下文与用量</strong><button aria-label="关闭用量统计" onClick={()=>setOpen(false)}><X size={15}/></button></header><Details {...usage}/></div>}</div>
})
