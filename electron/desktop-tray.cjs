function trayIcon(nativeImage){
  const size=32,pixels=Buffer.alloc(size*size*4)
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const dx=x-15.5,dy=y-15.5,r=Math.hypot(dx,dy),i=(y*size+x)*4
    if(r>15)continue
    const letter=r>=6&&r<=10&&!(dx>3&&Math.abs(dy)<6)
    const color=letter?[40,40,40]:[162,185,213]
    pixels[i]=color[0];pixels[i+1]=color[1];pixels[i+2]=color[2];pixels[i+3]=255
  }
  return nativeImage.createFromBitmap(pixels,{width:size,height:size,scaleFactor:1})
}
function installDesktopTray({app,window,Tray,Menu,nativeImage}){
  let quitting=false
  const tray=new Tray(trayIcon(nativeImage))
  const show=()=>{
    if(window.isDestroyed())return
    if(window.isMinimized())window.restore()
    window.show();window.focus()
  }
  const quit=(relaunch=false)=>{
    quitting=true
    if(relaunch)app.relaunch()
    app.quit()
  }
  tray.setToolTip('Claude Workspace · 右键退出')
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'打开 Claude Workspace',click:show},
    {type:'separator'},
    {label:'退出',click:()=>quit()}
  ]))
  tray.on('click',show)
  tray.on('double-click',show)
  window.on('close',event=>{
    if(quitting)return
    event.preventDefault();window.hide()
  })
  window.webContents.on('will-prevent-unload',event=>{if(quitting)event.preventDefault()})
  app.on('before-quit',()=>{quitting=true})
  app.on('activate',show)
  app.once('will-quit',()=>tray.destroy())
  return {show,quit,tray}
}
module.exports={installDesktopTray}
