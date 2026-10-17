const {app,WebContentsView,session:electronSession,Menu}=require('electron')
const {installEditMenu}=require('./edit-menu.cjs')
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http')
const {tools}=require('./browser-tools.cjs')
const {pickerScript}=require('./browser-picker.cjs')
const {localFile,startLocalPreview}=require('./local-preview.cjs')
const bridgeScript=app.isPackaged?path.join(process.resourcesPath,'app.asar.unpacked','electron','browser-mcp.cjs'):path.join(__dirname,'browser-mcp.cjs')
function browserUrl(input){
  if(typeof input!=='string'||input.length>8000)throw new Error('请输入网页地址')
  const url=new URL(/^[\w+.-]+:\/\//.test(input)?input:'http://'+input)
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('仅支持不含账号密码的 HTTP / HTTPS 地址')
  return url.href
}
class BrowserService{
  constructor({window,userData,isEnabled,onChange,projectRoot}){
    this.window=window;this.userData=userData;this.projectRoot=projectRoot;this.previews=new Map();this.isEnabled=isEnabled;this.onChange=onChange;this.pages=new Map();this.tokens=new Map();this.visible=null;this.bounds=null;this.queues=new Map()
    const runtimeDir=path.join(userData,'browser-runtime')
    if(fs.existsSync(runtimeDir)&&!fs.lstatSync(runtimeDir).isSymbolicLink())for(const name of fs.readdirSync(runtimeDir)){
      if(!/^[0-9a-f-]{36}\.json$/.test(name))continue
      const file=path.join(runtimeDir,name)
      try{if(fs.lstatSync(file).isFile()&&JSON.parse(fs.readFileSync(file,'utf8')).mcpServers?.workspace_browser?.args?.[0]===bridgeScript)fs.rmSync(file)}catch{/* Leave unrelated or unreadable files untouched. */}
    }
    this.server=http.createServer(async(req,res)=>{
      const id=this.tokens.get(req.headers.authorization?.replace(/^Bearer /,''))
      if(req.method!=='POST'||req.url!=='/'||!id||!this.isEnabled(id)){res.writeHead(403);res.end();return}
      try{let raw='';for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>65536)throw new Error('Browser request too large')}
        const {name,arguments:args={}}=JSON.parse(raw)
        const job=(this.queues.get(id)||Promise.resolve()).catch(()=>{}).then(()=>this.execute(id,name,args,true));this.queues.set(id,job)
        let result;try{result=await job}finally{if(this.queues.get(id)===job)this.queues.delete(id)};res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result))
      }catch(e){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({isError:true,content:[{type:'text',text:e.message}]}))}
    })
    this.ready=new Promise(resolve=>this.server.listen(0,'127.0.0.1',resolve))
    this.window.on('resize',()=>{if(this.visible)this.layout(this.visible,this.bounds)})
  }
  page(id){
    if(this.pages.has(id))return this.pages.get(id)
    const partition='workspace-browser-'+crypto.randomUUID(),s=electronSession.fromPartition(partition)
    s.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));s.setPermissionCheckHandler(()=>false)
    s.on('will-download',(event,item)=>{event.preventDefault();this.error(id,'页面发起下载，请在系统浏览器中下载文件')})
    const view=new WebContentsView({webPreferences:{partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false}})
    view.setBounds({x:0,y:0,width:1024,height:768})
    const page={view,logs:[],requests:[],error:'',file:null,token:null};this.pages.set(id,page)
    const wc=view.webContents
    installEditMenu(this.window,Menu,wc)
    const guard=(event,url)=>{try{browserUrl(url)}catch{event.preventDefault();this.error(id,'已阻止非 HTTP / HTTPS 导航')}}
    wc.on('will-navigate',guard);wc.on('will-redirect',guard)
    wc.setWindowOpenHandler(({url})=>{try{void this.navigate(id,url).catch(e=>this.error(id,e.message))}catch{}return {action:'deny'}})
    for(const event of ['did-start-loading','did-stop-loading','did-navigate','did-navigate-in-page','page-title-updated'])wc.on(event,()=>this.emit(id))
    wc.on('did-fail-load',(_e,code,description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3)this.error(id,description)})
    wc.on('console-message',details=>{page.logs.push({level:details.level,message:String(details.message).slice(0,2000)});if(page.logs.length>100)page.logs.shift()})
    s.webRequest.onCompleted(details=>{if(details.statusCode>=400){page.requests.push({url:details.url,status:details.statusCode});if(page.requests.length>100)page.requests.shift()}})
    s.webRequest.onErrorOccurred(details=>{page.requests.push({url:details.url,error:details.error});if(page.requests.length>100)page.requests.shift()})
    return page
  }
  error(id,error){const p=this.pages.get(id);if(p){p.error=error;this.emit(id)}}
  state(id){const p=this.pages.get(id),wc=p?.view.webContents;return {url:wc?.getURL()||'',title:wc?.getTitle()||'',loading:wc?.isLoading()||false,canGoBack:wc?.navigationHistory.canGoBack()||false,canGoForward:wc?.navigationHistory.canGoForward()||false,error:p?.error||''}}
  emit(id){if(!this.window.isDestroyed())this.onChange(id,this.state(id))}
  layout(id,bounds){
    if(this.visible){const old=this.pages.get(this.visible);if(old)this.window.contentView.removeChildView(old.view)}
    this.visible=null;this.bounds=bounds
    if(!bounds)return
    const {width:ww,height:wh}=this.window.getContentBounds(),x=Math.max(0,Math.min(ww,Math.round(bounds.x))),y=Math.max(0,Math.min(wh,Math.round(bounds.y)))
    const width=Math.max(0,Math.min(ww-x,Math.round(bounds.width))),height=Math.max(0,Math.min(wh-y,Math.round(bounds.height)))
    if(![x,y,width,height].every(Number.isFinite)||width<1||height<1)return
    const page=this.page(id);page.view.setBounds({x,y,width,height});this.window.contentView.addChildView(page.view);this.visible=id
  }
  async navigate(id,url){
    let target
    if(typeof url==='string'&&/^file:/i.test(url)){
      const local=localFile(this.projectRoot(id),url)
      let preview=this.previews.get(id)
      if(!preview||preview.root!==local.root){preview?.close();const ready=startLocalPreview(local.root);preview={root:local.root,ready,close(){void ready.then(p=>p.close()).catch(()=>{})}};this.previews.set(id,preview)}
      const server=await preview.ready
      if(this.closed)throw new Error('浏览器已关闭')
      target=server.url(local.file)+local.search+local.hash
    }else target=browserUrl(url)
    const p=this.page(id);p.error='';p.logs=[];p.requests=[]
    let timer
    try{await Promise.race([p.view.webContents.loadURL(target),new Promise((_resolve,reject)=>{timer=setTimeout(()=>{p.view.webContents.stop();reject(new Error('网页加载超过 30 秒，请检查地址或开发服务器'))},30000)})]);this.emit(id);return this.state(id)}finally{clearTimeout(timer)}
  }
  revoke(id){const p=this.pages.get(id);if(!p)return;if(p.token)this.tokens.delete(p.token);if(p.file)fs.rmSync(p.file,{force:true});p.token=null;p.file=null}
  async settle(wc){
    await new Promise(resolve=>setTimeout(resolve,50))
    if(!wc.isLoadingMainFrame())return
    await new Promise((resolve,reject)=>{
      const done=()=>{clearTimeout(timer);wc.removeListener('did-stop-loading',done);resolve()}
      const timer=setTimeout(()=>{wc.removeListener('did-stop-loading',done);reject(new Error('页面仍在加载，请稍后重新检查'))},10000)
      wc.once('did-stop-loading',done)
      if(!wc.isLoadingMainFrame())done()
    })
  }
  async runtime(id){
    await this.ready;const page=this.page(id)
    if(!page.file){
      page.token=crypto.randomBytes(32).toString('hex');this.tokens.set(page.token,id)
      const dir=path.join(this.userData,'browser-runtime');fs.mkdirSync(dir,{recursive:true})
      page.file=path.join(dir,crypto.randomUUID()+'.json')
      fs.writeFileSync(page.file,JSON.stringify({mcpServers:{workspace_browser:{command:process.execPath,args:[bridgeScript],env:{ELECTRON_RUN_AS_NODE:'1',WORKSPACE_BROWSER_URL:`http://127.0.0.1:${this.server.address().port}/`,WORKSPACE_BROWSER_TOKEN:page.token}}}}),{mode:0o600})
    }
    return page.file
  }
  async execute(id,name,args={},agent=false){
    if(!tools.some(t=>t.name===name)&&!(agent?[]:['forward','stop','picker','selection','selection-check']).includes(name))throw new Error('浏览器操作不存在')
    if(agent&&!this.isEnabled(id))throw new Error('此聊天尚未允许 Claude 操作浏览器')
    const p=this.page(id),wc=p.view.webContents
    if(['inspect','click','type','screenshot'].includes(name))await this.settle(wc)
    let result
    if(name==='picker')result=await wc.executeJavaScriptInIsolatedWorld(4242,[{code:pickerScript}])
    else if(name==='selection')result=await wc.executeJavaScriptInIsolatedWorld(4242,[{code:'(()=>{const p=window.__workspacePicker;if(!p)return null;if(p.selected||p.cancelled){delete window.__workspacePicker;return p.selected||{cancelled:true}}return null})()'}])
    else if(name==='selection-check'){
      const snapshot=args.snapshot
      if(!snapshot||typeof snapshot.selector!=='string')throw new Error('所选元素无效')
      const valid=await wc.executeJavaScriptInIsolatedWorld(4242,[{code:`(()=>{const s=${JSON.stringify(snapshot)},e=document.querySelector(s.selector);return !!e&&location.href===s.url&&performance.timeOrigin===s.documentKey&&e.tagName.toLowerCase()===s.tag&&(e.innerText||e.getAttribute('aria-label')||'').slice(0,1500)===s.text})()`}])
      if(!valid)throw new Error('页面或所选元素已经变化，请重新选择后再添加修改要求')
      result={valid:true}
    }
    else if(name==='navigate')result=await this.navigate(id,args.url)
    else if(name==='screenshot'){
      if(!wc.getURL())throw new Error('请先打开网页')
      let shot=await wc.capturePage(undefined,{stayHidden:true,stayAwake:true});if(shot.getSize().width>1280)shot=shot.resize({width:1280})
      const data=shot.toPNG()
      if(agent){const dir=path.join(this.userData,'attachments','browser-captures');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,crypto.createHash('sha256').update(data).digest('hex')+'.png');if(!fs.existsSync(file))fs.writeFileSync(file,data,{mode:0o600});return{content:[{type:'text',text:'浏览器截图已保存为本地图片文件（尚未读取图片内容）：'+JSON.stringify(file)}]}}
      return {content:[{type:'image',mimeType:'image/png',data:data.toString('base64')}]}
    }else if(name==='inspect')result=await wc.executeJavaScript(`(()=>{let n=0;const elements=[...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')].filter(e=>e.getClientRects().length).slice(0,100).map(e=>{const id='n'+(++n);e.setAttribute('data-workspace-node',id);return {selector:'[data-workspace-node="'+id+'"]',tag:e.tagName.toLowerCase(),type:e.type||'',label:(e.getAttribute('aria-label')||e.innerText||e.placeholder||e.name||'').slice(0,200),value:e.type==='password'?'[password]':String(e.value||'').slice(0,200),disabled:!!e.disabled}});return {url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,16000),elements}})()`)
    else if(name==='click'||name==='type'){
      if(typeof args.selector!=='string'||args.selector.length>1000)throw new Error('请提供有效的元素选择器')
      const selector=JSON.stringify(args.selector)
      const rect=await wc.executeJavaScript(`(()=>{const e=document.querySelector(${selector});if(!e)throw new Error('找不到元素，请重新 inspect');if(e.disabled)throw new Error('元素不可用');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();if(!r.width||!r.height)throw new Error('元素不可见');e.focus();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
      if(name==='click'){wc.sendInputEvent({type:'mouseDown',...rect,button:'left',clickCount:1});wc.sendInputEvent({type:'mouseUp',...rect,button:'left',clickCount:1});result={clicked:args.selector}}
      else{
        if(typeof args.text!=='string'||args.text.length>20000)throw new Error('输入内容过长')
        await wc.executeJavaScript(`(()=>{const e=document.querySelector(${selector});if(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement){const setter=Object.getOwnPropertyDescriptor(e instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,'value').set;setter.call(e,${JSON.stringify(args.text)})}else if(e.isContentEditable)e.textContent=${JSON.stringify(args.text)};else throw new Error('元素不是输入框');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);result={typed:true}
      }
    }else if(name==='press'){
      if(!['Enter','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Backspace','Space'].includes(args.key))throw new Error('不支持此按键')
      wc.sendInputEvent({type:'keyDown',keyCode:args.key});wc.sendInputEvent({type:'keyUp',keyCode:args.key});result={pressed:args.key}
    }else if(name==='scroll'){
      if(!Number.isFinite(args.pixels)||Math.abs(args.pixels)>10000)throw new Error('滚动距离无效')
      await wc.executeJavaScript(`window.scrollBy(0,${args.pixels})`);result={scrolled:args.pixels}
    }else if(name==='diagnostics')result={console:p.logs,failedRequests:p.requests}
    else if(name==='back'){if(wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();result=this.state(id)}
    else if(name==='forward'){if(wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();result=this.state(id)}
    else if(name==='reload'){wc.reload();result=this.state(id)}
    else if(name==='stop'){wc.stop();result=this.state(id)}
    if(['click','press','back','forward','reload'].includes(name))await this.settle(wc)
    this.emit(id)
    return {content:[{type:'text',text:JSON.stringify(result===undefined?{}:result)}]}
  }
  dispose(id){
    if(this.visible===id)this.layout(id,null)
    this.revoke(id);const p=this.pages.get(id);if(p)p.view.webContents.close({waitForBeforeUnload:false});this.pages.delete(id);this.previews.get(id)?.close();this.previews.delete(id)
  }
  close(){if(this.closed)return;this.closed=true;for(const preview of this.previews.values())preview.close();this.previews.clear();for(const p of this.pages.values()){p.view.webContents.close({waitForBeforeUnload:false});if(p.file)fs.rmSync(p.file,{force:true})}this.pages.clear();this.tokens.clear();this.server.close();this.server.closeAllConnections()}
}
module.exports={BrowserService,browserUrl}
