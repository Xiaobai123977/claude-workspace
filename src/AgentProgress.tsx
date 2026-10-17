import {useEffect,useState} from 'react'
import type {Message} from './types'
export function AgentProgress({progress}:{progress:NonNullable<Message['agentProgress']>}){
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  const seconds=Math.max(0,Math.floor((now-progress.since)/1000)),duration=seconds>=60?`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`:`${seconds} 秒`
  const label=progress.stage==='exploring'?'子代理正在探索模块':progress.stage==='writing'?(progress.topology?'主模型正在合并写图':'主模型正在写入文件'):(progress.topology?'子代理已返回，等待主模型核对并汇总写图':'子代理已返回，等待主模型汇总结果')
  return <div className="working agent-progress" role="status" aria-live="polite"><span className="pulse-dot"/><span><span>{label}</span><small>子代理 {progress.completed}/{progress.total} 已返回 · 当前阶段 {duration}{progress.stage==='merging'?' · 尚未完成主任务':''}</small></span></div>
}
