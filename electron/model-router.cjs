const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const {retryDelay}=require('./gateway-retry.cjs')

// Smooth weighted round-robin is applied twice. Adding more keys never increases a supplier's share.
class ModelRouter {
  constructor({file,now=Date.now}={}) {
    this.file=file;this.now=now;this.weights=new Map();this.health=new Map();this.sticky=new Map()
    if(file&&fs.existsSync(file)){try{this.sticky=new Map(JSON.parse(fs.readFileSync(file,'utf8')).filter(([,v])=>v.expiresAt>now()))}catch{/* Affinity state is disposable; provider configuration is separate. */}}
  }
  persist(){
    const now=this.now();for(const [key,value]of this.sticky)if(value.expiresAt<=now)this.sticky.delete(key)
    while(this.sticky.size>2000)this.sticky.delete(this.sticky.keys().next().value)
    if(!this.file)return
    const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify([...this.sticky]),{mode:0o600});fs.renameSync(temp,this.file)
  }
  affinity(scope,sessionId,model){return crypto.createHash('sha256').update(JSON.stringify([scope,sessionId,model])).digest('hex')}
  healthIds(route){return [`provider:${route.providerId}:${route.revision}`,`key:${route.providerId}:${route.keyId}:${route.revision}`,`model:${route.id}:${route.revision}`]}
  availableAt(route){return Math.max(0,...this.healthIds(route).map(id=>this.health.get(id)?.until||0))}
  available(routes){return routes.filter(r=>this.availableAt(r)<=this.now())}
  weighted(scope,items){
    const total=items.reduce((sum,r)=>sum+r.weight,0);let winner
    for(const item of items){const id=`${scope}:${item.id}`,value=(this.weights.get(id)||0)+item.weight;this.weights.set(id,value);if(!winner||value>winner.value)winner={item,value,id}}
    this.weights.set(winner.id,winner.value-total)
    if(this.weights.size>20000)this.weights.clear()
    return winner.item
  }
  choose(routes,{scope,sessionId,model,sticky=true,ttlMinutes=60}) {
    const healthy=this.available(routes)
    if(!healthy.length){
      const earliest=Math.min(...routes.map(r=>this.availableAt(r)))
      const blocked=routes.find(r=>this.availableAt(r)===earliest)
      const failure=blocked&&this.healthIds(blocked).map(id=>this.health.get(id)).filter(v=>v?.until>this.now()).sort((a,b)=>b.until-a.until)[0]
      const error=new Error(!routes.length?'没有已检测且能力兼容的模型线路':failure?.status?(failure.hint||`HTTP ${failure.status}`):'所有已确认线路正在冷却或不可用')
      error.routingStatus=!routes.length?400:failure?.status||503
      error.retryAfterMs=Number.isFinite(earliest)?Math.max(0,earliest-this.now()):undefined
      error.noRetry=!routes.length||!Number.isFinite(earliest)||[401,403,404].includes(failure?.status)
      throw error
    }
    const affinity=this.affinity(scope,sessionId,model),previous=this.sticky.get(affinity)
    if(sticky&&sessionId&&previous?.expiresAt>this.now()) {
      const route=healthy.find(r=>r.id===previous.routeId)
      if(route){this.sticky.set(affinity,{routeId:route.id,expiresAt:this.now()+ttlMinutes*60000});this.persist();return route}
    }
    const suppliers=[...new Map(healthy.map(r=>[r.providerId,{id:r.providerId,weight:r.providerWeight}])).values()]
    const supplier=this.weighted(scope+':providers',suppliers)
    const route=this.weighted(scope+':keys:'+supplier.id,healthy.filter(r=>r.providerId===supplier.id).map(r=>({...r,weight:r.keyWeight})))
    if(sticky&&sessionId){this.sticky.set(affinity,{routeId:route.id,expiresAt:this.now()+ttlMinutes*60000});this.persist()}
    return route
  }
  report(route,{response,error,hint=''}) {
    if(!route)return
    const status=response?.status,ids=this.healthIds(route)
    if(response?.ok){for(const id of ids)this.health.delete(id);return}
    if(error||[408,409,425,429,500,502,503,504,529].includes(status)||status>=500){
      const delay=response?retryDelay(response.headers,1,{random:()=>0.5}):2000
      const id=ids[1]
      this.health.set(id,{until:this.now()+Math.max(1,delay),status:status||0,hint})
    }else if(status===401)this.health.set(ids[1],{until:this.now()+30000,status,hint})
    else if(status===403||status===404)this.health.set(ids[2],{until:this.now()+3000,status,hint})
  }
  snapshot(routes){return routes.map(r=>({id:r.id,providerId:r.providerId,keyId:r.keyId,model:r.model,coolingUntil:Number.isFinite(this.availableAt(r))?this.availableAt(r):null,unavailable:this.availableAt(r)>this.now()}))}
}
module.exports={ModelRouter}
