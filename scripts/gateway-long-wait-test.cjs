// Real HTTP sockets, no paid upstream. Crosses the old 120-second cutoff.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
const {ProvidersService}=require('../electron/providers.cjs')
const duration=125000,root=fs.mkdtempSync(path.join(os.tmpdir(),'gateway-long-wait-')),events=[]
const packet=value=>'data: '+JSON.stringify(value)+'\n\n'
let requests=0,closedEarly=0
const server=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk
  requests++;const body=JSON.parse(raw),streaming=body.messages.at(-1).content==='stream'
  res.on('close',()=>{if(!res.writableFinished)closedEarly++})
  if(streaming){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(packet({choices:[{delta:{content:'FIRST_OUTPUT'}}]}))}
  await new Promise(resolve=>setTimeout(resolve,duration))
  if(!streaming)res.writeHead(200,{'Content-Type':'text/event-stream'})
  res.end(packet({choices:[{delta:{content:'LONG_WAIT_SUCCESS'},finish_reason:'stop'}]})+'data: [DONE]\n\n')
})
;(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const service=new ProvidersService({userData:root,secureStorage:{isEncryptionAvailable:()=>true},onRetry:(_id,event)=>events.push(event)})
  try{
    const provider=service.save({name:'long-wait-fixture',protocol:'chat',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,auth:'none',timeout:120000,models:[{id:'glm-5.2'}],defaultModel:'glm-5.2'})
    assert.equal(provider.timeoutMode,'unlimited')
    const runtime=await service.runtime(provider.id,'glm-5.2','','long-wait'),started=Date.now()
    const responses=await Promise.all(['idle','stream'].map(async mode=>{
      const response=await fetch(runtime.env.ANTHROPIC_BASE_URL+'/v1/messages',{method:'POST',headers:{'x-api-key':runtime.env.ANTHROPIC_API_KEY},body:JSON.stringify({messages:[{role:'user',content:mode}],stream:true,max_tokens:50})})
      assert.equal(response.status,200);return response.text()
    }))
    for(const output of responses){assert.match(output,/LONG_WAIT_SUCCESS/);assert.doesNotMatch(output,/event: error/)}
    assert.match(responses[1],/FIRST_OUTPUT/);assert.equal(requests,2);assert.equal(closedEarly,0);assert.equal(service.router.health.size,0)
    assert.ok(!events.some(e=>e.phase==='waiting'||e.phase==='attempting'));assert.ok(!events.some(e=>e.timeoutAt))
    console.log(JSON.stringify({passed:true,elapsedMs:Date.now()-started,requests,closedEarly,healthFailures:service.router.health.size,delayedHeaders:true,longStreaming:true,profile:root},null,2))
  }finally{service.close();server.close();server.closeAllConnections()}
})().catch(e=>{console.error(e);process.exitCode=1})
