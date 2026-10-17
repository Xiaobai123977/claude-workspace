const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process')
const {TopologyService,validateGraph}=require('../electron/topology.cjs')
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'topology-design-')),cwd=path.join(root,'project'),service=new TopologyService(path.join(root,'data'));fs.mkdirSync(path.join(cwd,'.claude'),{recursive:true})
  const boundary=(direction,port,kind)=>({direction,port,kind,reason:'用户设计的入口和终态',refs:[]})
  const graph={version:1,flowVersion:1,title:'新项目设计',description:'尚未生成代码',nodes:[{id:'start',label:'处理请求',purpose:'标准化输入',kind:'module',status:'planned',inputs:['请求'],outputs:['处理结果'],acceptance:['去除前后空格；空输入返回空串'],refs:[],boundaries:[boundary('input','请求','entry')]},{id:'end',label:'返回结果',purpose:'向用户返回结果',kind:'terminal',status:'planned',inputs:['待返回结果'],outputs:['用户响应'],acceptance:['返回完整处理结果'],refs:[],boundaries:[boundary('output','用户响应','terminal')]}],edges:[{id:'result',source:'start',target:'end',kind:'data',status:'planned',label:'传递结果',data:'标准化的用户输入',sourceOutputs:['处理结果'],targetInputs:['待返回结果'],refs:[]}]}
  const file=path.join(cwd,'.claude/workspace-topology.json'),save=()=>fs.writeFileSync(file,JSON.stringify(graph));return{cwd,service,graph,file,save}
}
test('a new project can design topology before code exists; implemented evidence is never fabricated',()=>{
  const f=fixture(),request={action:'design',revision:'',targets:[],text:'设计一个标准化输入的小项目'}
  const prompt=f.service.prepareWorkflow(f.cwd,request);assert.match(prompt,/不要求先有代码/);assert.match(prompt,/只修改/);assert.match(prompt,/status=planned/);assert.equal(fs.existsSync(f.file),false)
  f.save();const data=f.service.read(f.cwd);assert.equal(data.flow.designComplete,true);assert.equal(data.flow.complete,false);assert.deepEqual(data.flow.plannedNodes,['start','end']);assert.equal(data.graph.nodes[0].acceptance[0],f.graph.nodes[0].acceptance[0])
  assert.throws(()=>f.service.prompt(f.cwd,request),/拓扑已更新/)
  const check=mode=>spawnSync(process.execPath,[path.join(f.cwd,'.claude/skills/workspace-topology/validate.cjs'),...mode],{cwd:f.cwd,encoding:'utf8'})
  assert.equal(check(['--design']).status,0);assert.equal(check([]).status,1)
})
test('planned modules still need closed flows and acceptance before implementation; scoped work does not require unrelated designs to be finished',()=>{
  const f=fixture();f.save();let request={action:'implement',revision:f.service.read(f.cwd).revision,targets:[{kind:'node',id:'start'}],text:'按图开发'}
  assert.match(f.service.prepareWorkflow(f.cwd,request),/actual|实际测试|适当测试/)
  delete f.graph.nodes[0].acceptance;f.save();assert.throws(()=>f.service.prompt(f.cwd,{...request,revision:f.service.read(f.cwd).revision}),/验收条件/)
  f.graph.nodes[0].acceptance=['规范化输入'];f.graph.nodes.push({id:'other',label:'其他设计',purpose:'尚未补全',status:'planned',kind:'module',inputs:['未知输入'],outputs:['未知输出'],refs:[]});f.save();request.revision=f.service.read(f.cwd).revision
  assert.doesNotThrow(()=>f.service.prompt(f.cwd,request));assert.throws(()=>f.service.prompt(f.cwd,{...request,targets:[]}),/设计尚有缺口/)
  f.graph.edges[0].targetInputs=['错误端口'];f.save();assert.throws(()=>f.service.prompt(f.cwd,{...request,revision:f.service.read(f.cwd).revision}),/设计尚有缺口/)
})
test('planned refinement and synchronization preserve intent, while unknown status or false evidence cannot pass',()=>{
  const f=fixture();f.save();const revision=f.service.read(f.cwd).revision,request={revision,targets:[{kind:'node',id:'start'}],text:'继续细化'}
  assert.match(f.service.prompt(f.cwd,{...request,action:'refine'}),/这是从需求设计/)
  assert.match(f.service.prepareWorkflow(f.cwd,{...request,action:'sync'}),/不能因代码尚无实现而删除 planned/)
  assert.match(f.service.developmentGuidance(f.cwd),/修改后同步更新/)
  const broken=structuredClone(f.graph);broken.nodes[0].status='complete';assert.throws(()=>validateGraph(broken,f.cwd),/实现状态无效/)
  f.graph.nodes[0].status='implemented';f.save();assert.equal(f.service.read(f.cwd).flow.designComplete,false)
})
test('implementation evidence and actual verification records round trip without implying tests from graph closure',()=>{
  const f=fixture();fs.writeFileSync(path.join(f.cwd,'app.js'),'module.exports = value => String(value).trim()\n')
  const refs=[{path:'app.js',line:1}];for(const item of [...f.graph.nodes,...f.graph.edges]){item.status='implemented';item.refs=refs;for(const b of item.boundaries||[])b.refs=refs}f.save()
  let data=f.service.read(f.cwd);assert.equal(data.flow.complete,true);assert.equal(data.graph.nodes[0].verification,undefined)
  f.graph.nodes[0].verification={status:'failed',summary:'空值处理失败',commands:['node --test']};f.save();data=f.service.read(f.cwd);assert.equal(data.flow.complete,false);assert.equal(data.graph.nodes[0].verification.status,'failed');assert.equal(data.flow.designComplete,true);assert.doesNotThrow(()=>f.service.prompt(f.cwd,{revision:data.revision,action:'implement',targets:[{kind:'node',id:'start'}],text:'修复失败的实现'}))
  f.graph.nodes[0].verification={status:'passed',summary:'已执行本地验证',commands:['node --test']};f.save();assert.equal(f.service.read(f.cwd).flow.complete,true)
})
