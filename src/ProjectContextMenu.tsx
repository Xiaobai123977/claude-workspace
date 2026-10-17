import {Plus,SquarePen,Pin,PinOff,Copy,FolderOpen,Archive,PanelLeftClose,ChevronRight,ChevronDown,GitBranch} from 'lucide-react'
import {ContextMenu} from './ChatContextMenu'
import type {ProjectSettings} from './types'
export type ProjectAction='new'|'rename'|'pin'|'collapse'|'copy'|'folder'|'workspace'|'archive'|'remove'
export function ProjectContextMenu({cwd,name,settings,archived,running,empty,x,y,onClose,onAction}:{cwd:string;name:string;settings:ProjectSettings;archived:boolean;running:boolean;empty:boolean;x:number;y:number;onClose():void;onAction(action:ProjectAction):void}){
  const item=(action:ProjectAction,label:string,Icon:typeof Plus,disabled=false)=><button role="menuitem" disabled={disabled} onClick={()=>onAction(action)}><Icon size={17}/><span>{label}</span></button>
  return <ContextMenu id={cwd} label="项目操作" x={x} y={y} onClose={onClose} anchor={`[data-project-path="${CSS.escape(cwd)}"] button`}>
    {item('new','新建聊天',Plus)}
    {item('rename','重命名项目',SquarePen)}
    {item('pin',settings.pinned?'取消项目置顶':'置顶项目',settings.pinned?PinOff:Pin)}
    {item('collapse',settings.collapsed?'展开聊天列表':'折叠聊天列表',settings.collapsed?ChevronDown:ChevronRight)}
    <div role="separator"/>
    {item('copy','复制项目路径',Copy)}
    {item('folder','打开项目目录',FolderOpen)}
    {item('workspace','隔离工作区',GitBranch,running)}
    <div role="separator"/>
    {item('archive',archived?'取消归档全部聊天':'归档全部聊天',Archive,running||empty)}
    {item('remove','从侧栏移除项目',PanelLeftClose)}
  </ContextMenu>
}
