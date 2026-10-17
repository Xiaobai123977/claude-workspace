const counter=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:undefined
const keys=['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens']
function normalizeUsage(raw={},protocol='anthropic'){
  if(protocol==='anthropic')return Object.fromEntries(keys.filter(k=>counter(raw[k])!==undefined).map(k=>[k,raw[k]]))
  const total=counter(protocol==='chat'?raw.prompt_tokens:raw.input_tokens),output=counter(protocol==='chat'?raw.completion_tokens:raw.output_tokens)
  const cached=counter(protocol==='chat'?raw.prompt_tokens_details?.cached_tokens??raw.prompt_cache_hit_tokens:raw.input_tokens_details?.cached_tokens)
  return{...(total!==undefined?{input_tokens:Math.max(0,total-(cached||0))}:{}),...(output!==undefined?{output_tokens:output}:{}),...(cached!==undefined?{cache_read_input_tokens:Math.min(cached,total??cached),cache_creation_input_tokens:0}:{})}
}
function mergeUsage(a={},b={}){return Object.fromEntries(keys.filter(k=>counter(a[k])!==undefined||counter(b[k])!==undefined).map(k=>[k,Math.max(a[k]||0,b[k]||0)]))}
function sumUsage(values){const out={};for(const u of values)for(const k of keys)if(counter(u?.[k])!==undefined)out[k]=(out[k]||0)+u[k];return out}
function stats(usage,cacheReporting){
  const u=normalizeUsage(usage),known=keys.some(k=>u[k]!==undefined)
  const cacheKnown=cacheReporting!==false&&(u.cache_read_input_tokens!==undefined||u.cache_creation_input_tokens!==undefined)
  const input=known&&(u.input_tokens!==undefined||u.cache_read_input_tokens!==undefined||u.cache_creation_input_tokens!==undefined)?(u.input_tokens||0)+(u.cache_read_input_tokens||0)+(u.cache_creation_input_tokens||0):null
  return{known,input,uncached:u.input_tokens??null,output:u.output_tokens??null,cacheRead:cacheKnown?u.cache_read_input_tokens||0:null,cacheWrite:cacheKnown?u.cache_creation_input_tokens||0:null,cacheKnown,cacheRate:cacheKnown&&input>0?(u.cache_read_input_tokens||0)/input*100:null,total:known?(input||0)+(u.output_tokens||0):null}
}
const contextKey=session=>JSON.stringify([session.providerId||'',session.model||'',session.effort||''])
function normalizeContext(raw){
  if(counter(raw?.totalTokens)===undefined||counter(raw?.maxTokens)===undefined||raw.maxTokens<=0)return null
  return{used:raw.totalTokens,max:raw.maxTokens,rawMax:counter(raw.rawMaxTokens)??null,percentage:raw.totalTokens/raw.maxTokens*100,categories:(raw.categories||[]).filter(c=>counter(c.tokens)!==undefined).map(c=>({name:String(c.name),tokens:c.tokens,kind:c.kind|| (c.isDeferred?'deferred':undefined)})),autoCompactThreshold:counter(raw.autoCompactThreshold)??null,isAutoCompactEnabled:raw.isAutoCompactEnabled===true,model:typeof raw.model==='string'?raw.model:''}
}
function sessionUsage(session){
  const replies=session.messages.filter(m=>m.role==='assistant'),measured=replies.filter(m=>m.usage&&stats(m.usage).known),last=measured.at(-1)
  const lastStats=last?stats(last.usage,last.cacheReporting):stats(),totals=stats(sumUsage(measured.map(m=>m.usage)),measured.every(m=>stats(m.usage,m.cacheReporting).cacheKnown))
  const report=session.contextReport,anchor=session.messages.at(-1)?.id,key=contextKey(session)
  const validReport=report&&report.anchor===anchor&&report.key===key&&report.nativeId===session.nativeId
  const context=validReport?{...report.value,source:'cli',updatedAt:report.updatedAt}:{used:null,max:null,percentage:null,categories:[],source:'unavailable',rawMax:null,autoCompactThreshold:null,isAutoCompactEnabled:null,model:''}
  return{latest:lastStats,totals,context,recordedReplies:measured.length,completedReplies:replies.filter(m=>m.status==='done').length,cost:counter(last?.usage?.cost)??null,running:session.messages.some(m=>m.status==='running')}
}
module.exports={normalizeUsage,mergeUsage,sumUsage,stats,contextKey,normalizeContext,sessionUsage}
