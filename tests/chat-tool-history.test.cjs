const test=require('node:test'),assert=require('node:assert/strict')
const {normalizeChatToolHistory,unavailable}=require('../electron/chat-tool-history.cjs')
const {convertRequest,startProxy}=require('../electron/provider-proxy.cjs')
const provider={protocol:'chat',baseUrl:'https://fixture.invalid/v1',model:'fixture',models:[{id:'fixture'}]}
const call=id=>({id,type:'function',function:{name:'Read',arguments:'{}'}})
const assistant=(...ids)=>({role:'assistant',content:null,reasoning_content:'Original reasoning',tool_calls:ids.map(call)})
const tool=(id,content)=>({role:'tool',tool_call_id:id,content})
const use=id=>({type:'tool_use',id,name:'Read',input:{file_path:'fixture.txt'}})
const result=(id,content)=>({type:'tool_result',tool_use_id:id,content})
function validate(messages){
  let pending=new Set()
  for(const message of messages){
    if(pending.size){assert.equal(message.role,'tool','non-tool inserted before all results');assert.ok(pending.delete(message.tool_call_id),'missing or duplicate tool ID')}
    else assert.notEqual(message.role,'tool','orphan tool result')
    if(message.role==='assistant')pending=new Set((message.tool_calls||[]).map(c=>c.id))
  }
  assert.equal(pending.size,0,'unanswered tool calls at end of request')
}
test('valid parallel results retain exact order, reasoning, fields and cache prefix, without mutating input',()=>{
  const messages=[{role:'system',content:'Rules'},{role:'user',content:'Start'},assistant('a','b'),tool('b','Result B'),tool('a','Result A'),{role:'user',content:'Continue'}],original=JSON.stringify(messages)
  const normalized=normalizeChatToolHistory(messages)
  validate(normalized);assert.equal(JSON.stringify(normalized),original);assert.equal(JSON.stringify(messages),original)
  assert.equal(JSON.stringify(normalizeChatToolHistory(normalized)),original,'repair must be idempotent')
})
test('mixed text, tool results and images become a complete contiguous result group before user content',()=>{
  const body={max_tokens:64,messages:[{role:'assistant',content:[{type:'thinking',thinking:'Original reasoning'},use('a'),use('b')]},{role:'user',content:[{type:'text',text:'Keep this user instruction'},result('a','Actual A'),{type:'image',source:{type:'url',url:'https://fixture.invalid/image.png'}}]},{role:'user',content:[result('b','Actual B')]}]},original=JSON.stringify(body)
  const output=convertRequest(body,provider)
  validate(output.messages)
  assert.deepEqual(output.messages.slice(1,3),[tool('a','Actual A'),tool('b','Actual B')])
  assert.equal(output.messages[0].reasoning_content,'Original reasoning')
  assert.ok(JSON.stringify(output.messages).includes('Keep this user instruction'));assert.ok(JSON.stringify(output.messages).includes('https://fixture.invalid/image.png'))
  assert.equal(JSON.stringify(body),original)
})
test('interruption holes are marked unavailable without claiming a tool was executed or stealing a later result',()=>{
  const messages=[assistant('a','b'),tool('a','Real A'),{role:'user',content:'Interrupted; continue'},assistant('b'),tool('b','Later actual B')]
  const normalized=normalizeChatToolHistory(messages)
  validate(normalized);assert.equal(normalized[1].content,'Real A');assert.equal(normalized[2].content,unavailable)
  assert.equal(normalized[3].content,'Interrupted; continue');assert.equal(normalized.at(-1).content,'Later actual B')
  assert.match(unavailable,/unknown/);assert.match(unavailable,/not a successful result/)
  assert.deepEqual(normalizeChatToolHistory(normalized),normalized)
})
test('consecutive native assistant tool blocks merge before matching their real results',()=>{
  const normalized=normalizeChatToolHistory([assistant('a'),assistant('b'),tool('a','A'),tool('b','B')])
  validate(normalized);assert.equal(normalized.length,3);assert.equal(normalized[0].tool_calls.length,2)
  assert.equal(normalized[1].content,'A');assert.equal(normalized[2].content,'B');assert.ok(!JSON.stringify(normalized).includes(unavailable))
})
test('duplicate and orphan tool outputs are retained as labelled historical data and cannot break adjacency',()=>{
  const normalized=normalizeChatToolHistory([tool('orphan','Orphan data'),assistant('a'),tool('a','First'),tool('a','Second'),{role:'user',content:'Continue'}])
  validate(normalized);assert.equal(normalized[0].role,'user');assert.match(normalized[0].content,/Orphan data/)
  assert.equal(normalized[2].content,'First');assert.equal(normalized[3].role,'user');assert.match(normalized[3].content,/Second/)
})
test('Anthropic and Responses requests are not rewritten by Chat history compatibility repair',()=>{
  const body={max_tokens:64,messages:[{role:'assistant',content:[use('a')]},{role:'user',content:[{type:'text',text:'Continue'},result('a','Actual')]}]}
  assert.deepEqual(convertRequest(body,{...provider,protocol:'anthropic'}).messages,body.messages)
  const responses=convertRequest(body,{...provider,protocol:'responses'})
  assert.ok(responses.input.some(i=>i.type==='function_call_output'&&i.output==='Actual'));assert.ok(!JSON.stringify(responses).includes(unavailable))
})
test('real gateway accepts interrupted and mixed native histories on the first attempt against a strict Chat validator',async t=>{
  let requests=0
  const proxy=await startProxy(provider,{},async(_url,init)=>{
    requests++
    try{validate(JSON.parse(init.body).messages)}catch(error){return Response.json({error:{message:"An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'."}},{status:400})}
    return Response.json({choices:[{message:{role:'assistant',content:'Recovered'},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:1}})
  });t.after(()=>proxy.close())
  const histories=[
    [{role:'assistant',content:[use('a'),use('b')]},{role:'user',content:[{type:'text',text:'Continue'},result('a','Real A')]}],
    [{role:'assistant',content:[use('a')]},{role:'user',content:[{type:'text',text:'Continue'},result('a','Real A')]}]
  ]
  for(const messages of histories){const response=await fetch(proxy.url+'/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':proxy.token},body:JSON.stringify({max_tokens:64,messages})});assert.equal(response.status,200);assert.equal((await response.json()).content[0].text,'Recovered')}
  assert.equal(requests,histories.length,'malformed-history errors must not need repeated upstream retries')
})
