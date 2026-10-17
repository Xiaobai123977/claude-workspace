const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
function load(name){const output={};new Function('exports',ts.transpileModule(fs.readFileSync(require.resolve('../src/'+name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(output);return output}
const {layoutTopology,nodeHeight,NODE_WIDTH}=load('topology-layout'),{topologyView}=load('topology-view')
const node=(id,parent)=>({id,label:id,purpose:id,kind:'module',inputs:['request'],outputs:['result'],refs:[],...(parent?{parent}:{})})
const edge=(id,source,target,kind='data')=>({id,source,target,kind,label:id,data:id,sourceOutputs:['result'],targetInputs:['request'],refs:[]})
test('long flows keep their direction rather than wrapping arbitrary nodes into a three-column card grid; loops terminate',()=>{
  const nodes=Array.from({length:8},(_,i)=>node('n'+i)),edges=nodes.slice(1).map((n,i)=>edge('e'+i,'n'+i,n.id));edges.push(edge('return','n7','n0','return'))
  const layout=layoutTopology(nodes,edges)
  for(let i=1;i<nodes.length;i++)assert.ok(layout.positions.get('n'+i).x>layout.positions.get('n'+(i-1)).x)
  const cyclic=layoutTopology(nodes,[...edges,edge('cycle','n4','n2')]);assert.equal(cyclic.positions.size,8)
  for(const a of nodes)for(const b of nodes){if(a.id===b.id)continue;const x=cyclic.positions.get(a.id),y=cyclic.positions.get(b.id);assert.ok(x.x+NODE_WIDTH<=y.x||y.x+NODE_WIDTH<=x.x||x.y+nodeHeight(a)<=y.y||y.y+nodeHeight(b)<=x.y)}
})
test('cross-level data flow stays visible and missing endpoints are explicit diagnostics without altering graph data',()=>{
  const graph={nodes:[node('a'),node('b'),node('worker','a')],edges:[edge('cross','worker','b'),edge('reply','b','worker','return')]},original=JSON.stringify(graph)
  const view=topologyView(graph,'a');assert.ok(view.nodes.some(n=>n.id==='b'&&n.viewKind==='context'));assert.equal(view.edges.filter(e=>!e.inferred).length,2)
  const root=topologyView(graph,'');assert.equal(root.edges.find(e=>e.id==='cross').source,'a')
  const isolated=topologyView({nodes:[node('orphan')],edges:[]},'');assert.equal(isolated.nodes.filter(n=>n.viewKind==='unknown').length,2);assert.ok(isolated.edges.every(e=>e.problem));assert.equal(JSON.stringify(graph),original)
})
