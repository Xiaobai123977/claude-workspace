const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const compiled = ts.transpileModule(fs.readFileSync(require.resolve('../src/command-presentation.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText
const policy = {exports: {}}
new Function('exports', compiled)(policy.exports)
const {commandPurpose, visibleCommands, visibleSuggestion} = policy.exports

test('default slash menu is curated while explicit search retains GUI shortcuts and other skills', () => {
  const entries = ['model','config','mcp','heapdump','my-skill','clear','init','code-review'].map(key => ({key, description: key === 'my-skill' ? '项目测试技能' : '中文用途'}))
  assert.deepEqual(visibleCommands(entries, '').map(c => c.key), ['code-review','init','clear'])
  assert.deepEqual(visibleCommands(entries, 'model').map(c => c.key), ['model'])
  assert.deepEqual(visibleCommands(entries, '测试').map(c => c.key), ['my-skill'])
  assert.equal(visibleCommands([{key:'goal',description:'clear 清除目标'},{key:'clear',description:'开始新上下文'}],'clear')[0].key,'clear')
})

test('command purposes are Chinese and local overrides never inherit builtin descriptions', () => {
  assert.match(commandPurpose({name:'init',description:'Initialize project',source:'CLI'}), /CLAUDE.md/)
  assert.match(commandPurpose({name:'init',description:'Run customized init',source:'项目技能'}), /运行本地技能/)
  assert.match(commandPurpose({name:'custom',description:'English only',source:'插件 · demo'}), /运行插件技能/)
  assert.equal(commandPurpose({name:'custom',description:'检查项目规范',source:'项目技能'}), '检查项目规范')
  assert.match(commandPurpose({name:'unknown',description:'English only',source:'CLI'}), /未提供中文用途/)
})

test('bare slash suggestions are hidden even when persisted from an older session', () => {
  assert.equal(visibleSuggestion('/init'), false)
  assert.equal(visibleSuggestion(' /code-review --fix'), false)
  assert.equal(visibleSuggestion(''), false)
  assert.equal(visibleSuggestion('检查刚才的改动'), true)
})
