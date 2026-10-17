const test=require('node:test'),assert=require('node:assert/strict')
const {upstreamHint}=require('../electron/provider-errors.cjs')
test('upstream errors retain original wording and URLs without inferred causes',async()=>{
  const message="OpenCode's free tier can only be used from within OpenCode. Download it at https://example.org."
  for(const status of [401,403,429,503])assert.equal(await upstreamHint(Response.json({error:{message}},{status})),message)
  assert.equal(await upstreamHint(new Response('temporary failure',{status:503})),'temporary failure')
  assert.equal(await upstreamHint(new Response('',{status:403})),'')
})
test('upstream errors redact exact credentials without altering other text',async()=>{
  assert.equal(await upstreamHint(Response.json({error:{message:'bad key secret-key-123; request id 42'}}),['secret-key-123']),'bad key [REDACTED]; request id 42')
})
