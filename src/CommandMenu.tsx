import {Command,LoaderCircle,RefreshCw} from 'lucide-react'
import {useEffect,useRef} from 'react'
import './commands.css'
export type SlashEntry={key:string;description:string;source:string;argumentHint?:string;local?:boolean;disabled?:boolean;action():unknown}
export function CommandMenu({entries,index,loading,error,searching,onIndex,onPick,onRefresh}:{searching:boolean;entries:SlashEntry[];index:number;loading:boolean;error:string;onIndex(i:number):void;onPick(i:number):void;onRefresh():void}){
  const list=useRef<HTMLDivElement>(null)
  useEffect(()=>{list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'})},[index,entries.length])
  return <div className="claude-command-menu popover" role="listbox" aria-label="命令菜单">
    <header><div><Command size={15}/><strong>{searching?'命令搜索结果':'常用命令与技能'}</strong></div><button type="button" title="重新读取 CLI 命令" aria-label="重新读取 CLI 命令" disabled={loading} onClick={onRefresh}><RefreshCw size={13} className={loading?'spin':''}/></button></header>
    <div ref={list} className="claude-command-list">{entries.map((c,i)=><button type="button" key={c.key} role="option" aria-selected={index===i} disabled={c.disabled} className={index===i?'highlighted':''} onMouseEnter={()=>onIndex(i)} onClick={()=>onPick(i)}><div className="slash-entry-title"><code>/{c.key}</code><span>{c.local?'会话控制':c.source}</span></div><small title={c.description}>{c.description}</small>{c.argumentHint&&!c.local&&<em>{c.argumentHint}</em>}</button>)}
      {loading&&<p className="slash-loading"><LoaderCircle size={13} className="spin"/>读取当前 CLI 的可用命令…</p>}{error&&<p className="slash-error" role="status">{error}</p>}{!entries.length&&!loading&&<p>没有匹配的命令。可重新读取 CLI 或在扩展中管理技能。</p>}</div>
    <footer><span>↑ ↓ 选择 · Tab 补全</span><span>输入名称查找更多 · 技能发送后执行</span></footer>
  </div>
}
