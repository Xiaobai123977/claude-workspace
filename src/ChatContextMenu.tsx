import {useLayoutEffect,useRef} from 'react'
import {SquarePen,Pin,PinOff,Eye,GitBranch,Copy,FolderOpen,Download,Archive,Trash2} from 'lucide-react'
import type {Session} from './types'
export type ChatAction='rename'|'pin'|'unread'|'fork'|'copy-title'|'copy-chat'|'export'|'folder'|'archive'|'delete'
export function ContextMenu({id,label,x,y,onClose,anchor,children}:{id:string;label:string;x:number;y:number;onClose():void;anchor:string;children:React.ReactNode}){
  const ref=useRef<HTMLDivElement>(null)
  useLayoutEffect(()=>{
    const menu=ref.current;if(!menu)return
    const r=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(x,window.innerWidth-r.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,window.innerHeight-r.height-8))+'px'
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const outside=(e:PointerEvent)=>{if(!menu.contains(e.target as Node))onClose()}
    const close=()=>onClose()
    const scroll=(e:Event)=>{if(!(e.target instanceof Node)||!menu.contains(e.target))onClose()}
    document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',close);window.addEventListener('blur',close);document.addEventListener('scroll',scroll,true)
    return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',close);window.removeEventListener('blur',close);document.removeEventListener('scroll',scroll,true)}
  },[id,x,y])
  return <div ref={ref} role="menu" aria-label={label} className="chat-context-menu" style={{left:x,top:y}} onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();document.querySelector<HTMLButtonElement>(anchor)?.focus();return}
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();const items=Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus()}
    if(e.key==='Tab')onClose()
  }}>
    {children}
  </div>
}
export function ChatContextMenu({session,x,y,onAction,onClose}:{session:Session;x:number;y:number;onAction(action:ChatAction):void;onClose():void}){
  const running=session.messages.some(m=>m.status==='running')
  const item=(action:ChatAction,label:string,Icon:typeof Copy,disabled=false)=><button role="menuitem" key={action} disabled={disabled} className={action==='delete'?'danger':''} onClick={()=>onAction(action)}><Icon size={17}/><span>{label}</span></button>
  return <ContextMenu id={session.id} label="聊天操作" x={x} y={y} onClose={onClose} anchor={`[data-chat-id="${CSS.escape(session.id)}"]`}>

    {item('rename','重命名',SquarePen,running)}
    {item('pin',session.pinned?'取消置顶':'置顶',session.pinned?PinOff:Pin)}
    {item('unread',session.unread?'标记为已读':'标记为未读',Eye)}
    <div role="separator"/>
    {item('fork','创建聊天分支',GitBranch,running)}
    {item('copy-title','复制标题',Copy)}
    {item('copy-chat','复制聊天内容',Copy,!session.messages.length&&!session.nativeId)}
    {item('export','导出聊天',Download)}
    {item('folder','打开项目目录',FolderOpen)}
    <div role="separator"/>
    {item('archive',session.archived?'取消归档':'归档',Archive,running)}
    {item('delete','删除聊天',Trash2,running)}
  </ContextMenu>
}
