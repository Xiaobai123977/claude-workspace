// Deterministic integration fixture. Never used by the normal desktop launch.
const crypto = require('node:crypto'), fs = require('node:fs')
const args = process.argv.slice(2)
const runtimeSettings = args.includes('--settings') ? JSON.parse(fs.readFileSync(args[args.indexOf('--settings') + 1], 'utf8')) : {}
if (args.includes('--version')) { console.log('test-fixture (Claude Code)'); process.exit(0) }
if (args.includes('auth')) { console.log(JSON.stringify({ loggedIn: true, authMethod: 'test' })); process.exit(0) }
const interactive = args.includes('--permission-prompt-tool')
const id = args.includes('--resume') && !args.includes('--fork-session') ? args[args.indexOf('--resume') + 1] : crypto.randomUUID()
const emit = e => process.stdout.write(JSON.stringify(e) + '\n')
const pending = new Map(), timers = new Set()
let input = '', turns = 0, sessionAllowed = false, initialized = false
function later(fn, ms) { const timer = setTimeout(() => { timers.delete(timer); fn() }, ms); timers.add(timer) }
function state(value) { if (interactive) emit({ type: 'system', subtype: 'session_state_changed', state: value }) }
function finish(text, error) {
  if (text) emit({ type: 'assistant', uuid:crypto.randomUUID(), message: { id: crypto.randomUUID(), content: [{ type: 'text', text }] } })
  emit({ type: 'result', subtype: error ? 'error_during_execution' : 'success', is_error: !!error, errors: error ? [error] : undefined, result: text, usage: { input_tokens: 10, output_tokens: 12 } })
  state('idle')
}
function request(tool, data, callback, extra = {}) {
  const requestId = crypto.randomUUID()
  pending.set(requestId, callback)
  emit({ type: 'control_request', request_id: requestId, request: { subtype: 'can_use_tool', tool_name: tool, input: data, tool_use_id: crypto.randomUUID(), permission_suggestions: [{ type: 'addRules', behavior: 'allow', rules: [{ toolName: tool }], destination: 'localSettings' }], ...extra } })
  state('requires_action')
  return requestId
}
function turn(prompt, hasImage = false) {
  if(process.env.CLAUDE_GUI_TEST_TOPOLOGY_PROOF)fs.writeFileSync(process.env.CLAUDE_GUI_TEST_TOPOLOGY_PROOF,JSON.stringify({prompt,hasImage}))
  if (process.env.CLAUDE_GUI_TEST_PROOF) fs.writeFileSync(process.env.CLAUDE_GUI_TEST_PROOF, JSON.stringify({ maxContextTokens:process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,autoCompactWindow:process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW,maxOutputTokens:process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,model: runtimeSettings.model, effort: runtimeSettings.effortLevel, hasToken: !!runtimeSettings.env?.ANTHROPIC_AUTH_TOKEN, hasModelFlag: args.includes('--model'), configurationDirectory: process.env.CLAUDE_CONFIG_DIR }))
  if (!initialized) { initialized = true; emit({ type: 'system', subtype: 'init', session_id: id, model: runtimeSettings.model || 'sonnet' }) }
  state('busy'); turns++
  if(process.env.CLAUDE_GUI_TEST_FINAL_RETRY&&prompt.startsWith('FINAL_RETRY_')){
    const file=process.env.CLAUDE_GUI_TEST_FINAL_RETRY
    fs.appendFileSync(file,JSON.stringify({prompt,id,time:Date.now()})+'\n')
    const count=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse).filter(e=>e.prompt===prompt).length
    if(prompt==='FINAL_RETRY_RECOVER'&&count>=3){
      emit({type:'assistant',message:{id:'retry-thinking',content:[{type:'thinking',thinking:'Recovered stream is now thinking'}]}})
      later(()=>finish('Recovered after outer retries'),1000);return
    }
    if(prompt==='FINAL_RETRY_EXIT')process.exit(7)
    finish('', 'fixture raw error: model unavailable HTTP 404');return
  }
  if(prompt.includes('代理完成后汇总验证')){
    const path=require('node:path'),file=path.join(process.cwd(),'merged.json'),tool='merge-worker'
    emit({type:'assistant',uuid:crypto.randomUUID(),message:{id:'merge-launch',content:[{type:'tool_use',id:tool,name:'Agent',input:{description:'探索模块'}}]}})
    emit({type:'system',subtype:'task_started',task_id:'merge-task',tool_use_id:tool,task_type:'local_agent',description:'探索模块'})
    emit({type:'result',subtype:'success',result:'代理已派出，等待结果'});state('idle')
    later(()=>{
      emit({type:'assistant',parent_tool_use_id:tool,message:{id:'merge-child',content:[{type:'text',text:'模块探索返回'}]}})
      emit({type:'result',parent_tool_use_id:tool,subtype:'success',result:'模块探索返回'})
      emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:tool,content:'模块探索返回'}]}})
      emit({type:'system',subtype:'task_notification',task_id:'merge-task',status:'completed',summary:'模块探索完成'})
      state('idle') // stale idle after child completion, before parent inference resumes
    },80)
    later(()=>{
      request('Write',{file_path:file,content:'{"merged":true}'},answer=>{
        if(answer.behavior==='allow'){fs.writeFileSync(file,'{"merged":true}');emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'merge-write',content:'written'}]}});finish('主模型已完成合并写图。')}
        else finish('', '合并被意外拒绝：'+answer.message)
      },{tool_use_id:'merge-write'})
    },1300);return
  }
  if(process.env.CLAUDE_GUI_TEST_TOPOLOGY_WORKFLOW&&['业务拓扑设计：','业务拓扑按图开发：','业务拓扑代码核对：'].some(prefix=>prompt.includes(prefix))){
    const path=require('node:path'),file=path.join(process.cwd(),'.claude/workspace-topology.json'),implement=prompt.includes('业务拓扑按图开发：'),design=prompt.includes('业务拓扑设计：'),graph=JSON.parse(fs.readFileSync(design?process.env.CLAUDE_GUI_TEST_TOPOLOGY_WORKFLOW:file,'utf8'))
    if(implement){
      fs.writeFileSync(path.join(process.cwd(),'app.cjs'),"module.exports = value => String(value).trim()\n")
      fs.writeFileSync(path.join(process.cwd(),'app.test.cjs'),"const test=require('node:test'),assert=require('node:assert/strict'),normalize=require('./app.cjs');test('normalizes input',()=>{assert.equal(normalize(' hello '),'hello');assert.equal(normalize(''),'')})\n")
      const result=require('node:child_process').spawnSync(process.execPath,['--test','app.test.cjs'],{cwd:process.cwd(),encoding:'utf8'});if(result.status!==0){finish(result.stderr||result.stdout,true);return}
      for(const item of [...graph.nodes,...graph.edges]){item.status='implemented';item.refs=[{path:'app.cjs',line:1}];for(const boundary of item.boundaries||[])boundary.refs=[{path:'app.cjs',line:1}];if('purpose' in item)item.verification={status:'passed',summary:'本地 Node 测试已运行',commands:['node --test app.test.cjs']}}
    }
    const content=JSON.stringify(graph,null,2),toolId='topology-workflow-'+turns
    emit({type:'assistant',uuid:crypto.randomUUID(),message:{id:toolId,content:[{type:'tool_use',id:toolId,name:'Write',input:{file_path:file,content}}]}})
    later(()=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:toolId,content:'written'}]}});finish(design?'设计拓扑已保存，尚未实现代码。':implement?'按照拓扑实现完成，实际本地测试通过。':'代码与拓扑已核对，计划设计已保留。')},80);return
  }
  if((prompt.includes('业务拓扑并发探索：')||prompt.includes('业务拓扑重新生成：'))&&process.env.CLAUDE_GUI_TEST_TOPOLOGY){
    const path=require('node:path'),file=path.join(process.cwd(),'.claude','workspace-topology.json'),regenerate=prompt.includes('业务拓扑重新生成：'),moduleId=prompt.match(/"moduleId": "([\w:.-]+)"/)?.[1],graph=JSON.parse(fs.readFileSync(fs.existsSync(file)?file:process.env.CLAUDE_GUI_TEST_TOPOLOGY,'utf8'))
    if(regenerate){const moduleIds=JSON.parse(prompt.match(/"moduleIds": (\[[\s\S]*?\])/)?.[1]||JSON.stringify(moduleId?[moduleId]:[]));if(moduleIds.length){for(const id of moduleIds){const target=graph.nodes.find(n=>n.parent===id)||graph.nodes.find(n=>n.id===id);if(target)target.purpose='重新核实后的模块处理逻辑'}}else graph.description+='（重新核实）'}
    if(!fs.existsSync(file)&&prompt.includes('目标探索深度为 1 层')){graph.nodes=graph.nodes.filter(n=>!n.parent);const ids=new Set(graph.nodes.map(n=>n.id));graph.edges=graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))}
    const prefix='topology-batch-'+turns
    for(let index=1;index<=2;index++){
      const tool=prefix+'-agent'+index
      emit({type:'assistant',uuid:crypto.randomUUID(),message:{id:tool,content:[{type:'tool_use',id:tool,name:'Agent',input:{description:'业务模块探索 '+index,prompt:'只读分析分配的模块'}}]}})
      emit({type:'assistant',parent_tool_use_id:tool,message:{id:tool+'-read',content:[{type:'tool_use',id:tool+'-read',name:'Read',input:{file_path:'src/app.ts'}}]}})
      emit({type:'user',parent_tool_use_id:tool,message:{content:[{type:'tool_result',tool_use_id:tool+'-read',content:'模块源码证据'}]}})
      emit({type:'assistant',parent_tool_use_id:tool,message:{id:tool+'-output',content:[{type:'text',text:'子代理模块探索结果 '+index}]}})
    }
    later(()=>{
      for(let index=1;index<=2;index++){const tool=prefix+'-agent'+index;emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:tool,content:'模块分析完成'}]}});emit({type:'result',parent_tool_use_id:tool,subtype:'success',result:'子代理模块探索结果 '+index})}
      const content=JSON.stringify(graph,null,2);emit({type:'assistant',uuid:crypto.randomUUID(),message:{id:prefix+'-write',content:[{type:'tool_use',id:prefix+'-write',name:'Write',input:{file_path:file,content}}]}})
      fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:prefix+'-write',content:'written'}]}});finish(regenerate?'拓扑重新生成完成。':'并发探索汇总完成。')
    },450);return
  }
  if(prompt.includes('业务拓扑细化：')&&process.env.CLAUDE_GUI_TEST_TOPOLOGY){
    const path=require('node:path'),file=path.join(process.cwd(),'.claude','workspace-topology.json'),graph=JSON.parse(fs.readFileSync(file,'utf8')),moduleId=prompt.match(/"moduleId": "([\w:.-]+)"/)?.[1],parent=graph.nodes.find(n=>n.id===moduleId)
    if(!parent)throw new Error('Topology fixture refinement has no exact module ID')
    const children=graph.nodes.filter(n=>n.parent===moduleId),number=children.length+1,newNode={...parent,id:moduleId+'.step'+number,parent:moduleId,label:'内部步骤 '+number,purpose:'细化选中模块的单一处理步骤'}
    graph.nodes.push(newNode);if(children.length)graph.edges.push({id:moduleId+'.flow'+number,source:children.at(-1).id,target:newNode.id,label:'传递处理结果',data:'此模块内部的处理数据',refs:parent.refs})
    const content=JSON.stringify(graph,null,2)
    emit({type:'assistant',uuid:crypto.randomUUID(),message:{id:'topology-refine-'+turns,content:[{type:'tool_use',id:'topology-refine-tool-'+turns,name:'Write',input:{file_path:file,content}}]}})
    later(()=>{fs.writeFileSync(file,content);emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'topology-refine-tool-'+turns,content:'written'}]}});finish('所选模块内部拓扑已细化。')},80);return
  }
  if(prompt.includes('请为当前项目生成或更新业务拓扑')&&process.env.CLAUDE_GUI_TEST_TOPOLOGY){
    const path=require('node:path'),file=path.join(process.cwd(),'.claude','workspace-topology.json'),content=fs.readFileSync(process.env.CLAUDE_GUI_TEST_TOPOLOGY,'utf8')
    emit({type:'assistant',uuid:crypto.randomUUID(),message:{id:'topology-write',content:[{type:'tool_use',id:'topology-write-tool',name:'Write',input:{file_path:file,content}}]}})
    later(()=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'topology-write-tool',content:'written'}]}});finish('拓扑已生成，可在业务拓扑中查看。')},80);return
  }
  if(prompt.includes('变更审阅验证')){
    const path=require('node:path'),file=path.join(process.cwd(),'app.txt'),value=prompt.includes('第二轮')?'SECOND_TURN\n':'FIRST_TURN\n'
    emit({type:'assistant',uuid:crypto.randomUUID(),message:{id:'change-write-'+turns,content:[{type:'tool_use',id:'change-tool-'+turns,name:'Write',input:{file_path:file,content:value}}]}})
    later(()=>{
      fs.writeFileSync(file,value)
      if(!prompt.includes('第二轮'))fs.writeFileSync(path.join(process.cwd(),'new.txt'),'NEW_IN_FIRST_TURN\n')
      emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'change-tool-'+turns,content:'written'}]}})
      finish(prompt.includes('第二轮')?'第二轮文件变更完成':'第一轮文件变更完成')
    },100)
    return
  }
  if(prompt.includes('子代理卡片验证')){
    emit({type:'assistant',uuid:crypto.randomUUID(),message:{id:'live-main-launch',content:[{type:'tool_use',id:'live-agent',name:'Agent',input:{description:'独立执行验证',prompt:'读取文件并验证'}}]}})
    emit({type:'system',subtype:'task_started',task_id:'live-task',tool_use_id:'live-agent',description:'独立执行验证',task_type:'local_agent'})
    emit({type:'assistant',parent_tool_use_id:'live-agent',message:{id:'live-child',content:[{type:'text',text:'实时子代理输出，仅卡片内可见'}]}})
    emit({type:'assistant',parent_tool_use_id:'live-agent',message:{id:'live-child-read',content:[{type:'tool_use',id:'live-read',name:'Read',input:{file_path:'worker.txt'}}]}})
    emit({type:'user',parent_tool_use_id:'live-agent',message:{content:[{type:'tool_result',tool_use_id:'live-read',content:'实时子代理工具结果'}]}})
    emit({type:'assistant',uuid:crypto.randomUUID(),message:{id:'live-main-answer',content:[{type:'text',text:'最新主对话：子代理仍在后台运行。'}]}})
    emit({type:'result',subtype:'success',result:'最新主对话：子代理仍在后台运行。',session_id:id,usage:{input_tokens:12,output_tokens:8}})
    state('idle');return
  }
  if (prompt.includes('工作台验证')) {
    emit({type:'assistant',message:{id:'fixture-main-launch',content:[{type:'tool_use',id:'fixture-agent',name:'Agent',input:{description:'独立检查项目',prompt:'读取项目并验证'}}]}})
    emit({type:'system',subtype:'hook_started',hook_id:'fixture-hook',hook_name:'Fixture hook',hook_event:'PreToolUse'})
    emit({type:'system',subtype:'task_started',task_id:'fixture-task',tool_use_id:'fixture-agent',description:'Fixture review',task_type:'local_agent'})
    emit({type:'assistant',parent_tool_use_id:'fixture-agent',message:{id:'fixture-child',content:[{type:'text',text:'独立子代理输出'}]}})
    emit({type:'assistant',parent_tool_use_id:'fixture-agent',message:{id:'fixture-child-tool',content:[{type:'tool_use',id:'fixture-child-read',name:'Read',input:{file_path:'fixture.txt'}}]}})
    emit({type:'user',parent_tool_use_id:'fixture-agent',message:{content:[{type:'tool_result',tool_use_id:'fixture-child-read',content:'子代理文件内容'}]}})
    emit({type:'system',subtype:'task_updated',task_id:'fixture-task',patch:{status:'completed'}})
    emit({type:'system',subtype:'hook_response',hook_id:'fixture-hook',hook_name:'Fixture hook',output:'Hook completed'})
    emit({type:'result',subtype:'success',structured_output:{verified:true},usage:{input_tokens:12,output_tokens:8}})
    state('idle');return
  }
  if (prompt.includes('计划后续验证')) {
    finish('初次执行完成')
    later(()=>{state('busy');finish('后台定时再次执行完成')},1500)
    return
  }
  if (prompt.includes('等待停止')) return
  if (prompt.includes('触发失败')) { finish('', '测试：结构化调用失败'); return }
  if (prompt.includes('审批') || prompt.includes('会话授权')) {
    const data = { file_path: require('node:path').join(process.cwd(), 'approval-fixture.txt'), content: 'APPROVED_FIXTURE' }
    const callback = answer => {
      if (answer.behavior === 'allow') {
        if (answer.updatedPermissions?.some(s => s.destination === 'session')) sessionAllowed = true
        fs.writeFileSync(data.file_path, data.content)
        finish('审批通过，测试文件已写入。')
      } else finish('操作已拒绝：' + answer.message)
    }
    if (sessionAllowed && !prompt.includes('禁止记住')) { callback({ behavior: 'allow' }); return }
    request('Write', data, callback, { description: '写入测试文件', suppress_always_allow_rule: prompt.includes('禁止记住') })
    return
  }
  if (prompt.includes('提问')) {
    const questions = [
      { question: '选择输出风格', options: [{ label: '简洁', description: '只展示重点' }, { label: '详细', description: '包含解释' }], multiSelect: false },
      { question: '选择要包含的内容', options: [{ label: '代码' }, { label: '测试' }], multiSelect: true },
    ]
    request('AskUserQuestion', { questions }, answer => finish(answer.behavior === 'allow' ? '收到回答：' + JSON.stringify(answer.updatedInput.answers) : '提问已拒绝'))
    return
  }
  if (prompt.includes('确认计划')) {
    request('ExitPlanMode', { plan: '# 实施计划\n\n1. 修改界面\n2. 运行测试\n\n批准后继续执行。' }, answer => finish(answer.behavior === 'allow' ? '计划已批准并继续。' : '计划已退回：' + answer.message))
    return
  }
  const text = prompt.includes('图片文件：') ? '已收到图片文件引用。' : hasImage ? '已收到图片附件。' : turns > 1 || args.includes('--resume') ? '会话已恢复，继续处理。' : '你好，我已连接到 Claude 工作区。'
  const messageId = crypto.randomUUID(), toolId = crypto.randomUUID()
  emit({ type: 'stream_event', event: { type: 'message_start', message: { id: messageId } } })
  emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })
  emit({ type: 'assistant', message: { id: messageId, content: [{ type: 'text', text }, { type: 'tool_use', id: toolId, name: 'Read', input: { file_path: 'README.md' } }] } })
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolId, content: '项目文件已读取' }] } })
  emit({ type: 'result', subtype: 'success', result: text, total_cost_usd: .001, usage: { input_tokens: 10, output_tokens: 12 } })
  later(() => { emit({ type: 'assistant', message: { id: crypto.randomUUID(), content: [{ type: 'text', text: '最终输出已完整接收。' }] } }); state('idle') }, 150)
}
function receive(e) {
  if (e.type === 'control_request') {
    if(e.request.subtype==='get_context_usage'&&process.env.CLAUDE_GUI_TEST_CONTEXT){
      fs.appendFileSync(process.env.CLAUDE_GUI_TEST_CONTEXT,'context\n')
      emit({type:'control_response',response:{subtype:'success',request_id:e.request_id,response:{totalTokens:25000,maxTokens:100000,rawMaxTokens:200000,categories:[{name:'Messages',tokens:20000},{name:'System',tokens:5000},{name:'Free space',tokens:75000}],isAutoCompactEnabled:true,autoCompactThreshold:80000,model:'sonnet'}}});return
    }
    if (e.request.subtype === 'interrupt') {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      for (const requestId of pending.keys()) emit({ type: 'control_cancel_request', request_id: requestId })
      pending.clear()
      finish('', 'Interrupted by user')
    }
    emit({ type: 'control_response', response: { subtype: 'success', request_id: e.request_id, response: e.request.subtype === 'initialize' ? { commands:[{name:'goal',description:'Keep working toward a goal',argumentHint:'[condition | clear]'},{name:'loop',description:'Repeat a prompt',argumentHint:'[interval] [prompt]'},{name:'code-review',description:'Review code changes',argumentHint:'[target]'},{name:'simplify',description:'Simplify code',argumentHint:''},{name:'init',description:'Initialize project instructions',argumentHint:''}],capabilities: {}, session_state: 'idle', models: [{value:'sonnet',displayName:'Claude Sonnet',supportedEffortLevels:['low','medium','high']},{value:'opus',displayName:'Claude Opus',supportedEffortLevels:['low','medium','high','max']}] } : {} } })
    if(e.request.subtype==='stop_task'&&e.request.task_id==='live-task')emit({type:'system',subtype:'task_notification',task_id:'live-task',status:'stopped',summary:'已停止独立验证'})
  }
  if (e.type === 'control_response') {
    const callback = pending.get(e.response.request_id)
    pending.delete(e.response.request_id)
    if (callback) { state('busy'); callback(e.response.response) }
  }
  if (e.type === 'user') {
    emit({type:'user',uuid:e.uuid,message:e.message,session_id:id,isReplay:true})
    const content = e.message.content
    turn(typeof content === 'string' ? content : content.filter(b => b.type === 'text').map(b => b.text).join('\n'), Array.isArray(content) && content.some(b => b.type === 'image'))
  }
}
process.stdin.setEncoding('utf8')
process.stdin.on('data', s => {
  input += s
  if (!interactive) return
  let at
  while ((at = input.indexOf('\n')) >= 0) {
    const line = input.slice(0, at); input = input.slice(at + 1)
    if (line.trim()) receive(JSON.parse(line))
  }
})
process.stdin.on('end', () => {
  if (!interactive) {
    let data
    try { data = JSON.parse(input) } catch { /* Plain text print mode. */ }
    if (data?.type === 'user') receive(data); else turn(input)
  }
})
