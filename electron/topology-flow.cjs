// Explicit port mappings, never fuzzy comparisons of prose, establish coverage.
function inspectDataFlow(graph){
  const issues=[],add=(kind,id,code,message)=>issues.push({kind,id,code,message}),byId=new Map(graph.nodes.map(n=>[n.id,n]))
  if(!graph.nodes.length)add('graph','','empty-graph','尚无业务模块，不能视为完整设计')
  if(graph.flowVersion!==1)add('graph','','legacy','旧图尚未声明数据流协议，需要补齐输入来源和输出去向')
  for(const edge of graph.edges){
    for(const [field,node,ports] of [['sourceOutputs',byId.get(edge.source),'outputs'],['targetInputs',byId.get(edge.target),'inputs']]){
      if(!edge[field]?.length)add('edge',edge.id,'unmapped',`${edge.label}：未绑定${field==='sourceOutputs'?'来源输出':'目标输入'}`)
      for(const port of edge[field]||[])if(!node?.[ports].includes(port))add('edge',edge.id,'invalid-port',`${edge.label}：${node?.label}不存在端口「${port}」`)
    }
    if(!edge.kind)add('edge',edge.id,'edge-kind',`${edge.label}：未说明数据流类型`)
    if(edge.status==='planned')add('edge',edge.id,'pending-code',`${edge.label}：计划连接，尚未绑定实现证据`)
    if(edge.status!=='planned'&&!edge.refs.length)add('edge',edge.id,'evidence',`${edge.label}：缺少流转证据`)
  }
  for(const node of graph.nodes){
    for(const ports of ['inputs','outputs'])if(new Set(node[ports]).size!==node[ports].length)add('node',node.id,'duplicate-port',`${node.label}：${ports==='inputs'?'输入':'输出'}端口重复，无法准确绑定`)
    if(node.status==='planned'){add('node',node.id,'pending-code',`${node.label}：计划模块，尚未实现`);if(!node.acceptance?.length)add('node',node.id,'acceptance',`${node.label}：计划模块需要可验证的验收条件`)}
    if(node.verification?.status==='failed')add('node',node.id,'verification',`${node.label}：验证记录失败 · ${node.verification.summary}`)
    if(node.status!=='planned'&&!node.refs.length)add('node',node.id,'evidence',`${node.label}：缺少代码证据`)
    if(node.uncertain)add('node',node.id,'unresolved',`${node.label}：${node.uncertain}`)
    for(const boundary of node.boundaries||[]){
      const ports=boundary.direction==='input'?'inputs':'outputs'
      if(!node[ports].includes(boundary.port))add('node',node.id,'invalid-boundary',`${node.label}：边界端口「${boundary.port}」不存在`)
      if(node.status!=='planned'&&!boundary.refs.length)add('node',node.id,'evidence',`${node.label}：边界「${boundary.port}」缺少证据`)
      if(boundary.kind==='unresolved')add('node',node.id,'unresolved',`${node.label}：${boundary.port} · ${boundary.reason}`)
      if(boundary.kind==='parent'&&!byId.get(node.parent)?.[ports].includes(boundary.parentPort))add('node',node.id,'parent-boundary',`${node.label}：层级边界没有绑定父模块的${boundary.direction==='input'?'输入':'输出'}`)
      if(boundary.kind==='external'&&!['external','database'].includes(node.kind))add('node',node.id,'external-boundary',`${node.label}：内部模块必须通过连线表达外部请求或存储读写，不能直接省略外部端点`)
      if(boundary.kind==='entry'&&boundary.direction!=='input'||boundary.kind==='terminal'&&boundary.direction!=='output')add('node',node.id,'boundary-direction',`${node.label}：入口只能作为输入来源，终点只能作为输出去向`)
    }
    for(const direction of ['input','output']){
      const ports=direction==='input'?'inputs':'outputs',incoming=direction==='input',field=incoming?'targetInputs':'sourceOutputs'
      if(!node[ports].length)add('node',node.id,'empty-ports',`${node.label}：未列出${incoming?'输入（含触发条件）':'输出（含副作用或终态）'}`)
      for(const port of node[ports]){
        const connected=graph.edges.some(e=>e[incoming?'target':'source']===node.id&&e[field]?.includes(port)&&e.sourceOutputs?.length&&e.targetInputs?.length&&e.sourceOutputs.every(p=>byId.get(e.source)?.outputs.includes(p))&&e.targetInputs.every(p=>byId.get(e.target)?.inputs.includes(p)))
        const boundary=node.boundaries?.some(b=>b.direction===direction&&b.port===port)
        if(!connected&&!boundary)add('node',node.id,incoming?'missing-source':'missing-destination',`${node.label}：「${port}」没有明确${incoming?'来源':'去向'}`)
      }
    }
  }
  const zeroIncoming=graph.nodes.filter(n=>!graph.edges.some(e=>e.target===n.id)).map(n=>n.id),zeroOutgoing=graph.nodes.filter(n=>!graph.edges.some(e=>e.source===n.id)).map(n=>n.id)
  return {complete:issues.length===0,designComplete:issues.every(i=>['pending-code','verification'].includes(i.code)),plannedNodes:graph.nodes.filter(n=>n.status==='planned').map(n=>n.id),plannedEdges:graph.edges.filter(e=>e.status==='planned').map(e=>e.id),issues,zeroIncoming,zeroOutgoing}
}
module.exports={inspectDataFlow}
