import {FileDiff,ArrowUpRight} from 'lucide-react'
import type {ChangeSummary} from './types'
import './changes-panel.css'
export function ChangeSummaryCard({changes,onOpen}:{changes:ChangeSummary;onOpen():void}){
  const [first,second,third,...rest]=changes.files
  return <section className="change-summary-card" aria-label="本轮文件变更">
    <button className="change-summary-open" onClick={onOpen}><FileDiff size={18}/><span><strong>已更改 {changes.files.length} 个文件</strong><small>本轮变更</small></span><span className="diff-add">+{changes.add}</span><span className="diff-del">−{changes.del}</span><ArrowUpRight size={15}/></button>
    <div className="change-summary-files">{[first,second,third].filter(Boolean).map(file=><button key={file.path} onClick={onOpen}><span>{file.path}</span>{file.reason?<small>仅路径</small>:<small><b className="diff-add">+{file.add}</b> <b className="diff-del">−{file.del}</b></small>}</button>)}</div>
    <button className="change-summary-more" onClick={onOpen}>{rest.length?`查看全部 ${changes.files.length} 个文件`:'查看变更'}<ArrowUpRight size={12}/></button>
  </section>
}
