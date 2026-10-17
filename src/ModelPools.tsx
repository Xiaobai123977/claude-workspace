import {useEffect,useState} from 'react'
import type {ModelPool,Provider,RoutingState,Session} from './types'
const api=window.workspace
const emptyPool=():ModelPool=>({name:'',model:'',enabled:true,sticky:true,ttlMinutes:60,members:[]})
export function ModelPools({session,onDirtyChange}:{session:Session;onDirtyChange(dirty:boolean):void}) {
  const [suppliers,setSuppliers]=useState<Provider[]>([]),[state,setState]=useState<RoutingState>({pools:[],coverage:[]}),[draft,setDraft]=useState<ModelPool>(emptyPool)
  const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[notice,setNotice]=useState(''),[query,setQuery]=useState('')
  const running=session.messages.some(m=>m.status==='running')
  const refresh=async()=>{const [providers,routing]=await Promise.all([api.providers(),api.routing()]);setSuppliers(providers);setState(routing);return routing}
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setNotice('');try{await fn()}catch(e){setNotice(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  useEffect(()=>{void run(async()=>{const result=await refresh();const active=result.pools.find(p=>p.id===session.providerId);if(active)setDraft(active)})},[])
  useEffect(()=>{onDirtyChange(dirty);return()=>onDirtyChange(false)},[dirty])
  const patch=(p:Partial<ModelPool>)=>{setDraft(d=>({...d,...p}));setDirty(true)}
  const choose=(pool:ModelPool)=>{if(dirty&&!window.confirm('放弃未保存的模型池修改？'))return;setDraft(structuredClone(pool));setDirty(false);setNotice('')}
  const available=(providerId:string,model:string,keyIds?:string[])=>{
    const p=suppliers.find(p=>p.id===providerId)
    if(!p||p.enabled===false||p.models.find(m=>m.id===model)?.enabled===false)return []
    return (p.keys||[]).filter(k=>k.enabled!==false&&(!keyIds||keyIds.includes(k.id))&&k.models.some(m=>m.id===model&&!m.stale&&m.enabled!==false))
  }
  const candidates=draft.members.filter(m=>m.enabled!==false).map(m=>({...m,keys:available(m.providerId,m.model,m.keyIds)}))
  const hasWindow=candidates.some(m=>m.keys.some(k=>k.models.find(x=>x.id===m.model)?.context))
  const eligible=candidates.map(m=>({...m,keys:m.keys.filter(k=>!hasWindow||!!k.models.find(x=>x.id===m.model)?.context)}))
  const windows=eligible.flatMap(m=>m.keys.map(k=>k.models.find(x=>x.id===m.model)?.context).filter((n):n is number=>!!n))
  const providerCount=new Set(eligible.filter(m=>m.keys.length).map(m=>m.providerId)).size,keyCount=new Set(eligible.flatMap(m=>m.keys.map(k=>m.providerId+'/'+k.id))).size
  const save=async(activate:boolean)=>{const saved=await api.savePool(draft);setDraft(saved);setDirty(false);await refresh();window.dispatchEvent(new Event('providers:changed'));if(activate)await api.activateProvider(session.id,saved.id!);setNotice(activate?'模型池已保存并启用，当前聊天与新聊天使用此模型池':'模型池已保存')}
  const levels=[...new Set(eligible.flatMap(m=>m.keys.flatMap(k=>{return k.models.find(x=>x.id===m.model)?.efforts||[]})))]
  return <div className="model-pools">
    <section className="work-card"><div className="work-actions"><h2>模型覆盖</h2><button disabled={busy} onClick={()=>void run(async()=>{await refresh();setNotice('已读取各 Key 保存的独立检测结果')})}>刷新覆盖统计</button></div><p>相同 ID 自动统计；不同 ID 通过下方模型池手动映射。这里的统计来自每个 Key 各自的目录，不会把一个 Key 的结果复制给其他 Key。</p><input aria-label="搜索模型覆盖" placeholder="搜索上游模型 ID" value={query} onChange={e=>setQuery(e.target.value)}/>
      <div className="coverage-list">{state.coverage.filter(c=>c.model.toLowerCase().includes(query.toLowerCase())).map(c=><div key={c.model}><span><strong>{c.model}</strong><small>{c.detectedProviderCount} 个供应商 · {c.detectedKeyCount} 个 Key 已检测到{c.keyCount>c.detectedKeyCount?` · 另有 ${c.keyCount-c.detectedKeyCount} 条手动声明`:""}</small></span><button disabled={busy} onClick={()=>{if(dirty&&!window.confirm('放弃未保存的模型池修改？'))return;setDraft({...emptyPool(),name:c.model,model:c.model,members:c.suppliers.map(s=>({providerId:s.providerId,model:c.model,enabled:true}))});setDirty(true)}}>创建模型池</button></div>)}</div>
      {!state.coverage.length&&<p>先在“供应商与 Key”中分别检测模型目录。</p>}
    </section>
    <section className="saved-provider-list" aria-label="已保存的模型池"><div className="work-actions"><h2>已保存的模型池</h2><button onClick={()=>choose(emptyPool())}>新建模型池</button></div>{state.pools.map(pool=><button key={pool.id} className={draft.id===pool.id?'selected':''} onClick={()=>choose(pool)}><span><strong>{pool.name}</strong><small>{pool.model} · {pool.providerCount} 个供应商 / {pool.keyCount} 条可用 Key 线路 · {pool.sticky?'粘性':'逐请求轮询'}</small></span><span>{pool.id===session.providerId?'当前聊天使用':'编辑'}</span></button>)}</section>
    <section className="work-card"><h2>{draft.id?'编辑模型池':'新建模型池'}</h2><label>模型池名称<input aria-label="模型池名称" value={draft.name} onChange={e=>patch({name:e.target.value})} placeholder="例如 DeepSeek 主力服务"/></label><label>对外模型 ID<input aria-label="模型池模型 ID" value={draft.model} onChange={e=>patch({model:e.target.value})} placeholder="聊天中使用的统一模型 ID"/></label><label>启用模型池<input type="checkbox" checked={draft.enabled} onChange={e=>patch({enabled:e.target.checked})}/></label>
      <div className="pool-summary"><strong>{providerCount} 个供应商 · {keyCount} 条可用 Key 线路</strong><span>{windows.length?`上下文按最小声明值 ${Math.min(...windows).toLocaleString()} tokens 运行；容量未知线路不参与。`: '上下文容量未声明，沿用 CLI 默认判断。'}</span><span>先按供应商权重选择供应商，再按其 Key 权重选择 Key。同一 Key 在模型池中只映射一个上游模型 ID。</span></div>
      {draft.members.map((member,index)=>{
        const p=suppliers.find(p=>p.id===member.providerId),keys=available(member.providerId,member.model,member.keyIds)
        return <div className="pool-member" key={index}><header><strong>线路 {index+1}</strong><button aria-label={`移除池线路 ${index+1}`} onClick={()=>patch({members:draft.members.filter((_,i)=>i!==index)})}>移除</button></header>
          <label>供应商<select aria-label={`池线路 ${index+1} 供应商`} value={member.providerId} onChange={e=>{const next=suppliers.find(p=>p.id===e.target.value);patch({members:draft.members.map((m,i)=>i===index?{providerId:e.target.value,model:next?.models.find(m=>!m.stale)?.id||'',enabled:true}:m)})}}><option value="">选择供应商</option>{suppliers.map(p=><option key={p.id} value={p.id}>{p.name} · 权重 {p.weight||1}{p.enabled===false?' · 已停用':''}</option>)}</select></label>
          <label>上游模型 ID<input aria-label={`池线路 ${index+1} 上游模型 ID`} list={`pool-models-${index}`} value={member.model} onChange={e=>patch({members:draft.members.map((m,i)=>i===index?{...m,model:e.target.value}:m)})}/><datalist id={`pool-models-${index}`}>{p?.models.map(m=><option value={m.id} key={m.id}/>)}</datalist></label>
          <p>{keys.length?`${keys.length} 个启用 Key 的独立目录匹配此模型`:'没有启用 Key 检测到此模型，当前不会参与路由'}</p>
          <details><summary>参与的 Key · {member.keyIds?'指定 Key':'全部匹配 Key'}</summary><label>自动使用所有匹配 Key<input type="checkbox" checked={!member.keyIds} onChange={e=>patch({members:draft.members.map((m,i)=>i===index?{...m,keyIds:e.target.checked?undefined:keys.map(k=>k.id)}:m)})}/></label>{member.keyIds&&(p?.keys||[]).map(k=><label key={k.id}>{k.name} · 权重 {k.weight||1}<input type="checkbox" checked={member.keyIds?.includes(k.id)} onChange={e=>patch({members:draft.members.map((m,i)=>i===index?{...m,keyIds:e.target.checked?[...(m.keyIds||[]),k.id]:(m.keyIds||[]).filter(id=>id!==k.id)}:m)})}/></label>)}</details>
        </div>
      })}
      <button disabled={busy||!suppliers.length||draft.members.length>=100} onClick={()=>{const p=suppliers.find(p=>!draft.members.some(m=>m.providerId===p.id))||suppliers[0];if(p)patch({members:[...draft.members,{providerId:p.id!,model:p.models[0]?.id||'',enabled:true}]})}}>添加供应商线路</button>
      <label>同一聊天优先复用原线路<input aria-label="模型池粘性路由" type="checkbox" checked={draft.sticky} onChange={e=>patch({sticky:e.target.checked})}/></label><p>启用粘性后，权重主要分配新聊天；已有聊天在粘性有效期内优先沿用原线路。遇到限流、鉴权失败或服务故障时，会选择其他已确认且能力兼容的线路。</p>
      {draft.sticky&&<label>粘性有效期（分钟）<input aria-label="粘性有效期" type="number" min="1" max="10080" value={draft.ttlMinutes} onChange={e=>patch({ttlMinutes:Number(e.target.value)})}/></label>}
      <label>默认思考档位<select aria-label="模型池默认思考档位" value={draft.defaultEffort||''} onChange={e=>patch({defaultEffort:e.target.value})}><option value="">服务默认</option>{levels.map(l=><option key={l} value={l}>{l}</option>)}</select></label><p>选择思考档位后，只调度到已确认支持该档位的 Key。</p>
      <div className="work-actions"><button className="primary" disabled={busy||running||!keyCount||!draft.name||!draft.model} onClick={()=>void run(()=>save(true))}>保存并启用模型池</button><button disabled={busy||!draft.name||!draft.model||!draft.members.length} onClick={()=>void run(()=>save(false))}>保存模型池</button>{draft.id&&<button disabled={busy} onClick={()=>{if(window.confirm('删除此模型池？供应商和 Key 会保留。'))void run(async()=>{await api.removePool(draft.id!);setDraft(emptyPool());setDirty(false);await refresh()})}}>删除模型池</button>}</div>
    </section>
    {notice&&<div className="work-notice" role="status">{notice}</div>}
  </div>
}
