const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto')
const {normalizeProvider,publicProvider}=require('./provider-keys.cjs')
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const atomic=(file,data)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file)}
function diffConfig(before,after){
  const view=pair=>({providers:Object.fromEntries(pair.providers.map(p=>[p.id,portable(p)])),pools:Object.fromEntries(pair.pools.map(({revision,...p})=>[p.id,p]))}),rows=[]
  const display=v=>v===undefined?'未设置':JSON.stringify(v).slice(0,600)
  const visit=(a,b,location)=>{if(rows.length>=200||JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))visit(a[key],b[key],location?location+'.'+key:key)}else rows.push({path:location,before:display(a),after:display(b)})}
  visit(view(before),view(after),'');return rows
}
function portable(provider){
  const p=publicProvider(provider);delete p.headers;delete p.extraBody;delete p.hasKey;delete p.revision
  for(const key of p.keys){delete key.hasKey;delete key.checkedAt;delete key.checkError;delete key.checkAttemptAt;for(const model of key.models){delete model.verification;if(model.request)delete model.request.extraBody}}
  for(const model of p.models){delete model.verification;if(model.request)delete model.request.extraBody}
  return p
}
class ModelConfigStore{
  constructor(service,validate){this.service=service;this.validate=validate;this.dir=path.join(path.dirname(service.file),'provider-backups');this.journal=path.join(path.dirname(service.file),'model-config-transaction.json');this.plans=new Map()}
  snapshot(){return {schemaVersion:1,providers:this.service.read(),pools:this.service.pools()}}
  recover(){if(!fs.existsSync(this.journal))return;const data=JSON.parse(fs.readFileSync(this.journal,'utf8'));if(data.schemaVersion!==1||!Array.isArray(data.before?.providers)||!Array.isArray(data.before?.pools))throw new Error('模型配置事务文件无效，未覆盖配置');atomic(this.service.file,data.before.providers);atomic(this.service.poolsFile,data.before.pools);fs.rmSync(this.journal)}
  backup(reason='保存前自动备份'){
    const data=this.snapshot();if(!data.providers.length&&!data.pools.length)return null
    fs.mkdirSync(this.dir,{recursive:true});const name=Date.now()+'-'+crypto.randomUUID()+'.json';atomic(path.join(this.dir,name),{...data,createdAt:Date.now(),reason})
    for(const old of this.backups().slice(30))fs.rmSync(path.join(this.dir,old.name))
    return name
  }
  backups(){if(!fs.existsSync(this.dir))return[];return fs.readdirSync(this.dir).filter(n=>/^\d+-[0-9a-f-]{36}\.json$/.test(n)&&fs.lstatSync(path.join(this.dir,n)).isFile()).sort().reverse().map(name=>{const data=JSON.parse(fs.readFileSync(path.join(this.dir,name),'utf8'));return{name,createdAt:data.createdAt,reason:data.reason,providers:data.providers?.length||0,pools:data.pools?.length||0}})}
  export(){return {schemaVersion:1,exportedAt:Date.now(),credentialsIncluded:false,notes:'不含 API Key、凭证密文、请求头值和兼容参数 JSON；新供应商导入后默认停用。',providers:this.service.read().map(portable),pools:this.service.pools().map(({revision,...p})=>p)}}
  prepare(data,restore=false){
    if(!data||data.schemaVersion!==1||!Array.isArray(data.providers)||!Array.isArray(data.pools)||data.providers.length>100||data.pools.length>1000||JSON.stringify(data).length>10*1024*1024)throw new Error('模型配置格式或版本无效')
    const before=this.snapshot(),ids=new Set()
    const providers=data.providers.map(input=>{
      if(typeof input.id!=='string'||!input.id||input.id.length>100||ids.has(input.id))throw new Error('供应商 ID 无效或重复');ids.add(input.id)
      if(restore){const p=this.validate(normalizeProvider(input));for(const k of p.keys)if(k.encryptedKey)this.service.secureStorage.decryptString(Buffer.from(k.encryptedKey,'base64'));return{...p,schemaVersion:2,revision:crypto.randomUUID()}}
      const old=before.providers.find(p=>p.id===input.id),previous=old?normalizeProvider(old):null,p=normalizeProvider(input)
      delete p.key;delete p.encryptedKey;delete p.hasKey;delete p.clearKey
      p.headers=previous?.headers||{};p.extraBody=previous?.extraBody||{}
      p.keys=p.keys.map(k=>{const oldKey=previous?.keys.find(x=>x.id===k.id);delete k.key;delete k.encryptedKey;delete k.clearKey;delete k.hasKey;if(oldKey?.encryptedKey)k.encryptedKey=oldKey.encryptedKey;if(p.auth!=='none'&&!k.encryptedKey&&p.auth!=='env')k.enabled=false;k.models=k.models.map(m=>{delete m.verification;m.detected=false;m.source='import';if(m.request){const prior=oldKey?.models.find(x=>x.id===m.id);m.request.extraBody=prior?.request?.extraBody||{}}return m});return k})
      if(!old||!p.keys.some(k=>k.enabled!==false))p.enabled=false
      return {...this.validate(p),schemaVersion:2,revision:crypto.randomUUID()}
    })
    // Portable import merges suppliers and pools; restoring an internal backup restores its whole snapshot.
    const merged=restore?providers:[...before.providers.filter(p=>!ids.has(p.id)),...providers]
    const poolIds=new Set();const incoming=data.pools.map(p=>{if(typeof p.id!=='string'||!p.id.startsWith('pool:')||poolIds.has(p.id))throw new Error('模型池 ID 无效或重复');poolIds.add(p.id);return{...p,enabled:restore?p.enabled:before.pools.some(x=>x.id===p.id)?p.enabled:false,revision:crypto.randomUUID()}})
    const pools=restore?incoming:[...before.pools.filter(p=>!poolIds.has(p.id)),...incoming]
    const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'claude-config-validate-'))
    let checker
    try{
      fs.writeFileSync(path.join(temp,'providers.json'),JSON.stringify(merged));fs.writeFileSync(path.join(temp,'model-pools.json'),JSON.stringify(pools))
      checker=new this.service.constructor({userData:temp,secureStorage:this.service.secureStorage})
      for(const pool of pools)checker.savePool(pool,{validateOnly:true})
    }finally{checker?.close();if(path.dirname(fs.realpathSync(temp))===fs.realpathSync(os.tmpdir()))fs.rmSync(temp,{recursive:true,force:true})}
    const after={schemaVersion:1,providers:merged,pools},changes=[]
    for(const p of merged){const old=before.providers.find(x=>x.id===p.id);if(!old)changes.push('新增供应商：'+p.name);else if(digest(portable(old))!==digest(portable(p)))changes.push('更新供应商：'+p.name)}
    for(const p of pools){const old=before.pools.find(x=>x.id===p.id);if(!old)changes.push('新增模型池：'+p.name);else if(digest({...old,revision:''})!==digest({...p,revision:''}))changes.push('更新模型池：'+p.name)}
    if(restore){for(const p of before.providers)if(!merged.some(x=>x.id===p.id))changes.push('移除供应商：'+p.name);for(const p of before.pools)if(!pools.some(x=>x.id===p.id))changes.push('移除模型池：'+p.name)}
    const token=crypto.randomUUID();while(this.plans.size>=10)this.plans.delete(this.plans.keys().next().value)
    this.plans.set(token,{beforeHash:digest(before),after,restore,expires:Date.now()+600000})
    return {token,restore,providers:merged.length,pools:pools.length,changes,details:diffConfig(before,after),credentials:restore?'从本机加密备份恢复凭证':'同 ID 的已存凭证保持；新供应商需补填凭证并启用'}
  }
  prepareBackup(name){if(!/^\d+-[0-9a-f-]{36}\.json$/.test(name))throw new Error('备份名称无效');const file=path.join(this.dir,name);if(!fs.lstatSync(file).isFile())throw new Error('备份文件无效');return this.prepare(JSON.parse(fs.readFileSync(file,'utf8')),true)}
  apply(token){
    const plan=this.plans.get(token);if(!plan||plan.expires<Date.now())throw new Error('预览已过期，请重新读取')
    const before=this.snapshot();if(digest(before)!==plan.beforeHash)throw new Error('配置已被修改，请重新预览')
    this.backup(plan.restore?'恢复备份前':'导入前');atomic(this.journal,{schemaVersion:1,before})
    try{atomic(this.service.file,plan.after.providers);atomic(this.service.poolsFile,plan.after.pools);fs.rmSync(this.journal);this.plans.delete(token)}catch(e){atomic(this.service.file,before.providers);atomic(this.service.poolsFile,before.pools);fs.rmSync(this.journal);throw e}
    return{providers:plan.after.providers.length,pools:plan.after.pools.length}
  }
}
module.exports={ModelConfigStore,portable}
