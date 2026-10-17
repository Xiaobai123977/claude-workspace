import type {TopologyNode,TopologyEdge} from './types'
export const NODE_WIDTH=204,NODE_HEIGHT=82
export const nodeHeight=(n:TopologyNode)=>Math.max(NODE_HEIGHT,58+Math.max(n.inputs.length,n.outputs.length)*19)
// Condense cycles before ranking. Return paths do not move their producers
// into later stages. Stable barycentric ordering reduces edge crossings.
export function layoutTopology(nodes:TopologyNode[],edges:TopologyEdge[]){
  const ids=new Set(nodes.map(n=>n.id)),links=edges.filter(e=>ids.has(e.source)&&ids.has(e.target)),adj=new Map(nodes.map(n=>[n.id,[] as string[]]))
  for(const e of links)if(e.kind!=='return')adj.get(e.source)!.push(e.target)
  let clock=0;const index=new Map<string,number>(),low=new Map<string,number>(),stack:string[]=[],active=new Set<string>(),group=new Map<string,number>();let groups=0
  const visit=(id:string)=>{index.set(id,clock);low.set(id,clock++);stack.push(id);active.add(id);for(const next of adj.get(id)!){if(!index.has(next)){visit(next);low.set(id,Math.min(low.get(id)!,low.get(next)!))}else if(active.has(next))low.set(id,Math.min(low.get(id)!,index.get(next)!))}if(low.get(id)===index.get(id)){let last;do{last=stack.pop()!;active.delete(last);group.set(last,groups)}while(last!==id);groups++}}
  for(const n of nodes)if(!index.has(n.id))visit(n.id)
  const ranks=new Map<number,number>(),incoming=new Map<number,Set<number>>(),outgoing=new Map<number,Set<number>>()
  for(let i=0;i<groups;i++){incoming.set(i,new Set());outgoing.set(i,new Set());ranks.set(i,0)}
  for(const [id,nexts]of adj)for(const next of nexts){const a=group.get(id)!,b=group.get(next)!;if(a!==b){incoming.get(b)!.add(a);outgoing.get(a)!.add(b)}}
  const queue=[...incoming].filter(([,v])=>!v.size).map(([k])=>k),degrees=new Map([...incoming].map(([k,v])=>[k,v.size]))
  for(let i=0;i<queue.length;i++){const a=queue[i];for(const b of outgoing.get(a)!){ranks.set(b,Math.max(ranks.get(b)!,ranks.get(a)!+1));degrees.set(b,degrees.get(b)!-1);if(!degrees.get(b))queue.push(b)}}
  const columns=new Map<number,TopologyNode[]>()
  for(const node of nodes){const rank=ranks.get(group.get(node.id)!)!;if(!columns.has(rank))columns.set(rank,[]);columns.get(rank)!.push(node)}
  const row=new Map<string,number>();for(const column of columns.values())column.forEach((n,i)=>row.set(n.id,i))
  for(let pass=0;pass<4;pass++)for(const [rank,column]of [...columns].sort((a,b)=>a[0]-b[0])){
    const score=(id:string)=>{const neighbors=links.filter(e=>e.target===id&&ranks.get(group.get(e.source)!)!<rank).map(e=>row.get(e.source)!);return neighbors.length?neighbors.reduce((a,b)=>a+b,0)/neighbors.length:row.get(id)!}
    column.sort((a,b)=>score(a.id)-score(b.id));column.forEach((n,i)=>row.set(n.id,i))
  }
  const returnLanes=new Map<string,number>(),lanes:{left:number;right:number}[][]=[]
  for(const e of links){const a=ranks.get(group.get(e.source)!)!,b=ranks.get(group.get(e.target)!)!;if(b>a)continue;const left=Math.min(a,b),right=Math.max(a,b);let lane=lanes.findIndex(items=>items.every(item=>right<item.left||left>item.right));if(lane<0){lane=lanes.length;lanes.push([])}lanes[lane].push({left,right});returnLanes.set(e.id,lane)}
  const top=44+lanes.length*20,positions=new Map<string,{x:number;y:number}>(),heights=[...columns.values()].map(col=>col.reduce((sum,n)=>sum+nodeHeight(n)+45,0)),height=Math.max(320,...heights)+top+20
  for(const [rank,column]of columns){let y=top;for(const n of column){positions.set(n.id,{x:50+rank*340,y});y+=nodeHeight(n)+45}}
  return {positions,returnLanes,width:Math.max(580,(Math.max(0,...columns.keys())+1)*340),height}
}
