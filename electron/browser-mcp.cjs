// Minimal newline-delimited MCP stdio transport. No Electron renderer privileges or external packages.
const readline=require('node:readline')
const {tools}=require('./browser-tools.cjs')
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n')
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity})
input.on('line',async line=>{
  let request
  try{
    request=JSON.parse(line);if(request.id==null)return
    let result
    if(request.method==='initialize')result={protocolVersion:request.params?.protocolVersion||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'workspace_browser',version:'1.0.0'}}
    else if(request.method==='ping')result={}
    else if(request.method==='tools/list')result={tools}
    else if(request.method==='tools/call'){
      if(!tools.some(t=>t.name===request.params?.name))throw new Error('Unknown browser tool')
      const response=await fetch(process.env.WORKSPACE_BROWSER_URL,{method:'POST',headers:{Authorization:'Bearer '+process.env.WORKSPACE_BROWSER_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(request.params),signal:AbortSignal.timeout(35000)})
      if(!response.ok)throw new Error('Browser connection unavailable; check that this chat permits browser control.')
      result=await response.json()
    }else{send({id:request.id,error:{code:-32601,message:'Method not found'}});return}
    send({id:request.id,result})
  }catch(e){if(request?.id!=null)send({id:request.id,result:{isError:true,content:[{type:'text',text:e.message}]}})}
})
