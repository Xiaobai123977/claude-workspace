const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process')
const {inspectExploration}=require('../electron/topology-exploration.cjs'),{TopologyService}=require('../electron/topology.cjs')
const node=(id,parent)=>({id,label:id,purpose:'处理',inputs:['请求'],outputs:['结果'],refs:[{path:'app.cjs',line:1}],...(parent?{parent}:{})})
test('automatic depth cannot finish after a single unexplored layer; children remain in the frontier until evidence is recorded',()=>{
  const graph={nodes:[node('root'),node('worker','root')],edges:[]}
  let report=inspectExploration(graph);assert.equal(report.complete,false);assert.equal(report.reachedDepth,2);assert.deepEqual(report.frontier.map(n=>n.id),['worker'])
  graph.nodes[1].exploration={state:'leaf',reason:'app.cjs:1 直接标准化输入，不包含独立步骤'}
  assert.equal(inspectExploration(graph).complete,true)
  graph.nodes[1].refs=[];assert.equal(inspectExploration(graph).complete,false)
  assert.equal(inspectExploration(graph,{depth:1}).complete,true,'Explicit one-layer work must not turn into automatic recursion')
})
test('external stop reasons and real blocking remain distinct; scoped exploration never expands unrelated modules',()=>{
  const graph={nodes:[node('a'),node('b'),{...node('api','a'),kind:'external',exploration:{state:'external',reason:'项目外 HTTP 服务，无源码'}},{...node('blocked','b'),exploration:{state:'blocked',reason:'源码缺失'}}],edges:[]}
  assert.equal(inspectExploration(graph,{moduleIds:['a']}).complete,true)
  const report=inspectExploration(graph);assert.equal(report.complete,false);assert.equal(report.frontier[0].blocked,true)
})
test('installed auto checker rejects unexpanded modules and follow-up contains scoped frontier and flow gaps',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'topology-auto-unit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'.claude'));fs.writeFileSync(path.join(root,'app.cjs'),'module.exports = v => v\n')
  const service=new TopologyService(path.join(root,'data')),graph={version:1,flowVersion:1,title:'auto',description:'auto test',nodes:[node('start')],edges:[]},file=path.join(root,'.claude/workspace-topology.json');fs.writeFileSync(file,JSON.stringify(graph));service.prepare(root)
  const result=spawnSync(process.execPath,[path.join(root,'.claude/skills/workspace-topology/validate.cjs'),'--explore-auto'],{cwd:root,encoding:'utf8'})
  assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).exploration.frontier[0].id,'start')
  const follow=service.explorationFollowup(root,{action:'explore',depth:'auto',parallel:true,targets:[],revision:service.read(root).revision})
  assert.equal(follow.complete,false);assert.match(follow.prompt,/待展开模块/);assert.match(follow.prompt,/数据流缺口/)
})
