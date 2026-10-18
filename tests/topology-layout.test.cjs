const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript')
function load(name){const output={};new Function('require','exports',ts.transpileModule(fs.readFileSync(require.resolve('../src/'+name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,output);return output}
const {layoutTopology,nodeHeight,NODE_WIDTH}=load('topology-layout'),{topologyView,overviewTopology}=load('topology-view')
const node=(id,parent)=>({id,label:id,purpose:id,kind:'module',inputs:['request'],outputs:['result'],refs:[],...(parent?{parent}:{})})
const edge=(id,source,target,kind='data')=>({id,source,target,kind,label:id,data:id,sourceOutputs:['result'],targetInputs:['request'],refs:[]})
test('long flows keep their direction rather than wrapping arbitrary nodes into a three-column card grid; loops terminate',async()=>{
  const nodes=Array.from({length:8},(_,i)=>node('n'+i)),edges=nodes.slice(1).map((n,i)=>edge('e'+i,'n'+i,n.id));edges.push(edge('return','n7','n0','return'))
  const layout=await layoutTopology(nodes,edges)
  for(let i=1;i<nodes.length;i++)assert.ok(layout.positions.get('n'+i).x>layout.positions.get('n'+(i-1)).x)
  const cyclic=await layoutTopology(nodes,[...edges,edge('cycle','n4','n2')]);assert.equal(cyclic.positions.size,8)
  for(const a of nodes)for(const b of nodes){if(a.id===b.id)continue;const x=cyclic.positions.get(a.id),y=cyclic.positions.get(b.id);assert.ok(x.x+NODE_WIDTH<=y.x||y.x+NODE_WIDTH<=x.x||x.y+nodeHeight(a)<=y.y||y.y+nodeHeight(b)<=x.y)}
})
test('cross-level data flow stays visible and missing endpoints are explicit diagnostics without altering graph data',()=>{
  const graph={nodes:[node('a'),node('b'),node('worker','a')],edges:[edge('cross','worker','b'),edge('reply','b','worker','return')]},original=JSON.stringify(graph)
  const view=topologyView(graph,'a');assert.ok(view.nodes.some(n=>n.id==='b'&&n.viewKind==='context'));assert.equal(view.edges.filter(e=>!e.inferred).length,2)
  const root=topologyView(graph,'');assert.equal(root.edges.find(e=>e.id==='cross').source,'a')
  const isolated=topologyView({nodes:[node('orphan')],edges:[]},'');assert.equal(isolated.nodes.filter(n=>n.viewKind==='unknown').length,2);assert.ok(isolated.edges.every(e=>e.problem));assert.equal(JSON.stringify(graph),original)
})

test('dense branches, parallel ports, skip-stage paths and returns use independent tracks outside unrelated modules',async()=>{
  const nodes=['start','a','b','c','merge','end'].map(id=>({...node(id),inputs:['request','failure','extra'],outputs:['result','failure','extra']}))
  const edges=[edge('sa','start','a'),edge('sb','start','b'),edge('sc','start','c'),edge('am','a','merge'),edge('bm','b','merge'),edge('cm','c','merge'),edge('me','merge','end'),edge('skip','start','end'),edge('back','end','start','return'),{...edge('parallel','start','a'),sourceOutputs:['result','failure'],targetInputs:['request','failure']}]
  const original=JSON.stringify({nodes,edges}),layout=await layoutTopology(nodes,edges)
  assert.notDeepEqual(layout.routes.get('sa:0').points,layout.routes.get('parallel:0').points)
  assert.equal(layout.routes.has('parallel:1'),false,'Port lists do not expand a business relationship into a wire per item')
  for(const e of edges)for(let wire=0;wire<1;wire++){
    const route=layout.routes.get(e.id+':'+wire)
    assert.ok(route)
    for(let i=1;i<route.points.length;i++){
      const a=route.points[i-1],b=route.points[i]
      assert.ok(a.x===b.x||a.y===b.y)
      for(const n of nodes){
        if(n.id===e.source||n.id===e.target)continue
        const p=layout.positions.get(n.id),right=p.x+NODE_WIDTH,bottom=p.y+nodeHeight(n)
        const intersects=a.x===b.x?a.x>p.x&&a.x<right&&Math.max(a.y,b.y)>p.y&&Math.min(a.y,b.y)<bottom:a.y>p.y&&a.y<bottom&&Math.max(a.x,b.x)>p.x&&Math.min(a.x,b.x)<right
        assert.equal(intersects,false,`${e.id} crosses ${n.id}`)
      }
    }
  }
  assert.equal(JSON.stringify({nodes,edges}),original)
})

test('19 modules and 20 multi-port relationships stay compact instead of becoming hundreds of perimeter wires',async()=>{
  const ports=Array.from({length:12},(_,i)=>'data-'+i),nodes=Array.from({length:19},(_,i)=>({...node('m'+i),inputs:ports,outputs:ports}))
  const edges=[]
  for(let i=0;i<4;i++)edges.push(edge('main-'+i,'m'+i,'m'+(i+1)))
  for(let i=5;i<19;i++)edges.push(edge('branch-'+i,'m'+(i%3+1),'m'+i))
  edges.push(edge('reply','m4','m0','return'),edge('skip','m0','m4'))
  for(const e of edges){e.sourceOutputs=ports;e.targetInputs=ports}
  const original=JSON.stringify({nodes,edges}),layout=await layoutTopology(nodes,edges)
  assert.equal(layout.routes.size,20)
  assert.ok(layout.width<4000,`Unexpected horizontal expansion: ${layout.width}`)
  assert.ok(layout.height<3000,`Unexpected perimeter rails: ${layout.height}`)
  assert.equal(JSON.stringify({nodes,edges}),original)
  console.log(`19 modules / 20 relationships / 12 ports: ${Math.round(layout.width)} × ${Math.round(layout.height)}, ${layout.routes.size} visible connections`)
})

test('top-level business relations are separate from aggregated child projections and all original IDs remain inspectable',()=>{
  const graph={nodes:[node('a'),node('b'),...Array.from({length:20},(_,i)=>node('a.'+i,'a'))],edges:[edge('business','a','b'),...Array.from({length:20},(_,i)=>edge('detail-'+i,'a.'+i,'b'))]}
  const original=JSON.stringify(graph),raw=topologyView(graph,''),overview=overviewTopology(raw),detail=overviewTopology(raw,true)
  assert.equal(overview.edges.filter(e=>!e.inferred).length,1)
  const group=detail.edges.find(e=>e.projected)
  assert.equal(group.members.length,20);assert.deepEqual(group.members,graph.edges.slice(1).map(e=>e.id))
  const onlyChildren=overviewTopology(topologyView({...graph,edges:graph.edges.slice(1)},''))
  assert.equal(onlyChildren.edges.filter(e=>!e.inferred).length,1,'Do not hide the only available business relationship')
  assert.equal(JSON.stringify(graph),original)
})
