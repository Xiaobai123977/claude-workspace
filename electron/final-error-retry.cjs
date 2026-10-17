// This outer budget is independent of gateway retries and provider failover.
const MAX_RETRIES=3,DELAY_MS=3000
function nextFinalRetry(run,now=Date.now()){
  if(run.stopped||run.message.status!=='error'||!run.retryInput||(run.finalRetries||0)>=MAX_RETRIES)return null
  return {requestId:'final-error-retry',phase:'waiting',reason:'turn',errorType:run.message.error||'调用失败',attempt:(run.finalRetries||0)+1,maxRetries:MAX_RETRIES,nextAt:now+DELAY_MS}
}
module.exports={nextFinalRetry,MAX_RETRIES,DELAY_MS}
