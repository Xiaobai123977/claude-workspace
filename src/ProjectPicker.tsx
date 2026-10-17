import {useRef,useState} from 'react'
import {Check,Folder,Plus,Search} from 'lucide-react'
export type ProjectChoice={cwd:string;name:string}
export function ProjectPicker({projects,current,busy,onSelect,onAdd}:{projects:ProjectChoice[];current:string;busy:boolean;onSelect(cwd:string):void;onAdd():void}){
  const [query,setQuery]=useState(''),ref=useRef<HTMLDivElement>(null)
  const matches=projects.filter(p=>(p.name+' '+p.cwd).toLowerCase().includes(query.toLowerCase()))
  return <div ref={ref} className="project-picker popover" role="dialog" aria-label="选择项目" onKeyDown={e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();e.stopPropagation();const items=Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=items.indexOf(document.activeElement as HTMLButtonElement);items[(index+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus()}}}>
    <label className="project-picker-search"><Search size={14}/><input autoFocus aria-label="搜索项目" placeholder="搜索项目或路径" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="project-picker-list" role="listbox" aria-label="已有项目">{matches.map(p=><button key={p.cwd} role="option" aria-selected={p.cwd===current} disabled={busy} onClick={()=>onSelect(p.cwd)}><Folder size={16}/><span><strong>{p.name}</strong><small>{p.cwd}</small></span>{p.cwd===current&&<Check size={15}/>}</button>)}{!matches.length&&<p>没有匹配的项目</p>}</div>
    <button className="project-picker-add" disabled={busy} onClick={onAdd}><Plus size={16}/>添加新项目…</button>
  </div>
}
