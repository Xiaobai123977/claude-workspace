// CLI transcripts wrap slash invocations in these tags. Only normalize a full
// command record, never examples, prose, assistant output or arbitrary markup.
function commandText(text) {
  if (typeof text !== 'string') return text
  const fields = new Map(), pattern = /\s*<(command-name|command-message|command-args)>([\s\S]*?)<\/\1>/gy
  let offset = 0, match
  while ((match = pattern.exec(text))) {
    if (fields.has(match[1])) return text
    fields.set(match[1], match[2]); offset = pattern.lastIndex
  }
  if (!offset || text.slice(offset).trim() || !/^\/[\w:.-]+$/.test(fields.get('command-name') || '')) return text
  const args = (fields.get('command-args') || '').trim()
  return fields.get('command-name') + (args ? ' ' + args : '')
}
module.exports = {commandText}
