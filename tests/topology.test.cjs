const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {TopologyService,validateGraph,projectPath}=require('../electron/topology.cjs')
function fixture(){const base=fs.mkdtempSync(path.join(os.tmpdir(),'claude-topology-unit-')),cwd=path.join(base,'project'),service=new TopologyService(path.join(base,'data'));fs.mkdirSync(path.join(cwd,'.claude'),{recursive:true});fs.writeFileSync(path.join(cwd,'app.js'),'// source\nfunction run(){}\n');const n=(id,parent)=>({id,label:'同名模块',purpose:'处理请求',inputs:['请求'],outputs:['结果'],kind:'module',refs:[{path:'app.js',line:2}],...(parent?{parent}:{})});const graph={version:1,title:'业务测试',description:'静态分析',nodes:[n('first'),n('second'),n('child','first')],edges:[{id:'flow',source:'first',target:'second',label:'转发',data:'已校验请求',refs:[{path:'app.js',line:2}]}]},file=path.join(cwd,'.claude/workspace-topology.json');const save=()=>fs.writeFileSync(file,JSON.stringify(graph));save();return{base,cwd,service,graph,file,save}}
test('topology selection uses version and stable IDs, with exact direction, code references and hierarchy',()=>{
  const {cwd,service}=fixture(),data=service.read(cwd),request={revision:data.revision,targets:[{kind:'node',id:'first'}],action:'question',text:'为什么？'}
  const context=service.context(cwd,request);assert.equal(context.targets[0].id,'first');assert.equal(context.targets[0].refs[0].line,2);assert.deepEqual(context.relatedNodes.map(n=>n.id),['first','second']);assert.equal(context.connections[0].target,'second')
  const child=service.context(cwd,{...request,targets:[{kind:'node',id:'child'}]});assert.deepEqual(child.ancestors.map(n=>n.id),['first'])
  const edge=service.context(cwd,{...request,targets:[{kind:'edge',id:'flow'}]});assert.equal(edge.targets[0].source,'first');assert.equal(edge.targets[0].target,'second')
  assert.match(service.prompt(cwd,request),/不修改代码/);assert.match(service.prompt(cwd,{...request,action:'approve'}),/不代表批准工具权限/)
  assert.throws(()=>service.context(cwd,{...request,targets:[request.targets[0],request.targets[0]]}),/重复/)
})
test('annotations persist per project and graph version; stale selections never silently approve a changed graph',()=>{
  const {cwd,service,graph,save,base}=fixture(),data=service.read(cwd),request={revision:data.revision,targets:[{kind:'node',id:'first'}],action:'approve',text:'认可当前输入校验设计'}
  service.annotate(cwd,request);assert.equal(new TopologyService(path.join(base,'data')).read(cwd).notes[0].targets[0].id,'first')
  graph.nodes[0].purpose='新业务行为';save();assert.throws(()=>service.annotate(cwd,request),/拓扑已更新/);assert.throws(()=>service.prompt(cwd,request),/拓扑已更新/);assert.equal(service.read(cwd).notes.length,0)
  assert.equal(fs.readFileSync(path.join(cwd,'app.js'),'utf8'),'// source\nfunction run(){}\n')
})
test('recursive refinement includes the selected subtree and boundaries, preserving stable IDs and rejecting stale or ambiguous scopes',()=>{
  const {cwd,service,graph,save}=fixture();graph.nodes.push({...graph.nodes[2],id:'grandchild',parent:'child'});save()
  const data=service.read(cwd),request={revision:data.revision,targets:[{kind:'node',id:'first'}],action:'refine',text:'细化模块'}
  const context=service.refinementContext(cwd,request);assert.equal(context.scope.moduleId,'first');assert.deepEqual(context.scope.descendants.map(n=>n.id),['child','grandchild']);assert.equal(context.connections[0].target,'second')
  const prompt=service.prepare(cwd,{revision:data.revision,nodeId:'child'});assert.match(prompt,/新增直接子模块的 parent 必须等于选中模块 ID（child）/);assert.match(prompt,/兄弟模块和无关连接不变/);assert.match(prompt,/不修改业务代码/);assert.match(prompt,/"moduleId": "child"/);assert.match(prompt,/"id": "grandchild"/)
  assert.throws(()=>service.refinementContext(cwd,{...request,targets:[{kind:'edge',id:'flow'}]}),/一个业务模块/)
  assert.throws(()=>service.refinementContext(cwd,{...request,targets:[{kind:'node',id:'first'},{kind:'node',id:'second'}]}),/一个业务模块/)
  assert.throws(()=>service.prepare(cwd,{revision:'stale',nodeId:'first'}),/拓扑已更新/)
  assert.throws(()=>service.annotate(cwd,request),/批注类型无效/)
  assert.equal(service.read(cwd).graph.nodes.length,4,'Preparing a refinement must not modify the graph itself')
})
test('concurrent exploration distinguishes global/node depth and requires native parallel delegation with honest completion reporting',()=>{
  const {cwd,service}=fixture(),data=service.read(cwd),request={revision:data.revision,targets:[],action:'explore',text:'探索全项目',depth:2,parallel:true}
  const root=service.operationContext(cwd,request);assert.equal(root.scope.moduleId,null);assert.equal(root.exploration.depth,2);assert.match(root.exploration.depthOrigin,/顶层业务模块/)
  const scoped=service.operationContext(cwd,{...request,targets:[{kind:'node',id:'first'}],depth:5});assert.equal(scoped.scope.moduleId,'first');assert.equal(scoped.scope.descendants[0].id,'child');assert.match(scoped.exploration.depthOrigin,/直接子模块/)
  const prompt=service.prepareOperation(cwd,request).prompt;assert.match(prompt,/原生 Agent\/Task/);assert.match(prompt,/尽可能用满/);assert.match(prompt,/分批排队/);assert.match(prompt,/不得共同写入同一个拓扑文件/);assert.match(prompt,/不能只派一个代理/);assert.match(prompt,/目标探索深度为 2 层/);assert.match(prompt,/不宣称全量探索完成/);assert.match(prompt,/不得伪造已调用代理/)
  assert.match(service.prompt(cwd,{...request,depth:'auto'}),/逐项解释停止依据/)
  for(const depth of [undefined,0,-1,101,1.5,'2',null,Infinity])assert.throws(()=>service.operationContext(cwd,{...request,depth}),/探索深度/)
  assert.throws(()=>service.operationContext(cwd,{...request,parallel:false}),/必须启用/)
  assert.throws(()=>service.operationContext(cwd,{...request,targets:[{kind:'edge',id:'flow'}]}),/整个项目或 1–20 个/)
})
test('regeneration backs up the exact graph without changing it; module boundary and revision guards remain explicit',()=>{
  const {cwd,service,file,graph,save}=fixture(),data=service.read(cwd),before=fs.readFileSync(file,'utf8'),request={revision:data.revision,targets:[{kind:'node',id:'first'}],action:'regenerate',text:'重新生成节点',depth:1,parallel:false}
  const result=service.prepareOperation(cwd,request);assert.equal(fs.readFileSync(result.backup,'utf8'),before);assert.equal(fs.readFileSync(file,'utf8'),before);assert.match(result.prompt,/从当前代码重新推导/);assert.match(result.prompt,/不得删除父模块/);assert.match(result.prompt,/祖先、未选中的兄弟模块及无关连接不变/)
  assert.equal(service.prepareOperation(cwd,request).backup,result.backup)
  graph.nodes[0].purpose='changed';save();assert.throws(()=>service.prepareOperation(cwd,request),/拓扑已更新/);assert.equal(fs.readFileSync(result.backup,'utf8'),before)
})
test('multi-module operations preserve exact IDs, merge overlapping subtrees and never treat a multi-root selection as global',()=>{
  const {cwd,service,graph,save,file}=fixture();graph.nodes.push({...graph.nodes[2],id:'grandchild',parent:'child'});save()
  const request={revision:service.read(cwd).revision,targets:['child','second','first'].map(id=>({kind:'node',id})),action:'explore',text:'并发探索所选模块',depth:3,parallel:true}
  const context=service.operationContext(cwd,request)
  assert.deepEqual(context.scope.requestedModuleIds,['child','second','first']);assert.deepEqual(context.scope.moduleIds,['second','first']);assert.deepEqual(context.scope.overlappingModuleIds,['child']);assert.equal(context.scope.moduleId,null);assert.equal('graph' in context,false)
  assert.deepEqual(context.scope.descendants.map(n=>n.id),['child','grandchild']);assert.deepEqual(context.targets.map(n=>n.id),['child','second','first'])
  const prompt=service.prompt(cwd,request);assert.match(prompt,/不是整个项目/);assert.match(prompt,/不能重复派发/);assert.match(prompt,/未选中的兄弟模块/)
  const old=fs.readFileSync(file,'utf8'),regenerate={...request,action:'regenerate'},prepared=service.prepareOperation(cwd,regenerate);assert.equal(fs.readFileSync(prepared.backup,'utf8'),old);assert.match(prepared.prompt,/模块 second、first/)
  assert.throws(()=>service.operationContext(cwd,{...request,targets:[request.targets[0],request.targets[0]]}),/重复/)
  assert.throws(()=>service.operationContext(cwd,{...request,targets:[{kind:'node',id:'missing'}]}),/不存在/)
  assert.throws(()=>service.operationContext(cwd,{...request,targets:Array.from({length:21},()=>request.targets[0])}),/1–20/)
  graph.nodes[0].purpose='new';save();assert.throws(()=>service.prepareOperation(cwd,request),/拓扑已更新/)
})
test('concurrent exploration can start before the first graph and rejects a stale empty-project revision once a graph exists',()=>{
  const {cwd,service,file,save}=fixture();fs.unlinkSync(file)
  const request={revision:'',targets:[],action:'explore',text:'首轮全量探索',depth:1,parallel:true},result=service.prepareOperation(cwd,request)
  assert.equal(service.operationContext(cwd,request).graph,null);assert.equal(result.backup,undefined);assert.match(result.prompt,/目标探索深度为 1 层/);assert.equal(fs.existsSync(file),false)
  save();assert.throws(()=>service.prompt(cwd,request),/拓扑已更新/)
})
test('topology rejects invalid hierarchy, unknown endpoints, paths outside project and oversized documents',()=>{
  const {cwd,service,graph,file}=fixture()
  for(const input of ['../secret','C:/secret','/secret','folder/../../secret','folder\\secret'])assert.throws(()=>projectPath(cwd,input),/相对路径/)
  let broken=structuredClone(graph);broken.nodes[0].parent='child';assert.throws(()=>validateGraph(broken,cwd),/循环/)
  broken=structuredClone(graph);broken.edges[0].target='missing';assert.throws(()=>validateGraph(broken,cwd),/不存在/)
  broken=structuredClone(graph);broken.nodes[0].refs[0].line=0;assert.throws(()=>validateGraph(broken,cwd),/行号/)
  fs.writeFileSync(file,'x'.repeat(1024*1024+1));assert.throws(()=>service.read(cwd),/超过/)
})
test('skill installation preserves existing instructions and graph evidence warns on missing files or lines',()=>{
  const {cwd,service,graph,save}=fixture();assert.match(service.prepare(cwd),/只生成拓扑文件/)
  const skill=path.join(cwd,'.claude/skills/workspace-topology/SKILL.md');assert.match(fs.readFileSync(skill,'utf8'),/name: workspace-topology/);service.prepare(cwd)
  fs.writeFileSync(skill,'existing custom instructions');assert.throws(()=>service.prepare(cwd),/未覆盖/);assert.equal(fs.readFileSync(skill,'utf8'),'existing custom instructions')
  graph.nodes[0].refs[0].line=900;graph.nodes[1].refs[0].path='missing.js';save();assert.equal(service.read(cwd).warnings.length,2)
})
