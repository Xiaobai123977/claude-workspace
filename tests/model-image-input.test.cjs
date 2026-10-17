const test=require('node:test'),assert=require('node:assert/strict')
const {modelImageInput,TEXT_ONLY_PROMPT}=require('../electron/model-image-input.cjs')
const {buildTurn,makeInput}=require('../electron/claude.cjs')
test('image input preferences follow connection and model, inheriting capability until explicitly set',()=>{
  const session={providerId:'one',model:'text'},connection={defaultModel:'text',models:[{id:'text',vision:false},{id:'vision',vision:true}]},prefs={}
  const first=modelImageInput(session,prefs,connection)
  assert.equal(first.enabled,false)
  prefs.modelImageInputs={[first.key]:true}
  assert.equal(modelImageInput(session,prefs,connection).enabled,true)
  assert.equal(modelImageInput({...session,model:''},prefs,connection).key,first.key)
  assert.equal(modelImageInput({...session,providerId:'two'},prefs,connection).enabled,false)
  assert.equal(modelImageInput({...session,model:'vision'},prefs,connection).enabled,true)
  assert.equal(modelImageInput({model:'text'},prefs).enabled,true)
  assert.notEqual(modelImageInput({providerId:'pool:one',model:'text'},prefs,connection).key,first.key)
})
test('text-only instruction shares one system prompt with browser and never changes path-only attachments',()=>{
  const session={cwd:process.cwd()},attachment={kind:'image',path:'D:\\pictures\\test.png'}
  const args=buildTurn(session,{},[attachment],{systemPrompt:TEXT_ONLY_PROMPT,mcpConfigPath:'browser.json'})
  assert.equal(args.filter(x=>x==='--append-system-prompt').length,1)
  const prompt=args[args.indexOf('--append-system-prompt')+1]
  assert.match(prompt,/非多模态/);assert.match(prompt,/不要尝试/);assert.match(prompt,/workspace_browser/)
  assert.equal(buildTurn(session,{}).includes('--append-system-prompt'),false)
  const input=JSON.parse(makeInput('hello',[attachment],true))
  assert.equal(input.message.content.length,1);assert.equal(input.message.content[0].type,'text')
  assert.ok(input.message.content[0].text.includes(JSON.stringify(attachment.path)))
})
