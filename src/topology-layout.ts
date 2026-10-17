import type {TopologyNode,TopologyEdge} from './types'
export const NODE_WIDTH=214,NODE_HEIGHT=114
export function layoutTopology(nodes:TopologyNode[],edges:TopologyEdge[]){
  const ids=new Set(nodes.map(n=>n.id)),links=edges.filter(e=>ids.has(e.source)&&ids.has(e.target)),incoming=new Set(links.map(e=>e.target)),depth=new Map<string,number>()
  const roots=nodes.filter(n=>!incoming.has(n.id));const queue=(roots.length?roots:nodes.slice(0,1)).map(n=>({id:n.id,level:0}))
  for(let i=0;i<queue.length;i++){const item=queue[i];if(depth.has(item.id))continue;depth.set(item.id,item.level);for(const edge of links.filter(e=>e.source===item.id))if(!depth.has(edge.target))queue.push({id:edge.target,level:Math.min(5,item.level+1)})}
  for(const node of nodes)if(!depth.has(node.id))depth.set(node.id,0)
  const counts=new Map<number,number>(),positions=new Map<string,{x:number;y:number}>(),wrap=Math.max(0,...depth.values())>2
  const ordered=wrap?[...nodes].sort((a,b)=>depth.get(a.id)!-depth.get(b.id)!):nodes
  for(const [index,n] of ordered.entries()){const column=wrap?index%3:depth.get(n.id)!;const row=wrap?Math.floor(index/3):counts.get(column)||0;counts.set(column,row+1);positions.set(n.id,{x:38+column*290,y:45+row*180})}
  return {positions,width:Math.max(580,...[...positions.values()].map(p=>p.x+NODE_WIDTH+42)),height:Math.max(340,...[...positions.values()].map(p=>p.y+NODE_HEIGHT+55))}
}
