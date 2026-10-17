// This outer budget is independent of gateway retries and provider failover.
const MAX_RETRIES=3,DELAY_MS=3000
function nextFinalRetry(run,now=Date.now()){
  if(run.stopped||run.message.status!=='error'||!run.retryInput||(run.finalRetries||0)>=MAX_RETRIES)return null
  return {requestId:'final-error-retry',phase:'waiting',reason:'turn',errorType:run.message.error||'调用失败',attempt:(run.finalRetries||0)+1,maxRetries:MAX_RETRIES,nextAt:now+DELAY_MS}
}
function clearFinalRetryOnOutput(message,event){
  if(event.parent_tool_use_id||event.parentToolUseID||event.isSidechain||event.isApiErrorMessage)return false
  const block=b=>b&&(b.type==='tool_use'||b.type==='text'&&!!b.text||b.type==='thinking'&&!!b.thinking)
  const stream=event.type==='stream_event'?event.event:null
  const output=event.type==='assistant'&&event.message?.content?.some(block)||stream?.type==='content_block_start'&&block(stream.content_block)||stream?.type==='content_block_delta'&&!!(stream.delta?.text||stream.delta?.thinking||stream.delta?.partial_json)||event.type==='control_request'&&event.request?.subtype==='can_use_tool'
  if(!output||!message.gatewayRetries?.some(r=>r.requestId==='final-error-retry'&&r.phase==='attempting'))return false
  const remaining=message.gatewayRetries.filter(r=>r.requestId!=='final-error-retry')
  if(remaining.length)message.gatewayRetries=remaining;else delete message.gatewayRetries
  return true
}
module.exports={nextFinalRetry,clearFinalRetryOnOutput,MAX_RETRIES,DELAY_MS}
