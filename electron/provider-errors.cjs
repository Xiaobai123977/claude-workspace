// Preserve upstream error wording; only redact known credentials and bound display size.
function redact(message,secrets=[]){for(const secret of secrets.filter(v=>typeof v==='string'&&v.length).sort((a,b)=>b.length-a.length))message=message.split(secret).join('[REDACTED]');return message.slice(0,16384)}
async function upstreamHint(response,secrets=[],{timeoutMs=1000}={}){
  const reader=response.clone().body?.getReader();if(!reader)return ''
  let message='',timer,expired=false
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>{expired=true;resolve({done:true,timedOut:true});void reader.cancel().catch(()=>{})},timeoutMs)})
  try{
    const chunks=[];let size=0
    while(true){const {done,value,timedOut}=await Promise.race([reader.read(),deadline]);if(timedOut||expired)return '';if(done)break;size+=value.length;if(size>16384){void reader.cancel().catch(()=>{});return ''}chunks.push(value)}
    const text=Buffer.concat(chunks).toString('utf8')
    try{const data=JSON.parse(text);const value=data?.error?.message??data?.message??data?.error??data?.detail;message=typeof value==='string'?value:text}catch{message=text}
    return redact(message,secrets)
  }catch{return ''}finally{clearTimeout(timer);try{reader.releaseLock()}catch{}}
}
module.exports={upstreamHint,redact}
