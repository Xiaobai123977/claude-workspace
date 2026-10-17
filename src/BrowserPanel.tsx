import {useEffect,useRef,useState} from 'react'
import {ArrowLeft,ArrowRight,RefreshCw,MousePointer2,Camera,ExternalLink,Globe} from 'lucide-react'
import type {Attachment,BrowserContext,BrowserState,Session} from './types'
const api=window.workspace
type Selection={url:string;title:string;selector:string;tag:string;text:string;html:string;rect:{x:number;y:number;width:number;height:number};styles:Record<string,string>;capturedAt?:string}
export function BrowserPanel({session,obscured,navigation,onAttach}:{session:Session;obscured:boolean;navigation?:{id:string;url:string};onAttach(text:string,attachments:Attachment[],context?:BrowserContext):void}){
  const [state,setState]=useState<BrowserState>({url:'',title:'',loading:false,canGoBack:false,canGoForward:false,error:''}),[address,setAddress]=useState(''),[notice,setNotice]=useState(''),[picking,setPicking]=useState(false),[selected,setSelected]=useState<Selection|null>(null),[comment,setComment]=useState(''),[busy,setBusy]=useState(false)
  const host=useRef<HTMLDivElement>(null),visible=useRef(false),editingAddress=useRef(false)
  const running=session.messages.some(m=>m.status==='running')
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setNotice('');try{await fn()}catch(e){setNotice(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  useEffect(()=>{void api.browserState(session.id).then(s=>{setState(s);setAddress(s.url)});return api.onBrowser((id,s)=>{if(id===session.id){setState(s);if(s.url&&!editingAddress.current)setAddress(s.url)}})},[session.id])
  useEffect(()=>{
    if(!navigation)return
    setAddress(navigation.url);setSelected(null);setPicking(false)
    void run(async()=>{await api.browserAction(session.id,'navigate',{url:navigation.url})})
  },[session.id,navigation?.id])
  useEffect(()=>{
    const layout=()=>{const rect=host.current?.getBoundingClientRect();const show=!obscured&&!!state.url&&!state.error&&rect&&rect.width>0&&rect.height>0;visible.current=!!show;void api.browserLayout(session.id,show?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null).catch(()=>{})}
    const observer=new ResizeObserver(layout);if(host.current)observer.observe(host.current);window.addEventListener('resize',layout);layout()
    return()=>{observer.disconnect();window.removeEventListener('resize',layout);visible.current=false;void api.browserLayout(session.id,null).catch(()=>{})}
  },[session.id,state.url,state.error,obscured,selected])
  useEffect(()=>{
    if(!picking)return
    let pending=false,cancelled=false
    const timer=setInterval(()=>{if(pending)return;pending=true;void api.browserAction(session.id,'selection').then(r=>{if(cancelled)return;const value=JSON.parse(r.content.find(c=>c.type==='text')?.text||'null');if(!value||typeof value!=='object'||!Object.keys(value).length)return;if(value.cancelled){setPicking(false);return}if(typeof value.url!=='string'||typeof value.selector!=='string'||typeof value.tag!=='string'||typeof value.text!=='string'||typeof value.html!=='string'){setPicking(false);setNotice('未获得有效的元素信息，请重新选择');return}setPicking(false);setSelected({...value,capturedAt:new Date().toISOString()});setComment('')}).catch(e=>{if(!cancelled){setPicking(false);setNotice(String(e))}}).finally(()=>{pending=false})},300)
    return()=>{cancelled=true;clearInterval(timer)}
  },[session.id,picking])
  const action=(name:string)=>void run(async()=>{await api.browserAction(session.id,name)})
  const screenshot=async()=>{const r=await api.browserAction(session.id,'screenshot');const image=r.content.find(c=>c.type==='image');if(!image?.data)throw new Error('未获得截图');return api.importFiles([{name:'browser-preview.png',data:image.data}])}
  const attachSelection=()=>void run(async()=>{
    if(!selected)return
    await api.browserAction(session.id,'selection-check',{snapshot:selected})
    const attachments=await screenshot()
    onAttach(comment.trim(),attachments,selected);setSelected(null);setComment('');setNotice('元素信息和页面截图已加入聊天草稿，发送后执行修改')
  })
  return <div className="browser-panel">
    <form className="browser-address" onSubmit={e=>{e.preventDefault();void run(async()=>{setPicking(false);setSelected(null);await api.browserAction(session.id,'navigate',{url:address})})}}><button type="button" aria-label="浏览器后退" disabled={!state.canGoBack} onClick={()=>action('back')}><ArrowLeft size={15}/></button><button type="button" aria-label="浏览器前进" disabled={!state.canGoForward} onClick={()=>action('forward')}><ArrowRight size={15}/></button><button type="button" aria-label="刷新网页" disabled={!state.url} onClick={()=>action('reload')}><RefreshCw size={15} className={state.loading?'spin':''}/></button><input aria-label="浏览器地址" value={address} onFocus={()=>{editingAddress.current=true}} onBlur={()=>{editingAddress.current=false}} onChange={e=>setAddress(e.target.value)} placeholder="http://localhost:3000 或 file:///D:/project/index.html"/><button type="submit" disabled={busy}>打开</button></form>
    <div className="browser-actions"><button aria-label="选择网页元素" className={picking?'active':''} disabled={!state.url||busy} onClick={()=>void run(async()=>{await api.browserAction(session.id,'picker');setPicking(true);setNotice('在页面上点击要修改的元素，Esc 取消')})}><MousePointer2 size={14}/>选中修改</button><button aria-label="截图加入聊天" disabled={!state.url||busy} onClick={()=>void run(async()=>{onAttach('',await screenshot());setNotice('页面截图已加入聊天草稿')})}><Camera size={14}/>截图</button><button aria-label="在系统浏览器中打开" disabled={!state.url} onClick={()=>void run(()=>api.openLink(state.url))}><ExternalLink size={14}/></button><label><input aria-label="允许 Claude 操作浏览器" type="checkbox" disabled={running||busy||!!session.options?.safeMode} checked={!!session.browserEnabled} onChange={e=>void run(()=>api.browserEnable(session.id,e.target.checked))}/>Claude 可操作</label></div>
    <div className="browser-connection" role="status">{session.options?.safeMode?'安全模式已停用浏览器工具':session.browserEnabled?'已连接到当前聊天 · 发送时附带当前页面地址，Claude 可使用页面检查、点击和截图工具':'尚未连接到 Claude · 开启“Claude 可操作”后，发送消息即可使用浏览器工具'}</div>
    {(notice||state.error)&&<div className="browser-notice" role="status">{state.error||notice}</div>}

    <div ref={host} className="browser-viewport" aria-label="内置网页预览">{!state.url?<div className="browser-empty"><Globe size={30}/><h3>预览网页，直接指出怎么改</h3><p>输入网站、开发服务器地址或当前项目的 file:/// HTML 链接。开启“Claude 可操作”后，下一次发送时可使用网页工具。</p></div>:state.error?<p>{state.error}</p>:null}</div>
    {selected&&<section className="browser-selection"><div><strong>已选中 · {selected.tag}</strong><button aria-label="移除所选元素" onClick={()=>setSelected(null)}>×</button></div><code title={selected.selector}>{selected.selector}</code><p>{selected.text.slice(0,150)||'无文字内容'}</p>{selected.url!==state.url&&<p role="alert">页面已变化，请重新选择元素。</p>}<textarea aria-label="元素修改要求" value={comment} onChange={e=>setComment(e.target.value)} placeholder="例如：把这个按钮改成蓝色，圆角小一点"/><button disabled={busy||!comment.trim()||selected.url!==state.url} onClick={attachSelection}>将元素与修改要求加入聊天</button></section>}
  </div>
}
