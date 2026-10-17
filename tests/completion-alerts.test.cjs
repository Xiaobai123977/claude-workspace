const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events')
const {CompletionAlerts,completionAlert,validateAlertPreferences}=require('../electron/completion-alerts.cjs')
const input=(extra={})=>({session:{id:'chat',title:'任务标题'},message:{time:1000,status:'done'},now:61000,focused:false,activeId:'chat',...extra})
test('long parent completion alerts default to one minute; short, stopped, running and historical-invalid turns remain silent',()=>{
  assert.equal(completionAlert(input({now:60999})),null)
  assert.equal(completionAlert(input()).sound,true);assert.equal(completionAlert(input()).desktop,true)
  for(const extra of [{stopped:true},{message:{time:0,status:'running'}},{message:{status:'done'}},{message:{time:0,status:'stopped'}}])assert.equal(completionAlert(input(extra)),null)
  assert.equal(completionAlert(input({preferences:{completionMinSeconds:180}})),null)
  assert.match(completionAlert(input({message:{time:1000,status:'error'}})).title,/失败/)
})
test('sound and background notifications are independent; focused current chat suppresses desktop only',()=>{
  assert.equal(completionAlert(input({focused:true})).desktop,false)
  assert.equal(completionAlert(input({focused:true,activeId:'another'})).desktop,true)
  assert.equal(completionAlert(input({preferences:{completionSound:false}})).sound,false)
  assert.equal(completionAlert(input({preferences:{completionNotification:false}})).desktop,false)
  assert.equal(completionAlert(input({preferences:{completionSound:false,completionNotification:false}})),null)
  assert.equal(completionAlert(input({preferences:{completionMinSeconds:30},now:31000})).desktop,true)
})
test('native delivery beeps once, keeps toast silent, opens exact chat, releases notifications and tolerates unsupported systems',()=>{
  const shown=[],opened=[];let beeps=0
  class Toast extends EventEmitter{static isSupported(){return true}constructor(options){super();this.options=options}show(){shown.push(this)}close(){this.emit('close')}}
  const service=new CompletionAlerts({Notification:Toast,shell:{beep(){beeps++}},onOpen:id=>opened.push(id)})
  service.deliver(input());assert.equal(beeps,1);assert.equal(shown.length,1);assert.equal(shown[0].options.silent,true);assert.equal(service.visible.size,1)
  shown[0].emit('click');assert.deepEqual(opened,['chat']);assert.equal(service.visible.size,0)
  service.deliver(input({focused:true}));assert.equal(shown.length,1);assert.equal(beeps,2)
  Toast.isSupported=()=>false;service.deliver(input());assert.equal(shown.length,1);assert.equal(beeps,3)
})
test('OS failures never break task completion and only validated preference types are accepted',()=>{
  const errors=[],service=new CompletionAlerts({Notification:{isSupported(){throw Error('unavailable')}},shell:{beep(){throw Error('sound unavailable')}},onOpen(){},onError:e=>errors.push(e.message)})
  assert.doesNotThrow(()=>service.deliver(input()));assert.equal(errors.length,2)
  validateAlertPreferences({completionSound:false,completionNotification:true,completionMinSeconds:300})
  for(const patch of [{completionSound:'false'},{completionNotification:0},{completionMinSeconds:0},{completionMinSeconds:'60'}])assert.throws(()=>validateAlertPreferences(patch),/无效/)
})
