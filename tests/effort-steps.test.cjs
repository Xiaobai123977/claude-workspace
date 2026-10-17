const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
const output={}
new Function('exports',ts.transpileModule(fs.readFileSync(require.resolve('../src/effort-steps.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(output)
test('thinking steps preserve configured selection order, with default between off and the first enabled step',()=>{
  assert.deepEqual(output.effortSteps(['max','low','none','high']),['none','','max','low','high'])
  assert.deepEqual(output.effortSteps(['high','minimal','low','high']),['','high','minimal','low'])
  assert.deepEqual(output.effortSteps(['none']),['none',''])
  assert.deepEqual(output.effortSteps([]),[''])
  assert.deepEqual(output.effortSteps(['','low','none','none','']),['none','','low'])
})
