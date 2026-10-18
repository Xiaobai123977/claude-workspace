import {memo,useEffect,useMemo,useRef,useState} from 'react'
import ReactMarkdown,{defaultUrlTransform} from 'react-markdown'
import remarkGfm from 'remark-gfm'

const CHUNK=24000
const ContentChunk=memo(function ContentChunk({text,markdown,onOpenLink,virtual}:{text:string;markdown:boolean;onOpenLink?(url:string):void;virtual:boolean}){
  const host=useRef<HTMLDivElement>(null),link=useRef(onOpenLink),height=useRef(600)
  const [visible,setVisible]=useState(!virtual)
  link.current=onOpenLink
  useEffect(()=>{
    if(!virtual){setVisible(true);return}
    const node=host.current!
    const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting),{rootMargin:'1000px'})
    observer.observe(node);return()=>observer.disconnect()
  },[virtual])
  useEffect(()=>{
    if(!visible||!host.current)return
    const node=host.current,observer=new ResizeObserver(()=>{if(node.offsetHeight)height.current=node.offsetHeight})
    observer.observe(node);return()=>observer.disconnect()
  },[visible])
  const content=useMemo(()=>!visible?null:markdown?<ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(url,key)=>key==='href'&&/^file:\/\//i.test(url)?url:defaultUrlTransform(url)} components={{a:({href,children})=><a href={href} onClick={event=>{event.preventDefault();if(href)link.current?.(href)}}>{children}</a>}}>{text}</ReactMarkdown>:<pre className="bounded-text">{text}</pre>,[text,markdown,visible])
  return <div ref={host} className="content-chunk" style={!visible?{height:height.current}:undefined}>{content}</div>
})
export function LargeContent({text,markdown=false,onOpenLink}:{text:string;markdown?:boolean;onOpenLink?(url:string):void}){
  const chunks=[]
  for(let start=0;start<text.length;start+=CHUNK)chunks.push(text.slice(start,start+CHUNK))
  return <>{chunks.map((part,index)=><ContentChunk key={index} text={part} markdown={markdown} onOpenLink={onOpenLink} virtual={text.length>CHUNK}/>)}</>
}
export function LazyThought({text}:{text:string}){
  const [open,setOpen]=useState(false)
  return <details className="thinking" onToggle={event=>setOpen(event.currentTarget.open)}><summary>思考过程</summary>{open&&<LargeContent text={text}/>}</details>
}
