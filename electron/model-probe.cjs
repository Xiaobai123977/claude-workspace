const crypto=require('node:crypto'),zlib=require('node:zlib')
const {startProxy,convertRequest,endpoint}=require('./provider-proxy.cjs')
const {resolvedModel}=require('./model-profile.cjs')
function signature(p,m){return crypto.createHash('sha256').update(JSON.stringify([p.baseUrl,p.protocol,p.auth,p.key,p.headers,p.extraBody,p.thinking,p.thinkingBudget,p.outputTokenField,p.timeout,m.reported,m.overrides,m.request,m.defaultEffort,p.models.find(x=>x.id===m.id)?.defaultEffort])).digest('hex')}
function redact(value,secret=''){
  if(Array.isArray(value))return value.map(v=>redact(v,secret))
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/api.?key|authorization|password|secret|credential|access.?token|auth.?token|^encryptedKey$|^key$|^data$/i.test(k)?'[已隐藏]':redact(v,secret)]))
  return typeof value==='string'?value.split(secret||'\0').join('[已隐藏]').replace(/data:image\/[^;]+;base64,[\w+/=]+/g,'[图片数据]'):value
}
function resolve(service,input,keyId,modelId){
  const p=service.resolve(input,keyId),model=p.keys.find(k=>k.id===p.keyId)?.models.find(m=>m.id===modelId)
  if(!model)throw new Error('所选 Key 没有此模型，请先独立检测或手动声明')
  return {p,model}
}
function preview(service,input,keyId,modelId){
  const {p,model}=resolve(service,input,keyId,modelId),effective=resolvedModel(p,model,model.defaultEffort||input.models.find(m=>m.id===modelId)?.defaultEffort||'')
  const body={model:modelId,max_tokens:model.output||4096,stream:false,messages:[{role:'user',content:'[消息内容]'}]}
  const params={...convertRequest(body,effective),...effective.extraBody}
  return {protocol:p.protocol,endpoint:endpoint(p.baseUrl,p.protocol),keyName:p.keyName,signature:signature(p,model),context:model.context,params:redact(params,p.key),overriddenFields:Object.keys(effective.extraBody||{}).filter(k=>Object.hasOwn(convertRequest(body,effective),k)),headerNames:Object.keys(service.headers(p))}
}
function colorPng(red){
  const crc=buffer=>{let c=0xffffffff;for(const byte of buffer){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
  const chunk=(type,data)=>{const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const payload=Buffer.concat([Buffer.from(type),data]),sum=Buffer.alloc(4);sum.writeUInt32BE(crc(payload));return Buffer.concat([size,payload,sum])}
  const head=Buffer.alloc(13);head.writeUInt32BE(16,0);head.writeUInt32BE(16,4);head[8]=8;head[9]=2
  const rows=Buffer.alloc(16*(1+16*3));for(let y=0;y<16;y++)for(let x=0;x<16;x++)rows[y*49+1+x*3+(red?0:2)]=255
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]).toString('base64')
}
async function probe(service,input,keyId,modelId,kind){
  if(!['generation','tools','vision',...'none minimal low medium high xhigh max'.split(' ').map(e=>'effort:'+e)].includes(kind))throw new Error('验证类型无效')
  const {p,model}=resolve(service,input,keyId,modelId),nonce=crypto.randomBytes(8).toString('hex'),time=Date.now()
  const effort=kind.startsWith('effort:')?kind.slice(7):''
  if(effort&&!model.efforts?.includes(effort))throw new Error('请先声明此档位，再测试请求是否被接受')
  const effective=resolvedModel(p,{...model,vision:undefined,tools:undefined},effort||input.models.find(m=>m.id===modelId)?.defaultEffort||''),mark={kind,checkedAt:time,signature:signature(p,model),ok:false}
  const proxy=await startProxy(effective,service.headers(p),service.fetcher,{retryPolicy:{maxRetries:0}})
  let status
  const post=async(body)=>{
    const response=await fetch(proxy.url+'/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':proxy.token},body:JSON.stringify({max_tokens:256,stream:false,...body}),signal:AbortSignal.timeout(Math.min(effective.timeout||45000,45000))});status=response.status
    const data=await response.json()
    if(!response.ok)throw new Error(data.error?.message||`HTTP ${response.status}`)
    return data
  }
  try{
    if(kind==='tools'){
      const tools=[{name:'workspace_probe',description:'Return the token supplied in the request. No side effects.',input_schema:{type:'object',properties:{token:{type:'string',enum:[nonce]}},required:['token']}}]
      const messages=[{role:'user',content:`Call workspace_probe with token ${nonce}, then repeat the tool result.`}]
      const first=await post({messages,tools,tool_choice:{type:'tool',name:'workspace_probe'}}),call=first.content?.find(b=>b.type==='tool_use')
      if(call?.name!=='workspace_probe'||call.input?.token!==nonce)throw new Error('未返回符合要求的工具调用')
      const result=await post({messages:[...messages,{role:'assistant',content:first.content},{role:'user',content:[{type:'tool_result',tool_use_id:call.id,content:nonce}]}],tools})
      if(!result.content?.some(b=>b.type==='text'&&b.text.includes(nonce)))throw new Error('工具结果回传未验证通过')
      mark.detail='工具调用及结果回传已验证'
    }else if(kind==='vision'){
      for(const red of [true,false]){
        const result=await post({max_tokens:24,messages:[{role:'user',content:[{type:'text',text:'Name the dominant color of the supplied image. Reply with one English color word.'},{type:'image',source:{type:'base64',media_type:'image/png',data:colorPng(red)}}]}]})
        const text=result.content?.filter(b=>b.type==='text').map(b=>b.text).join(' ').trim().toLowerCase()
        if(!text?.includes(red?'red':'blue'))throw new Error('未正确识别测试图片颜色，暂不能确认视觉能力')
      }
      mark.detail='两张颜色图片识别已验证；不代表复杂视觉任务质量'
    }else{
      const result=await post({messages:[{role:'user',content:'Reply OK only.'}]})
      if(!result.content?.some(b=>b.type==='text'&&b.text.trim()))throw new Error('未返回可用文本')
      mark.detail=effort?'此档位请求已被接受；不能据此证明上游实际采用该推理强度':'文本生成已验证'
    }
    mark.ok=true
  }catch(e){mark.detail=String(e.message).split(p.key||'\0').join('[已隐藏]').slice(0,16384)}finally{proxy.close()}
  return {...mark,status,elapsedMs:Date.now()-time}
}
module.exports={preview,probe,signature,redact,colorPng}
