export function browserRequest(body,protocol){
  if(protocol==='chat')return {
    results:body.messages.filter(m=>m.role==='tool').map(m=>({content:m.content,tool_use_id:m.tool_call_id})),
    names:(body.tools||[]).map(t=>t.function.name),source:body.messages,
    userImage:body.messages.some(m=>m.role==='user'&&Array.isArray(m.content)&&m.content.some(c=>c.type==='image_url')),
    toolImage:body.messages.some(m=>m.role==='user'&&Array.isArray(m.content)&&m.content.some(c=>c.type==='text'&&c.text.includes('browser_tool_4'))&&m.content.some(c=>c.type==='image_url'))
  }
  if(protocol==='responses')return {
    results:body.input.filter(i=>i.type==='function_call_output').map(i=>({tool_use_id:i.call_id,content:Array.isArray(i.output)?i.output.map(c=>({...c,type:c.type==='input_image'?'image':c.type==='input_text'?'text':c.type})):i.output})),
    names:(body.tools||[]).map(t=>t.name),source:body.input,
    userImage:body.input.some(i=>i.role==='user'&&Array.isArray(i.content)&&i.content.some(c=>c.type==='input_image')),
    toolImage:body.input.some(i=>i.type==='function_call_output'&&i.call_id==='browser_tool_4'&&Array.isArray(i.output)&&i.output.some(c=>c.type==='input_image'))
  }
  return {
    results:body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='tool_result'),names:(body.tools||[]).map(t=>t.name),source:body.messages,
    userImage:body.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image')),
    toolImage:body.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='tool_result'&&c.tool_use_id==='browser_tool_4'&&Array.isArray(c.content)&&c.content.some(b=>b.type==='image')))
  }
}
export function respond(res,protocol,step,count){
  const id='browser_tool_'+count,text='NATIVE_BROWSER_VERIFIED'
  res.writeHead(200,{'Content-Type':'text/event-stream'})
  const emit=(type,payload)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...payload})}\n\n`)
  if(protocol==='chat'){
    res.write('data: '+JSON.stringify({choices:[{delta:step?{tool_calls:[{index:0,id,type:'function',function:{name:step.name,arguments:JSON.stringify(step.input)}}]}:{content:text},finish_reason:step?'tool_calls':'stop'}]})+'\n\n')
    res.write('data: '+JSON.stringify({choices:[],usage:{prompt_tokens:50,completion_tokens:10}})+'\n\n');res.write('data: [DONE]\n\n')
  }else if(protocol==='responses'){
    if(step){const item={id:'item_'+count,type:'function_call',call_id:id,name:step.name,arguments:JSON.stringify(step.input)};emit('response.output_item.added',{output_index:0,item:{...item,arguments:''}});emit('response.function_call_arguments.delta',{item_id:item.id,delta:item.arguments});emit('response.output_item.done',{item})}
    else{emit('response.output_item.added',{output_index:0,item:{type:'message',id:'msg',role:'assistant',content:[]}});emit('response.output_text.delta',{item_id:'msg',delta:text})}
    emit('response.completed',{response:{status:'completed',usage:{input_tokens:50,output_tokens:10}}})
  }else{
    emit('message_start',{message:{id:'response-'+Date.now(),type:'message',role:'assistant',model:'fixture-browser',content:[],stop_reason:null,usage:{input_tokens:50,output_tokens:0}}})
    emit('content_block_start',{index:0,content_block:step?{type:'tool_use',id,name:step.name,input:{}}:{type:'text',text:''}})
    emit('content_block_delta',{index:0,delta:step?{type:'input_json_delta',partial_json:JSON.stringify(step.input)}:{type:'text_delta',text}})
    emit('content_block_stop',{index:0});emit('message_delta',{delta:{stop_reason:step?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:10}});emit('message_stop',{})
  }
  res.end()
}
