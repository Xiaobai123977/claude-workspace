function planMessageAction(session,messageId,action) {
  if(!['branch','regenerate'].includes(action))throw new Error('消息操作无效')
  const index=session.messages.findIndex(m=>m.id===messageId)
  if(index<0)throw new Error('消息不存在，请刷新聊天')
  const selected=session.messages[index]
  if(selected.status==='running')throw new Error('请先停止当前回复')
  let userIndex=-1
  if(action==='regenerate'){
    if(selected.role!=='assistant')throw new Error('只能重新生成 Claude 的回答')
    for(let i=index-1;i>=0;i--)if(session.messages[i].role==='user'){userIndex=i;break}
    if(userIndex<0)throw new Error('找不到这条回答对应的问题')
  }
  const messages=structuredClone(session.messages.slice(0,action==='branch'?index+1:userIndex))
  const anchor=[...messages].reverse().find(m=>m.nativeUUID||m.checkpointId)
  const nativeAt=anchor?.nativeUUID||anchor?.checkpointId
  if(messages.length&&!nativeAt)throw new Error('此位置缺少原生会话定位信息，无法创建准确的分支')
  return{messages,nativeAt,user:userIndex>=0?structuredClone(session.messages[userIndex]):null}
}
function regenerationOrigin(session,messageId){
  return session.regeneration?.answerId===messageId?{...session.regeneration.origin}:{sessionId:session.id,messageId}
}
module.exports={planMessageAction,regenerationOrigin}
