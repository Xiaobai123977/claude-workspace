import {useMemo,useState} from 'react'
type Line={old?:number;next?:number;text:string;kind:'add'|'del'|'context'|'head'}
export function filesFromDiff(patch:string){
  return patch.split(/(?=^diff --git )/m).filter(s=>s.trim()).map((section,index)=>{
    const lines=section.split('\n'),path=lines.find(l=>l.startsWith('+++ b/'))?.slice(6)||lines.find(l=>l.startsWith('--- a/'))?.slice(6)||lines[0].replace(/^diff --git a\/.* b\//,'')
    let old=0,next=0,hunk=false;const rows:Line[]=[]
    for(const line of lines){const match=line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);if(match){old=Number(match[1]);next=Number(match[2]);hunk=true;rows.push({text:line,kind:'head'});continue}if(!hunk||line.startsWith('\\')){if(!line.startsWith('diff --git')&&!line.startsWith('index ')&&!line.startsWith('---')&&!line.startsWith('+++'))rows.push({text:line,kind:'head'});continue}if(line.startsWith('+'))rows.push({next:next++,text:line.slice(1),kind:'add'});else if(line.startsWith('-'))rows.push({old:old++,text:line.slice(1),kind:'del'});else if(line.startsWith(' '))rows.push({old:old++,next:next++,text:line.slice(1),kind:'context'})}
    return {id:index,path,kind:/new file mode|--- \/dev\/null/.test(section)?'新增':/deleted file mode|\+\+\+ \/dev\/null/.test(section)?'删除':/rename from /.test(section)?'重命名':'修改',rows,add:rows.filter(l=>l.kind==='add').length,del:rows.filter(l=>l.kind==='del').length}
  })
}
function pairs(rows:Line[]){
  const result:{left?:Line;right?:Line;head?:string}[]=[]
  for(let i=0;i<rows.length;){const row=rows[i];if(row.kind==='head'){result.push({head:row.text});i++}else if(row.kind==='context'){result.push({left:row,right:row});i++}else{const left:Line[]=[],right:Line[]=[];while(i<rows.length&&['add','del'].includes(rows[i].kind)){const r=rows[i++];(r.kind==='del'?left:right).push(r)}for(let n=0;n<Math.max(left.length,right.length);n++)result.push({left:left[n],right:right[n]})}}
  return result
}
export function DiffReview({patch,status}:{patch:string;status:string}){
  const files=useMemo(()=>filesFromDiff(patch),[patch]),[query,setQuery]=useState(''),[split,setSplit]=useState(true),[collapsed,setCollapsed]=useState<Set<string>>(new Set())
  const filtered=files.filter(f=>f.path.toLowerCase().includes(query.toLowerCase()))
  const toggle=(path:string)=>setCollapsed(old=>{const next=new Set(old);if(next.has(path))next.delete(path);else next.add(path);return next})
  return <div className="diff-review change-review">
    <div className="diff-summary"><span>{files.length} 个文件</span><span className="diff-add">+{files.reduce((n,f)=>n+f.add,0)}</span><span className="diff-del">−{files.reduce((n,f)=>n+f.del,0)}</span><div className="diff-view-options" role="group" aria-label="差异显示方式"><button aria-pressed={!split} onClick={()=>setSplit(false)}>单列</button><button aria-pressed={split} onClick={()=>setSplit(true)}>左右对照</button></div></div>
    {!!files.length&&<div className="change-filter"><input aria-label="搜索变更文件" value={query} onChange={e=>setQuery(e.target.value)} placeholder="筛选文件…"/><button onClick={()=>setCollapsed(collapsed.size?new Set():new Set(files.map(f=>f.path)))}>{collapsed.size?'全部展开':'全部折叠'}</button></div>}
    {!files.length&&<div className="changes-empty">{status?'没有可显示的文本差异。':'没有文件变更'}</div>}
    {!!files.length&&!filtered.length&&<div className="changes-empty">没有匹配的文件</div>}
    <div className="change-file-stack" aria-label="变更文件列表">{filtered.map(file=><section className="change-file" key={file.path}>
      <button className="change-file-header" aria-expanded={!collapsed.has(file.path)} onClick={()=>toggle(file.path)}><span className="change-file-kind">{file.kind}</span><strong>{file.path}</strong><span className="diff-add">+{file.add}</span><span className="diff-del">−{file.del}</span><span aria-hidden="true">{collapsed.has(file.path)?'›':'⌄'}</span></button>
      {!collapsed.has(file.path)&&<div className="diff-lines" aria-label={'文件代码差异 '+file.path}>{split?<table className="diff-split"><thead><tr><th colSpan={2}>修改前</th><th colSpan={2}>修改后</th></tr></thead><tbody>{pairs(file.rows).map((pair,i)=>pair.head!==undefined?<tr key={i}><td colSpan={4} className="diff-head">{pair.head}</td></tr>:<tr key={i}><td className="diff-number">{pair.left?.old}</td><td className={pair.left?.kind==='del'?'diff-row-del':''}>{pair.left?.text}</td><td className="diff-number">{pair.right?.next}</td><td className={pair.right?.kind==='add'?'diff-row-add':''}>{pair.right?.text}</td></tr>)}</tbody></table>:<table><tbody>{file.rows.map((row,i)=><tr className={row.kind==='add'?'diff-row-add':row.kind==='del'?'diff-row-del':row.kind==='head'?'diff-head':''} key={i}><td className="diff-number">{row.old}</td><td className="diff-number">{row.next}</td><td className="diff-sign">{row.kind==='add'?'+':row.kind==='del'?'−':''}</td><td>{row.text}</td></tr>)}</tbody></table>}</div>}
    </section>)}</div>
  </div>
}
