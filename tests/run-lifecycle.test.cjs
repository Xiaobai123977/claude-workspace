const test=require('node:test'),assert=require('node:assert/strict')
const {TurnAccumulator}=require('../electron/stream.cjs')
const {mainEvent,observeRunEvent,finishDisposition,agentProgress}=require('../electron/run-lifecycle.cjs')
function fixture(){const message={id:'reply',role:'assistant',text:'',tools:[],status:'running'},run={message,tasks:new Set(),completed:false,topologyTask:true};run.accumulator=new TurnAccumulator(message);return run}
function consume(run,event,owned=true){observeRunEvent(run,event,owned);if(owned)run.accumulator.consume(event);agentProgress(run);return finishDisposition(run)}
const state=value=>({type:'system',subtype:'session_state_changed',state:value}),result=()=>({type:'result',subtype:'success',result:'阶段回复'})
test('last background task completion invalidates a previous idle/result pair until the parent produces its own new result',()=>{
  const run=fixture();consume(run,state('busy'));consume(run,{type:'system',subtype:'task_started',task_id:'one',task_type:'local_agent'});consume(run,result());assert.equal(consume(run,state('idle')),null)
  assert.equal(consume(run,{type:'system',subtype:'task_notification',task_id:'one',status:'completed'}),null);assert.equal(run.tasks.size,0);assert.equal(run.accumulator.result,null);assert.equal(run.mainResultFresh,false)
  assert.equal(consume(run,state('idle')),null,'An idle event cannot substitute for the parent merge result')
  consume(run,{type:'assistant',message:{id:'merge',content:[{type:'tool_use',id:'write',name:'Write',input:{file_path:'graph.json'}}]}})
  consume(run,{type:'user',message:{content:[{type:'tool_result',tool_use_id:'write',content:'written'}]}})
  assert.equal(consume(run,result()),null);assert.equal(consume(run,state('idle')),'now')
})
test('child results, sidechain aliases and old task notifications cannot finish or change another main turn',()=>{
  const run=fixture();consume(run,state('busy'))
  consume(run,{...result(),parent_tool_use_id:'agent'});consume(run,{...result(),parentToolUseID:'other'});consume(run,{...result(),isSidechain:true})
  assert.equal(run.mainResultFresh,false);assert.equal(run.accumulator.result,null);assert.equal(finishDisposition(run),null)
  consume(run,result());consume(run,state('idle'))
  assert.equal(consume(run,{type:'system',subtype:'task_notification',task_id:'old',status:'completed'},false),'now');assert.equal(run.tasks.size,0)
  assert.equal(mainEvent({type:'assistant',parentToolUseID:'agent'}),false)
})
test('legacy completion grace is cancelled on resumed parent work and rechecks pending approvals',async()=>{
  const run=fixture();assert.equal(consume(run,result()),'legacy');let finished=false
  run.finishTimer=setTimeout(()=>{finished=finishDisposition(run)==='legacy'},20)
  consume(run,{type:'stream_event',event:{type:'message_start',message:{id:'resumed'}}});await new Promise(resolve=>setTimeout(resolve,35));assert.equal(finished,false);assert.equal(finishDisposition(run),null)
  consume(run,result());assert.equal(finishDisposition(run,1),null);assert.equal(finishDisposition(run,0),'legacy')
  run.stopped=true;assert.equal(finishDisposition(run,0),'legacy','Stop acknowledgements must still settle promptly')
})
test('trailing canonical text before idle remains part of its completed result, while new tool work invalidates it',()=>{
  const run=fixture();consume(run,state('busy'));consume(run,result());consume(run,{type:'assistant',message:{id:'tail',content:[{type:'text',text:'最终完整输出'}]}})
  assert.equal(run.mainResultFresh,true);assert.equal(consume(run,state('idle')),'now')
  consume(run,{type:'assistant',message:{id:'work',content:[{type:'tool_use',id:'read',name:'Read',input:{}}]}});assert.equal(run.mainResultFresh,false);assert.equal(finishDisposition(run),null)
})
test('explicit child cancellation or a terminal main error can settle an already finished parent without waiting for a nonexistent merge',()=>{
  for(const failure of [false,true]){
    const run=fixture();consume(run,state('busy'));consume(run,{type:'system',subtype:'task_started',task_id:'one',task_type:'local_agent'});consume(run,failure?{type:'result',is_error:true,subtype:'error_during_execution',errors:['original API failure']}:result());consume(run,state('idle'))
    if(!failure)run.cancelledTasks=new Set(['one'])
    assert.equal(consume(run,{type:'system',subtype:'task_notification',task_id:'one',status:failure?'failed':'stopped'}),'now')
    if(failure)assert.equal(run.accumulator.error,'original API failure')
  }
})
test('progress distinguishes child completion from parent merge and writing, preserving stage elapsed time',()=>{
  const run=fixture();run.message.tools.push({id:'one',name:'Agent',status:'running'},{id:'two',name:'Agent',status:'running'})
  agentProgress(run,100);assert.equal(run.message.agentProgress.stage,'exploring');run.message.tools[0].status='done';agentProgress(run,200);assert.equal(run.message.agentProgress.since,100)
  run.message.tools[1].status='done';agentProgress(run,300);assert.deepEqual(run.message.agentProgress,{stage:'merging',completed:2,total:2,since:300,topology:true})
  agentProgress(run,500);assert.equal(run.message.agentProgress.since,300)
  run.message.tools.push({id:'edit',name:'Edit',status:'running'});agentProgress(run,600);assert.equal(run.message.agentProgress.stage,'writing');assert.equal(run.message.agentProgress.since,600)
})
test('a successful background launch does not count as an already returned child',()=>{
  const run=fixture();run.message.tools.push({id:'one',name:'Agent',input:JSON.stringify({run_in_background:true}),status:'done'});agentProgress(run,100)
  assert.equal(run.message.agentProgress.completed,0);assert.equal(run.message.agentProgress.stage,'exploring')
  run.message.tasks=[{id:'background',toolUseId:'one',status:'completed'}];agentProgress(run,200);assert.equal(run.message.agentProgress.completed,1);assert.equal(run.message.agentProgress.stage,'merging')
})
