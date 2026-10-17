const fs=require('node:fs')
const path=require('node:path')

// A foreground transition must repaint the existing page, not reload live UI.
function installWindowRendering(window,{powerMonitor,logFile,onForeground=()=>{}}={}){
  const wc=window.webContents
  let timer,closed=false
  const recoveries=[]
  function log(event,details={}){
    if(!logFile)return
    try{
      fs.mkdirSync(path.dirname(logFile),{recursive:true})
      if(fs.existsSync(logFile)&&fs.statSync(logFile).size>256*1024)fs.writeFileSync(logFile,'')
      fs.appendFileSync(logFile,JSON.stringify({time:new Date().toISOString(),event,...details})+'\n')
    }catch{/* Diagnostics must not interrupt a running task. */}
  }
  function repaint(){
    clearTimeout(timer)
    timer=setTimeout(()=>{
      if(closed||window.isDestroyed()||wc.isDestroyed()||!window.isVisible()||window.isMinimized())return
      try{onForeground();wc.invalidate()}catch(error){log('repaint-failed',{message:error.message})}
    },100)
  }
  const events=['restore','show','focus']
  for(const event of events)window.on(event,repaint)
  powerMonitor?.on('resume',repaint)
  wc.setBackgroundThrottling(false)
  wc.on('render-process-gone',(_event,details)=>{
    log('render-process-gone',{reason:details.reason,exitCode:details.exitCode})
    if(closed||window.isDestroyed()||wc.isDestroyed()||!['crashed','oom','abnormal-exit'].includes(details.reason))return
    const now=Date.now()
    while(recoveries.length&&recoveries[0]<now-60000)recoveries.shift()
    if(recoveries.length>=2){log('renderer-recovery-limit');return}
    recoveries.push(now)
    // Main-process tasks survive a renderer crash; reload only the dead UI.
    log('renderer-reload')
    wc.reload()
  })
  window.on('unresponsive',()=>log('window-unresponsive'))
  window.once('closed',()=>{
    closed=true;clearTimeout(timer)
    powerMonitor?.removeListener('resume',repaint)
  })
}
module.exports={installWindowRendering}
