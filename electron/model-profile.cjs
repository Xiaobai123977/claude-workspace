const fields=['efforts','context','output','vision','tools','thinking']
function capabilities(model){return Object.fromEntries(fields.filter(k=>model[k]!==undefined).map(k=>[k,structuredClone(model[k])]))}
function normalizeModel(input){
  const m=structuredClone(input)
  m.reported=m.reported||((m.source==='server'||m.detected&&m.source!=='manual')?capabilities(m):{})
  m.overrides=m.overrides||(m.source==='manual'?capabilities(m):{})
  for(const field of fields){if(Object.hasOwn(m.overrides,field))m[field]=m.overrides[field]??undefined;else if(Object.hasOwn(m.reported,field))m[field]=m.reported[field]}
  return m
}
function refreshModel(reported,old){
  const prior=old&&normalizeModel(old)
  return normalizeModel({...reported,reported:capabilities(reported),overrides:prior?.overrides||{},request:prior?.request,verification:prior?.verification,enabled:old?.enabled??true,favorite:old?.favorite,defaultEffort:old?.defaultEffort,detected:true,source:Object.keys(prior?.overrides||{}).length?'manual':'server',stale:false})
}
function resolvedModel(provider,model,effort=''){
  const request=model.request||{}
  return {...provider,model:model.id,models:[model],effort:effort||model.defaultEffort||'',thinking:request.thinkingMode??provider.thinking,thinkingBudget:request.thinkingBudget??provider.thinkingBudget,outputTokenField:request.outputTokenField??provider.outputTokenField,timeout:request.timeout??provider.timeout,effortField:request.effortField||'auto',effortMap:request.effortMap||{},extraBody:{...provider.extraBody,...request.extraBody}}
}
function hasImages(body){return !!body?.messages?.some(m=>Array.isArray(m.content)&&m.content.some(b=>b.type==='image'||b.type==='tool_result'&&Array.isArray(b.content)&&b.content.some(c=>c.type==='image')))}
function windowPolicy(routes){
  const contexts=routes.map(r=>r.capability.context).filter(Number.isInteger),outputs=routes.map(r=>r.capability.output).filter(Number.isInteger)
  return {context:contexts.length?Math.min(...contexts):undefined,output:outputs.length?Math.min(...outputs):undefined,unknownContext:routes.filter(r=>!r.capability.context).length}
}
function cliModelEnvironment(routes){
  const policy=windowPolicy(routes),env={}
  if(policy.context){env.CLAUDE_CODE_MAX_CONTEXT_TOKENS=String(policy.context);env.CLAUDE_CODE_AUTO_COMPACT_WINDOW=String(policy.context)}
  if(policy.output)env.CLAUDE_CODE_MAX_OUTPUT_TOKENS=String(Math.min(policy.output,policy.context?Math.max(1,policy.context-1):Infinity))
  if(routes.length&&routes.every(r=>Array.isArray(r.capability.efforts)||typeof r.capability.thinking==='boolean')){
    const caps=[]
    if(routes.every(r=>r.capability.efforts?.length)){caps.push('effort');if(routes.every(r=>r.capability.efforts.includes('xhigh')))caps.push('xhigh_effort');if(routes.every(r=>r.capability.efforts.includes('max')))caps.push('max_effort')}
    if(routes.every(r=>r.capability.thinking===true)){caps.push('thinking');if(routes.every(r=>r.capability.request?.thinkingMode==='adaptive'))caps.push('adaptive_thinking')}
    for(const name of ['OPUS','SONNET','HAIKU','FABLE'])env[`ANTHROPIC_DEFAULT_${name}_MODEL_SUPPORTED_CAPABILITIES`]=caps.join(',')
  }
  return {env,policy}
}
function applyEffort(request,p){
  if(p.effortField==='auto'||!p.effortField)return request
  delete request.reasoning_effort
  if(request.reasoning){request.reasoning={...request.reasoning};delete request.reasoning.effort;if(!Object.keys(request.reasoning).length)delete request.reasoning}
  if(request.output_config){request.output_config={...request.output_config};delete request.output_config.effort;if(!Object.keys(request.output_config).length)delete request.output_config}
  if(p.effort&&p.effortField!=='none'){
    const value=p.effortMap?.[p.effort]??p.effort,parts=p.effortField.split('.')
    if(parts.length===1)request[parts[0]]=value;else request[parts[0]]={...request[parts[0]],[parts[1]]:value}
  }
  return request
}
module.exports={fields,capabilities,normalizeModel,refreshModel,resolvedModel,hasImages,windowPolicy,cliModelEnvironment,applyEffort}
