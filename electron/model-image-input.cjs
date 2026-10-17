const TEXT_ONLY_PROMPT = '当前模型按非多模态模型使用，不接受图片输入。图片文件路径只是文件位置，不代表你已经看到图片。不要尝试通过 Read、截图或其他工具读取、打开或解析图片，也不要声称知道图片内容。需要图片信息时，请用户提供文字描述。此限制不影响读取普通文本文件。'

function modelImageInput(session, preferences, connection) {
  const model = session.model || connection?.defaultModel || 'default'
  const key = JSON.stringify([session.providerId || 'subscription', model])
  const configured = preferences.modelImageInputs?.[key]
  const capability = connection?.models?.find(m => m.id === model)
  return { key, enabled: typeof configured === 'boolean' ? configured : capability?.vision !== false }
}

module.exports = { modelImageInput, TEXT_ONLY_PROMPT }
