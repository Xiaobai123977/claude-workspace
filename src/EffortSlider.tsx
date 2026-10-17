import {useEffect,useRef,useState} from 'react'
import type {CSSProperties} from 'react'
import {effortSteps} from './effort-steps'
import './effort-slider.css'

export function EffortSlider({levels,value,labels,defaultLabel,disabled,onChange,onError}:{levels:string[];value:string;labels:Record<string,string>;defaultLabel:string;disabled:boolean;onChange(value:string):Promise<void>;onError(message:string):void}) {
  const steps=effortSteps(levels),signature=JSON.stringify(steps)
  const [preview,setPreview]=useState(value),[saving,setSaving]=useState(false)
  const dragging=useRef(false),current=useRef(value)
  useEffect(()=>{setPreview(value);current.current=value},[value,signature])
  const index=steps.indexOf(preview),position=Math.max(0,index),progress=steps.length>1?position/(steps.length-1)*100:0
  const label=(step:string)=>step===''?defaultLabel:labels[step]||step
  async function commit(next:string){
    if(disabled||saving||next===value)return
    setPreview(next);current.current=next;setSaving(true)
    try{await onChange(next)}catch(e){setPreview(value);current.current=value;onError(e instanceof Error?e.message:String(e))}finally{setSaving(false)}
  }
  return <div className="effort-slider">
    <div className="effort-slider-readout"><strong aria-live="polite">{index<0?'原档位不可用':label(preview)}</strong></div>
    <div className="effort-slider-rail" style={{'--effort-fill':`calc(${progress}% + ${16-32*progress/100}px)`} as CSSProperties}>
      <div className="effort-slider-fill"/>
      <div className="effort-slider-dots" aria-hidden="true">{steps.map(step=><i key={step}/>)}</div>
      <input type="range" aria-label="思考强度" aria-valuetext={index<0?'原档位不可用，请重新选择':label(preview)} min={0} max={Math.max(0,steps.length-1)} step={1} value={position} disabled={disabled||saving||steps.length===1}
        onPointerDown={()=>{dragging.current=true}}
        onChange={e=>{const next=steps[Number(e.target.value)];current.current=next;setPreview(next);if(!dragging.current)void commit(next)}}
        onPointerUp={()=>{dragging.current=false;void commit(current.current)}}
        onPointerCancel={()=>{dragging.current=false;current.current=value;setPreview(value)}}
        onBlur={()=>{if(dragging.current){dragging.current=false;void commit(current.current)}}}/>
    </div>
    <div className="effort-slider-labels">{steps.map(step=><button key={step} type="button" title={label(step)} aria-label={label(step)} aria-pressed={preview===step} disabled={disabled||saving} onClick={()=>void commit(step)}>{step===''?'默认':labels[step]||step}</button>)}</div>
  </div>
}
