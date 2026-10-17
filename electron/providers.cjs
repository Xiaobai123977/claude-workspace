const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { startProxy, endpoint } = require('./provider-proxy.cjs')
const {normalizeProvider,publicProvider,mergeCatalogs}=require('./provider-keys.cjs')
const {ModelRouter}=require('./model-router.cjs')
const {normalizeModel,refreshModel,resolvedModel,hasImages,cliModelEnvironment,windowPolicy}=require('./model-profile.cjs')
const {ImageReferences,imageCount}=require('./image-references.cjs')
const protocols = ['anthropic', 'chat', 'responses']
const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
function validate(input) {
  const p = structuredClone(input)
  if(p.schemaVersion!=null&&(!Number.isInteger(p.schemaVersion)||p.schemaVersion>2||p.schemaVersion<1))throw new Error('供应商配置版本不受支持，请升级应用')
  if (!p.name?.trim() || p.name.length > 100) throw new Error('请输入连接名称（最多 100 字）')
  if (!protocols.includes(p.protocol)) throw new Error('接口协议无效')
  const u = new URL(p.baseUrl)
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('API 地址格式无效')
  if (!['none', 'bearer', 'api-key', 'env'].includes(p.auth)) throw new Error('认证方式无效')
  if (!p.keys && p.auth === 'env' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.keyEnv || '')) throw new Error('环境变量名称无效')
  for (const [key, value] of Object.entries(p.headers || {})) {
    if (!/^[\w-]+$/.test(key) || typeof value !== 'string' || /[\r\n]/.test(value) || /authorization|api-key|host|content-length|connection/i.test(key)) throw new Error('自定义请求头无效，请通过认证字段设置凭据')
  }
  if (Object.keys(p.headers || {}).length > 20) throw new Error('请求头过多')
  if (p.extraBody && (typeof p.extraBody !== 'object' || Array.isArray(p.extraBody) || JSON.stringify(p.extraBody).length > 30000 || Object.keys(p.extraBody).some(k => ['__proto__','constructor','prototype','model','messages','input','tools','stream','system','instructions','max_tokens','max_completion_tokens','max_output_tokens','tool_choice'].includes(k)))) throw new Error('兼容参数必须是 JSON 对象，不能覆盖模型、消息、工具、流或输出限制')
  if (p.outputTokenField && !['auto','max_tokens','max_completion_tokens'].includes(p.outputTokenField)) throw new Error('输出上限字段无效')
  if (p.key && (typeof p.key !== 'string' || p.key.length > 10000 || /[\r\n]/.test(p.key))) throw new Error('密钥格式无效')
  p.timeout = Number(p.timeout || 120000)
  if (!Number.isInteger(p.timeout) || p.timeout < 10000 || p.timeout > 3600000) throw new Error('请求超时应为 10–3600 秒')
  p.models = (p.models || []).map(m => {
    if (!m.id || typeof m.id !== 'string' || m.id.length > 300) throw new Error('模型 ID 无效')
    if (m.efforts && (!Array.isArray(m.efforts) || m.efforts.some(e => !efforts.includes(e)))) throw new Error('思考档位无效')
    if (m.defaultEffort && !m.efforts?.includes(m.defaultEffort)) throw new Error('默认思考强度必须在此模型支持的档位中')
    for (const k of ['context', 'output']) if (m[k] != null && (!Number.isInteger(m[k]) || m[k] <= 0 || m[k] > 100000000)) throw new Error('模型容量无效')
    for (const k of ['vision', 'tools', 'thinking', 'enabled']) if (m[k] != null && typeof m[k] !== 'boolean') throw new Error('模型能力无效')
    for(const source of ['reported','overrides'])if(m[source]){
      if(typeof m[source]!=='object'||Array.isArray(m[source])||Object.keys(m[source]).some(k=>!['efforts','context','output','vision','tools','thinking'].includes(k)))throw new Error('模型能力来源无效')
      validate({...p,keys:undefined,auth:'none',models:[{id:m.id,...Object.fromEntries(Object.entries(m[source]).filter(([,v])=>v!==null))}],defaultModel:undefined})
    }
    if(m.request){
      const r=m.request
      if(typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['thinkingMode','thinkingBudget','effortField','effortMap','outputTokenField','extraBody','timeout'].includes(k)))throw new Error('模型请求设置无效')
      if(r.effortField&&!['auto','none','reasoning_effort','reasoning.effort','output_config.effort'].includes(r.effortField))throw new Error('思考强度字段无效')
      if(r.effortMap&&(typeof r.effortMap!=='object'||Array.isArray(r.effortMap)||Object.entries(r.effortMap).some(([k,v])=>!efforts.includes(k)||typeof v!=='string'||v.length>64||!v.length)))throw new Error('思考档位映射无效')
      validate({...p,keys:undefined,auth:'none',models:[],defaultModel:undefined,thinking:r.thinkingMode||'inherit',thinkingBudget:r.thinkingBudget,extraBody:r.extraBody,outputTokenField:r.outputTokenField,timeout:r.timeout||p.timeout})
      if(r.thinkingMode==='enabled'&&m.output&&(r.thinkingBudget||1024)>=m.output)throw new Error('此模型思考预算必须小于输出上限')
    }
    return m
  })
  if (p.models.length > 2000 || (p.defaultModel && !p.models.some(m => m.id === p.defaultModel && m.enabled !== false))) throw new Error('默认模型不在列表中')
  if (!['inherit', 'enabled', 'disabled', 'adaptive'].includes(p.thinking || 'inherit')) throw new Error('思考模式无效')
  if (p.thinkingBudget != null && (!Number.isInteger(p.thinkingBudget) || p.thinkingBudget < 1024 || p.thinkingBudget > 1000000)) throw new Error('固定思考预算应为 1024–1000000 token')
  if(p.weight!=null&&(!Number.isInteger(p.weight)||p.weight<1||p.weight>1000))throw new Error('供应商权重应为 1–1000')
  if(p.enabled!=null&&typeof p.enabled!=='boolean')throw new Error('供应商启用状态无效')
  if(p.keys){
    if(!Array.isArray(p.keys)||!p.keys.length||p.keys.length>100)throw new Error('每个供应商需要 1–100 个 Key')
    const ids=new Set()
    for(const k of p.keys){
      if(!k.id||typeof k.id!=='string'||k.id.length>100||ids.has(k.id))throw new Error('Key 标识无效或重复');ids.add(k.id)
      if(typeof k.name!=='string'||!k.name.trim()||k.name.length>100)throw new Error('Key 名称无效')
      if(k.weight!=null&&(!Number.isInteger(k.weight)||k.weight<1||k.weight>1000))throw new Error('Key 权重应为 1–1000')
      if(k.enabled!=null&&typeof k.enabled!=='boolean')throw new Error('Key 启用状态无效')
      if(k.key&&(typeof k.key!=='string'||k.key.length>10000||/[\r\n]/.test(k.key)))throw new Error('Key 格式无效')
      if(p.auth==='env'&&k.enabled!==false&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k.keyEnv||p.keyEnv||''))throw new Error('Key 环境变量名称无效')
      validate({...p,keys:undefined,auth:'none',key:undefined,models:k.models||[],defaultModel:undefined})
    }
  }
  return p
}
function metadata(m) {
  const effort = m.effort?.supported_levels || m.supportedEffortLevels
  const caps = m.capabilities || {}
  const levels = effort || (caps.effort && Object.entries(caps.effort).filter(([k, v]) => efforts.includes(k) && v?.supported).map(([k]) => k))
  return { id: m.id, name: m.name || m.display_name || m.id, context: m.context_window || m.max_input_tokens || undefined,
    output: m.max_output_tokens || undefined, efforts: levels?.length ? levels : undefined,
    vision: m.input_modalities ? m.input_modalities.includes('image') : undefined,
    tools: caps.tool_calling?.supported, thinking: caps.thinking?.supported,
    source: 'server', detected:true, fetchedAt: Date.now() }
}
class ProvidersService {
  constructor({ userData, secureStorage, fetcher = fetch, onRetry = () => {}, onRoute=()=>{}, onUsage=()=>{} }) { this.imageReferences=new ImageReferences(userData);this.file = path.join(userData, 'providers.json'); this.poolsFile=path.join(userData,'model-pools.json');this.router=new ModelRouter({file:path.join(userData,'routing-affinity.json')});this.secureStorage = secureStorage; this.fetcher = fetcher; this.onRetry = onRetry;this.onRoute=onRoute;this.onUsage=onUsage; this.proxies = new Map();this.configStore=new (require('./model-config-store.cjs').ModelConfigStore)(this,validate);this.configStore.recover() }
  read() { if (!fs.existsSync(this.file)) return []; const data = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (!Array.isArray(data)) throw new Error('连接配置无效，未覆盖');if(data.some(p=>p.schemaVersion>2))throw new Error('供应商配置版本高于当前应用，未覆盖'); return data }
  write(data) { this.configStore.backup();const temp = this.file + '.tmp'; fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 }); fs.renameSync(temp, this.file) }
  list() { return this.read().map(raw=>({...publicProvider(raw),endpoint:endpoint(raw.baseUrl,raw.protocol)})) }
  resolve(input,keyId) {
    const savedRaw=input.id&&this.read().find(p=>p.id===input.id),saved=savedRaw?normalizeProvider(savedRaw):null
    const supplied=normalizeProvider({...savedRaw,...input})
    // Old clients edit one credential. Preserve that compatibility without copying it into new keys.
    if(!input.keys&&saved){supplied.keys=saved.keys; if(input.key)supplied.keys[0]={...supplied.keys[0],key:input.key};if(input.models)supplied.keys[0]={...supplied.keys[0],models:input.models}}
    if(input.key&&(!keyId||keyId===supplied.keys[0]?.id))supplied.keys[0].key=input.key
    const p=validate(supplied),selected=p.keys.find(k=>k.id===(keyId||p.keys.find(k=>k.enabled!==false)?.id))
    if(!selected)throw new Error('Key 不存在')
    const original=saved?.keys.find(k=>k.id===selected.id)
    let key=selected.key||''
    if(!key&&original?.encryptedKey&&!selected.clearKey&&!input.clearKey)key=this.secureStorage.decryptString(Buffer.from(original.encryptedKey,'base64'))
    if(p.auth==='env')key=process.env[selected.keyEnv||p.keyEnv]||''
    if(p.auth!=='none'&&!key)throw new Error('请填写密钥或配置认证环境变量')
    return {...p,key,keyId:selected.id,keyName:selected.name}
  }
  save(input) {
    const all=this.read(),index=all.findIndex(x=>x.id===input.id),old=index>=0?normalizeProvider(all[index]):null
    if(old&&input.revision&&input.revision!==old.revision)throw new Error('连接已被修改，请重新加载后保存')
    let p=normalizeProvider({...input})
    if(!input.keys&&old){p.keys=old.keys.map(k=>({...k}));if(input.key)p.keys[0].key=input.key;if(input.models)p.keys[0].models=input.models}
    if(input.key&&p.keys[0])p.keys[0].key=input.key
    p=validate(p);p.id=old?.id||crypto.randomUUID()
    p.keys=p.keys.map(k=>{
      const prior=old?.keys.find(x=>x.id===k.id),out={...k};delete out.encryptedKey
      if(p.auth!=='none'&&p.auth!=='env'){
        if(k.key){if(!this.secureStorage.isEncryptionAvailable())throw new Error('系统加密不可用，无法保存凭据');out.encryptedKey=this.secureStorage.encryptString(k.key).toString('base64')}
        else if(prior?.encryptedKey&&!k.clearKey&&!input.clearKey)out.encryptedKey=prior.encryptedKey
        else if(k.enabled!==false)throw new Error(`请填写 ${k.name} 的 API Key`)
      }
      if(p.auth==='env'&&k.enabled!==false&&!process.env[k.keyEnv||p.keyEnv])throw new Error(`请配置 ${k.name} 的认证环境变量`)
      delete out.key;delete out.hasKey;delete out.clearKey;return out
    })
    delete p.key;delete p.hasKey;delete p.encryptedKey;delete p.clearKey;delete p.endpoint;delete p.keyId;delete p.keyName
    p.schemaVersion=2;p.revision=crypto.randomUUID()
    if(index>=0)all[index]=p;else all.push(p)
    this.write(all);return this.list().find(x=>x.id===p.id)
  }
  usesProvider(connectionId,providerId){return connectionId===providerId||!!this.pools().find(p=>p.id===connectionId)?.members.some(m=>m.providerId===providerId)}
  remove(id) { this.write(this.read().filter(p => p.id !== id)); for (const [key, promise] of this.proxies) if (promise.providerId === id) {promise.then(proxy=>proxy.close()).catch(()=>{});this.proxies.delete(key)} }
  headers(p) { return { 'Content-Type': 'application/json', ...p.headers, ...(p.auth === 'none' ? {} : p.auth === 'api-key' ? { 'x-api-key': p.key } : { Authorization: `Bearer ${p.key}` }), ...(p.protocol === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {}) } }
  async discoverKey(input,keyId) {
    const p = this.resolve(input,keyId), url = new URL(endpoint(p.baseUrl, p.protocol)); url.pathname = url.pathname.replace(/\/(messages|chat\/completions|responses)$/, '/models')
    const models = [], seen = new Set()
    for (let page = 0; page < 20; page++) {
      const r = await this.fetcher(url, { headers: this.headers(p), redirect: 'error', signal: AbortSignal.timeout(15000) })
      if (!r.ok) throw new Error(r.status === 404 ? '服务未提供模型目录，可手动添加模型' : `获取模型失败（HTTP ${r.status}），原列表已保留`)
      const raw = await r.text(); if (raw.length > 5 * 1024 * 1024) throw new Error('模型目录过大')
      const data = JSON.parse(raw)
      if (!Array.isArray(data.data)) throw new Error('模型目录格式不兼容，可手动添加')
      for (const m of data.data) if (typeof m.id === 'string' && !seen.has(m.id)) { seen.add(m.id); models.push(metadata(m)) }
      if (!data.has_more || !data.last_id || seen.has('page:' + data.last_id)) break
      seen.add('page:' + data.last_id); url.searchParams.set('after_id', data.last_id)
    }
    const merged = models.map(m => {
      const old = p.keys.find(k=>k.id===p.keyId).models.find(x => x.id === m.id)
      return refreshModel(m,old)
    })
    for (const old of p.keys.find(k=>k.id===p.keyId).models) if (!models.some(m => m.id === old.id)) merged.push({ ...old, stale: true })
    return { models: merged, fetchedAt: Date.now() }
  }
  async discover(input,keyId) {
    const p=normalizeProvider(input),keys=p.keys.map(k=>({...k})),errors=[]
    const targets=keyId?keys.filter(k=>k.id===keyId):keys.filter(k=>k.enabled!==false&&(p.auth==='none'||k.key||k.hasKey||p.auth==='env'&&(k.keyEnv||p.keyEnv)))
    if(!targets.length)throw new Error('请先填写要检测的 Key')
    let cursor=0,success=0
    await Promise.all(Array.from({length:Math.min(3,targets.length)},async()=>{while(cursor<targets.length){const k=targets[cursor++];try{const result=await this.discoverKey(input,k.id);k.models=result.models;k.checkedAt=result.fetchedAt;delete k.checkError;success++}catch(error){k.checkError=error.message;k.checkAttemptAt=Date.now();errors.push({keyId:k.id,message:error.message})}}}))
    if(!success&&!input.keys&&!keyId)throw new Error(errors.map(e=>e.message).join('；'))
    return {models:mergeCatalogs(keys,p.models),keys:keys.map(({key,encryptedKey,...k})=>k),fetchedAt:Date.now(),errors}
  }
  pools() {
    if(!fs.existsSync(this.poolsFile))return []
    const pools=JSON.parse(fs.readFileSync(this.poolsFile,'utf8'));if(!Array.isArray(pools))throw new Error('模型池配置无效，未覆盖');return pools
  }
  savePool(input,{validateOnly=false}={}) {
    const all=this.pools(),old=all.find(p=>p.id===input.id)
    if(old&&input.revision!==old.revision)throw new Error('模型池已被修改，请重新读取')
    const pool={id:old?.id||'pool:'+crypto.randomUUID(),name:String(input.name||'').trim(),model:String(input.model||'').trim(),enabled:input.enabled!==false,sticky:input.sticky!==false,ttlMinutes:input.ttlMinutes??60,defaultEffort:input.defaultEffort||'',members:input.members,revision:crypto.randomUUID()}
    if(!pool.name||pool.name.length>100||!pool.model||pool.model.length>300)throw new Error('请填写模型池名称和对外模型 ID')
    if(!Number.isInteger(pool.ttlMinutes)||pool.ttlMinutes<1||pool.ttlMinutes>10080)throw new Error('粘性时长应为 1–10080 分钟')
    if(!Array.isArray(pool.members)||!pool.members.length||pool.members.length>100)throw new Error('请添加模型池线路')
    const suppliers=this.list(),seen=new Set()
    pool.members=pool.members.map(m=>{
      const provider=suppliers.find(p=>p.id===m.providerId)
      if(!provider)throw new Error('模型池供应商不存在');const identity=JSON.stringify([m.providerId,m.model,m.keyIds?.slice().sort()]);if(seen.has(identity))throw new Error('模型池线路重复');seen.add(identity)
      if(typeof m.model!=='string'||!m.model||m.model.length>300)throw new Error('请填写每个供应商的上游模型 ID')
      if(m.keyIds&&(!Array.isArray(m.keyIds)||m.keyIds.some(id=>!provider.keys.some(k=>k.id===id))))throw new Error('模型池 Key 选择无效')
      return {providerId:m.providerId,model:m.model,keyIds:m.keyIds,enabled:m.enabled!==false}
    })
    const routes=this.routes(pool.id,pool.model,'',null,pool)
    const assigned=new Set();for(const r of routes){const identity=r.providerId+'/'+r.keyId;if(assigned.has(identity))throw new Error('同一个 Key 在模型池中重复映射，请为各线路选择互不重叠的 Key');assigned.add(identity)}
    if(pool.enabled&&!routes.length)throw new Error('模型池没有已独立检测到该模型的可用 Key')
    if(pool.enabled&&pool.defaultEffort&&!routes.some(r=>r.capability.efforts?.includes(pool.defaultEffort)))throw new Error('模型池没有支持此思考档位的线路')
    if(validateOnly)return pool
    this.configStore.backup();if(old)all[all.indexOf(old)]=pool;else all.push(pool)
    const temp=this.poolsFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(all,null,2),{mode:0o600});fs.renameSync(temp,this.poolsFile)
    return pool
  }
  removePool(id){this.configStore.backup();const all=this.pools().filter(p=>p.id!==id),temp=this.poolsFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(all,null,2),{mode:0o600});fs.renameSync(temp,this.poolsFile)}
  routes(connectionId,model,effort='',body=null,poolOverride) {
    const suppliers=this.list(),pool=poolOverride||this.pools().find(p=>p.id===connectionId)
    if(pool&&(!pool.enabled||model!==pool.model))return []
    const members=pool?pool.members:[{providerId:connectionId,model}]
    const output=[]
    for(const member of members){
      if(member.enabled===false)continue
      const provider=suppliers.find(p=>p.id===member.providerId)
      if(!provider||provider.enabled===false)continue
      const declared=provider.models.find(m=>m.id===member.model)
      if(declared?.enabled===false)continue
      for(const key of provider.keys){
        if(key.enabled===false||member.keyIds&&!member.keyIds.includes(key.id))continue
        const detected=key.models.find(m=>m.id===member.model&&m.enabled!==false&&!m.stale)
        if(!detected)continue
        const capability=normalizeModel({...detected,id:member.model})
        if(effort&&!capability.efforts?.includes(effort))continue
        if(body?.tools?.length&&capability.tools===false)continue
        output.push({id:`${provider.id}/${key.id}/${member.model}`,providerId:provider.id,providerName:provider.name,keyId:key.id,keyName:key.name,model:member.model,providerWeight:provider.weight,keyWeight:key.weight,revision:provider.revision,protocol:provider.protocol,capability})
      }
    }
    return output.some(r=>r.capability.context)?output.filter(r=>r.capability.context):output
  }
  coverage(){
    const models=new Map()
    for(const p of this.list())for(const key of p.keys)for(const model of key.models||[]){
      if(model.stale)continue
      let entry=models.get(model.id);if(!entry){entry={model:model.id,suppliers:[]};models.set(model.id,entry)}
      let supplier=entry.suppliers.find(s=>s.providerId===p.id);if(!supplier){supplier={providerId:p.id,name:p.name,enabled:p.enabled,keys:[]};entry.suppliers.push(supplier)}
      supplier.keys.push({keyId:key.id,name:key.name,enabled:key.enabled&&p.enabled,checkedAt:key.checkedAt,source:model.source,detected:!!model.detected})
    }
    return [...models.values()].map(m=>({...m,providerCount:m.suppliers.length,keyCount:m.suppliers.reduce((n,p)=>n+p.keys.length,0),detectedProviderCount:m.suppliers.filter(p=>p.keys.some(k=>k.detected)).length,detectedKeyCount:m.suppliers.reduce((n,p)=>n+p.keys.filter(k=>k.detected).length,0)})).sort((a,b)=>a.model.localeCompare(b.model))
  }
  connections(){
    return [...this.list(),...this.pools().map(pool=>{
      const routes=this.routes(pool.id,pool.model),levels=[...new Set(routes.flatMap(r=>r.capability.efforts||[]))]
      return {id:pool.id,revision:pool.revision,name:pool.name,isPool:true,enabled:pool.enabled,protocol:'anthropic',baseUrl:'',auth:'none',keys:[],models:[{id:pool.model,name:pool.name,efforts:levels,...windowPolicy(routes),defaultEffort:pool.defaultEffort||undefined,source:'pool',enabled:routes.length>0}],defaultModel:pool.model,providerCount:new Set(routes.map(r=>r.providerId)).size,keyCount:routes.length,sticky:pool.sticky}
    })]
  }
  routing(){return {pools:this.pools().map(p=>({...p,providerCount:new Set(this.routes(p.id,p.model).map(r=>r.providerId)).size,keyCount:this.routes(p.id,p.model).length})),coverage:this.coverage()}}
  async runtime(id, model, effort, sessionId = '') {
    const connection=this.connections().find(p=>p.id===id)
    if(!connection)throw new Error('此连接已删除，请重新选择服务商连接')
    if(connection.enabled===false)throw new Error('此供应商或模型池已停用')
    const selected=model||connection.defaultModel
    if(!selected)throw new Error('请先选择此连接的模型')
    const declared=connection.models.find(m=>m.id===selected)
    if(declared?.enabled===false)throw new Error('此模型已隐藏，请重新选择已启用的模型')
    if(effort&&declared?.efforts&&!declared.efforts.includes(effort))throw new Error('该模型不支持所选思考强度，请重新选择')
    const effectiveEffort=effort||declared?.defaultEffort||connection.defaultEffort||''
    const initialRoutes=this.routes(id,selected,effectiveEffort),limits=cliModelEnvironment(initialRoutes),routeIds=new Set(initialRoutes.map(r=>r.id))
    if(!initialRoutes.length)throw new Error('没有独立检测到该模型并支持当前思考档位的可用 Key')
    const compatible=body=>this.routes(id,selected,effectiveEffort,body).filter(r=>routeIds.has(r.id)&&(!limits.policy.context||r.capability.context>=limits.policy.context))
    const pool=this.pools().find(p=>p.id===id),revisions=this.list().map(p=>[p.id,p.revision])
    const fingerprint=JSON.stringify([id,connection.revision,revisions,selected,effectiveEffort,sessionId])
    if(!this.proxies.has(fingerprint)){
      const routing={
        choose:body=>{
          const routes=compatible(body)
          if(!routes.length){
            const reasons=[]
            if(body?.tools?.length&&initialRoutes.every(r=>r.capability.tools===false))reasons.push('当前 Key 的模型能力配置均为“不支持工具调用”，请求中包含工具定义')
            if(!reasons.length)reasons.push('没有线路同时满足本次请求的工具、思考档位及上下文配置')
            throw Object.assign(new Error(`本地网关：模型 ${selected} 没有兼容线路；${reasons.join('；')}`),{routingStatus:400,noRetry:true})
          }
          const visionRoutes=hasImages(body)?this.router.available(routes.filter(r=>r.capability.vision!==false)):[]
          const route=this.router.choose(visionRoutes.length?visionRoutes:routes,{scope:id,sessionId,model:selected,sticky:pool?pool.sticky:connection.sticky!==false,ttlMinutes:pool?.ttlMinutes||60})
          const raw=this.read().find(p=>p.id===route.providerId),resolved=this.resolve(raw,route.keyId)
          this.onRoute(sessionId,{providerId:route.providerId,providerName:route.providerName,keyId:route.keyId,keyName:route.keyName,model:route.model,imageReferences:route.capability.vision===false?imageCount(body):0})
          return {...route,p:{...resolvedModel(resolved,route.capability,effectiveEffort),routeId:route.id,imageReference:image=>this.imageReferences.reference(image)},headers:this.headers(resolved)}
        },
        report:(route,result)=>this.router.report(route,result),
        retryAfter:body=>{const until=Math.min(...compatible(body).map(r=>this.router.availableAt(r)));return Number.isFinite(until)?Math.max(0,until-this.router.now()):0},
        hasAlternative:(body,current)=>this.router.available(compatible(body)).some(r=>r.id!==current?.id)
      }
      const promise=startProxy({...connection,model:selected,effort:effectiveEffort}, {},this.fetcher,{onRetry:event=>this.onRetry(sessionId,event),onUsage:usage=>this.onUsage(sessionId,usage),routing}).then(proxy=>{if(this.closed)proxy.close();return proxy}).catch(error=>{this.proxies.delete(fingerprint);throw error})
      promise.providerId=id;promise.sessionId=sessionId;this.proxies.set(fingerprint,promise)
    }
    const proxy=await this.proxies.get(fingerprint)
    return {env:{...limits.env,ANTHROPIC_BASE_URL:proxy.url,ANTHROPIC_API_KEY:proxy.token,ANTHROPIC_AUTH_TOKEN:proxy.token,ANTHROPIC_MODEL:selected,ANTHROPIC_DEFAULT_OPUS_MODEL:selected,ANTHROPIC_DEFAULT_SONNET_MODEL:selected,ANTHROPIC_DEFAULT_HAIKU_MODEL:selected,ANTHROPIC_DEFAULT_FABLE_MODEL:selected},model:selected,context:limits.policy}
  }
  cancelSession(sessionId) { for (const promise of this.proxies.values()) if(promise.sessionId===sessionId)void promise.then(proxy=>proxy.cancelAll()).catch(()=>{}) }
  close() { this.closed=true;for (const promise of this.proxies.values()) promise.then(proxy=>proxy.close()).catch(()=>{}); this.proxies.clear() }
}
module.exports = { ProvidersService, validate, metadata }
