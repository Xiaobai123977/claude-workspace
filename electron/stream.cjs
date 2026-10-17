const { StringDecoder } = require('node:string_decoder')
const {normalizeUsage,mergeUsage,sumUsage}=require('./token-usage.cjs')

// A data chunk is neither a JSON record nor necessarily a whole UTF-8 character.
class JsonLines {
  constructor(consume, diagnostic = () => {}) {
    this.consume = consume; this.diagnostic = diagnostic
    this.decoder = new StringDecoder('utf8'); this.buffer = ''
  }
  push(chunk) { this.buffer += this.decoder.write(chunk); this.drain() }
  drain() {
    let at
    while ((at = this.buffer.indexOf('\n')) >= 0) {
      this.line(this.buffer.slice(0, at)); this.buffer = this.buffer.slice(at + 1)
    }
  }
  line(raw) {
    if (!raw.trim()) return
    try { this.consume(JSON.parse(raw)) } catch (error) { this.diagnostic(raw, error) }
  }
  end() { this.buffer += this.decoder.end(); this.drain(); this.line(this.buffer); this.buffer = '' }
}

const textContent = value => typeof value === 'string' ? value : Array.isArray(value)
  ? value.map(block => block.text || (block.type === 'image' ? '[图片]' : '')).join('\n') : JSON.stringify(value ?? '')

class TurnAccumulator {
  constructor(message, onSession = () => {}) {
    this.message = message; this.onSession = onSession
    this.texts = new Map(); this.thoughts = new Map(); this.blocks = new Map(); this.current = 'initial'
    this.result = null; this.error = ''; this.commands = []
    this.children = new Map()
    this.requestUsages = new Map()
  }
  tool(id, name, input = '') {
    let tool = this.message.tools.find(t => t.id === id)
    if (!tool) { tool = { id, name, input, output: '', status: 'running' }; this.message.tools.push(tool) }
    return tool
  }
  render() {
    this.message.text = [...this.texts.values()].join('\n\n')
    this.message.thinking = [...this.thoughts.values()].join('\n\n')
  }
  usage(id,value){
    const next=normalizeUsage(value)
    if(!Object.keys(next).length)return
    if(!this.requestUsages.has(id)&&Object.values(next).every(n=>n===0))return
    this.requestUsages.set(id,mergeUsage(this.requestUsages.get(id),next))
    this.message.lastRequestUsage=this.requestUsages.get(id)
    if(!this.result)this.message.usage=sumUsage([...this.requestUsages.values()])
  }
  consume(event) {
    const parentId=event.parent_tool_use_id||event.parentToolUseID
    if(event.isSidechain&&!parentId)return
    if (parentId && ['assistant', 'user', 'stream_event','result'].includes(event.type)) {
      const id = parentId
      if (!this.children.has(id)) {
        const child = { id, text: '', thinking: '', tools: [], status: 'running' }
        this.message.subagents ||= []; this.message.subagents.push(child); this.children.set(id, new TurnAccumulator(child))
      }
      const child=this.children.get(id)
      child.consume({ ...event, parent_tool_use_id: null,parentToolUseID:null,isSidechain:false })
      if(event.type==='result')child.finish(0)
      return
    }
    if (event.type === 'system' && /^task_/.test(event.subtype || '')) {
      this.message.tasks ||= []
      let task = this.message.tasks.find(t => t.id === event.task_id)
      if (!task) { task = { id: event.task_id, status: 'running', description: event.description || event.task_type || '后台任务' }; this.message.tasks.push(task) }
      Object.assign(task, { status: event.subtype === 'task_notification' ? event.status || 'completed' : event.patch?.status || task.status, summary: event.summary || event.patch?.description || task.summary, outputFile: event.output_file || task.outputFile, usage: event.usage || task.usage, toolUseId: event.tool_use_id || task.toolUseId })
    }
    if (event.type === 'system' && /^hook_/.test(event.subtype || '')) {
      this.message.hooks ||= []
      this.message.hooks.push({ id: event.hook_id, name: event.hook_name || event.hook_event, type: event.subtype, output: String(event.output || event.stdout || event.stderr || '').slice(-6000), outcome: event.outcome, time: Date.now() })
      this.message.hooks = this.message.hooks.slice(-200)
    }
    if (event.type === 'result' && event.structured_output != null) this.message.structured = event.structured_output
    if (event.session_id) this.onSession(event.session_id)
    if (event.type === 'system' && event.subtype === 'init') {
      this.commands = event.slash_commands || []
      this.message.model = event.model
    }
    if (event.type === 'stream_event') {
      const e = event.event || {}
      if (e.type === 'message_start') { this.current = e.message?.id || `message_${this.texts.size}`; this.blocks.clear();this.usage(this.current,e.message?.usage) }
      if(e.type==='message_delta')this.usage(this.current,e.usage)
      if (e.type === 'content_block_start') {
        const b = e.content_block || {}; this.blocks.set(e.index, b)
        if (b.type === 'tool_use') this.tool(b.id, b.name, Object.keys(b.input || {}).length ? JSON.stringify(b.input) : '')
        if (b.type === 'text' && b.text) this.texts.set(this.current, (this.texts.get(this.current) || '') + b.text)
      }
      if (e.type === 'content_block_delta') {
        const d = e.delta || {}
        if (d.type === 'text_delta') this.texts.set(this.current, (this.texts.get(this.current) || '') + d.text)
        if (d.type === 'thinking_delta') this.thoughts.set(this.current, (this.thoughts.get(this.current) || '') + d.thinking)
        if (d.type === 'input_json_delta') {
          const b = this.blocks.get(e.index)
          if (b?.id) this.tool(b.id, b.name).input += d.partial_json
        }
      }
    }
    if (event.type === 'assistant') {
      if (event.message?.model) this.message.model = event.message.model
      const content = event.message?.content || []
      const id = event.message?.id || this.current
      this.usage(id,event.message?.usage)
      const text = content.filter(b => b.type === 'text').map(b => b.text).join('')
      // Replace a streamed message with its canonical snapshot, not another append.
      if (text) this.texts.set(id, text)
      const thought = content.filter(b => b.type === 'thinking').map(b => b.thinking).join('')
      if (thought) this.thoughts.set(id, thought)
      for (const b of content) if (b.type === 'tool_use') this.tool(b.id, b.name).input = JSON.stringify(b.input || {})
      if (event.isApiErrorMessage) { this.error = text || 'Claude API 请求失败'; this.texts.delete(id) }
    }
    if (event.type === 'user') {
      for (const b of event.message?.content || []) {
        if (b.type !== 'tool_result') continue
        const tool = this.tool(b.tool_use_id, 'Tool')
        tool.output = textContent(b.content); tool.status = b.is_error ? 'error' : 'done'
      }
    }
    if (event.type === 'result') {
      this.result = event
      this.message.usage = { ...event.usage, cost: event.total_cost_usd, duration: event.duration_ms }
      if(event.modelUsage)this.message.modelUsage=event.modelUsage
      if (event.is_error || (event.subtype && event.subtype !== 'success')) this.error = (event.errors || []).join('\n') || event.result || `Claude: ${event.subtype}`
      if (event.result && !this.texts.size && !this.error) this.texts.set('result', event.result)
      if (event.permission_denials?.length) {
        this.message.notice = `有 ${event.permission_denials.length} 个工具请求未获授权。可在权限设置中调整后继续。`
      }
    }
    if (event.type === 'system' && event.subtype === 'compact_boundary') this.message.notice = '会话上下文已压缩'
    this.render()
  }
  finish(code, stderr = '', stopped = false) {
    for (const child of this.message.subagents || []) { if(!['error','stopped','done'].includes(child.status))child.status = stopped ? 'stopped' : 'done'; for (const tool of child.tools) if (tool.status === 'running') tool.status = stopped ? 'stopped' : 'done' }
    for (const task of this.message.tasks || []) if (task.status === 'running' && (stopped || code !== 0)) task.status = stopped ? 'stopped' : 'failed'
    for (const t of this.message.tools) if (['running', 'waiting'].includes(t.status)) t.status = stopped ? 'stopped' : this.error || code !== 0 ? 'error' : 'done'
    this.message.status = stopped ? 'stopped' : this.error || code !== 0 || !this.result ? 'error' : 'done'
    if (this.message.status === 'error') this.message.error = this.error || (code !== 0 ? `Claude 退出 (${code ?? '未知'})\n${stderr.trim()}` : '进程结束，但未收到完整结果。可继续会话重试。')
  }
}
module.exports = { JsonLines, TurnAccumulator }
