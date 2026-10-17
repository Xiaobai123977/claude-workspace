const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
const output={}
new Function('exports',ts.transpileModule(fs.readFileSync(require.resolve('../src/agent-cards.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(output)
test('agent launch, independent output, and linked background status form one card without child data in ordinary tools',()=>{
  const m={tools:[{id:'read',name:'Read',input:'{}',output:'main file',status:'done'},{id:'agent',name:'Agent',input:'{"description":"验证构建"}',output:'launch result',status:'done'}],subagents:[{id:'agent',text:'child-only output',tools:[{id:'child-read',name:'Read',input:'{}',output:'child file',status:'done'}],status:'running'}],tasks:[{id:'task',toolUseId:'agent',description:'Review',status:'running'}]}
  const cards=output.agentCards(m)
  assert.equal(cards.length,1);assert.equal(cards[0].title,'验证构建');assert.equal(cards[0].task.id,'task');assert.equal(cards[0].agent.text,'child-only output');assert.equal(cards[0].status,'running')
  assert.deepEqual(m.tools.filter(t=>!output.isAgentTool(t)).map(t=>t.id),['read'])
})
