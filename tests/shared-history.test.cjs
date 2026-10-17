const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto')
const {SharedHistory,parseMessages,projectKey}=require('../electron/shared-history.cjs')

test('topology metadata keeps chat text compact while native replay retains the exact original selection snapshot',t=>{
  const f=fixture(t);f.history.sync(f.state);const s=f.state.sessions[0];f.history.hydrate(s)
  const selection={displayText:'解释这个模块',requests:[{revision:'original',targets:[{kind:'node',id:'billing'}],action:'question',text:'解释这个模块',summary:'订单计费'}],context:'原始拓扑快照：billing → storage'}
  s.messages[0].topologySelection=selection
  f.write([f.event('user','u1',null,'解释这个模块\n\n'+selection.context),f.event('assistant','a1','u1','module answer')])
  f.history.hydrate(s,true)
  assert.equal(s.messages[0].text,'解释这个模块');assert.equal(s.messages[0].topologySelection.requests[0].targets[0].id,'billing')
  assert.equal(f.history.replayInput(s,s.messages[0]),'解释这个模块\n\n'+selection.context)
  const serialized=f.history.serialize(f.state);assert.ok(JSON.stringify(serialized).includes('原始拓扑快照'))
})

test('a late internal task message on an older parent does not replace the latest visible conversation branch',t=>{
  const f=fixture(t)
  const rows=[...f.rows,f.event('user','u2','a1','latest user'),f.event('assistant','a2','u2','latest answer')]
  rows.push({...f.event('user','task-meta','a1','internal task update'),isMeta:true})
  assert.deepEqual(parseMessages(rows).map(m=>m.text),['hello from CLI','native reply','latest user','latest answer'])
})

test('late background tool results update their original card without becoming the selected conversation leaf',t=>{
  const f=fixture(t),launch=f.event('assistant','launch','u1','')
  launch.message.content=[{type:'tool_use',id:'agent-tool',name:'Agent',input:{description:'background review'}}]
  const late=f.event('user','late-result','launch','');late.message.content=[{type:'tool_result',tool_use_id:'agent-tool',content:'background result'}]
  const messages=parseMessages([f.rows[0],launch,f.event('assistant','a1','launch','first reply'),f.event('user','u2','a1','latest user'),f.event('assistant','a2','u2','latest reply'),late])
  assert.deepEqual(messages.map(m=>m.text),['hello from CLI','first reply','latest user','latest reply'])
  assert.equal(messages[1].tools[0].output,'background result')
})

test('late CLI writes cannot erase a pending GUI answer or duplicate its partial snapshot',t=>{
  const f=fixture(t);f.history.sync(f.state);const s=f.state.sessions[0];f.history.hydrate(s)
  const user={id:'u2',role:'user',text:'latest user',time:Date.parse('2026-10-16T06:00:02Z'),tools:[],status:'done',pendingNative:true}
  const answer={id:'gui-answer',nativeUUID:'a2',role:'assistant',text:'latest complete answer',time:user.time+1,tools:[],status:'done',pendingNative:true}
  s.messages.push(user,answer)
  const partial=f.event('assistant','a2-part','u2','latest partial answer')
  f.write([...f.rows,f.event('user','u2','a1','latest user'),partial])
  f.history.hydrate(s)
  assert.deepEqual(s.messages.map(m=>m.text),['hello from CLI','native reply','latest user','latest complete answer'])
  assert.ok(JSON.stringify(f.history.serialize(f.state)).includes('latest complete answer'))
  f.write([...f.rows,f.event('user','u2','a1','latest user'),f.event('assistant','a2','u2','latest complete answer')])
  f.history.hydrate(s)
  assert.equal(s.messages.filter(m=>m.text==='latest complete answer').length,1)
  assert.equal(s.messages.some(m=>m.pendingNative),false)
  assert.equal(JSON.stringify(f.history.serialize(f.state)).includes('latest complete answer'),false)
})

test('CLI slash records display and replay as commands while native history and ordinary examples remain intact',t=>{
  const f=fixture(t),raw='<command-name>/goal</command-name>\u00a0<command-message>goal</command-message>\u00a0<command-args>仅仅是确认目标功能完好，请回复：功能正常！</command-args>'
  const command='/goal 仅仅是确认目标功能完好，请回复：功能正常！'
  f.write([f.event('user','u1',null,raw),f.event('assistant','a1','u1','功能正常！')])
  f.history.sync(f.state);const s=f.state.sessions[0];f.history.hydrate(s)
  assert.equal(s.messages[0].text,command);assert.equal(s.title,command)
  assert.equal(f.history.replayInput(s,s.messages[0]),command)
  assert.ok(fs.readFileSync(f.file,'utf8').includes(raw))
  const {commandText}=require('../electron/command-text.cjs')
  assert.equal(commandText('<command-message>goal</command-message>\n<command-name>/goal</command-name>'),'/goal')
  assert.equal(commandText('<command-name>/goal</command-name><command-args>clear</command-args>'),'/goal clear')
  for(const text of ['请解释：'+raw,'```xml\n'+raw+'\n```',raw+' 后面的文字','<command-name>not-a-command</command-name>'])assert.equal(commandText(text),text)
  const assistant=parseMessages([f.event('assistant','a1',null,raw)])[0];assert.equal(assistant.text,raw)
})
test('native API message blocks deduplicate usage by message id across tool loops and preserve metadata after reload',t=>{
  const f=fixture(t)
  const a=f.event('assistant','a1','u1','thinking'),b=f.event('assistant','a2','a1','tool call'),c=f.event('assistant','a3','a2','answer')
  a.message.id=b.message.id='request1';c.message.id='request2'
  a.message.usage=b.message.usage={input_tokens:20,output_tokens:5,cache_read_input_tokens:80}
  c.message.usage={input_tokens:30,output_tokens:8,cache_read_input_tokens:90}
  f.write([f.rows[0],a,b,c]);f.history.sync(f.state);const s=f.state.sessions[0];f.state.activeId=s.id;f.history.hydrate(s)
  assert.equal(s.messages[1].usage.input_tokens,50);assert.equal(s.messages[1].usage.output_tokens,13);assert.equal(s.messages[1].usage.cache_read_input_tokens,170)
  assert.equal(s.messages[1].lastRequestUsage.input_tokens,30)
  s.messages[1].cacheReporting=false;s.messages[1].modelUsage={m:{contextWindow:128000}}
  const restored=JSON.parse(JSON.stringify(f.history.serialize(f.state)));new SharedHistory({configHome:()=>f.home}).sync(restored)
  assert.equal(restored.sessions[0].messages[1].cacheReporting,false);assert.equal(restored.sessions[0].messages[1].modelUsage.m.contextWindow,128000)
})
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'shared-claude-history-')),home=path.join(root,'profile'),cwd=path.join(root,'project'),id=crypto.randomUUID(),dir=path.join(home,'projects',projectKey(cwd));fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(cwd)
  const file=path.join(dir,id+'.jsonl'),history=new SharedHistory({configHome:()=>home}),state={preferences:{},projectSettings:{},sessions:[],activeId:null}
  const event=(type,uuid,parentUuid,text)=>({type,uuid,parentUuid,cwd,sessionId:id,timestamp:'2026-10-16T06:00:00Z',message:{role:type,content:[{type:'text',text}]}})
  const rows=[event('user','u1',null,'hello from CLI'),event('assistant','a1','u1','native reply')]
  const write=(data=rows)=>fs.writeFileSync(file,data.map(v=>JSON.stringify(v)).join('\n')+'\n')
  write();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return{root,home,cwd,id,dir,file,history,state,event,rows,write}
}
test('discovers CLI sessions, loads on selection, persists metadata without a duplicate conversation, reloads native content',t=>{
  const f=fixture(t);assert.equal(f.history.sync(f.state),true);assert.equal(f.state.sessions.length,1)
  const s=f.state.sessions[0];assert.equal(s.cwd,f.cwd);f.state.activeId=s.id;f.history.hydrate(s)
  assert.deepEqual(s.messages.map(m=>m.text),['hello from CLI','native reply']);s.pinned=true;s.archived=true;s.messages[0].attachments=[{id:'attachment',path:path.join(f.cwd,'image.png'),name:'image.png',kind:'image'}]
  const disk=f.history.serialize(f.state);assert.deepEqual(disk.sessions[0].messages,[]);assert.equal(JSON.stringify(disk).includes('native reply'),false);assert.equal(JSON.stringify(disk).includes('hello from CLI'),true) // title only
  const restored=JSON.parse(JSON.stringify(disk)),next=new SharedHistory({configHome:()=>f.home});next.sync(restored)
  assert.equal(restored.sessions.length,1);assert.equal(restored.sessions[0].messages[1].text,'native reply');assert.equal(restored.sessions[0].messages[0].attachments[0].id,'attachment');assert.equal(restored.sessions[0].pinned,true)
})
test('terminal continuations refresh once, reconnect cached CLI, skip a running GUI turn, and handle terminal deletion',t=>{
  const f=fixture(t);f.history.sync(f.state);const s=f.state.sessions[0];f.state.activeId=s.id;f.history.hydrate(s)
  const more=[...f.rows,f.event('user','u2','a1','continue in terminal'),f.event('assistant','a2','u2','terminal response')];f.write(more)
  f.history.sync(f.state,()=>true);assert.equal(s.messages.length,2)
  let reconnect=0;f.history.sync(f.state,()=>false,()=>reconnect++);assert.equal(s.messages.length,4);assert.equal(reconnect,1);assert.equal(f.history.sync(f.state),false)
  fs.unlinkSync(f.file);assert.equal(f.history.sync(f.state),true);assert.equal(f.state.sessions.length,0)
})
test('rename is written in native custom-title format, terminal rename wins, deferred forks never rename their parent',t=>{
  const f=fixture(t);f.history.sync(f.state);const s=f.state.sessions[0];f.history.rename(s,'GUI renamed');f.history.sync(f.state);assert.equal(s.title,'GUI renamed')
  f.history.rename({...s,forkPending:true},'DO NOT RENAME PARENT');assert.equal(fs.readFileSync(f.file,'utf8').includes('DO NOT RENAME PARENT'),false)
  fs.appendFileSync(f.file,JSON.stringify({type:'custom-title',customTitle:'terminal renamed',sessionId:f.id})+'\n');f.history.sync(f.state);assert.equal(s.title,'terminal renamed')
})
test('deletes exact CLI transcript, native index and history references, session snapshots and subagents; preserves project and other chats',t=>{
  const f=fixture(t);f.history.sync(f.state);const s=f.state.sessions[0],other=crypto.randomUUID(),otherFile=path.join(f.dir,other+'.jsonl')
  fs.writeFileSync(otherFile,'OTHER SESSION');fs.writeFileSync(path.join(f.cwd,'keep.txt'),'PROJECT FILE');fs.mkdirSync(path.join(f.dir,'memory'));fs.writeFileSync(path.join(f.dir,'memory','MEMORY.md'),'KEEP MEMORY')
  for(const target of [path.join(f.dir,f.id,'subagents'),path.join(f.home,'file-history',f.id),path.join(f.home,'session-env',f.id)]){fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'owned'),'remove')}
  fs.writeFileSync(path.join(f.dir,'sessions-index.json'),JSON.stringify({version:1,entries:[{sessionId:f.id},{sessionId:other}]}))
  fs.writeFileSync(path.join(f.home,'history.jsonl'),JSON.stringify({sessionId:f.id,display:'delete'})+'\n'+JSON.stringify({sessionId:other,display:'keep'})+'\n')
  f.history.remove(s);assert.equal(fs.existsSync(f.file),false);assert.equal(fs.existsSync(path.join(f.dir,f.id)),false);assert.equal(fs.existsSync(path.join(f.home,'file-history',f.id)),false)
  assert.equal(fs.readFileSync(otherFile,'utf8'),'OTHER SESSION');assert.equal(fs.readFileSync(path.join(f.cwd,'keep.txt'),'utf8'),'PROJECT FILE');assert.ok(fs.existsSync(path.join(f.dir,'memory','MEMORY.md')))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir,'sessions-index.json'))).entries,[{sessionId:other}]);assert.equal(fs.readFileSync(path.join(f.home,'history.jsonl'),'utf8').includes('"display":"delete"'),false)
})
test('native fork has its own transcript and ID immediately; deleting it preserves parent',t=>{
  const f=fixture(t);f.history.sync(f.state);const parent=f.state.sessions[0];f.history.hydrate(parent)
  const snapshots=path.join(f.home,'file-history',f.id);fs.mkdirSync(snapshots,{recursive:true});fs.writeFileSync(path.join(snapshots,'snapshot'),'native checkpoint')
  const fork={...parent,id:'fork',messages:structuredClone(parent.messages),...f.history.fork(parent,'fork title')};assert.notEqual(fork.nativeId,parent.nativeId);assert.ok(fs.existsSync(fork.nativeFile));assert.equal(fork.forkPending,false)
  assert.equal(fs.readFileSync(path.join(f.home,'file-history',fork.nativeId,'snapshot'),'utf8'),'native checkpoint')
  const text=fs.readFileSync(fork.nativeFile,'utf8');assert.equal(text.includes(f.id),false);assert.ok(text.includes(fork.nativeId));f.history.remove(fork);assert.ok(fs.existsSync(f.file));assert.equal(fs.existsSync(fork.nativeFile),false)
  f.history.remove({...parent,id:'deferred',forkPending:true});assert.ok(fs.existsSync(f.file))
})
test('native subagent transcripts render from their own files and are not duplicated in GUI storage',t=>{
  const f=fixture(t),dir=path.join(f.dir,f.id,'subagents');fs.mkdirSync(dir,{recursive:true})
  const child=f.event('assistant','agent-answer',null,'child reasoning output');child.isSidechain=true
  fs.writeFileSync(path.join(dir,'agent-fixture.jsonl'),JSON.stringify(child)+'\n')
  f.history.sync(f.state);const s=f.state.sessions[0];f.history.hydrate(s)
  assert.equal(s.messages[1].subagents[0].text,'child reasoning output');assert.equal(JSON.stringify(f.history.serialize(f.state)).includes('child reasoning output'),false)
})
test('deletion rejects traversal, linked history and mismatched IDs before touching project files',t=>{
  const f=fixture(t);assert.throws(()=>f.history.remove({id:'bad',cwd:f.cwd,nativeId:f.id,nativeFile:path.join(f.cwd,f.id+'.jsonl')}),/配置目录/)
  f.history.sync(f.state);const s=f.state.sessions[0];assert.throws(()=>f.history.remove({...s,nativeId:crypto.randomUUID()}),/不匹配/)
  const linked=path.join(f.home,'file-history',f.id);fs.mkdirSync(path.dirname(linked),{recursive:true});fs.symlinkSync(f.cwd,linked,'junction');assert.throws(()=>f.history.remove(s),/链接/);assert.ok(fs.existsSync(f.file));assert.ok(fs.existsSync(f.cwd))
})
test('old GUI-only records and not-yet-written native sessions survive migration, without importing twice',t=>{
  const f=fixture(t);const old={id:'legacy',cwd:f.cwd,title:'old title',nativeId:f.id,messages:[{id:'a',role:'assistant',nativeUUID:'a1',text:'old cached text',time:0,tools:[],status:'done'}]};f.state.sessions=[old];f.state.activeId=old.id
  f.history.sync(f.state);assert.equal(f.state.sessions.length,1);assert.equal(old.messages[1].text,'native reply')
  const absent={id:'only-gui',cwd:f.cwd,nativeId:crypto.randomUUID(),messages:[{id:'user',role:'user',text:'never discard',tools:[]}]};f.state.sessions.push(absent)
  assert.equal(f.history.serialize(f.state).sessions[1].messages[0].text,'never discard');f.history.sync(f.state);assert.ok(f.state.sessions.includes(absent))
})
test('parser groups tool calls per turn, applies results, chooses current parent chain and hides raw image bytes and meta prompts',()=>{
  const e=(type,uuid,parentUuid,content)=>({type,uuid,parentUuid,timestamp:'2026-10-16T06:00:00Z',message:{content}})
  const result=parseMessages([e('user','u',null,'hello'),e('assistant','tool','u',[{type:'tool_use',id:'call',name:'Read',input:{file_path:'a'}}]),e('user','result','tool',[{type:'tool_result',tool_use_id:'call',content:[{type:'text',text:'file text'},{type:'image',source:{data:'SECRET_BASE64'}}]}]),e('assistant','answer','result','done'),e('assistant','discarded','answer','discard this branch'),e('user','u2','answer','continue'),e('assistant','a2','u2','final')])
  assert.equal(result.length,4);assert.equal(result[1].tools[0].output,'file text\n[图片]');assert.equal(result[1].nativeUUID,'answer');assert.equal(result[3].text,'final');assert.equal(JSON.stringify(result).includes('discard this branch'),false);assert.equal(JSON.stringify(result).includes('SECRET_BASE64'),false)
})
