// Installed CLI, isolated Git/config, local model fixture; no paid API or PR writes.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
const {promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile)
const cli=require('../electron/claude.cjs'),{InteractiveSession}=require('../electron/interactive.cjs'),{startProxy}=require('../electron/provider-proxy.cjs')
;(async()=>{
  const temp=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'claude-review-real-')),cwd=path.join(temp,'project'),profile=path.join(temp,'config'),settings=path.join(temp,'settings.json');fs.mkdirSync(cwd);fs.mkdirSync(profile);fs.writeFileSync(settings,JSON.stringify({disableAllHooks:true,autoMemoryEnabled:false}))
  await exec('git',['init'],{cwd,windowsHide:true});fs.writeFileSync(path.join(cwd,'sample.js'),'export const value = 1\n');await exec('git',['add','.'],{cwd,windowsHide:true});await exec('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture'],{cwd,windowsHide:true});fs.writeFileSync(path.join(cwd,'sample.js'),'export const value = 2\n')
  const requests=[],events=[];let client,timer
  const proxy=await startProxy({protocol:'chat',model:'fixture-model',baseUrl:'http://fixture.invalid/v1',models:[{id:'fixture-model'}]}, {},async(url,init)=>{
    const body=JSON.parse(init.body);requests.push(body)
    assert.ok(requests.length<=3,'Review should not loop on a deterministic response')
    const reply={id:'review-fixture',choices:[{message:{role:'assistant',content:'NATIVE_CODE_REVIEW_OK'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}}
    return body.stream?new Response('data: '+JSON.stringify({choices:[{delta:{content:'NATIVE_CODE_REVIEW_OK'},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:reply.usage})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}):Response.json(reply)
  })
  try{
    const args=cli.buildTurn({cwd,model:'fixture-model',permission:'default'},{},[],{interactive:true,settingsPath:settings});args.push('--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}')
    const child=cli.launch(cli.resolveClaude(),args,cwd,{CLAUDE_CONFIG_DIR:profile,ANTHROPIC_BASE_URL:proxy.url,ANTHROPIC_API_KEY:proxy.token,ANTHROPIC_AUTH_TOKEN:proxy.token,ANTHROPIC_MODEL:'fixture-model',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'})
    const result=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Native review timed out')),30000);client=new InteractiveSession(child,{terminate:cli.terminate,onEvent:e=>{events.push(e);if(e.type==='result'){if(e.is_error)reject(Error(JSON.stringify(e.errors||e.result)));else resolve(e)}if(e.type==='control_request')client.answer(e.request_id,{action:'deny',reason:'No tool execution in this deterministic test'})}})})
    const info=await client.initialize();const commands=info.commands||[]
    assert.ok(commands.some(c=>c.name==='code-review'),'Installed CLI must advertise its bundled code-review skill')
    client.write({type:'user',parent_tool_use_id:null,message:{role:'user',content:'/code-review'}})
    const done=await result;assert.match(done.result||JSON.stringify(events),/NATIVE_CODE_REVIEW_OK/)
    assert.ok(requests.length>0);assert.ok(requests.some(b=>/reviewer|correctness|false positives|review the/i.test(JSON.stringify(b.messages))),'Native review instructions must reach the model')
    assert.equal(fs.readFileSync(path.join(cwd,'sample.js'),'utf8'),'export const value = 2\n')
    console.log(JSON.stringify({nativeCodeReview:true,advertisedCommands:commands.map(c=>c.name),requests:requests.length,projectPreserved:true},null,2))
  }finally{clearTimeout(timer);client?.close(true);proxy.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
