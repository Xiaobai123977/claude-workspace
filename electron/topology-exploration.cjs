// Coverage is derived from the tree, not an agent's prose claim of completion.
function inspectExploration(graph,{moduleIds=[],depth='auto'}={}){
  const byId=new Map(graph.nodes.map(n=>[n.id,n])),children=new Map()
  for(const n of graph.nodes){const key=n.parent||'';if(!children.has(key))children.set(key,[]);children.get(key).push(n)}
  const roots=moduleIds.length?moduleIds.flatMap(id=>children.get(id)||[]):children.get('')||[],frontier=[],stops=[]
  let reachedDepth=0,visited=0
  const visit=(node,level)=>{
    visited++;reachedDepth=Math.max(reachedDepth,level)
    const nested=children.get(node.id)||[],record=node.exploration
    if(depth!=='auto'&&level>=depth)return
    if(nested.length){for(const child of nested)visit(child,level+1);return}
    if(record?.state==='leaf'&&record.reason?.trim()&&node.refs.length){stops.push({id:node.id,reason:record.reason});return}
    if(['external','database'].includes(node.kind)&&record?.state==='external'&&record.reason?.trim()){stops.push({id:node.id,reason:record.reason});return}
    frontier.push({id:node.id,label:node.label,depth:level,blocked:record?.state==='blocked',reason:record?.reason||'尚未展开，也没有经代码核实的叶子停止依据'})
  }
  for(const root of roots)visit(root,1)
  if(moduleIds.length)for(const id of moduleIds)if(!(children.get(id)||[]).length){const n=byId.get(id);if(n)visit(n,0)}
  return {complete:visited>0&&!frontier.length,reachedDepth,visited,frontier,stops}
}
module.exports={inspectExploration}
