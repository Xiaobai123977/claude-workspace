// Explicit, bounded diagnostics. Reads saved credentials without changing configuration.
const {app,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {ProvidersService}=require('../electron/providers.cjs'),{endpoint}=require('../electron/provider-proxy.cjs'),{redact}=require('../electron/provider-errors.cjs')
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'claude-provider-audit-'))
const localState=path.join(process.env.APPDATA,'Claude Workspace','Local State')
if(fs.existsSync(localState)){const state=JSON.parse(fs.readFileSync(localState,'utf8'));if(state.os_crypt)fs.writeFileSync(path.join(profile,'Local State'),JSON.stringify({os_crypt:state.os_crypt}),{mode:0o600})}
app.setPath('userData',profile)
app.whenReady().then(async()=>{
  const args=process.argv.slice(2),file=path.join(process.env.APPDATA,'Claude Workspace','providers.json'),service=Object.create(ProvidersService.prototype)
  service.file=file;service.secureStorage=safeStorage
  const id=args.find(a=>a.startsWith('--provider='))?.slice(11),raw=service.read().find(p=>id?p.id===id:p.enabled!==false)
  if(!raw)throw Error('未找到指定供应商')
  const p=service.resolve(raw),model=p.defaultModel,url=endpoint(p.baseUrl,p.protocol)
  if(p.protocol!=='anthropic')throw Error('此诊断只测试 Anthropic 接口')
  const headers=service.headers(p),secrets=[p.key,...Object.entries(headers).filter(([k])=>/authorization|api[-_]?key|token|cookie|secret/i.test(k)).flatMap(([,v])=>[v,String(v).replace(/^Bearer /i,'')])]
  if(args.includes('--compare-native')){
    const file=path.join(os.homedir(),'.claude/settings.json'),config=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{},env=config.env||{}
    console.log(JSON.stringify({scenario:'native-comparison',sameBase:String(env.ANTHROPIC_BASE_URL||'').replace(/\/$/,'')===p.baseUrl.replace(/\/$/,''),apiKeyMatches:env.ANTHROPIC_API_KEY?env.ANTHROPIC_API_KEY===p.key:null,authTokenMatches:env.ANTHROPIC_AUTH_TOKEN?env.ANTHROPIC_AUTH_TOKEN===p.key:null,nativeModel:env.ANTHROPIC_MODEL,subagentModel:env.CLAUDE_CODE_SUBAGENT_MODEL}))
  }
  async function request(scenario,target,body){
    const started=Date.now()
    try{
      const response=await fetch(target,{method:body?'POST':'GET',headers,redirect:'error',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})}),text=await response.text()
      let data;try{data=JSON.parse(text)}catch{}
      const result={scenario,status:response.status,elapsedMs:Date.now()-started}
      if(!response.ok||data?.error)result.error=redact(typeof data?.error?.message==='string'?data.error.message:text,secrets).slice(0,1500)
      else if(scenario==='models')Object.assign(result,{count:data?.data?.length,targetListed:data?.data?.some(m=>m.id===model),relatedModels:data?.data?.filter(m=>/deepseek/i.test(m.id)).map(m=>m.id)})
      else Object.assign(result,{model:data?.model,contentTypes:data?.content?.map(c=>c.type),stopReason:data?.stop_reason,usage:data?.usage})
      console.log(JSON.stringify(result))
    }catch(error){console.log(JSON.stringify({scenario,elapsedMs:Date.now()-started,error:redact(error.message,secrets),code:error.cause?.code||error.code}))}
  }
  if(args.includes('--models')){const target=new URL(url);target.pathname=target.pathname.replace(/\/messages$/,'/models');await request('models',target)}
  if(args.includes('--hello'))await request('hello',url,{model,max_tokens:64,messages:[{role:'user',content:'hello'}]})
  if(args.includes('--tool-roundtrip'))await request('tool-roundtrip',url,{model,max_tokens:64,tools:[{name:'Read',description:'Read a text file',input_schema:{type:'object',properties:{file_path:{type:'string'}},required:['file_path']}}],messages:[{role:'user',content:'Read example.txt and acknowledge its content.'},{role:'assistant',content:[{type:'tool_use',id:'toolu_diagnostic_read',name:'Read',input:{file_path:'example.txt'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'toolu_diagnostic_read',content:'Example diagnostic text. No real project file was read.'}]}]})
  app.exit(0)
}).catch(error=>{console.error(error.message);app.exit(1)})
