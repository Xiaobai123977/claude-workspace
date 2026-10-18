import type {TopologyData,TopologyNode,TopologyEdge,TopologyTarget} from './types'
export type FlowNode=TopologyNode&{viewKind?:'boundary'|'unknown'|'context';selection?:TopologyTarget}
export type FlowEdge=TopologyEdge&{selection?:TopologyTarget;inferred?:boolean;problem?:boolean;projected?:boolean;members?:string[]}
// Outside endpoints and boundary ports stay visible. Missing links are visual
// diagnostics, never invented relationships written back to the business graph.
export function topologyView(graph:NonNullable<TopologyData['graph']>,parent:string){
  const nodes:FlowNode[]=graph.nodes.filter(n=>(n.parent||'')===parent).map(n=>({...n})),direct=new Set(nodes.map(n=>n.id)),byId=new Map(graph.nodes.map(n=>[n.id,n])),edges:FlowEdge[]=[]
  const visible=(id:string)=>{let n=byId.get(id);while(n){if(direct.has(n.id))return n.id;n=n.parent?byId.get(n.parent):undefined}return null}
  const addContext=(id:string)=>{if(!nodes.some(n=>n.id===id)){const n=byId.get(id)!;nodes.push({...n,viewKind:'context',selection:{kind:'node',id}})}return id}
  for(const edge of graph.edges){const a=visible(edge.source),b=visible(edge.target);if(!a&&!b||a&&a===b)continue
    const source=a||addContext(edge.source),target=b||addContext(edge.target)
    edges.push({...edge,source,target,projected:source!==edge.source||target!==edge.target,selection:{kind:'edge',id:edge.id}})
  }
  for(const n of [...nodes].filter(n=>!n.viewKind))for(const direction of ['input','output'] as const){
    for(const [i,port]of n[direction==='input'?'inputs':'outputs'].entries()){
      const incoming=direction==='input',connected=edges.some(e=>e[incoming?'target':'source']===n.id&&e[incoming?'targetInputs':'sourceOutputs']?.includes(port))
      if(connected)continue
      const boundary=n.boundaries?.find(b=>b.direction===direction&&b.port===port),unknown=!boundary||boundary.kind==='unresolved'
      const id=`__${n.id}.${direction}.${boundary?.kind||'unknown'}`,other=boundary?.kind==='parent'?byId.get(n.parent||'')?.label:undefined
      const externalPort=boundary?.kind==='parent'&&boundary.parentPort?boundary.parentPort:port
      const label=unknown?(incoming?'来源待核实':'去向待核实'):boundary?.kind==='parent'?`${incoming?'来自':'交给'} ${other||'父模块'}`:boundary?.kind==='entry'?'业务入口':boundary?.kind==='terminal'?'业务结果':'外部边界'
      const existing=nodes.find(item=>item.id===id)
      if(existing){if(!existing[incoming?'outputs':'inputs'].includes(externalPort))existing[incoming?'outputs':'inputs'].push(externalPort);existing.purpose+='；'+(boundary?.reason||port)}
      else nodes.push({id,label,purpose:boundary?.reason||`「${port}」尚无明确${incoming?'来源':'去向'}`,kind:'external',inputs:incoming?[]:[externalPort],outputs:incoming?[externalPort]:[],refs:[],viewKind:unknown?'unknown':'boundary',selection:{kind:'node',id:n.id}})
      edges.push({id:`__edge.${id}.${i}`,source:incoming?id:n.id,target:incoming?n.id:id,label:port,data:boundary?.reason||label,sourceOutputs:[incoming?externalPort:port],targetInputs:[incoming?port:externalPort],refs:[],kind:'data',inferred:true,problem:unknown,selection:{kind:'node',id:n.id}})
    }
  }
  // A boundary or diagnostic is one relationship in the overview, even when
  // several ports share it. Keep all names for inspection without a wire fan.
  const overview:FlowEdge[]=[],boundaries=new Map<string,FlowEdge>()
  for(const edge of edges){
    if(!edge.inferred){overview.push(edge);continue}
    const identity=JSON.stringify([edge.source,edge.target,edge.problem])
    const prior=boundaries.get(identity)
    if(prior){prior.sourceOutputs=[...new Set([...(prior.sourceOutputs||[]),...(edge.sourceOutputs||[])])];prior.targetInputs=[...new Set([...(prior.targetInputs||[]),...(edge.targetInputs||[])])];prior.label=`${prior.sourceOutputs.length} 个端口 · ${edge.problem?'待核实':'边界数据'}`}
    else {boundaries.set(identity,edge);overview.push(edge)}
  }
  return {nodes,edges:overview}
}

export function overviewTopology(view:ReturnType<typeof topologyView>,crossLevel=false){
  const explicit=view.edges.some(e=>!e.inferred&&!e.projected),groups=new Map<string,FlowEdge>(),edges:FlowEdge[]=[]
  for(const original of view.edges){
    if(original.projected&&!crossLevel&&explicit)continue
    if(original.inferred&&original.problem&&!crossLevel&&explicit)continue
    if(!original.projected){edges.push(original);continue}
    const identity=JSON.stringify([original.source,original.target,original.kind]),prior=groups.get(identity)
    if(prior){prior.members!.push(original.id);prior.sourceOutputs=[...new Set([...(prior.sourceOutputs||[]),...(original.sourceOutputs||[])])];prior.targetInputs=[...new Set([...(prior.targetInputs||[]),...(original.targetInputs||[])])];prior.label=`${prior.members!.length} 条跨层关系`;prior.data+='\n'+original.label+'：'+original.data}
    else{const edge={...original,members:[original.id]};groups.set(identity,edge);edges.push(edge)}
  }
  const endpoints=new Set(edges.flatMap(e=>[e.source,e.target]))
  return {nodes:view.nodes.filter(n=>!['context','unknown'].includes(n.viewKind||'')||endpoints.has(n.id)),edges}
}
