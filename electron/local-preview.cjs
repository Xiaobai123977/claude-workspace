const fs=require('node:fs'),path=require('node:path'),http=require('node:http')
const {fileURLToPath}=require('node:url')
const inside=(root,file)=>{const relative=path.relative(root,file);return !relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)}
const types={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.wasm':'application/wasm','.mp4':'video/mp4','.mp3':'audio/mpeg','.txt':'text/plain; charset=utf-8'}
function localFile(root,input){
  const url=new URL(input)
  if(url.protocol!=='file:'||url.hostname&&url.hostname!=='localhost')throw new Error('仅支持当前项目中的本地 HTML 文件')
  const base=fs.realpathSync(root),file=fs.realpathSync(fileURLToPath(url))
  if(!inside(base,file))throw new Error('本地网页必须位于当前聊天的项目目录中')
  if(!/\.html?$/i.test(file)||!fs.statSync(file).isFile())throw new Error('请选择 HTML 网页文件')
  return{root:base,file,search:url.search,hash:url.hash}
}
async function startLocalPreview(root){
  root=fs.realpathSync(root)
  const server=http.createServer((req,res)=>{
    const fail=(code)=>{res.writeHead(code,{'Content-Type':'text/plain; charset=utf-8'});res.end(http.STATUS_CODES[code])}
    try{
      if(!['GET','HEAD'].includes(req.method))return fail(405)
      const origin='http://127.0.0.1:'+server.address().port
      if(req.headers.host!=='127.0.0.1:'+server.address().port||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return fail(403)
      const relative=decodeURIComponent(new URL(req.url,origin).pathname)
      if(relative.includes('\0')||relative.includes('\\')||relative.includes(':')||relative.split('/').some(p=>p.startsWith('.')))return fail(403)
      let file=path.resolve(root,'.'+relative)
      if(!inside(root,file))return fail(403)
      file=fs.realpathSync(file)
      if(!inside(root,file))return fail(403)
      if(fs.statSync(file).isDirectory()){file=fs.realpathSync(path.join(file,'index.html'));if(!inside(root,file))return fail(403)}
      if(!fs.statSync(file).isFile())return fail(404)
      res.writeHead(200,{'Content-Type':types[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
      if(req.method==='HEAD')return res.end()
      fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res)
    }catch{return fail(404)}
  })
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
  return{root,url:file=>'http://127.0.0.1:'+server.address().port+'/'+path.relative(root,file).split(path.sep).map(encodeURIComponent).join('/'),close(){server.close();server.closeAllConnections()}}
}
module.exports={localFile,startLocalPreview}
