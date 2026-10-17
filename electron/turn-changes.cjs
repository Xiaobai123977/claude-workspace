const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto')
const {execFile}=require('node:child_process'),{promisify}=require('node:util')
const exec=promisify(execFile),limit=1024*1024
async function git(cwd,args){return(await exec('git',['--no-pager','-c','core.quotePath=false',...args],{cwd,windowsHide:true,timeout:10000,maxBuffer:4*1024*1024})).stdout}
function statusPaths(raw){
  const parts=raw.split('\0'),paths=[]
  for(let i=0;i<parts.length;i++){const item=parts[i];if(item.length<4)continue;paths.push(item.slice(3));if(/[RC]/.test(item.slice(0,2))&&parts[i+1])paths.push(parts[++i])}
  return [...new Set(paths)]
}
async function changedPaths(tracker){return statusPaths(await git(tracker.cwd,['status','--porcelain=v1','-z','--untracked-files=all','--','.'])).map(file=>path.relative(tracker.cwd,path.resolve(tracker.repoRoot,file)).replace(/\\/g,'/')).filter(file=>file&&!file.startsWith('../'))}
function fullPath(root,relative){
  root=fs.realpathSync.native(root)
  const full=path.resolve(root,relative),inside=(r,p)=>p!==r&&!path.relative(r,p).startsWith('..'+path.sep)&&!path.isAbsolute(path.relative(r,p))
  let parent=full;while(!fs.existsSync(parent)&&parent!==path.dirname(parent))parent=path.dirname(parent)
  const resolved=path.resolve(fs.realpathSync.native(parent),path.relative(parent,full))
  if(!inside(root,resolved))throw Error('文件不在当前项目中，或链接到了项目外')
  return resolved
}
function readState(root,relative){
  try{
    const full=fullPath(root,relative)
    if(!fs.existsSync(full))return{exists:false,text:''}
    const stat=fs.lstatSync(full)
    if(!stat.isFile()||stat.isSymbolicLink())return{exists:true,reason:'链接或非普通文件不提供文本预览',signature:`${stat.size}:${stat.mtimeMs}`}
    if(stat.size>limit)return{exists:true,reason:'文件超过 1 MB，仅记录路径',signature:`${stat.size}:${stat.mtimeMs}`}
    const bytes=fs.readFileSync(full);if(bytes.includes(0))return{exists:true,reason:'二进制文件不提供文本预览',signature:crypto.createHash('sha256').update(bytes).digest('hex')}
    return{exists:true,text:bytes.toString('utf8')}
  }catch(e){return{reason:e.message}}
}
async function makePatch(relative,before,after){
  if(before.text===after.text&&before.exists!==after.exists)return `diff --git a/${relative} b/${relative}\n${before.exists?'deleted':'new'} file mode 100644\n--- ${before.exists?'a/'+relative:'/dev/null'}\n+++ ${after.exists?'b/'+relative:'/dev/null'}\n`
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'claude-change-diff-')),left=path.join(dir,'before'),right=path.join(dir,'after')
  try{
    fs.writeFileSync(left,before.text);fs.writeFileSync(right,after.text)
    let patch
    try{patch=await git(dir,['diff','--no-index','--no-ext-diff','--no-textconv','--unified=3','--',left,right])}catch(e){if(e.code!==1)throw e;patch=e.stdout}
    return patch.replace(/^diff --git .*$/m,`diff --git a/${relative} b/${relative}`).replace(/^--- .*$/m,before.exists?`--- a/${relative}`:'--- /dev/null').replace(/^\+\+\+ .*$/m,after.exists?`+++ b/${relative}`:'+++ /dev/null')
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
class TurnChanges{
  constructor(userData){this.root=path.join(userData,'changes');this.pending=new Map()}
  async begin(cwd){
    const tracker={cwd:fs.realpathSync.native(cwd),before:new Map(),touched:new Set(),tracked:new Set(),head:null,git:false,limited:false}
    try{
      tracker.repoRoot=fs.realpathSync.native((await git(cwd,['rev-parse','--show-toplevel'])).trim());tracker.git=true
      tracker.tracked=new Set((await git(cwd,['ls-files','-z','--','.'])).split('\0').filter(Boolean).map(p=>p.replace(/\\/g,'/')))
      tracker.head=(await git(cwd,['rev-parse','--verify','HEAD']).catch(()=>'' )).trim()||null
      const paths=await changedPaths(tracker)
      let size=0
      for(const relative of paths){const state=size<16*limit&&tracker.before.size<200?readState(tracker.cwd,relative):{reason:'本轮记录超过预览限制'};tracker.before.set(relative,state);size+=state.text?.length||0;if(state.reason)tracker.limited=true}
    }catch{/* Non-Git projects can still track native file edit tools. */}
    return tracker
  }
  observe(tracker,event){
    if(!tracker)return
    const blocks=event.type==='assistant'?event.message?.content:[]
    const calls=[...(Array.isArray(blocks)?blocks:[]),...(event.type==='control_request'&&event.request?.subtype==='can_use_tool'?[{type:'tool_use',name:event.request.tool_name,input:event.request.input}]:[])]
    for(const call of calls){
      if(call.type!=='tool_use'||!['Write','Edit','MultiEdit','NotebookEdit'].includes(call.name))continue
      const target=call.input?.file_path||call.input?.notebook_path;if(typeof target!=='string')continue
      try{const full=fullPath(tracker.cwd,target),relative=path.relative(tracker.cwd,full).replace(/\\/g,'/');tracker.touched.add(relative);if(!tracker.before.has(relative)&&!tracker.tracked.has(relative))tracker.before.set(relative,readState(tracker.cwd,relative))}catch{/* The viewer covers this project only. */}
    }
  }
  file(sessionId,messageId){if(!/^[\w-]{1,100}$/.test(sessionId)||!/^[\w-]{1,100}$/.test(messageId))throw Error('变更记录标识无效');return path.join(this.root,messageId+'.json')}
  async finish(sessionId,messageId,tracker){
    const promise=this.collect(sessionId,messageId,tracker);this.pending.set(sessionId,promise)
    try{return await promise}finally{if(this.pending.get(sessionId)===promise)this.pending.delete(sessionId)}
  }
  async wait(sessionId){await this.pending.get(sessionId)?.catch(()=>{})}
  async collect(sessionId,messageId,tracker){
    if(!tracker)return null
    const candidates=new Set([...tracker.before.keys(),...tracker.touched]);let limited=tracker.limited
    if(tracker.git)for(const file of await changedPaths(tracker))candidates.add(file)
    const states=[];let bytes=0
    // Capture all final contents before generating patches, so the next turn
    // cannot change what an already completed change card represents.
    for(const relative of [...candidates].slice(0,200)){
      let before=tracker.before.get(relative)
      if(!before){
        if(tracker.head){try{const text=await git(tracker.cwd,['show',`${tracker.head}:./${relative}`]);before=Buffer.byteLength(text)>limit?{exists:true,reason:'原文件超过预览限制'}:{exists:true,text}}catch(error){before=/does not exist|exists on disk, but not in/.test(error.stderr||'')?{exists:false,text:''}:{exists:true,reason:error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'?'原文件超过预览限制':error.message}}}
        else before={exists:false,text:''}
      }
      const after=readState(tracker.cwd,relative)
      if(!before.reason&&!after.reason&&before.exists===after.exists&&before.text===after.text)continue
      if(before.reason||after.reason){limited=true;if(before.signature&&before.signature===after.signature)continue;if(!tracker.touched.has(relative)&&tracker.before.has(relative)&&!before.signature)continue}
      bytes+=(before.text?.length||0)+(after.text?.length||0)
      if(bytes>16*limit){limited=true;states.push({path:relative,before:{reason:'本轮变更超过文本预览限制'},after:{reason:'本轮变更超过文本预览限制'}})}else states.push({path:relative,before,after})
    }
    if(candidates.size>200)limited=true
    const files=[]
    for(const state of states){
      const {path:relative,before,after}=state,reason=before.reason||after.reason
      const patch=reason?'':await makePatch(relative,before,after)
      const lines=patch.split('\n'),add=lines.filter(l=>l.startsWith('+')&&!l.startsWith('+++')).length,del=lines.filter(l=>l.startsWith('-')&&!l.startsWith('---')).length
      files.push({path:relative,kind:before.exists===false?'added':after.exists===false?'deleted':'modified',add,del,patch,reason})
    }
    const record={scope:'turn',messageId,createdAt:Date.now(),files,limited,coverage:tracker.git?'git':'tools'}
    if(files.length){const file=this.file(sessionId,messageId);fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(record),{mode:0o600});fs.renameSync(temp,file)}
    return{files:files.map(({path,kind,add,del,reason})=>({path,kind,add,del,reason})),add:files.reduce((n,f)=>n+f.add,0),del:files.reduce((n,f)=>n+f.del,0),limited,coverage:record.coverage}
  }
  read(sessionId,messageId){const file=this.file(sessionId,messageId);if(!fs.existsSync(file))throw Error('这轮没有已保存的文件变更预览');return JSON.parse(fs.readFileSync(file,'utf8'))}
  remove(messageId){fs.rmSync(this.file('cleanup',messageId),{force:true})}
}
module.exports={TurnChanges,statusPaths,readState,makePatch}
