const test=require('node:test'),assert=require('node:assert/strict')
const {planMessageAction,regenerationOrigin,failedRetryInput}=require('../electron/message-actions.cjs')
const session=()=>({id:'original',messages:[{id:'u1',role:'user',text:'first',checkpointId:'nu1',status:'done'},{id:'a1',role:'assistant',text:'old answer',nativeUUID:'na1',status:'done'},{id:'u2',role:'user',text:'second',checkpointId:'nu2',attachments:[{path:'picture.png'}],browserContexts:[{selector:'#target'}],status:'done'},{id:'a2',role:'assistant',text:'second answer',nativeUUID:'na2',status:'done'},{id:'u3',role:'user',text:'later',checkpointId:'nu3',status:'done'}]})

test('only a failed or stopped last answer retries in place; prior answers retain branching semantics',()=>{
  const s=session();s.messages.pop();s.messages.at(-1).status='error'
  const before=JSON.stringify(s),user=failedRetryInput(s,'a2')
  assert.equal(user.id,'u2');assert.equal(user.attachments[0].path,'picture.png');assert.equal(user.browserContexts[0].selector,'#target')
  user.text='changed';assert.equal(JSON.stringify(s),before)
  s.messages.at(-1).status='stopped';assert.equal(failedRetryInput(s,'a2').id,'u2')
  s.messages.at(-1).status='done';assert.equal(failedRetryInput(s,'a2'),null)
  s.messages[1].status='error';assert.equal(failedRetryInput(s,'a1'),null)
  assert.equal(failedRetryInput(s,'missing'),null)
})
test('message branch includes the selected message and excludes all later context without mutating the original',()=>{const s=session(),before=JSON.stringify(s),plan=planMessageAction(s,'a1','branch');assert.deepEqual(plan.messages.map(m=>m.id),['u1','a1']);assert.equal(plan.nativeAt,'na1');plan.messages[0].text='changed';assert.equal(JSON.stringify(s),before);assert.equal(planMessageAction(s,'u2','branch').nativeAt,'nu2')})
test('regeneration excludes the old question, its answer and later turns from the branch prefix, preserving question metadata for replay',()=>{const s=session(),plan=planMessageAction(s,'a2','regenerate');assert.deepEqual(plan.messages.map(m=>m.id),['u1','a1']);assert.equal(plan.nativeAt,'na1');assert.equal(plan.user.text,'second');assert.equal(plan.user.attachments[0].path,'picture.png');assert.equal(plan.user.browserContexts[0].selector,'#target');const first=planMessageAction(s,'a1','regenerate');assert.deepEqual(first.messages,[]);assert.equal(first.nativeAt,undefined);assert.equal(first.user.id,'u1')})
test('errors with no native assistant record can be regenerated; invalid positions and active answers are rejected',()=>{const s=session();delete s.messages[3].nativeUUID;s.messages[3].status='error';assert.equal(planMessageAction(s,'a2','regenerate').nativeAt,'na1');assert.throws(()=>planMessageAction(s,'missing','branch'),/不存在/);assert.throws(()=>planMessageAction(s,'u1','regenerate'),/只能/);s.messages[3].status='running';assert.throws(()=>planMessageAction(s,'a2','regenerate'),/停止/);assert.throws(()=>planMessageAction({messages:[{id:'a',role:'assistant',status:'done'}]},'a','regenerate'),/对应的问题/);assert.throws(()=>planMessageAction({messages:[{id:'u',role:'user',status:'done'}]},'u','branch'),/定位/)} )
test('regeneration of a generated answer stays in the same version family; other messages start their own family',()=>{const s=session();s.regeneration={origin:{sessionId:'root',messageId:'root-answer'},answerId:'a2'};assert.deepEqual(regenerationOrigin(s,'a2'),{sessionId:'root',messageId:'root-answer'});assert.deepEqual(regenerationOrigin(s,'a1'),{sessionId:'original',messageId:'a1'})})
