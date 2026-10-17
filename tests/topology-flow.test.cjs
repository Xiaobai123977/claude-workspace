const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process')
const {TopologyService,validateGraph}=require('../electron/topology.cjs')
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'topology-flow-')),cwd=path.join(root,'project'),service=new TopologyService(path.join(root,'data'))
  fs.mkdirSync(path.join(cwd,'.claude'),{recursive:true});fs.writeFileSync(path.join(cwd,'app.js'),'produce();\nassemble();\nconsume();\narchive();\n')
  const refs=[{path:'app.js',line:1}],boundary=(direction,port,kind)=>({direction,port,kind,reason:'已核对实际入口或最终审计归档',refs})
  const graph={version:1,flowVersion:1,title:'数据来源与去向',description:'静态映射测试',nodes:[
    {id:'producer',label:'生产',kind:'module',purpose:'处理请求',inputs:['触发'],outputs:['反思课程'],refs,boundaries:[boundary('input','触发','entry')]},
    {id:'consumer',label:'归档',kind:'terminal',purpose:'归档审计',inputs:['updates.lesson'],outputs:['审计记录'],refs,boundaries:[boundary('output','审计记录','terminal')]}
  ],edges:[{id:'lesson',source:'producer',target:'consumer',kind:'data',label:'经 updates 传递',data:'经中介列表传递课程',sourceOutputs:['反思课程'],targetInputs:['updates.lesson'],refs:[{path:'app.js',line:2},{path:'app.js',line:3}]}]}
  const file=path.join(cwd,'.claude/workspace-topology.json'),save=()=>fs.writeFileSync(file,JSON.stringify(graph));save();return{root,cwd,service,graph,file,save,boundary,refs}
}
test('explicit intermediate flow and proven terminal are closed; prose alone and terminal kind do not cover outputs',()=>{
  const f=fixture();assert.equal(f.service.read(f.cwd).flow.complete,true)
  f.graph.edges=[];f.save();let flow=f.service.read(f.cwd).flow;assert.equal(flow.complete,false);assert(flow.issues.some(i=>i.id==='producer'&&i.code==='missing-destination'));assert(flow.issues.some(i=>i.id==='consumer'&&i.code==='missing-source'))
  f.graph.nodes[0].kind='terminal';f.graph.nodes[0].uncertain='待核实：没有找到下游';f.save();flow=f.service.read(f.cwd).flow;assert(flow.issues.some(i=>i.code==='unresolved'));assert(flow.issues.some(i=>i.code==='missing-destination'))
})
test('a connected edge cannot conceal an additional missing storage or service output',()=>{
  const f=fixture();f.graph.nodes[0].outputs.push('LLM 请求','原子文件写入');f.save();const flow=f.service.read(f.cwd).flow
  assert.equal(flow.complete,false);assert.equal(flow.issues.filter(i=>i.code==='missing-destination').length,2)
  const g=f.graph;g.nodes.push({id:'llm',label:'外部 LLM',kind:'external',purpose:'生成课程',inputs:['生成请求'],outputs:['课程响应'],refs:f.refs,boundaries:[f.boundary('output','课程响应','external')]},{id:'memory',label:'日志存储',kind:'database',purpose:'持久化',inputs:['结算结果'],outputs:['持久化记录'],refs:f.refs,boundaries:[f.boundary('output','持久化记录','external')]})
  for(const [id,target,kind,output,input] of [['llm-call','llm','side-effect','LLM 请求','生成请求'],['write','memory','storage-write','原子文件写入','结算结果']])g.edges.push({id,source:'producer',target,kind,label:id,data:output,sourceOutputs:[output],targetInputs:[input],refs:f.refs})
  f.save();assert.equal(f.service.read(f.cwd).flow.complete,true)
})
test('invalid port IDs and legacy unmapped prose do not count as data coverage',()=>{
  const f=fixture();f.graph.edges[0].sourceOutputs=['反思课程（看起来相似）'];f.save();let flow=f.service.read(f.cwd).flow;assert(flow.issues.some(i=>i.code==='invalid-port'));assert(flow.issues.some(i=>i.code==='missing-destination'))
  delete f.graph.flowVersion;delete f.graph.edges[0].sourceOutputs;delete f.graph.edges[0].targetInputs;f.save();flow=f.service.read(f.cwd).flow;assert.equal(flow.complete,false);assert(flow.issues.some(i=>i.code==='legacy'));assert.equal(f.service.read(f.cwd).graph.nodes.length,2)
})
test('hierarchical boundaries must bind the actual parent port rather than hiding disconnected child nodes',()=>{
  const f=fixture(),child={id:'child',parent:'producer',label:'子模块',kind:'module',purpose:'校验',inputs:['子输入'],outputs:['子输出'],refs:f.refs,boundaries:[{...f.boundary('input','子输入','parent'),parentPort:'触发'},{...f.boundary('output','子输出','parent'),parentPort:'反思课程'}]};f.graph.nodes.push(child);f.save();assert.equal(f.service.read(f.cwd).flow.complete,true)
  child.boundaries[0].parentPort='不存在';f.save();assert(f.service.read(f.cwd).flow.issues.some(i=>i.code==='parent-boundary'))
  child.boundaries[0].kind='external';f.save();assert(f.service.read(f.cwd).flow.issues.some(i=>i.code==='external-boundary'))
})
test('boundary evidence, direction, duplicate ports and unresolved items keep delivery incomplete',()=>{
  const f=fixture();f.graph.nodes[0].boundaries[0].refs=[{path:'app.js',line:999}];f.save();assert(f.service.read(f.cwd).flow.issues.some(i=>i.code==='reference'))
  f.graph.nodes[0].boundaries[0]=f.boundary('input','触发','terminal');f.graph.nodes[0].outputs.push('反思课程');f.save();let flow=f.service.read(f.cwd).flow;assert(flow.issues.some(i=>i.code==='boundary-direction'));assert(flow.issues.some(i=>i.code==='duplicate-port'))
  f.graph.nodes[0].boundaries[0]=f.boundary('input','触发','unresolved');f.save();assert(f.service.read(f.cwd).flow.issues.some(i=>i.code==='unresolved'))
  f.graph.edges[0].kind='imaginary';assert.throws(()=>validateGraph(f.graph,f.cwd),/数据流类型无效/)
})
test('installed CLI checker shares GUI results and exits nonzero on incomplete or malformed graph',()=>{
  const f=fixture();f.service.prepare(f.cwd);const check=()=>spawnSync(process.execPath,[path.join(f.cwd,'.claude/skills/workspace-topology/validate.cjs')],{cwd:f.cwd,encoding:'utf8'})
  let result=check();assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).issues,f.service.read(f.cwd).flow.issues)
  f.graph.nodes[0].outputs.push('被漏掉的数据');f.save();result=check();assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).complete,false)
  fs.writeFileSync(f.file,'not json');assert.equal(check().status,1)
})
test('managed Skill upgrades back up previous content and protect locally customized checker files',()=>{
  const f=fixture(),folder=path.join(f.cwd,'.claude/skills/workspace-topology');f.service.prepare(f.cwd)
  const file=path.join(folder,'SKILL.md'),manifest=path.join(folder,'installation.json'),old='previous managed version',record=JSON.parse(fs.readFileSync(manifest,'utf8'));fs.writeFileSync(file,old);record['SKILL.md']=crypto.createHash('sha256').update(old).digest('hex');fs.writeFileSync(manifest,JSON.stringify(record));f.service.prepare(f.cwd);assert.equal(fs.readFileSync(file+'.previous','utf8'),old)
  const checker=path.join(folder,'validate.cjs');fs.writeFileSync(checker,'custom checker');assert.throws(()=>f.service.prepare(f.cwd),/未覆盖/);assert.equal(fs.readFileSync(checker,'utf8'),'custom checker')
})
