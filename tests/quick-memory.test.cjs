const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const compiled = ts.transpileModule(fs.readFileSync(require.resolve('../src/quick-memory.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText
const output = {}
new Function('exports', compiled)(output)

test('quick memory keeps ordinary markdown headings available and rejects empty rules', () => {
  assert.equal(output.isQuickMemory('#回答用中文'), true)
  assert.equal(output.isQuickMemory('## 标题'), false)
  assert.equal(output.isQuickMemory('普通消息 #规则'), false)
  assert.throws(() => output.appendQuickMemory('original', '#  '), /输入要记住/)
})

test('append preserves original instructions and line endings, including multiline rules', () => {
  assert.equal(output.appendQuickMemory('', '#回答用中文'), '# 快速记忆\n\n- 回答用中文\n')
  const original = '# Team rules\r\nExisting content.\r\n'
  const result = output.appendQuickMemory(original, '#先运行测试\n再提交代码')
  assert.ok(result.startsWith(original))
  assert.equal(result, original + '\r\n- 先运行测试\r\n  再提交代码\r\n')
})
