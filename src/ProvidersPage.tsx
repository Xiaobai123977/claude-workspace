import React, { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, LoaderCircle, Plus } from 'lucide-react'
import {EffortSlider} from './EffortSlider'
import type { ModelCapability, ModelVerification, NativeInfo, Provider, ProviderKey, Session } from './types'
const ModelDetails=React.lazy(()=>import('./ModelDetails').then(m=>({default:m.ModelDetails})))
const ModelConfigFiles=React.lazy(()=>import('./ModelConfigFiles').then(m=>({default:m.ModelConfigFiles})))
const ModelPools=React.lazy(()=>import('./ModelPools').then(m=>({default:m.ModelPools})))
const api = window.workspace
const effortLabels: Record<string,string> = { '': '服务默认', none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高' }
const blank = (): Provider => ({ name: '', protocol: 'anthropic', baseUrl: '', auth: 'api-key', models: [], timeout: 120000,weight:1,enabled:true,sticky:true,keys:[{id:'primary',name:'Key 1',weight:1,enabled:true,key:'',models:[]}] })
export function ProvidersPage({session,onDirtyChange}: {session: Session; onDirtyChange?(dirty:boolean):void}) {
  const [items,setItems]=useState<Provider[]>([]), [draft,setDraft]=useState<Provider>(blank), [mode,setMode]=useState<'subscription'|'custom'>(session.providerId?'custom':'subscription')
  const [view,setView]=useState<'providers'|'pools'|'files'>(session.providerId?.startsWith('pool:')?'pools':'providers'),[poolDirty,setPoolDirty]=useState(false),[modelDirty,setModelDirty]=useState(false),[manualKey,setManualKey]=useState('primary'),[modelKey,setModelKey]=useState('')
  const [expanded,setExpanded]=useState<string|null>(null)
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[discovering,setDiscovering]=useState(false),[dirty,setDirty]=useState(false),[loading,setLoading]=useState(true)
  const [headers,setHeaders]=useState('{}'),[extraBody,setExtraBody]=useState('{}'),[query,setQuery]=useState(''),[manual,setManual]=useState(''),[selected,setSelected]=useState('')
  const discoveryVersion=useRef(0),lastDiscovery=useRef(''),draftRef=useRef(draft);draftRef.current=draft
  const running=session.messages.some(m=>m.status==='running')
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setNotice('');try{await fn()}catch(e){setNotice(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  const signature=(p:Provider)=>JSON.stringify([p.id,p.protocol,p.baseUrl,p.auth,(p.keys||[]).map(k=>[k.id,k.key,k.keyEnv,k.hasKey])])
  const install=(p:Provider)=>{discoveryVersion.current++;lastDiscovery.current=p.models.length?signature({...p,key:'',keys:p.keys?.map(k=>({...k,key:''}))}):'';setDraft({...p,key:'',keys:p.keys?.map(k=>({...k,key:''}))});setHeaders(JSON.stringify(p.headers||{},null,2));setExtraBody(JSON.stringify(p.extraBody||{},null,2));setDirty(false);setSelected(p.defaultModel||p.models[0]?.id||'');setNotice('')}
  useEffect(()=>{let mounted=true;void run(async()=>{const all=await api.providers();if(!mounted)return;setItems(all);const p=all.find(p=>p.id===session.providerId)||all[0];if(p)install(p)}).finally(()=>{if(mounted)setLoading(false)});return()=>{mounted=false}},[])
  useEffect(()=>{onDirtyChange?.(dirty||poolDirty||modelDirty)},[dirty,poolDirty,modelDirty])
  useEffect(()=>{
    let active=true
    const refresh=()=>{void api.providers().then(all=>{if(active)setItems(all)}).catch(e=>{if(active)setNotice(e instanceof Error?e.message:String(e))})}
    window.addEventListener('focus',refresh);window.addEventListener('providers:changed',refresh)
    return()=>{active=false;window.removeEventListener('focus',refresh);window.removeEventListener('providers:changed',refresh)}
  },[])

  const patch=(p:Partial<Provider>)=>{setDraft(d=>({...d,...p}));setDirty(true)}
  const input=():Provider=>({...draftRef.current,name:draftRef.current.name.trim()||'自定义 API',headers:JSON.parse(headers),extraBody:JSON.parse(extraBody)})
  const changeConnection=(p:Partial<Provider>)=>{discoveryVersion.current++;const reset='baseUrl' in p||'protocol' in p;patch({...p,...(reset?{models:[],defaultModel:'',keys:(draft.keys||[]).map(k=>({...k,models:[],checkedAt:undefined,checkError:undefined}))}:{})});if(reset)setSelected('')}
  const patchKey=(id:string,p:Partial<ProviderKey>)=>{
    const reset='key' in p||'keyEnv' in p
    const keys=(draft.keys||[]).map(k=>k.id===id?{...k,...p,...(reset?{models:k.models.filter(m=>Object.keys(m.overrides||{}).length||m.request||m.source==='manual'||m.source==='import').map(m=>{const kept={...m,reported:{},source:'manual',detected:false,verification:undefined,fetchedAt:undefined};for(const field of ['context','output','vision','tools','thinking','efforts'])(kept as Record<string,unknown>)[field]=kept.overrides?.[field]??undefined;return kept}),checkedAt:undefined,checkError:undefined}:{})}:k)
    patch({keys})
  }
  const setViewSafely=(next:'providers'|'pools'|'files')=>{if(next===view)return;if((dirty||poolDirty||modelDirty)&&!window.confirm('放弃当前未保存的修改并切换？'))return;if(dirty){const saved=items.find(p=>p.id===draft.id);install(saved||blank())}setPoolDirty(false);setModelDirty(false);setExpanded(null);setView(next)}
  const discover=async(keyId?:string)=>{
    const version=++discoveryVersion.current,sig=signature(draftRef.current);lastDiscovery.current=sig;setDiscovering(true);setNotice('')
    try{const r=await api.discoverModels(input(),keyId);if(version!==discoveryVersion.current||sig!==signature(draftRef.current))return
      setDraft(d=>{const models=r.models;const keys=r.keys?(d.keys||[]).map(k=>({...k,...r.keys!.find(x=>x.id===k.id),key:k.key})):d.keys;return {...d,models,keys,defaultModel:models.some(m=>m.id===d.defaultModel&&m.enabled!==false)?d.defaultModel:models.find(m=>m.enabled!==false)?.id||''}});setDirty(true);setNotice(`已读取 ${r.models.length} 个模型。${r.errors?.length?`${r.errors.length} 个 Key 检测失败，保留其上次结果。`:keyId?'此 Key 已独立检测。':'各 Key 的检测结果已分别更新。'}勾选要在聊天中显示的模型。`)
    }catch(e){if(version===discoveryVersion.current)setNotice(e instanceof Error?e.message:String(e))}finally{if(version===discoveryVersion.current)setDiscovering(false)}
  }
  const connectionSignature=signature(draft)
  useEffect(()=>{
    discoveryVersion.current++;setDiscovering(false)
    if(!expanded||mode!=='custom'||view!=='providers'||lastDiscovery.current===connectionSignature||!draft.baseUrl||!(draft.keys||[]).some(k=>k.enabled!==false&&(k.key||k.hasKey||draft.auth==='none'||draft.auth==='env'&&k.keyEnv)))return
    try{const url=new URL(draft.baseUrl);if(!['http:','https:'].includes(url.protocol))return}catch{return}
    const timer=setTimeout(()=>void discover(),700);return()=>{clearTimeout(timer);discoveryVersion.current++}
  },[connectionSignature,mode,view,expanded])
  const toggleCard=(p?:Provider)=>{
    if(busy||discovering)return
    if((dirty||modelDirty||poolDirty)&&!window.confirm('放弃当前尚未保存的修改？'))return
    const id=p?.id||'new'
    const closing=expanded===id&&mode==='custom'&&view==='providers'
    install(p||blank());setModelDirty(false);setPoolDirty(false);setQuery('');setManual('');setModelKey('');setExpanded(closing?null:id);setMode('custom');setView('providers')
  }
  const selectedModel=draft.models.find(m=>m.id===selected)
  const modelKeys=(draft.keys||[]).filter(k=>k.models.some(m=>m.id===selected))
  const capabilityKey=modelKeys.find(k=>k.id===modelKey)||modelKeys[0]
  const target=capabilityKey?.models.find(m=>m.id===selected)||selectedModel
  const modelPatch=(p:Partial<ModelCapability>)=>{
    if(Object.keys(p).every(k=>k==='defaultEffort')){patch({models:draft.models.map(m=>m.id===selected?{...m,...p}:m)});return}
    const capFields=['context','output','vision','tools','thinking','efforts']
    const changedCapability=Object.keys(p).some(k=>capFields.includes(k))
    const keys=(draft.keys||[]).map(k=>k.id===capabilityKey?.id?{...k,models:k.models.map(m=>{
      if(m.id!==selected)return m
      const overrides=p.overrides??{...m.overrides,...Object.fromEntries(Object.entries(p).filter(([k])=>capFields.includes(k)).map(([k,v])=>[k,v??null]))}
      const next={...m,...p,overrides,source:Object.keys(overrides).length?'manual':'server',verification:changedCapability||p.request||p.overrides?undefined:p.verification??m.verification}
      for(const field of capFields){const value=Object.hasOwn(overrides,field)?overrides[field]:next.reported?.[field]??(!Object.hasOwn(m.overrides||{},field)?(m as Record<string,unknown>)[field]:undefined);(next as Record<string,unknown>)[field]=value??undefined}
      return next
    })}:k)
    const combined=draft.models.map(m=>{const variants=keys.flatMap(k=>k.models.filter(x=>x.id===m.id&&!x.stale)),levels=[...new Set(variants.flatMap(m=>m.efforts||[]))];return {...m,efforts:levels.length?levels:undefined,defaultEffort:levels.includes(m.defaultEffort||'')?m.defaultEffort:undefined}})
    patch({keys,models:combined})
  }
  const recordVerification=(providerId:string|undefined,keyId:string,modelId:string,result:ModelVerification)=>{
    if(draftRef.current.id!==providerId)return
    setDraft(d=>d.id!==providerId?d:({...d,keys:d.keys?.map(k=>k.id===keyId?{...k,models:k.models.map(m=>m.id===modelId?{...m,verification:{...m.verification,[result.kind]:result}}:m)}:k)}));setDirty(true)
  }
  const toggleModel=(id:string,enabled:boolean)=>{const models=draft.models.map(m=>m.id===id?{...m,enabled}:m);patch({models,defaultModel:models.some(m=>m.id===draft.defaultModel&&m.enabled!==false)?draft.defaultModel:models.find(m=>m.enabled!==false)?.id||''})}
  const save=async(activate=false)=>{const p=await api.saveProvider(input());install(p);setExpanded(p.id!);setItems(await api.providers());window.dispatchEvent(new Event('providers:changed'));if(activate)await api.activateProvider(session.id,p.id!);setNotice(activate?'已启用自定义 API，应用于当前聊天和新聊天':'连接已保存，凭证已加密')}
  const useSubscription=()=>{if((dirty||poolDirty||modelDirty)&&!window.confirm('放弃当前尚未保存的连接修改？'))return;void run(async()=>{await api.activateProvider(session.id,'');if(dirty)install(items.find(p=>p.id===draft.id)||blank());setDirty(false);setPoolDirty(false);setModelDirty(false);setExpanded(null);setMode('subscription');setNotice('已切换到 Claude 订阅')})}
  const visible=draft.models.filter(m=>m.enabled!==false)
  const editor=<div className="provider-card-body" id="provider-editor">
      <section className="work-card"><h2>连接配置</h2>{draft.id&&<p className="provider-saved-state" role="status">{dirty?'有未保存的修改；上次保存的连接仍保留在本机。':`已保存在本机${draft.hasKey?' · API Key 已加密保存，留空会保留':''}`}</p>}
        <label>连接名称<input value={draft.name} onChange={e=>patch({name:e.target.value})} placeholder="自定义 API（可选名称）"/></label>
        <label>接口协议<select aria-label="接口协议" value={draft.protocol} onChange={e=>changeConnection({protocol:e.target.value as Provider['protocol'],auth:e.target.value==='anthropic'?'api-key':'bearer',thinking:'inherit',thinkingBudget:undefined})}><option value="anthropic">Anthropic Messages</option><option value="chat">OpenAI Chat Completions</option><option value="responses">OpenAI Responses</option></select></label>
        <label>API 地址<input value={draft.baseUrl} onChange={e=>changeConnection({baseUrl:e.target.value})} placeholder="https://example.com/v1"/></label>
        <div className="key-section-heading"><h3>API Keys</h3><button disabled={busy||(draft.keys?.length||0)>=100} onClick={()=>patch({keys:[...(draft.keys||[]),{id:crypto.randomUUID(),name:`Key ${(draft.keys?.length||0)+1}`,weight:1,enabled:true,key:'',models:[]}]})}>添加 Key</button></div>
        <p>每个 Key 独立获取模型目录。权重只影响同一供应商内的分配；供应商之间按上面的供应商权重分配。</p>
        {(draft.keys||[]).map((key,index)=><div className="provider-key-card" key={key.id}><header><strong>{key.name}</strong><span>{key.checkedAt&&key.checkedAt>1?`${key.models.filter(m=>m.detected&&!m.stale).length} 个模型 · 已独立检测`:key.models.length?`${key.models.length} 个手动 / 旧版模型 · 待复查`:'尚未检测'}</span></header>
          <div className="key-row"><label>Key 名称<input aria-label={`Key ${index+1} 名称`} value={key.name} onChange={e=>patchKey(key.id,{name:e.target.value})}/></label><label>Key 权重<input aria-label={`Key ${index+1} 权重`} type="number" min="1" max="1000" value={key.weight||1} onChange={e=>patchKey(key.id,{weight:Number(e.target.value)})}/></label><label>启用<input aria-label={`启用 Key ${index+1}`} type="checkbox" checked={key.enabled!==false} onChange={e=>patchKey(key.id,{enabled:e.target.checked})}/></label></div>
          {draft.auth!=='none'&&<label>{draft.auth==='env'?'环境变量':'API Key'}<input aria-label={index===0?(draft.auth==='env'?'API Key 环境变量':'API Key'):`Key ${index+1} ${draft.auth==='env'?'环境变量':'API Key'}`} type={draft.auth==='env'?'text':'password'} autoComplete="off" value={draft.auth==='env'?key.keyEnv||'':key.key||''} onChange={e=>patchKey(key.id,draft.auth==='env'?{keyEnv:e.target.value}:{key:e.target.value})} placeholder={key.hasKey?'已加密保存；留空保留':'填写此 Key'}/></label>}
          <div className="work-actions"><button aria-label={`检测 Key ${index+1} 模型`} disabled={busy||discovering||!draft.baseUrl} onClick={()=>void discover(key.id)}>检测此 Key</button>{(draft.keys?.length||0)>1&&<button aria-label={`移除 Key ${index+1}`} onClick={()=>patch({keys:draft.keys?.filter(k=>k.id!==key.id)})}>移除</button>}<small>{key.checkedAt?new Date(key.checkedAt).toLocaleString():'模型目录未知，不自动参与模型池'}</small></div>
          {key.checkError&&<p role="status">上次检测失败：{key.checkError}；已保留先前成功结果。</p>}
          {!!key.models.length&&<details><summary>此 Key 的模型目录 · {key.models.length}</summary><div className="key-model-list">{key.models.map(m=><div key={m.id}><span>{m.id}</span><small>{m.stale?'目录已移除':m.efforts?.join(' / ')||'思考档位未知'}</small></div>)}</div></details>}
        </div>)}
        <details className="work-nested"><summary>供应商路由与分配</summary>        <label>供应商权重<input aria-label="供应商权重" type="number" min="1" max="1000" value={draft.weight||1} onChange={e=>patch({weight:Number(e.target.value)})}/></label><label>启用供应商<input aria-label="启用供应商" type="checkbox" checked={draft.enabled!==false} onChange={e=>patch({enabled:e.target.checked})}/></label>
        <label>同一聊天优先复用 Key<input aria-label="供应商 Key 粘性路由" type="checkbox" checked={draft.sticky!==false} onChange={e=>patch({sticky:e.target.checked})}/></label>
<p>权重、启停和粘性路由作用于此供应商；不同模型 ID 的合并在“模型服务池”中设置。</p></details>
        <div className="work-actions"><span className="provider-hint">{discovering?<><LoaderCircle size={14} className="spin"/>正在自动获取模型…</>:'填写连接信息后自动读取模型列表'}</span><button disabled={busy||discovering||!draft.baseUrl} onClick={()=>void discover()}>获取模型列表</button></div>
      </section>
      <section className="work-card"><h2>聊天中显示的模型 <small>{visible.length} / {draft.models.length}</small></h2><p>仅勾选的模型会出现在当前连接的聊天菜单中。点击模型配置思考档位。</p>
        <details className="work-nested"><summary>手动添加模型</summary><label>手动模型归属 Key<select value={manualKey} onChange={e=>setManualKey(e.target.value)}>{draft.keys?.map(k=><option key={k.id} value={k.id}>{k.name}</option>)}</select></label><div className="work-actions"><input aria-label="手动模型 ID" placeholder="手动输入模型 ID" value={manual} onChange={e=>setManual(e.target.value)}/><button onClick={()=>{const id=manual.trim();if(id){const keyId=draft.keys?.some(k=>k.id===manualKey)?manualKey:draft.keys?.[0]?.id;if(draft.keys?.find(k=>k.id===keyId)?.models.some(m=>m.id===id)){setSelected(id);setModelKey(keyId||'');setNotice('此 Key 已有该模型，可直接编辑其能力');return}patch({models:draft.models.some(m=>m.id===id)?draft.models:[...draft.models,{id,source:'manual',enabled:true,detected:false}],keys:draft.keys?.map((k,i)=>k.id===(draft.keys?.some(k=>k.id===manualKey)?manualKey:draft.keys?.[0]?.id)?{...k,models:[...k.models.filter(m=>m.id!==id),{id,source:'manual',enabled:true,detected:false}],checkedAt:k.checkedAt}:k),defaultModel:draft.defaultModel||id});setSelected(id);setModelKey(keyId||'');setManual('')}}}>添加模型</button></div></details>
        <label>搜索模型<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="名称或模型 ID"/></label>
        <div className="model-inventory">{draft.models.filter(m=>(m.id+(m.name||'')).toLowerCase().includes(query.toLowerCase())).map(m=><div key={m.id} className={selected===m.id?'selected':''}><input type="checkbox" aria-label={`显示模型 ${m.id}`} checked={m.enabled!==false} onChange={e=>toggleModel(m.id,e.target.checked)}/><button onClick={()=>{if(modelDirty&&!window.confirm('放弃尚未应用的模型 JSON？'))return;setSelected(m.id)}}>{m.name||m.id}<small>{m.id}{m.stale?' · 目录已移除':''} · {(draft.keys||[]).filter(k=>k.enabled!==false&&k.models.some(x=>x.id===m.id&&!x.stale)).length} 个 Key · {m.efforts?.length?m.efforts.map(e=>effortLabels[e]||e).join(' / '):'思考档位未知'}</small></button><button title="移除模型" onClick={()=>{const models=draft.models.filter(x=>x.id!==m.id);if(selected===m.id)setSelected(models[0]?.id||'');patch({models,keys:draft.keys?.map(k=>({...k,models:k.models.filter(x=>x.id!==m.id)})),defaultModel:draft.defaultModel===m.id?models.find(x=>x.enabled!==false)?.id||'':draft.defaultModel})}}>×</button></div>)}</div>
        {!draft.models.length&&<p>尚无模型。自动获取成功后会在这里显示；不提供模型目录的服务可在高级设置中手动添加。</p>}
        <label>默认模型<select aria-label="新聊天默认模型" value={draft.defaultModel||''} onChange={e=>patch({defaultModel:e.target.value})}><option value="">请选择</option>{visible.map(m=><option key={m.id} value={m.id}>{m.name||m.id}</option>)}</select></label>
        {target&&<div className="work-nested model-effort-editor"><h3>{target.name||target.id}</h3>{modelKeys.length>1&&<label>能力设置归属 Key<select aria-label="能力设置归属 Key" value={capabilityKey?.id||''} onChange={e=>{if(modelDirty&&!window.confirm('放弃尚未应用的模型 JSON？'))return;setModelKey(e.target.value)}}>{modelKeys.map(k=><option key={k.id} value={k.id}>{k.name}</option>)}</select></label>}<p>能力属于上面选中的 Key，修改不会覆盖其他 Key。供应商模型的默认档位从所有已确认档位中选择，路由时会排除不支持的 Key。</p><div className="effort-checkboxes">{Object.entries(effortLabels).filter(([e])=>e).map(([e,label])=><label key={e}><input type="checkbox" aria-label={`${target.id} 支持 ${e}`} checked={target.efforts?.includes(e)||false} onChange={event=>{const efforts=event.target.checked?[...(target.efforts||[]),e]:(target.efforts||[]).filter(x=>x!==e);modelPatch({efforts:efforts.length?efforts:undefined,defaultEffort:efforts.includes(target.defaultEffort||'')?target.defaultEffort:undefined})}}/>{label}</label>)}</div>
        <label>默认思考强度<select aria-label="此模型默认思考强度" value={selectedModel?.defaultEffort||''} onChange={e=>modelPatch({defaultEffort:e.target.value||undefined})}><option value="">服务默认</option>{selectedModel?.efforts?.map(e=><option key={e} value={e}>{effortLabels[e]||e}</option>)}</select></label>
        <details><summary>高级模型能力</summary><p>手动声明不会让模型获得新能力。</p>{(['context','output'] as const).map(k=><label key={k}>{k==='context'?'上下文 token 容量':'最大输出 token'}<input type="number" min="1" value={target[k]||''} onChange={e=>modelPatch({[k]:e.target.value?Number(e.target.value):undefined})}/></label>)}{(['vision','tools','thinking'] as const).map(k=><label key={k}>{{vision:'图片输入',tools:'工具调用',thinking:'思考'}[k]}<select value={target[k]==null?'':String(target[k])} onChange={e=>modelPatch({[k]:e.target.value===''?undefined:e.target.value==='true'})}><option value="">未知</option><option value="true">支持</option><option value="false">不支持</option></select></label>)}<label>常用模型<input type="checkbox" checked={!!target.favorite} onChange={e=>modelPatch({favorite:e.target.checked})}/></label></details>{capabilityKey&&<React.Suspense fallback={<p>正在读取模型详情…</p>}><ModelDetails key={capabilityKey.id+':'+target.id} model={target} keyId={capabilityKey.id} getInput={input} connectionSignature={JSON.stringify([draft.baseUrl,draft.protocol,draft.auth,headers,extraBody,draft.timeout,draft.thinking,draft.thinkingBudget,selectedModel?.defaultEffort,(draft.keys||[]).map(k=>[k.id,k.key,k.keyEnv])])} onChange={modelPatch} onVerification={recordVerification} onDirtyChange={setModelDirty}/></React.Suspense>}</div>}
      </section>
      <section className="work-card">
      <details className="work-nested"><summary>高级连接设置</summary><label>认证方式<select value={draft.auth} onChange={e=>changeConnection({auth:e.target.value as Provider['auth']})}><option value="api-key">x-api-key</option><option value="bearer">Bearer Token</option><option value="env">读取环境变量（Bearer）</option><option value="none">无认证</option></select></label><p>思考模式、预算和输出字段在每个模型的详情中配置。已有连接默认值继续继承。</p><label>请求总超时（秒）<input type="number" min="10" max="3600" value={(draft.timeout || 120000) / 1000} onChange={e => patch({timeout: Number(e.target.value) * 1000})}/></label><label>协议兼容参数 JSON（最后合并）<textarea value={extraBody} onChange={e=>{setExtraBody(e.target.value);setDirty(true)}}/></label><p>专家选项；不能覆盖模型、消息、工具、流或输出限制。</p><label>附加请求头 JSON（不要填写凭证）<textarea value={headers} onChange={e => {setHeaders(e.target.value); setDirty(true)}}/></label></details>
      <div className="work-actions"><button className="primary" disabled={busy||discovering||modelDirty||running||!draft.defaultModel} onClick={()=>void run(()=>save(true))}>保存并启用自定义 API</button><button disabled={busy||discovering||modelDirty} onClick={()=>void run(()=>save())}>{dirty?'保存修改':'保存连接'}</button>{draft.id&&<button disabled={busy} onClick={()=>{if(window.confirm('删除此连接？'))void run(async()=>{await api.removeProvider(draft.id!);const all=await api.providers();setItems(all);install(blank());setExpanded(null)})}}>删除连接</button>}</div>
      </section>
  </div>
  const cards=<>
    <section className="saved-provider-list" aria-label="已保存的供应商">
      <header className="provider-list-heading"><h2>已保存的供应商 <small>{items.length}</small></h2><button className="provider-refresh" disabled={busy||discovering} onClick={()=>void run(async()=>{setItems(await api.providers());setNotice('已重新读取本机供应商列表')})}>刷新列表</button></header>
      {!items.length&&<p className="provider-empty">暂无已保存的供应商，可展开下方卡片添加。</p>}
      {items.map(p=>{const open=expanded===p.id&&mode==='custom'&&view==='providers';return <article key={p.id} className={'provider-accordion'+(open?' expanded':'')}>
        <button className="provider-card-toggle" aria-expanded={open} aria-controls={open?'provider-editor':undefined} disabled={busy||discovering} onClick={()=>toggleCard(p)}><span><strong>{p.name}</strong><small>{p.models.length} 个模型 · {p.keys?.length||1} 个 Key{p.enabled===false?' · 已停用':''}</small></span><span className="provider-card-state">{session.providerId===p.id&&<small className="provider-active">当前聊天使用</small>}{open&&(dirty||modelDirty)&&<small>未保存</small>}<ChevronDown size={17}/></span></button>
        {open&&editor}
      </article>})}
    </section>
    <article className={'provider-accordion provider-add-card'+(expanded==='new'?' expanded':'')}>
      <button className="provider-card-toggle" aria-expanded={expanded==='new'} aria-controls={expanded==='new'?'provider-editor':undefined} disabled={busy||discovering} onClick={()=>toggleCard()}><span><strong><Plus size={17}/>添加新的供应商</strong><small>配置 API 地址、协议和密钥</small></span><ChevronDown size={17}/></button>
      {expanded==='new'&&editor}
    </article>
  </>
  return <div className="provider-settings">
    <div className="source-options" role="group" aria-label="模型接入方式">
      <button className={mode==='subscription'?'selected':''} disabled={busy} onClick={()=>{if(mode==='subscription')return;if((dirty||poolDirty||modelDirty)&&!window.confirm('放弃当前尚未保存的连接修改？'))return;install(items.find(p=>p.id===draft.id)||blank());setPoolDirty(false);setModelDirty(false);setExpanded(null);setMode('subscription')}}><strong>Claude 订阅</strong><span>使用本机 Claude 订阅登录</span>{!session.providerId&&<small>当前已激活</small>}</button>
      <button className={mode==='custom'?'selected':''} disabled={busy||loading} onClick={()=>setMode('custom')}><strong>自定义 API</strong><span>填写 API Key、URL，选择接口协议</span>{session.providerId?<small>当前已激活 · 已保存 {items.length} 个连接</small>:items.length>0&&<small>已保存 {items.length} 个连接</small>}</button>
    </div>
    {notice&&<div className="work-notice" role="status">{notice}</div>}

    {loading?<div className="work-notice" role="status">正在读取已保存的连接…</div>:mode==='subscription'?<section className="work-card"><h2>Claude 订阅</h2><p>使用本机 Claude Code 的订阅登录。聊天模型菜单仅显示 Claude 原生模型。</p><button disabled={busy||running||!session.providerId} onClick={useSubscription}>{session.providerId?'启用 Claude 订阅':'已使用 Claude 订阅'}</button><p>可在“常规”检查安装和登录；订阅模式会隔离 API Key、网关地址与模型别名覆盖；权限、规则与其他项目配置继续加载。</p></section>:<>
      <div className="routing-tabs" role="group" aria-label="自定义 API 管理分类"><button className={view==='providers'?'selected':''} onClick={()=>setViewSafely('providers')}>供应商与 Key</button><button className={view==='pools'?'selected':''} onClick={()=>setViewSafely('pools')}>模型服务池</button><button className={view==='files'?'selected':''} onClick={()=>setViewSafely('files')}>导入、导出与备份</button></div>
      {view==='files'?<React.Suspense fallback={<p>正在读取配置文件…</p>}><ModelConfigFiles onChanged={async()=>{const all=await api.providers();setItems(all);install(all.find(p=>p.id===draft.id)||all[0]||blank())}}/></React.Suspense>:view==='pools'?<React.Suspense fallback={<p>正在读取模型池…</p>}><ModelPools session={session} onDirtyChange={setPoolDirty}/></React.Suspense>:<>
      {cards}
      </>}
    </>}
    {!loading&&mode==='subscription'&&cards}
  </div>
}
export function ModelPicker({session,running,onChange,onManage}: {session:Session;running:boolean;onChange(p:Partial<Session>):Promise<void>;onManage():void}) {
  const [imageInput,setImageInput]=useState<{key:string;enabled:boolean}|null>(null),[savingImageInput,setSavingImageInput]=useState(false)
  const [provider,setProvider]=useState<Provider|null>(null),[info,setInfo]=useState<NativeInfo>({}),[issue,setIssue]=useState(''),[loading,setLoading]=useState(true)
  const load=async()=>{setLoading(true);setIssue('');try{if(session.providerId){const p=(await api.connections()).find(p=>p.id===session.providerId);setProvider(p||null);setInfo({});if(!p)setIssue('当前连接已删除，请在设置中重新启用。')}else{setProvider(null);setInfo(await api.nativeModels(session.id))}}catch(e){setIssue(e instanceof Error?e.message:String(e))}finally{setLoading(false)}}
  useEffect(()=>{void load()},[session.id,session.providerId])
  useEffect(()=>{let active=true;setImageInput(null);void api.modelImageInput(session.id).then(value=>{if(active)setImageInput(value)}).catch(e=>{if(active)setIssue(String(e))});return()=>{active=false}},[session.id,session.providerId,session.model])
  const changeImageInput=async(enabled:boolean)=>{if(!imageInput)return;const previous=imageInput;setImageInput({...previous,enabled});setSavingImageInput(true);try{setImageInput(await api.modelImageInput(session.id,previous.key,enabled))}catch(e){setImageInput(previous);setIssue(String(e))}finally{setSavingImageInput(false)}}
  const models:ModelCapability[]=session.providerId?(provider?.models||[]).filter(m=>m.enabled!==false):(info.models||[]).map(m=>({id:m.value,name:m.displayName,efforts:m.supportedEffortLevels,source:'cli'}))
  const selectedId=session.model||provider?.defaultModel||'default',selected=models.find(m=>m.id===selectedId)
  const levels=(selected?.efforts||[]).filter(e=>session.providerId||!['none','minimal'].includes(e))
  const choose=(patch:Partial<Session>)=>void onChange(patch).catch(e=>setIssue(String(e)))
  return <div className="model-picker"><header className="model-picker-heading"><div><strong>{session.providerId?(provider?.isPool?'模型服务池':'自定义 API'):'Claude 订阅'}</strong><small>{session.providerId?provider?.isPool?`${provider.name} · ${provider.providerCount} 个供应商 / ${provider.keyCount} 个 Key`:provider?.name||'连接不可用':'使用订阅登录'}</small></div><button onClick={onManage}>接入设置</button></header>
    <div className="picker-models" role="group" aria-label="当前接入可用模型">{loading?<p>正在读取模型…</p>:models.map(m=><button disabled={running} key={m.id} className={selectedId===m.id?'chosen':''} onClick={()=>choose({model:m.id==='default'?'':m.id,effort:''})}><span>{m.name||m.id}<small>{m.id}</small></span>{selectedId===m.id&&<Check size={15}/>}</button>)}</div>
    {!loading&&!models.length&&<p>没有已启用的模型，请在接入设置中配置。</p>}
    {session.model&&!selected&&!loading&&<p>此前选择的模型已不在当前可用列表，请重新选择。</p>}
    <div className="picker-effort"><small>思考强度{selected?' · '+(selected.name||selected.id):''}</small><EffortSlider key={session.id+':'+selectedId} levels={levels} value={session.effort||''} labels={effortLabels} defaultLabel={selected?.defaultEffort?`模型默认 · ${effortLabels[selected.defaultEffort]||selected.defaultEffort}`:'服务默认'} disabled={running||!selected} onChange={effort=>onChange({effort})} onError={setIssue}/>{selected&&!levels.length&&<p>未提供可选档位，使用服务默认。</p>}</div>
    <div className="picker-effort picker-image-input"><label><span>接受图片输入</span><input type="checkbox" checked={imageInput?.enabled??false} disabled={running||loading||!selected||!imageInput||savingImageInput} onChange={e=>void changeImageInput(e.target.checked)}/></label><small>关闭后，提示模型不要读取图片。附件始终只传文件路径。</small></div>
    <button disabled={loading} onClick={()=>{void load();void api.modelImageInput(session.id).then(setImageInput).catch(e=>setIssue(String(e)))}}>刷新可选模型</button>{issue&&<p role="alert">{issue}</p>}
  </div>
}
export function ModelButton({session,onClick}: {session:Session;onClick():void}) {
  const [provider,setProvider]=useState<Provider|null>(null)
  useEffect(()=>{let active=true;const load=()=>{void api.connections().then(all=>{if(active)setProvider(all.find(p=>p.id===session.providerId)||null)}).catch(()=>{})};load();window.addEventListener('providers:changed',load);return()=>{active=false;window.removeEventListener('providers:changed',load)}},[session.providerId,session.model])
  const id=session.model||provider?.defaultModel,model=provider?.models.find(m=>m.id===id)
  return <button className="model-button" title="模型与推理强度" aria-label="模型与推理强度" onClick={onClick}><span className="model-source-label">{session.providerId?(provider?.isPool?'模型池':'自定义'):'订阅'}</span><span>{model?.name||id||(session.providerId?'选择模型':'Claude 默认')}</span><span className="muted">{session.effort?effortLabels[session.effort]||session.effort:model?.defaultEffort?`默认 · ${effortLabels[model.defaultEffort]||model.defaultEffort}`:'默认'}</span><ChevronDown size={12}/></button>
}
