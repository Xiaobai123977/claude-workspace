import {useState,type ReactNode} from 'react'
import {Bot,ChevronRight,LoaderCircle,Monitor} from 'lucide-react'
import {LargeContent,LazyThought} from './LargeContent'
import type {Message,Tool} from './types'
import {agentCards,type AgentCard} from './agent-cards'
import './agent-activity.css'

const names:Record<string,string>={running:'运行中',pending:'等待中',waiting:'等待确认',done:'已完成',completed:'已完成',error:'失败',failed:'失败',stopped:'已停止',cancelled:'已停止'}
function ActivityCard({card,sessionId,renderTools,onOpenLink}:{card:AgentCard;sessionId:string;renderTools(tools:Tool[]):ReactNode;onOpenLink(url:string):void}){
  const [open,setOpen]=useState(false),[stopping,setStopping]=useState(false),[issue,setIssue]=useState('')
  const active=['running','pending','waiting'].includes(card.status),agent=!!card.agent||!!card.tool
  const text=card.agent?.text||card.tool?.output||card.task?.summary||''
  return <section className={`agent-activity ${agent?'is-agent':'is-task'} ${active?'is-active':''}`} data-task-card={card.id} data-task-active={active?'true':'false'}>
    <button className="agent-activity-summary" aria-expanded={open} onClick={()=>setOpen(!open)}>
      {active?<LoaderCircle size={15} className="spin"/>:agent?<Bot size={15}/>:<Monitor size={15}/>}<span><strong>{agent?'子代理':'后台任务'}{card.title!==(agent?'子代理':'后台任务')?' · '+card.title:''}</strong><small>{card.agent?.tools.length?`${card.agent.tools.length} 次工具调用`:active?'独立执行中':'点击查看结果与工具记录'}</small></span><em>{names[card.status]||card.status}</em><ChevronRight size={14} className={open?'rotated':''}/>
    </button>
    {open&&<div className="agent-activity-detail">
      {card.tool?.input&&<details><summary>任务指令</summary><LargeContent text={card.tool.input}/></details>}
      {card.agent?.thinking&&<LazyThought text={card.agent.thinking}/>}
      <div className="markdown agent-output">{text?<LargeContent text={text} markdown onOpenLink={onOpenLink}/>:<p>{active?'等待子任务输出…':'未记录输出'}</p>}</div>
      {card.task?.summary&&card.task.summary!==text&&<p className="agent-task-summary">{card.task.summary}</p>}
      {card.agent&&renderTools(card.agent.tools)}
      {card.task&&active&&<button className="agent-stop" disabled={stopping} onClick={()=>{setStopping(true);setIssue('');void window.workspace.stopTask(sessionId,card.task!.id).catch(e=>setIssue(String(e.message||e))).finally(()=>setStopping(false))}}>{stopping?'正在请求停止…':'停止此任务'}</button>}
      {issue&&<p role="alert">{issue}</p>}
    </div>}
  </section>
}
export function AgentActivity({message,sessionId,renderTools,onOpenLink}:{message:Message;sessionId:string;renderTools(tools:Tool[]):ReactNode;onOpenLink(url:string):void}){
  return <>{agentCards(message).map(card=><ActivityCard key={card.id} card={card} sessionId={sessionId} renderTools={renderTools} onOpenLink={onOpenLink}/>)}</>
}
