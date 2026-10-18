const test=require('node:test'),assert=require('node:assert/strict')
const {StatePublisher}=require('../electron/state-publisher.cjs')
const tick=()=>new Promise(r=>setTimeout(r,20))
test('stream bursts coalesce, blocked renderer has one snapshot in flight, stale ACK cannot release it',async()=>{
  const sent=[],p=new StatePublisher({send:id=>sent.push(id),delay:1})
  for(let i=0;i<10000;i++)p.request()
  await tick();assert.deepEqual(sent,[1])
  for(let i=0;i<10000;i++)p.request()
  await tick();assert.deepEqual(sent,[1]);p.ack(0);await tick();assert.deepEqual(sent,[1])
  p.ack(1);await tick();assert.deepEqual(sent,[1,2]);p.close();p.request();await tick();assert.deepEqual(sent,[1,2])
})
test('hidden windows skip snapshots; showing or renderer restart sends current state',async()=>{
  const sent=[];let visible=false
  const p=new StatePublisher({send:id=>sent.push(id),isVisible:()=>visible,delay:1})
  p.request();await tick();assert.equal(sent.length,0)
  visible=true;p.request();await tick();assert.deepEqual(sent,[1])
  p.reset();await tick();assert.deepEqual(sent,[1,2]);p.ack(1);p.request();await tick();assert.deepEqual(sent,[1,2]);p.close()
})
