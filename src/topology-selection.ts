import type {TopologyNode} from './types'
export function normalizeTopologyModules(nodes:TopologyNode[],ids:string[]){
  const unique=[...new Set(ids)],selected=new Set(unique),byId=new Map(nodes.map(n=>[n.id,n]))
  const roots=unique.filter(id=>{let parent=byId.get(id)?.parent;const seen=new Set<string>();while(parent&&!seen.has(parent)){if(selected.has(parent))return false;seen.add(parent);parent=byId.get(parent)?.parent}return true})
  return {roots,overlapping:unique.filter(id=>!roots.includes(id))}
}
