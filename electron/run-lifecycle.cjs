const mainEvent=event=>!event.parent_tool_use_id&&!event.parentToolUseID&&!event.isSidechain
const terminalTask=event=>event.subtype==='task_notification'||event.subtype==='task_updated'&&['completed','failed','stopped'].includes(event.patch?.status||event.status)
function observeRunEvent(run,event,ownsTask=true){
  if(!mainEvent(event))return
  const state=event.type==='system'&&event.subtype==='session_state_changed',task=event.type==='system'&&/^task_/.test(event.subtype||'')
  if(task&&!ownsTask)return
  if(task&&event.task_id){
    if(event.subtype==='task_started'&&(!event.task_type||['local_agent','local_workflow'].includes(event.task_type)))run.tasks.add(event.task_id)
    if(terminalTask(event))run.tasks.delete(event.task_id)
  }
  const canonicalTail=event.type==='assistant'&&run.mainResultFresh&&!run.tasks.size&&run.sessionState!=='idle'&&!event.message?.content?.some?.(b=>b.type==='tool_use')
  const activity=event.type==='assistant'&&!canonicalTail||event.type==='stream_event'&&['message_start','content_block_start','content_block_delta'].includes(event.event?.type)||event.type==='control_request'||event.type==='user'&&event.message?.content?.some?.(b=>b.type==='tool_result')||task&&(event.subtype==='task_started'||terminalTask(event))||state&&event.state!=='idle'
  if(activity){
    clearTimeout(run.finishTimer);run.finishTimer=undefined
    const terminalAcknowledgement=task&&terminalTask(event)&&(run.accumulator.error||run.cancelledTasks?.has(event.task_id))
    if(!terminalAcknowledgement){run.mainResultFresh=false;run.accumulator.result=null}
    // A prior idle/result pair belongs to the previous owed turn. In particular,
    // the last task notification is input for the parent, never its final answer.
    if(run.hasSessionState&&!terminalAcknowledgement)run.sessionState='busy'
  }
  if(state){run.hasSessionState=true;run.sessionState=event.state}
  if(event.type==='result')run.mainResultFresh=true
}
function finishDisposition(run,pending=0){
  if(run.completed||!run.mainResultFresh||!run.accumulator.result||pending||run.tasks.size)return null
  return run.sessionState==='idle'?'now':!run.hasSessionState?'legacy':null
}
function agentProgress(run,now=Date.now()){
  const tools=run.message.tools.filter(t=>['Agent','Task'].includes(t.name)),ids=new Set([...tools.map(t=>t.id),...(run.message.subagents||[]).map(a=>a.id)])
  if(!ids.size)return
  let completed=0
  for(const id of ids){
    const task=run.message.tasks?.find(t=>t.toolUseId===id),child=run.message.subagents?.find(a=>a.id===id),tool=tools.find(t=>t.id===id);let status=task?.status||child?.status||tool?.status
    // A background Agent launch returning successfully is not the child's result.
    if(!task&&!child&&status==='done'){try{if(JSON.parse(tool.input).run_in_background)status='running'}catch{}}
    if(['done','completed','failed','error','stopped'].includes(status))completed++
  }
  const writing=run.message.tools.some(t=>['Write','Edit','MultiEdit','NotebookEdit'].includes(t.name)&&['running','waiting'].includes(t.status)),stage=completed<ids.size?'exploring':writing?'writing':'merging',old=run.message.agentProgress
  run.message.agentProgress={stage,total:ids.size,completed,since:old?.stage===stage?old.since:now,topology:!!run.topologyTask}
}
module.exports={mainEvent,observeRunEvent,finishDisposition,agentProgress}
