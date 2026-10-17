// Runs in an isolated JavaScript world in the page; no preload or IPC objects are exposed.
function installPicker(){
  window.__workspacePicker?.cleanup?.()
  let target=null
  const overlay=document.createElement('div');overlay.setAttribute('data-workspace-picker','');Object.assign(overlay.style,{position:'fixed',pointerEvents:'none',zIndex:'2147483647',border:'2px solid #69a8ff',background:'#69a8ff22',borderRadius:'3px',display:'none'});document.documentElement.append(overlay)
  const move=event=>{target=event.target;if(!(target instanceof Element)||target===overlay)return;const r=target.getBoundingClientRect();Object.assign(overlay.style,{display:'block',left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'})}
  const cleanup=()=>{overlay.remove();document.removeEventListener('mousemove',move,true);document.removeEventListener('click',click,true);document.removeEventListener('keydown',key,true)}
  const key=event=>{if(event.key==='Escape'){cleanup();window.__workspacePicker={cancelled:true}}}
  const click=event=>{
    event.preventDefault();event.stopImmediatePropagation();const e=event.target;if(!(e instanceof Element))return
    const parts=[];let node=e
    for(let i=0;node&&i<7;i++,node=node.parentElement){let segment=node.tagName.toLowerCase();if(node.id){segment+='#'+CSS.escape(node.id);parts.unshift(segment);break}const parent=node.parentElement;if(parent){const siblings=[...parent.children].filter(s=>s.tagName===node.tagName);if(siblings.length>1)segment+=`:nth-of-type(${siblings.indexOf(node)+1})`}parts.unshift(segment)}
    const style=getComputedStyle(e),r=e.getBoundingClientRect(),clone=e.cloneNode(true)
    for(const input of clone.querySelectorAll('input,textarea')){input.removeAttribute('value');input.textContent=''}if(clone.tagName==='INPUT')clone.removeAttribute('value')
    const selected={url:location.href,documentKey:performance.timeOrigin,title:document.title,selector:parts.join(' > '),tag:e.tagName.toLowerCase(),text:(e.innerText||e.getAttribute('aria-label')||'').slice(0,1500),html:clone.outerHTML.slice(0,5000),rect:{x:r.x,y:r.y,width:r.width,height:r.height},styles:Object.fromEntries(['display','position','color','backgroundColor','fontSize','fontWeight','fontFamily','padding','margin','gap','borderRadius','width','height'].map(k=>[k,style[k]]))}
    cleanup();window.__workspacePicker={selected}
  }
  document.addEventListener('mousemove',move,true);document.addEventListener('click',click,true);document.addEventListener('keydown',key,true)
  window.__workspacePicker={cleanup,active:true};return true
}
module.exports={pickerScript:'('+installPicker.toString()+')()'}
