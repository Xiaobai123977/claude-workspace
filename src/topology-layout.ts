import ELK,{type ElkNode} from 'elkjs/lib/elk.bundled.js'
import type {TopologyNode,TopologyEdge} from './types'
export const NODE_WIDTH=224,NODE_HEIGHT=108,PORT_STEP=20,PORT_TOP=64
// Overview cards have a bounded height. Full port lists belong to the inspector.
export const nodeHeight=(_node:TopologyNode)=>NODE_HEIGHT
export type TopologyLayout={positions:Map<string,{x:number;y:number}>;routes:Map<string,{points:{x:number;y:number}[];label:{x:number;y:number}}> ;width:number;height:number}
const elk=new ELK()
export async function layoutTopology(nodes:TopologyNode[],edges:TopologyEdge[]):Promise<TopologyLayout>{
  const ids=new Set(nodes.map(n=>n.id)),links=edges.filter(e=>ids.has(e.source)&&ids.has(e.target))
  const incoming=new Map(nodes.map(n=>[n.id,links.filter(e=>e.target===n.id)])),outgoing=new Map(nodes.map(n=>[n.id,links.filter(e=>e.source===n.id)]))
  const port=(edge:TopologyEdge,side:'in'|'out')=>'port:'+edge.id+':'+side
  const result:ElkNode=await elk.layout({id:'business-flow',layoutOptions:{
    'elk.algorithm':'layered','elk.direction':'RIGHT','elk.edgeRouting':'ORTHOGONAL',
    'elk.padding':'[top=28,left=28,bottom=28,right=28]',
    'elk.spacing.nodeNode':'44','elk.layered.spacing.nodeNodeBetweenLayers':'80',
    'elk.spacing.edgeNode':'18','elk.layered.spacing.edgeEdgeBetweenLayers':'12',
    'elk.layered.nodePlacement.strategy':'NETWORK_SIMPLEX',
    'elk.layered.layering.strategy':'NETWORK_SIMPLEX','elk.layered.thoroughness':'12',
    'elk.layered.mergeEdges':'false','elk.separateConnectedComponents':'true',
    'elk.randomSeed':'1'
  },children:nodes.map(n=>({id:n.id,width:NODE_WIDTH,height:nodeHeight(n),layoutOptions:{'elk.portConstraints':'FIXED_POS'},ports:[
    ...incoming.get(n.id)!.map((edge,i,list)=>({id:port(edge,'in'),x:0,y:50+(nodeHeight(n)-64)*(i+1)/(list.length+1),width:0,height:0,layoutOptions:{'elk.port.side':'WEST'}})),
    ...outgoing.get(n.id)!.map((edge,i,list)=>({id:port(edge,'out'),x:NODE_WIDTH,y:50+(nodeHeight(n)-64)*(i+1)/(list.length+1),width:0,height:0,layoutOptions:{'elk.port.side':'EAST'}}))
  ]})),edges:links.map(edge=>({id:edge.id,sources:[port(edge,'out')],targets:[port(edge,'in')],layoutOptions:{'elk.layered.priority.direction':edge.kind==='return'?'0':'10'}}))})
  const positions=new Map((result.children||[]).map(n=>[n.id,{x:n.x||0,y:n.y||0}]))
  const routes:TopologyLayout['routes']=new Map()
  for(const edge of result.edges||[]){
    const section=edge.sections?.[0]
    if(!section)continue
    const points=[section.startPoint,...section.bendPoints||[],section.endPoint]
    const horizontal=points.slice(1).map((p,i)=>({a:points[i],b:p})).filter(s=>s.a.y===s.b.y).sort((a,b)=>Math.abs(b.b.x-b.a.x)-Math.abs(a.b.x-a.a.x))[0]
    const label=horizontal?{x:(horizontal.a.x+horizontal.b.x)/2,y:horizontal.a.y-8}:{x:points[0].x+8,y:points[0].y-8}
    routes.set(edge.id+':0',{points,label})
  }
  return {positions,routes,width:Math.max(580,result.width||0),height:Math.max(320,result.height||0)}
}
