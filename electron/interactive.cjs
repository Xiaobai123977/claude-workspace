const crypto = require('node:crypto')
const { JsonLines } = require('./stream.cjs')

// Permission policy stays in the CLI. The renderer can only answer a live request;
// it cannot supply tool input, arbitrary rules, or persistent permission updates.
function sessionSuggestions(request) {
  if (request.suppress_always_allow_rule || request.suppressAlwaysAllowRule) return []
  const candidates = (request.permission_suggestions || []).filter(s =>
    (s.type === 'addRules' && s.behavior === 'allow' && Array.isArray(s.rules) && s.rules.length) ||
    (s.type === 'addDirectories' && Array.isArray(s.directories) && s.directories.length) ||
    (s.type === 'setMode' && s.mode === 'acceptEdits')
  )
  // Suggestions can be alternative scopes. Pick one native suggestion rather
  // than granting every alternative at once, preferring a tool-specific rule.
  const selected = candidates.find(s => s.type === 'addRules') || candidates.find(s => s.type === 'addDirectories') || candidates[0]
  return selected ? [{ ...selected, destination: 'session' }] : []
}

class InteractiveSession {
  constructor(child, { onEvent = () => {}, onClose = () => {}, onDiagnostic = () => {}, terminate, requestTimeout = 20000 } = {}) {
    this.child = child; this.onEvent = onEvent; this.onClose = onClose; this.onDiagnostic = onDiagnostic
    this.terminate = terminate; this.requestTimeout = requestTimeout
    this.pending = new Map(); this.controls = new Map(); this.closed = false; this.closing = false
    const parser = new JsonLines(e => this.consume(e), raw => onDiagnostic(raw))
    child.stdout.on('data', chunk => parser.push(chunk))
    child.stderr.on('data', chunk => onDiagnostic(chunk.toString('utf8')))
    child.stdin.on('error', error => { if (!this.closing) onDiagnostic(`输入传输失败：${error.message}`) })
    child.on('error', error => onDiagnostic(`无法启动 Claude：${error.message}`))
    child.on('close', code => {
      parser.end(); this.closed = true; clearTimeout(this.killTimer)
      for (const { reject, timer } of this.controls.values()) { clearTimeout(timer); reject(new Error('Claude 连接已关闭')) }
      this.controls.clear(); this.pending.clear(); onClose(code)
    })
  }
  write(event) {
    if (this.closed || this.closing || this.child.stdin.destroyed || this.child.stdin.writableEnded) throw new Error('Claude 连接已关闭，请重新发送消息')
    this.child.stdin.write(JSON.stringify(event) + '\n')
  }
  consume(event) {
    if (event.type === 'control_response') {
      const entry = this.controls.get(event.response?.request_id)
      if (entry) {
        clearTimeout(entry.timer); this.controls.delete(event.response.request_id)
        if (event.response.subtype === 'success') entry.resolve(event.response.response)
        else entry.reject(new Error(event.response.error || 'Claude 控制请求失败'))
      }
      return
    }
    if (event.type === 'control_request') {
      if (event.request?.subtype === 'can_use_tool') this.pending.set(event.request_id, event.request)
      else {
        this.write({ type: 'control_response', response: { subtype: 'error', request_id: event.request_id, error: 'Unsupported host request' } })
        return
      }
    }
    if (event.type === 'control_cancel_request') this.pending.delete(event.request_id)
    this.onEvent(event)
  }
  request(request) {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.controls.delete(id); reject(new Error('Claude 控制请求超时')) }, this.requestTimeout)
      this.controls.set(id, { resolve, reject, timer })
      try { this.write({ type: 'control_request', request_id: id, request }) }
      catch (e) { clearTimeout(timer); this.controls.delete(id); reject(e) }
    })
  }
  initialize() { return this.request({ subtype: 'initialize', hooks: {} }) }
  answer(id, choice) {
    const request = this.pending.get(id)
    if (!request) throw new Error('此请求已结束或取消，请查看最新消息')
    if (!choice || typeof choice !== 'object') throw new Error('审批答案无效')
    let response
    if (choice.action === 'deny') {
      if (choice.reason != null && (typeof choice.reason !== 'string' || choice.reason.length > 4000)) throw new Error('拒绝原因过长')
      response = { behavior: 'deny', message: choice.reason?.trim() || '用户拒绝了此操作，请停止该操作或调整方案。' }
    } else if (choice.action === 'answer' && request.tool_name === 'AskUserQuestion') {
      const questions = request.input?.questions
      if (!Array.isArray(questions) || !questions.length) throw new Error('问题格式无效，可拒绝本次提问')
      const answers = {}
      for (const q of questions) {
        const value = choice.answers?.[q.question]
        const values = Array.isArray(value) ? value : [value]
        if (!values.length || values.some(v => typeof v !== 'string' || !v.trim() || v.length > 4000) || (!q.multiSelect && values.length > 1)) throw new Error('请回答所有问题')
        answers[q.question] = Array.isArray(value) ? values : value
      }
      response = { behavior: 'allow', updatedInput: { ...request.input, answers } }
    } else if (['allow', 'allow-session'].includes(choice.action) && request.tool_name !== 'AskUserQuestion') {
      response = { behavior: 'allow', updatedInput: request.input }
      if (choice.action === 'allow-session') {
        const suggestions = sessionSuggestions(request)
        if (!suggestions.length || request.tool_name === 'ExitPlanMode') throw new Error('此请求需要单独确认')
        response.updatedPermissions = suggestions
      }
    } else throw new Error('此请求不支持该操作')
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: id, response } })
    this.pending.delete(id)
    return { request, response }
  }
  close(force = false) {
    if (this.closed || this.closing) return
    this.closing = true; this.pending.clear()
    if (force) this.terminate(this.child)
    else { this.child.stdin.end(); this.killTimer = setTimeout(() => this.terminate(this.child), 5000) }
  }
}
module.exports = { InteractiveSession, sessionSuggestions }
