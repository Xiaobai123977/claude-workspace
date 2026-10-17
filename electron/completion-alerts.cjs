const DEFAULT_MIN_SECONDS=60
function validateAlertPreferences(patch){
  for(const key of ['completionSound','completionNotification'])if(key in patch&&typeof patch[key]!=='boolean')throw new Error('任务提醒开关无效')
  if('completionMinSeconds' in patch&&![30,60,180,300].includes(patch.completionMinSeconds))throw new Error('长任务提醒时间无效')
}
function completionAlert({preferences={},session,message,stopped=false,focused=false,activeId,now=Date.now()}){
  if(stopped||!['done','error'].includes(message.status)||!Number.isFinite(message.time))return null
  const seconds=[30,60,180,300].includes(preferences.completionMinSeconds)?preferences.completionMinSeconds:DEFAULT_MIN_SECONDS
  const elapsed=now-message.time;if(elapsed<seconds*1000)return null
  const sound=preferences.completionSound!==false,desktop=preferences.completionNotification!==false&&(!focused||activeId!==session.id)
  if(!sound&&!desktop)return null
  return {sound,desktop,title:message.status==='error'?'长任务执行失败':'长任务已完成',body:`${String(session.title||'聊天').replace(/[\r\n]+/g,' ').slice(0,80)} · 用时 ${Math.floor(elapsed/60000)} 分 ${Math.floor(elapsed/1000)%60} 秒`,sessionId:session.id}
}
// The parent run invokes this once after its actual terminal state; child events never alert.
class CompletionAlerts{
  constructor({Notification,shell,onOpen,onError=()=>{}}){Object.assign(this,{Notification,shell,onOpen,onError});this.visible=new Set()}
  deliver(input){
    const alert=completionAlert(input);if(!alert)return
    if(alert.sound)try{this.shell.beep()}catch(error){this.onError(error)}
    if(alert.desktop)try{
      if(!this.Notification.isSupported())return
      // Sound is controlled independently; do not also play the OS toast sound.
      const notification=new this.Notification({title:alert.title,body:alert.body,silent:true})
      this.visible.add(notification)
      notification.once('click',()=>{this.visible.delete(notification);this.onOpen(alert.sessionId)})
      notification.once('close',()=>this.visible.delete(notification))
      notification.once('failed',(_event,error)=>{this.visible.delete(notification);this.onError(new Error(String(error)))})
      notification.show()
      if(this.visible.size>20){const oldest=this.visible.values().next().value;this.visible.delete(oldest);oldest.close()}
    }catch(error){this.onError(error)}
  }
}
module.exports={CompletionAlerts,completionAlert,validateAlertPreferences,DEFAULT_MIN_SECONDS}
