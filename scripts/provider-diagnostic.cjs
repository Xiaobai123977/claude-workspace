// Run with Electron. Decrypts saved credentials only in memory; never prints authentication values.
const {app,safeStorage}=require('electron')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const root=path.resolve(__dirname,'..'),{ProvidersService}=require('../electron/providers.cjs'),{endpoint,convertRequest,startProxy}=require('../electron/provider-proxy.cjs')
const source=path.join(process.env.APPDATA,'Claude Workspace'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'claude-provider-diagnostic-'))
// Windows safeStorage uses the profile's DPAPI-protected encryption key. Copy only its encrypted Local State.
if(fs.existsSync(path.join(source,'Local State')))fs.copyFileSync(path.join(source,'Local State'),path.join(temp,'Local State'))
app.setName('Claude Workspace')
app.setPath('userData',temp)
app.whenReady().then(async()=>{
  let service,proxy
  try{
    service=new ProvidersService({userData:source,secureStorage:safeStorage})
    const state=JSON.parse(fs.readFileSync(path.join(source,'workspace.json'),'utf8')),session=state.sessions.find(s=>s.id===state.activeId),publicProvider=service.list().find(p=>p.id===(session.providerId||state.preferences.providerId))
    if(!publicProvider)throw new Error('No active saved supplier')
    const p=service.resolve(publicProvider,session.messages.filter(m=>m.gatewayRoute).at(-1)?.gatewayRoute.keyId),model=session.model||p.defaultModel
    const clean=value=>String(value||'').split(p.key||'\0').join('[KEY]').replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_.-]+/g,'[KEY]').replace(/[A-Za-z0-9_-]{70,}/g,'[TOKEN]').slice(0,700)
    const headers=service.headers(p),url=endpoint(p.baseUrl,p.protocol)
    console.log(JSON.stringify({supplier:p.name,protocol:p.protocol,endpoint:new URL(url).origin+new URL(url).pathname,model,thinking:p.thinking,defaultEffort:p.models.find(m=>m.id===model)?.defaultEffort,customHeaderNames:Object.keys(p.headers||{}),extraBodyKeys:Object.keys(p.extraBody||{})}))
    async function probe(label,target,body,requestHeaders=headers){
      const time=Date.now()
      try{
        const r=await fetch(target,{method:body?'POST':'GET',headers:requestHeaders,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(25000)}),raw=await r.text()
        let data;try{data=JSON.parse(raw)}catch{}
        console.log(JSON.stringify({probe:label,status:r.status,elapsedMs:Date.now()-time,server:r.headers.get('server'),retryAfter:r.headers.get('retry-after'),requestId:r.headers.get('x-request-id')||r.headers.get('request-id'),...(label==='models'&&r.ok?{models:data?.data?.map(m=>m.id)}:r.ok?{contentTypes:data?.content?.map(c=>c.type),hasText:!!data?.content?.some(c=>c.text)||!!data?.choices?.length||!!data?.output?.length}:{error:clean(data?.error?.message||data?.message||raw),errorType:clean(data?.error?.type||data?.error?.code)})}))
        return r.status
      }catch(e){console.log(JSON.stringify({probe:label,error:clean(e.message),cause:clean(e.cause?.code),elapsedMs:Date.now()-time}));return 0}
    }
    const models=new URL(url);models.pathname=models.pathname.replace(/\/(messages|chat\/completions|responses)$/,'/models')
    await probe('models',models.href)
    const body={model,messages:[{role:'user',content:'Reply with OK only.'}],max_tokens:16,stream:false}
    const basic=await probe('direct-minimal',url,convertRequest(body,{...p,model,effort:''}))
    if(basic===403||basic===401){console.log('Generation rejected directly upstream; no repeated generation probes.');return}
    const withDefaults={...p,model,effort:session.effort||p.models.find(m=>m.id===model)?.defaultEffort||''}
    proxy=await startProxy(withDefaults,headers,fetch,{retryPolicy:{maxRetries:0}})
    await probe('local-proxy-defaults',proxy.url+'/v1/messages',body,{'x-api-key':proxy.token,'Content-Type':'application/json'})
  }catch(e){console.log(JSON.stringify({diagnosticError:String(e.message).slice(0,300)}));process.exitCode=1}finally{proxy?.close();service?.close();app.quit()}
})
