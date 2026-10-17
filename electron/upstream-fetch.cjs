const http=require('node:http'),https=require('node:https'),{Readable}=require('node:stream'),zlib=require('node:zlib')

// Unlike fetch's implicit headers/body deadlines, this transport waits until the
// caller aborts or the peer closes. Explicit request deadlines live in the gateway.
function upstreamFetch(url,init={}){
  return new Promise((resolve,reject)=>{
    const target=new URL(url),transport=target.protocol==='https:'?https:target.protocol==='http:'?http:null
    if(!transport){reject(new TypeError('Unsupported upstream protocol'));return}
    const headers=Object.fromEntries(new Headers(init.headers||{}))
    if(!headers.accept)headers.accept='*/*'
    if(init.body!=null&&!headers['content-length'])headers['content-length']=String(Buffer.byteLength(init.body))
    const request=transport.request(target,{method:init.method||'GET',headers,signal:init.signal,timeout:0},response=>{
      if(response.statusCode>=300&&response.statusCode<400&&init.redirect==='error'){
        response.destroy();reject(new TypeError('Upstream redirect rejected'));return
      }
      const responseHeaders=new Headers()
      for(const [name,value]of Object.entries(response.headers))if(value!=null)responseHeaders.set(name,Array.isArray(value)?value.join(', '):value)
      let body=response
      const encoding=response.headers['content-encoding']
      const decoder=encoding==='gzip'?zlib.createGunzip():encoding==='deflate'?zlib.createInflate():encoding==='br'?zlib.createBrotliDecompress():null
      if(decoder){response.on('error',error=>decoder.destroy(error));body=response.pipe(decoder);decoder.on('close',()=>response.destroy());responseHeaders.delete('content-encoding');responseHeaders.delete('content-length')}
      const noBody=init.method==='HEAD'||[204,205,304].includes(response.statusCode)
      if(noBody)response.resume()
      resolve(new Response(noBody?null:Readable.toWeb(body),{status:response.statusCode,statusText:response.statusMessage,headers:responseHeaders}))
    })
    request.on('socket',socket=>socket.setTimeout(0))
    request.on('error',reject)
    if(init.body!=null)request.write(init.body)
    request.end()
  })
}
module.exports={upstreamFetch}
