const transientCodes=new Set(['ECONNRESET','ECONNREFUSED','EPIPE','EAI_AGAIN','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','UPSTREAM_EMPTY_RESPONSE','UPSTREAM_INVALID_RESPONSE'])
function networkRetryable(error){const code=error?.cause?.code||error?.code;return code?transientCodes.has(code):error instanceof TypeError}
function upstreamError(event){
  const value=event.error||event.response?.error||event
  const type=typeof value.type==='string'?value.type:typeof value.code==='string'?value.code:''
  const explicit=[value.status,value.status_code,event.status,event.status_code,event.response?.status_code,value.code].find(n=>Number.isInteger(Number(n))&&Number(n)>=400&&Number(n)<=599)
  const status=explicit?Number(explicit):({overloaded_error:529,rate_limit_error:429,rate_limit_exceeded:429,server_error:503,api_error:503,authentication_error:401,invalid_api_key:401,permission_error:403,invalid_request_error:400,context_length_exceeded:400,insufficient_quota:429}[type]||502)
  const message=typeof value.message==='string'?value.message:typeof value==='string'?value:JSON.stringify(event)
  return Object.assign(new Error(message),{upstreamStatus:status,upstreamType:type,explicitStatus:explicit?Number(explicit):undefined})
}
function isError(event){return !!event.error||event.type==='error'||event.type==='response.failed'||event.type==='response.error'}
function ready(event,protocol){
  if(protocol==='anthropic'){
    if(event.type==='content_block_start'){const block=event.content_block||{};return block.type==='text'?!!block.text:block.type==='thinking'?!!block.thinking:true}
    if(event.type==='content_block_delta')return !!(event.delta?.text||event.delta?.thinking||event.delta?.signature||event.delta?.partial_json)
    return event.type==='message_stop'||event.type==='message_delta'&&!!event.delta?.stop_reason
  }
  if(protocol==='chat')return event.choices?.some(c=>c.finish_reason||c.delta?.content||c.delta?.reasoning_content||c.delta?.tool_calls?.length)
  return ['response.output_text.delta','response.refusal.delta','response.reasoning_summary_text.delta','response.function_call_arguments.delta'].includes(event.type)&&!!event.delta||['response.completed','response.incomplete'].includes(event.type)||event.type==='response.output_item.added'&&event.item?.type==='function_call'
}
function read(reader,signal){
  if(!signal)return reader.read()
  signal.throwIfAborted()
  return new Promise((resolve,reject)=>{
    const abort=()=>{void reader.cancel().catch(()=>{});reject(signal.reason||new Error('请求已取消'))}
    signal.addEventListener('abort',abort,{once:true})
    reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
  })
}
// Buffer only until the first deliverable event. Nothing has reached the CLI, so
// failures here can be retried without replaying text, thought or tool execution.
async function inspectResponse(response,{protocol,stream,signal}={}){
  if(!response.ok||!response.body)return response
  const parseStream=stream&&!response.headers.get('content-type')?.includes('application/json')
  const reader=response.body.getReader(),chunks=[],decoder=new TextDecoder();let buffer='',size=0,ended=false
  const cancel=()=>{void reader.cancel().catch(()=>{})}
  const fail=error=>{cancel();throw error}
  const synthetic=event=>{
    const error=upstreamError(event);cancel()
    return new Response(JSON.stringify({error:{message:error.message,type:error.upstreamType}}),{status:error.upstreamStatus,headers:{'content-type':'application/json','x-claude-gui-stream-error':'true','x-claude-gui-error-type':encodeURIComponent(error.upstreamType.slice(0,100)),...(error.explicitStatus?{'x-claude-gui-upstream-status':String(error.explicitStatus)}:{}),...Object.fromEntries(['retry-after','retry-after-ms','x-should-retry'].filter(k=>response.headers.has(k)).map(k=>[k,response.headers.get(k)]))}})
  }
  const replay=()=>new Response(new ReadableStream({
    start(controller){for(const chunk of chunks)controller.enqueue(chunk)},
    async pull(controller){try{const next=await read(reader,signal);if(next.done){controller.close();reader.releaseLock()}else controller.enqueue(next.value)}catch(error){controller.error(error)}},
    cancel(){return reader.cancel()}
  }),{status:response.status,statusText:response.statusText,headers:response.headers})
  try{
    while(true){
      const {done,value}=await read(reader,signal)
      if(done){ended=true;buffer+=decoder.decode()}else{chunks.push(value);size+=value.byteLength;buffer+=decoder.decode(value,{stream:true})}
      if(size>(stream?1024*1024:32*1024*1024))fail(Object.assign(new Error('上游响应在有效内容之前超过大小限制'),{code:'UPSTREAM_INVALID_RESPONSE'}))
      if(!parseStream){
        if(!done)continue
        let json;try{json=JSON.parse(buffer)}catch{fail(Object.assign(new Error('上游没有返回有效 JSON'),{code:'UPSTREAM_INVALID_RESPONSE'}))}
        if(json&&isError(json))return synthetic(json)
        const valid=protocol==='chat'?json?.choices?.[0]?.message:protocol==='responses'?Array.isArray(json?.output):Array.isArray(json?.content)
        if(!valid)fail(Object.assign(new Error('上游没有返回有效模型消息'),{code:'UPSTREAM_INVALID_RESPONSE'}))
        return replay()
      }
      buffer=buffer.replace(/\r\n/g,'\n')
      let end
      while((end=buffer.indexOf('\n\n'))>=0||done&&buffer.length){
        const frame=end>=0?buffer.slice(0,end):buffer;buffer=end>=0?buffer.slice(end+2):''
        const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n')
        if(!data||data==='[DONE]')continue
        let event;try{event=JSON.parse(data)}catch{fail(Object.assign(new Error('上游流式响应包含无效 JSON'),{code:'UPSTREAM_INVALID_RESPONSE'}))}
        if(isError(event))return synthetic(event)
        if(ready(event,protocol))return replay()
      }
      if(done)fail(Object.assign(new Error('上游响应在返回有效内容前结束'),{code:'UPSTREAM_EMPTY_RESPONSE'}))
    }
  }catch(error){if(!ended)cancel();throw error}
}
module.exports={inspectResponse,upstreamError,networkRetryable}
