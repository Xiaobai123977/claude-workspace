const crypto=require('node:crypto')
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
const {SettingsService}=require('../electron/settings.cjs'),claude=require('../electron/claude.cjs'),{InteractiveSession}=require('../electron/interactive.cjs'),{assertSubscriptionModels}=require('../electron/subscription.cjs')
;(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'claude-subscription-smoke-')),service=new SettingsService({userData:root,preferences:()=>({}),environment:process.env})
 const source=path.join(service.configHome(),'settings.json'),hash=()=>fs.existsSync(source)?crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'):null,before=hash()
 const runtime=service.prepareRuntime(root,{subscription:true}),settings=JSON.parse(fs.readFileSync(runtime.settingsPath,'utf8'))
 assert.equal(settings.env.ANTHROPIC_MODEL,'');assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL,'');assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN,'')
 const auth=await claude.probe('',{cwd:root,env:runtime.env,settingsPath:runtime.settingsPath});console.log(JSON.stringify({loggedIn:auth.loggedIn,authMethod:auth.authMethod}))
 const child=claude.launch(claude.resolveClaude(),claude.buildTurn({cwd:root},{},[],{...runtime,interactive:true}),root,runtime.env)
 const client=new InteractiveSession(child,{terminate:claude.terminate,onClose:runtime.cleanup})
 try{const info=assertSubscriptionModels(await client.initialize());assert.ok(info.models?.length);assert.equal(hash(),before);assert.equal(new Set(info.models.map(m=>m.value)).size,info.models.length);console.log(JSON.stringify({subscriptionModels:info.models.map(m=>({id:m.value,name:m.displayName,resolved:m.resolvedModel})),originalSettingsUnchanged:true},null,2))}finally{client.close(true);runtime.cleanup()}
})().catch(e=>{console.error(e.message);process.exitCode=1})
