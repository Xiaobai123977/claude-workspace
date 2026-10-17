const test=require('node:test'),assert=require('node:assert/strict')
const {nextFinalRetry,MAX_RETRIES,DELAY_MS}=require('../electron/final-error-retry.cjs')
test('all terminal errors get exactly three outer retries with a fixed three second interval',()=>{
  for(const error of ['HTTP 400','HTTP 401','HTTP 403','HTTP 404','HTTP 429','HTTP 503','CLI exited (1)','invalid JSON','unknown failure']){
    const run={message:{status:'error',error},retryInput:{},finalRetries:0}
    for(let i=1;i<=3;i++){const retry=nextFinalRetry(run,100);assert.equal(retry.attempt,i);assert.equal(retry.maxRetries,3);assert.equal(retry.nextAt,3100);assert.equal(retry.errorType,error);run.finalRetries=retry.attempt}
    assert.equal(nextFinalRetry(run),null)
  }
  assert.equal(MAX_RETRIES,3);assert.equal(DELAY_MS,3000)
})
test('success, user stop and non-replayable unsolicited events never auto restart',()=>{
  assert.equal(nextFinalRetry({message:{status:'done'},retryInput:{}}),null)
  assert.equal(nextFinalRetry({message:{status:'error'},retryInput:{},stopped:true}),null)
  assert.equal(nextFinalRetry({message:{status:'error'}}),null)
})
