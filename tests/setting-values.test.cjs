const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
const output={}
new Function('exports',ts.transpileModule(fs.readFileSync(require.resolve('../src/setting-values.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(output)
const {sameSettingValue}=output
test('IPC copies of nested preferences are clean regardless of object key order',()=>{
  const saved={modelImageInputs:{alpha:false,beta:true},fontSize:'14'}
  assert.equal(sameSettingValue(structuredClone(saved),saved),true)
  assert.equal(sameSettingValue({fontSize:'14',modelImageInputs:{beta:true,alpha:false}},saved),true)
  assert.equal(sameSettingValue({a:undefined},{}),true)
})
test('real setting edits, deleted keys and array order are still tracked',()=>{
  assert.equal(sameSettingValue({model:false},{model:true}),false)
  assert.equal(sameSettingValue({model:false},{}),false)
  assert.equal(sameSettingValue({values:['low','high']},{values:['high','low']}),false)
  assert.equal(sameSettingValue({values:['low']},{values:['low']}),true)
  assert.equal(sameSettingValue(undefined,null),false)
})
