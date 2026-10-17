import type {Message,Tool,TaskInfo} from './types'
export const isAgentTool=(tool:Tool)=>['Agent','Task'].includes(tool.name)
export type AgentCard={id:string;title:string;status:string;tool?:Tool;agent?:NonNullable<Message['subagents']>[number];task?:TaskInfo}
export function agentCards(message:Message):AgentCard[]{
  const cards:AgentCard[]=message.tools.filter(isAgentTool).map(tool=>{
    let title='子代理'
    try{const input=JSON.parse(tool.input);title=input.description||input.name||input.subagent_type||title}catch{/* Input can still be streaming. */}
    return{id:tool.id,title:String(title),status:tool.status,tool}
  })
  for(const agent of message.subagents||[]){
    let card=cards.find(c=>c.id===agent.id)
    if(!card){card={id:agent.id,title:'子代理',status:agent.status};cards.push(card)}
    card.agent=agent;card.status=agent.status
  }
  for(const task of message.tasks||[]){
    let card=cards.find(c=>c.id===(task.toolUseId||task.id))
    if(!card){card={id:task.toolUseId||task.id,title:task.description||'后台任务',status:task.status};cards.push(card)}
    card.task=task;card.status=task.status
    if(card.title==='子代理')card.title=task.description||card.title
  }
  return cards
}
