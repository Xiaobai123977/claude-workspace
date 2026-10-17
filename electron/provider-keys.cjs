const crypto = require('node:crypto')
const {normalizeModel}=require('./model-profile.cjs')

function normalizeProvider(input) {
  const p=structuredClone(input)
  p.weight=p.weight??1;p.enabled=p.enabled!==false
  if(!Array.isArray(p.keys))p.keys=[{id:'primary',name:'Key 1',weight:1,enabled:true,key:p.key,keyEnv:p.keyEnv,encryptedKey:p.encryptedKey,hasKey:p.hasKey,models:p.models||[],checkedAt:p.models?.length?Math.max(1,...p.models.map(m=>m.fetchedAt||1)):undefined}]
  p.keys=p.keys.map((key,index)=>({...key,id:key.id||crypto.randomUUID(),name:key.name||`Key ${index+1}`,weight:key.weight??1,enabled:key.enabled!==false,models:(key.models||[]).map(m=>normalizeModel({...m,detected:m.detected??(m.source==='server'||!!m.fetchedAt)}))}))
  return p
}
function publicProvider(input) {
  const p=normalizeProvider(input)
  delete p.key;delete p.encryptedKey;delete p.clearKey
  p.keys=p.keys.map(({key,encryptedKey,clearKey,...rest})=>({...rest,hasKey:!!encryptedKey}))
  p.hasKey=p.keys.some(k=>k.hasKey)
  return p
}
function mergeCatalogs(keys,previous=[]) {
  const ids=new Map()
  for(const key of keys)for(const model of key.models||[]) {
    const old=ids.get(model.id)
    if(!old||old.stale&&!model.stale)ids.set(model.id,{...model})
    else if(!model.stale){
      const levels=[...new Set([...(old.efforts||[]),...(model.efforts||[])])];old.efforts=levels.length?levels:undefined
      for(const field of ['vision','tools','thinking'])old[field]=old[field]===true||model[field]===true?true:old[field]===false&&model[field]===false?false:undefined
      for(const field of ['context','output'])old[field]=old[field]&&model[field]?Math.min(old[field],model[field]):undefined
    }
  }
  return [...ids.values()].map(model=>{
    const old=previous.find(m=>m.id===model.id)
    return {...model,enabled:old?.enabled??true,favorite:old?.favorite,defaultEffort:model.efforts?.includes(old?.defaultEffort)?old.defaultEffort:undefined}
  })
}
module.exports={normalizeProvider,publicProvider,mergeCatalogs}
