// Process-local overrides: never edit the user's CLI configuration or credentials.
const routingKey = key => /^ANTHROPIC_/.test(key) || /^CLAUDE_CODE_(USE_(BEDROCK|VERTEX|FOUNDRY)|SUBAGENT_MODEL|MODEL_OVERRIDES|CUSTOM_MODEL|API_KEY_HELPER)/.test(key)
const baseKeys = ['ANTHROPIC_BASE_URL','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_FABLE_MODEL','CLAUDE_CODE_SUBAGENT_MODEL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY']
function subscriptionOverlay(settings, documents, environment) {
  const managed=documents.find(([scope])=>scope==='managed')?.[1].data||{}
  if (managed.forceLoginGatewayUrl || managed.forceLoginMethod&&managed.forceLoginMethod!=='claudeai' || managed.apiKeyHelper || Object.entries(managed.env||{}).some(([key,value])=>routingKey(key)&&value) || managed.model && !nativeModel(managed.model)) throw new Error('组织策略配置了模型或认证路由，无法启用 Claude 订阅模式。请检查配置来源。')
  const keys=new Set([...baseKeys,...Object.keys(environment).filter(routingKey),...documents.flatMap(([,doc])=>Object.keys(doc.data.env||{}).filter(routingKey))])
  const env=Object.fromEntries([...keys].map(key=>[key,'']))
  env.ANTHROPIC_BASE_URL='https://api.anthropic.com'
  return { settings:{...settings,model:'default',apiKeyHelper:'',forceLoginMethod:'claudeai',env:{...settings.env,...env}},env:{...Object.fromEntries([...keys].map(key=>[key,null])),ANTHROPIC_BASE_URL:env.ANTHROPIC_BASE_URL} }
}
function nativeModel(value) {return !value||/^(default|opus|sonnet|haiku|fable|opusplan)(\[1m\])?$/.test(value)||/^claude-/.test(value)}
function assertSubscriptionModels(info) {
  for(const model of info.models||[]) {
    if(!nativeModel(model.value)||model.resolvedModel&&!nativeModel(model.resolvedModel)||/deepseek|gemini|gpt-|qwen|kimi|glm-/i.test(model.displayName||''))throw new Error('检测到订阅模型仍被外部路由覆盖，已停止使用该列表。请检查组织策略与 Claude 配置。')
  }
  return {...info,models:info.models?info.models.filter((m,index,all)=>all.findIndex(x=>x.value===m.value)===index):undefined}
}
module.exports={subscriptionOverlay,nativeModel,assertSubscriptionModels}
