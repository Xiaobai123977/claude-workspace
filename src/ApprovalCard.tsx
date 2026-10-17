import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Shield, CircleHelp, ListChecks, Check, X, LoaderCircle } from 'lucide-react'
import type { Approval, ApprovalChoice } from './types'
import './approvals.css'

export function ApprovalCard({ card, sessionId }: { card: Approval; sessionId: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [reason, setReason] = useState('')
  const [selected, setSelected] = useState<Record<string, string[]>>({}), [custom, setCustom] = useState<Record<string, string>>({})
  const asking = card.tool === 'AskUserQuestion', planning = card.tool === 'ExitPlanMode', pending = card.status === 'pending'
  const questions = Array.isArray(card.input.questions) ? card.input.questions : []
  const title = asking ? 'Claude 需要你的回答' : planning ? '确认执行计划' : '允许这次操作吗？'
  const answers = Object.fromEntries(questions.map(q => [q.question, custom[q.question]?.trim() || (q.multiSelect ? selected[q.question] || [] : selected[q.question]?.[0] || '')]))
  const complete = questions.length > 0 && Object.values(answers).every(a => Array.isArray(a) ? a.length > 0 : !!a)
  async function send(choice: ApprovalChoice) {
    if (busy || !pending) return
    setBusy(true); setError('')
    try { await window.workspace.answer(sessionId, card.id, choice) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  if (!pending) return <div className={`approval-resolved ${card.status}`}>
    {card.status === 'approved' ? <Check size={14}/> : <X size={14}/>}
    <span>{asking ? '用户提问' : planning ? '计划确认' : card.tool} · {{ approved: '已确认', denied: '已拒绝', cancelled: '已取消' }[card.status as 'approved' | 'denied' | 'cancelled']}</span>
    {card.answer && <span>{Object.values(card.answer).map(a => Array.isArray(a) ? a.join('、') : a).join('；')}</span>}
    {card.note && <span>{card.note}</span>}
  </div>
  return <section className={`approval-card ${asking ? 'question' : planning ? 'plan' : 'tool'}`} aria-label={title} aria-busy={busy}>
    <header>{asking ? <CircleHelp size={19}/> : planning ? <ListChecks size={19}/> : <Shield size={19}/>}<strong>{title}</strong><span>等待你确认</span></header>
    {!asking && <>
      <div className="approval-description">{card.description || card.tool}</div>
      {planning && typeof card.input.plan === 'string'
        ? <div className="markdown approval-plan"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} onClick={e => { e.preventDefault(); if (href) void window.workspace.openLink(href) }}>{children}</a> }}>{card.input.plan}</ReactMarkdown></div>
        : <pre className="approval-input">{typeof card.input.command === 'string' ? card.input.command : JSON.stringify(card.input, null, 2)}</pre>}
      {card.reason && <p className="approval-reason">{card.reason}</p>}
    </>}
    {asking && questions.map((q, i) => <fieldset key={i} disabled={busy}>
      <legend>{q.question}{q.multiSelect && <small>可多选</small>}</legend>
      {(q.options || []).map((option, j) => <label className={`question-option ${(selected[q.question] || []).includes(option.label) && !custom[q.question]?.trim() ? 'chosen' : ''}`} key={j}>
        <input type={q.multiSelect ? 'checkbox' : 'radio'} name={`${card.id}-${i}`} checked={(selected[q.question] || []).includes(option.label)} onChange={() => {
          setCustom(old => ({ ...old, [q.question]: '' }))
          setSelected(old => ({ ...old, [q.question]: q.multiSelect
            ? (old[q.question] || []).includes(option.label) ? old[q.question].filter(x => x !== option.label) : [...old[q.question] || [], option.label]
            : [option.label] }))
        }}/><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
      </label>)}
      <input className="question-custom" aria-label={`${q.question}：其他回答`} placeholder="或输入你的回答…" maxLength={4000} value={custom[q.question] || ''} onChange={e => { setCustom(old => ({ ...old, [q.question]: e.target.value })); setSelected(old => ({ ...old, [q.question]: [] })) }}/>
    </fieldset>)}
    {asking && !questions.length && <p className="approval-reason">问题格式无法显示，可以拒绝本次提问让 Claude 重新组织。</p>}
    <details className="approval-reject"><summary>补充拒绝原因</summary><textarea aria-label="拒绝原因" value={reason} maxLength={4000} placeholder="告诉 Claude 应如何调整…" onChange={e => setReason(e.target.value)}/></details>
    {card.sessionLabel && <details className="approval-scope"><summary>会话允许的范围</summary><pre>{card.sessionDetail}</pre></details>}
    {error && <p className="approval-error" role="alert">{error}</p>}
    <footer>
      <button disabled={busy} onClick={() => void send({ action: 'deny', reason })}>{asking ? '拒绝本次提问' : planning ? '退回修改' : '拒绝'}</button>
      {!asking && card.sessionLabel && <button disabled={busy} onClick={() => void send({ action: 'allow-session' })}>{card.sessionLabel}</button>}
      <button className="approval-primary" disabled={busy || (asking && !complete)} onClick={() => void send(asking ? { action: 'answer', answers } : { action: 'allow' })}>
        {busy && <LoaderCircle size={14} className="spin"/>}{asking ? '提交回答' : planning ? '批准并继续' : '允许一次'}
      </button>
    </footer>
  </section>
}
