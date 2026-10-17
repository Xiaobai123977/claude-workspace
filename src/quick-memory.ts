export type MemoryScope = 'project' | 'user'
export const isQuickMemory = (text: string) => /^#(?!#)/.test(text)
export const memoryText = (text: string) => isQuickMemory(text) ? text.slice(1).trim() : ''

export function appendQuickMemory(content: string, text: string) {
  const rule = memoryText(text)
  if (!rule) throw new Error('请在 # 后输入要记住的规则')
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const entry = '- ' + rule.replace(/\r\n?/g, '\n').split('\n').join(newline + '  ')
  return content + (content ? (content.endsWith(newline + newline) ? '' : content.endsWith(newline) ? newline : newline + newline) : '# 快速记忆' + newline + newline) + entry + newline
}
