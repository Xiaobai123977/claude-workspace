const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const omitted='[图片内容未发送：当前线路不支持图片输入；请依据文字或源文件继续处理。]'
class ImageReferences{
  constructor(userData){this.dir=path.join(userData,'attachments','image-references')}
  reference(image){
    const source=image.source||{}
    if(source.type==='url'&&typeof source.url==='string'&&/^https?:\/\//i.test(source.url))return '[图片地址（当前线路未读取图片内容）] '+JSON.stringify(source.url)
    if(source.type!=='base64'||typeof source.data!=='string'||source.data.length>40*1024*1024)return omitted
    const ext={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif'}[source.media_type]
    if(!ext)return omitted
    try{const data=Buffer.from(source.data,'base64'),file=path.join(this.dir,crypto.createHash('sha256').update(data).digest('hex')+ext);fs.mkdirSync(this.dir,{recursive:true});if(!fs.existsSync(file))fs.writeFileSync(file,data,{mode:0o600});return '[本地图片文件（当前线路未读取图片内容）] '+JSON.stringify(file)}catch{return omitted}
  }
}
function adaptImages(body,p){
  if(p.models?.find(m=>m.id===p.model)?.vision!==false)return body
  const block=b=>b.type==='image'?{type:'text',text:p.imageReference?.(b)||omitted}:b.type==='tool_result'&&Array.isArray(b.content)?{...b,content:b.content.map(block)}:b
  return {...body,messages:body.messages?.map(m=>Array.isArray(m.content)?{...m,content:m.content.map(block)}:m)}
}
function imageCount(body){const count=items=>Array.isArray(items)?items.reduce((n,b)=>n+(b.type==='image'?1:b.type==='tool_result'?count(b.content):0),0):0;return(body?.messages||[]).reduce((n,m)=>n+count(m.content),0)}
module.exports={ImageReferences,adaptImages,imageCount}
