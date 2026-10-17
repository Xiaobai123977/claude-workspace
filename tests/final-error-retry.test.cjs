const test=require('node:test'),assert=require('node:assert/strict')
const {nextFinalRetry,clearFinalRetryOnOutput,MAX_RETRIES,DELAY_MS}=require('../electron/final-error-retry.cjs')
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
test('real text, thinking and tool output clear only the outer attempt notice',()=>{
  for(const event of [
    {type:'assistant',message:{content:[{type:'thinking',thinking:'working'}]}},
    {type:'assistant',message:{content:[{type:'tool_use',id:'t',name:'Read'}]}},
    {type:'stream_event',event:{type:'content_block_delta',delta:{text:'hello'}}},
    {type:'stream_event',event:{type:'content_block_delta',delta:{thinking:'working'}}},
    {type:'stream_event',event:{type:'content_block_start',content_block:{type:'tool_use',id:'t',name:'Read'}}},
    {type:'control_request',request:{subtype:'can_use_tool'}},
  ]){
    const other={requestId:'other-request',phase:'waiting'},message={gatewayRetries:[{requestId:'final-error-retry',phase:'attempting'},other]}
    assert.equal(clearFinalRetryOnOutput(message,event),true);assert.deepEqual(message.gatewayRetries,[other])
  }
  const message={gatewayRetries:[{requestId:'final-error-retry',phase:'attempting'}]}
  assert.equal(clearFinalRetryOnOutput(message,{type:'assistant',message:{content:[{type:'text',text:'hello'}]}}),true);assert.equal(message.gatewayRetries,undefined)
})
test('metadata, old output, child events and API errors cannot clear the current retry countdown',()=>{
  const events=[{type:'system',subtype:'init'},{type:'stream_event',event:{type:'message_start'}},{type:'stream_event',event:{type:'content_block_delta',delta:{text:''}}},{type:'assistant',isApiErrorMessage:true,message:{content:[{type:'text',text:'HTTP 503'}]}},{type:'assistant',parent_tool_use_id:'child',message:{content:[{type:'text',text:'child'}]}}]
  for(const event of events){const message={gatewayRetries:[{requestId:'final-error-retry',phase:'attempting'}]};assert.equal(clearFinalRetryOnOutput(message,event),false);assert.equal(message.gatewayRetries.length,1)}
  const message={gatewayRetries:[{requestId:'final-error-retry',phase:'waiting'}]}
  assert.equal(clearFinalRetryOnOutput(message,{type:'assistant',message:{content:[{type:'text',text:'old output'}]}}),false)
})
