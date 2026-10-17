// Real installed CLI + local protocol fixtures only. No paid model endpoint.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const {promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile)
const cli=require('../electron/claude.cjs'),{InteractiveSession}=require('../electron/interactive.cjs'),{startProxy}=require('../electron/provider-proxy.cjs')
const {TurnAccumulator}=require('../electron/stream.cjs'),{stats,normalizeContext}=require('../electron/token-usage.cjs')
const root=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'claude-real-protocol-'))
const settings=path.join(root,'settings.json');fs.writeFileSync(settings,JSON.stringify({disableAllHooks:true,autoMemoryEnabled:false}))
function stream(events){return new Response(events.map(e=>`event: ${e.type||'message'}\ndata: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}})}
async function run(protocol,write=false){
  const cwd=path.join(root,protocol),profile=path.join(root,protocol+'-profile');fs.mkdirSync(cwd);fs.mkdirSync(profile)
  const file=path.join(cwd,'checkpoint.txt');if(write)fs.writeFileSync(file,'before')
  let count=0,toolResult=false,checkpoint,sessionId,context,final='',timer,child,client,toolOutput
  const userUUID=crypto.randomUUID()
  const measured={text:'',tools:[],status:'running'},accumulator=new TurnAccumulator(measured)
  const proxy=await startProxy({protocol,model:'fixture-model',models:[{id:'fixture-model'}],baseUrl:'http://fixture.invalid/v1',timeout:30000},{},async(url,init)=>{
    if(url.endsWith('/count_tokens'))return Response.json({input_tokens:10})
    const body=JSON.parse(init.body);count++
    if(count>6)throw Error('Unexpected repeated fixture requests')
    if(protocol==='chat'){
      if(write&&count<=2)return stream([{choices:[{delta:{tool_calls:[{index:0,id:count===1?'tool_fixture_read':'tool_fixture_write',function:{name:count===1?'Read':'Write',arguments:JSON.stringify(count===1?{file_path:file}:{file_path:file,content:'after'})}}]},finish_reason:'tool_calls'}]},{choices:[],usage:{prompt_tokens:10,completion_tokens:5}}])
      if(write){toolResult=body.messages.some(m=>m.role==='tool');toolOutput=body.messages.filter(m=>m.role==='tool').map(m=>m.content).join('\n')}
      return stream([{choices:[{delta:{content:'Protocol smoke OK'},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:10,completion_tokens:5}}])
    }
    if(protocol==='responses'){
      if(write&&count>1){toolResult=body.input.some(i=>i.type==='function_call_output');assert.ok(body.input.some(i=>i.type==='reasoning'&&i.encrypted_content==='fixture_opaque_1'),'Opaque reasoning must survive the actual CLI transcript');toolOutput=body.input.filter(i=>i.type==='function_call_output').map(i=>i.output).join('\n')}
      if(write&&count<=2){const item={id:'item_'+count,type:'function_call',call_id:'tool_'+count,name:count===1?'Read':'Write',arguments:JSON.stringify(count===1?{file_path:file}:{file_path:file,content:'after'})};return stream([{type:'response.output_item.done',item:{id:'reason_'+count,type:'reasoning',encrypted_content:'fixture_opaque_'+count}},{type:'response.output_item.added',output_index:1,item:{...item,arguments:''}},{type:'response.function_call_arguments.delta',item_id:item.id,delta:item.arguments},{type:'response.output_item.done',item},{type:'response.completed',response:{status:'completed',usage:{input_tokens:10,output_tokens:5}}}])}
      return stream([{type:'response.output_item.added',output_index:0,item:{type:'message',id:'msg1',role:'assistant',content:[]}},{type:'response.output_text.delta',item_id:'msg1',delta:'Protocol smoke OK'},{type:'response.completed',response:{status:'completed',usage:{input_tokens:10,output_tokens:5}}}])
    }
    return stream([{type:'message_start',message:{id:'msg_fixture',type:'message',role:'assistant',model:'fixture-model',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Protocol smoke OK'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:5}},{type:'message_stop'}])
  })
  const env={CLAUDE_CODE_MAX_CONTEXT_TOKENS:'64000',CLAUDE_CODE_AUTO_COMPACT_WINDOW:'64000',CLAUDE_CONFIG_DIR:profile,ANTHROPIC_BASE_URL:proxy.url,ANTHROPIC_API_KEY:proxy.token,ANTHROPIC_AUTH_TOKEN:proxy.token,ANTHROPIC_MODEL:'fixture-model',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'true',CLAUDE_CODE_SDK_READS_SESSION_STATE:'1'}
  const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--include-partial-messages','--permission-prompt-tool','stdio','--replay-user-messages','--setting-sources','','--settings',settings,'--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--permission-mode',write?'acceptEdits':'default','--tools',write?'Read,Write':'','--max-turns','5']
  const result=new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(Error(protocol+' fixture timed out')),45000)
    child=cli.launch(cli.resolveClaude(),args,cwd,env)
    client=new InteractiveSession(child,{terminate:cli.terminate,onEvent:e=>{
      accumulator.consume(e)
      if(e.session_id)sessionId=e.session_id
      if(e.type==='user'&&e.uuid===userUUID)checkpoint=e.uuid
      if(e.type==='assistant'&&!e.isApiErrorMessage)final+=(e.message?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('')
      if(e.type==='control_request')client.answer(e.request_id,e.request.tool_name==='Write'&&e.request.input?.file_path===file&&e.request.input?.content==='after'?{action:'allow'}:{action:'deny',reason:'Unexpected fixture permission'})
      if(e.type==='result'){if(e.is_error)reject(Error((e.errors||[]).join(';')||e.result||'CLI error'));else resolve(e)}
    },onClose:code=>{if(code)reject(Error('CLI exited '+code))}})
  })
  try{
    const init=await client.initialize();assert.ok(Array.isArray(init.models))
    client.write({type:'user',uuid:userUUID,parent_tool_use_id:null,message:{role:'user',content:write?'Write the isolated checkpoint file.':'Reply briefly.'}})
    await result;clearTimeout(timer)
    context=await client.request({subtype:'get_context_usage'}).catch(()=>null)
    assert.equal(context?.maxTokens,64000);assert.equal(context?.rawMaxTokens,64000);assert.equal(context?.autocompactSource,'env')
    assert.equal(normalizeContext(context)?.max,64000);assert.ok(Number.isFinite(normalizeContext(context)?.used))
    assert.equal(stats(measured.usage).input,count*10);assert.equal(stats(measured.lastRequestUsage).input,10)
    assert.match(final,/Protocol smoke OK/)
    if(write){assert.equal(toolResult,true);assert.equal(fs.readFileSync(file,'utf8'),'after',toolOutput);assert.ok(checkpoint)}
    const closed=new Promise(resolve=>child.once('close',resolve));client.close();await closed
    if(write){
      const spec=cli.commandSpec(cli.resolveClaude(),['-p','--resume',sessionId,'--rewind-files',checkpoint,'--setting-sources','','--settings',settings])
      await exec(spec.command,spec.args,{cwd,env:cli.environment({...env,...spec.env}),windowsHide:true,timeout:30000})
      assert.equal(fs.readFileSync(file,'utf8'),'before')
    }
    return{protocol,requests:count,text:true,models:true,context:!!context,contextTokens:context?.maxTokens,toolLoop:write||undefined,fileRewind:write||undefined}
  }finally{clearTimeout(timer);client?.close(true);proxy.close()}
}
;(async()=>{
  const results=[]
  results.push(await run('anthropic'));results.push(await run('responses',true));results.push(await run('chat',true))
  fs.writeFileSync(path.resolve(__dirname,'../artifacts/provider-real-cli-smoke.json'),JSON.stringify({time:new Date().toISOString(),results},null,2))
  console.log(JSON.stringify(results,null,2));console.log('Isolated fixture: '+root)
})().catch(e=>{console.error(e.message);process.exitCode=1})
