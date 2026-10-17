// Installed Claude CLI against isolated protocol fixtures; no real provider/key is used.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict')
const {promisify}=require('node:util'),exec=promisify(require('node:child_process').execFile)
const cli=require('../electron/claude.cjs'),{ProvidersService}=require('../electron/providers.cjs')
const root=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'gateway-failover-cli-'))
const secure={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()}
const settings=path.join(root,'settings.json');fs.writeFileSync(settings,JSON.stringify({disableAllHooks:true,autoMemoryEnabled:false,promptSuggestionEnabled:false}))
async function run(name,env){
  const cwd=path.join(root,name),home=path.join(root,name+'-profile');fs.mkdirSync(cwd);fs.mkdirSync(home)
  const spec=cli.commandSpec(cli.resolveClaude(),['-p','hello','--model','glm-5.2','--output-format','stream-json','--verbose','--tools','','--max-turns','1','--setting-sources','','--settings',settings,'--strict-mcp-config','--mcp-config','{"mcpServers":{}}'])
  const options={cwd,env:cli.environment({...env,...spec.env,CLAUDE_CONFIG_DIR:home,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS:'1'}),windowsHide:true,timeout:45000,maxBuffer:4*1024*1024}
  let output;try{output=(await exec(spec.command,spec.args,options)).stdout}catch(e){if(!e.stdout)throw e;output=e.stdout}
  return output
}
async function main(){
  const server=http.createServer((req,res)=>{req.resume();res.writeHead(404,{'Content-Type':'application/json','x-should-retry':'false'});res.end(JSON.stringify({error:{type:'api_error',message:'RAW_ROUTING_MISS'}}))})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  let service
  try{
    const baseline=await run('baseline',{ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,ANTHROPIC_API_KEY:'FIXTURE',ANTHROPIC_AUTH_TOKEN:'FIXTURE'})
    assert.match(baseline,/issue with the selected model|may not exist/i)
    let fail=true;const seen=[]
    service=new ProvidersService({userData:root,secureStorage:secure,fetcher:async(url,init)=>{
      seen.push(init.headers.Authorization)
      if(fail||init.headers.Authorization==='Bearer KEY_A')return Response.json({error:{message:'RAW_ROUTING_MISS'}},{status:404})
      return new Response('data: '+JSON.stringify({choices:[{delta:{content:'RECOVERED_WITH_VALID_KEY'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})
    }})
    const models=[{id:'glm-5.2'}],provider=service.save({name:'fixture',protocol:'chat',baseUrl:'http://fixture.invalid/v1',auth:'bearer',models,defaultModel:'glm-5.2',keys:[{id:'a',key:'KEY_A',models},{id:'b',key:'KEY_B',models}]})
    const runtime=await service.runtime(provider.id,'glm-5.2','','cli-fixture')
    const failed=await run('gateway-error',runtime.env)
    assert.match(failed,/RAW_ROUTING_MISS/);assert.doesNotMatch(failed,/issue with the selected model|may not exist/i)
    assert.ok(seen.includes('Bearer KEY_A')&&seen.includes('Bearer KEY_B'))
    fail=false;service.router.now=()=>Date.now()+10000
    const recovered=await run('gateway-recovery',runtime.env)
    assert.match(recovered,/RECOVERED_WITH_VALID_KEY/);assert.doesNotMatch(recovered,/issue with the selected model/i)
    console.log('Real CLI passed: direct upstream 404 reproduces generic model-unavailable error; gateway preserves raw error; same saved keys recover and fail over without restarting or editing settings. Isolated fixture: '+root)
  }finally{service?.close();server.close();server.closeAllConnections()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
