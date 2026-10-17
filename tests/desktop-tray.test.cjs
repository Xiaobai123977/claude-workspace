const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events')
const {installDesktopTray}=require('../electron/desktop-tray.cjs')
test('close hides to tray, tray restores the same window, explicit exit permits shutdown and releases icon',()=>{
  const app=new EventEmitter(),window=new EventEmitter(),wc=new EventEmitter()
  let hidden=0,shown=0,focused=0,quit=0,restored=0,prevented=0,destroyed=0,menu
  Object.assign(window,{webContents:wc,isDestroyed:()=>false,isMinimized:()=>true,hide:()=>hidden++,show:()=>shown++,focus:()=>focused++,restore:()=>restored++})
  app.quit=()=>{quit++;app.emit('before-quit')}
  class Tray extends EventEmitter{setToolTip(){} setContextMenu(value){menu=value} destroy(){destroyed++}}
  const result=installDesktopTray({app,window,Tray,Menu:{buildFromTemplate:value=>value},nativeImage:{createFromBitmap:(bitmap,options)=>{assert.equal(bitmap.length,32*32*4);assert.equal(options.width,32);return {}}}})
  window.emit('close',{preventDefault:()=>prevented++})
  assert.equal(hidden,1);assert.equal(prevented,1);assert.equal(quit,0)
  result.tray.emit('click');assert.equal(shown,1);assert.equal(focused,1);assert.equal(restored,1)
  menu.find(item=>item.label==='退出').click();assert.equal(quit,1)
  window.emit('close',{preventDefault:()=>prevented++});assert.equal(prevented,1)
  wc.emit('will-prevent-unload',{preventDefault:()=>prevented++});assert.equal(prevented,2)
  app.emit('will-quit');assert.equal(destroyed,1)
})
