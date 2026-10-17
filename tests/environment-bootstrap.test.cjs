const {test}=require('node:test')
const assert=require('node:assert/strict')
const {execFileSync}=require('node:child_process')
const path=require('node:path')
const fs=require('node:fs')
const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe')
const script=path.resolve(__dirname,'../scripts/check-environment.ps1').replaceAll("'","''")
const run=body=>{
  const command=`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; . '${script}'; ${body}`
  const output=execFileSync(powershell,['-NoProfile','-OutputFormat','Text','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']})
  return JSON.parse(output.trim().split(/\r?\n/).at(-1))
}
const options={skip:process.platform!=='win32'||!fs.existsSync(powershell)}
test('environment: an old Node version is detected as incompatible',options,()=>{
  const result=run(`function Find-WorkspaceCommand { return 'node.exe' }; function Read-WorkspaceVersion { return 'v20.19.0' }; Get-WorkspaceTool 'Node.js' | ConvertTo-Json -Compress`)
  assert.equal(result.Ready,false)
  assert.match(result.Reason,/22\.12/)
})
test('environment: ready tools never ask to install',options,()=>{
  const result=run(`function Update-WorkspacePath {}; function Get-WorkspaceTool($Name) { return @{Name=$Name;Ready=$true;Version='1.0';Path='fixture'} }; function Read-Host { throw 'Unexpected prompt' }; function Install-WorkspaceTool { throw 'Unexpected installation' }; @{ready=(Invoke-WorkspaceEnvironment -NoPrompt)} | ConvertTo-Json -Compress`)
  assert.equal(result.ready,true)
})
test('environment: noninteractive missing tools fail without installing',options,()=>{
  const result=run(`function Update-WorkspacePath {}; function Get-WorkspaceTool($Name) { return @{Name=$Name;Ready=$false;Reason='missing';Url='https://example.test'} }; function Read-Host { throw 'Unexpected prompt' }; function Install-WorkspaceTool { throw 'Unexpected installation' }; @{ready=(Invoke-WorkspaceEnvironment -NoPrompt)} | ConvertTo-Json -Compress`)
  assert.equal(result.ready,false)
})
test('environment: declining installation does not run an installer',options,()=>{
  const result=run(`function Update-WorkspacePath {}; function Get-WorkspaceTool($Name) { return @{Name=$Name;Ready=$false;Reason='missing';Url='https://example.test'} }; function Read-Host { return 'n' }; function Install-WorkspaceTool { throw 'Unexpected installation' }; @{ready=(Invoke-WorkspaceEnvironment)} | ConvertTo-Json -Compress`)
  assert.equal(result.ready,false)
})
test('environment: installer success is rechecked before marking tools ready',options,()=>{
  const result=run(`$script:installs=0; function Update-WorkspacePath {}; function Get-WorkspaceTool($Name) { return @{Name=$Name;Ready=$false;Reason='still missing';Url='https://example.test'} }; function Read-Host { return 'y' }; function Install-WorkspaceTool { $script:installs++; return $true }; @{ready=(Invoke-WorkspaceEnvironment);installs=$script:installs} | ConvertTo-Json -Compress`)
  assert.equal(result.ready,false)
  assert.equal(result.installs,3)
})
test('environment: confirmed installation makes a missing tool available',options,()=>{
  const result=run(`$script:installed=$false; $script:installs=0; function Update-WorkspacePath {}; function Get-WorkspaceTool($Name) { return @{Name=$Name;Ready=($Name -ne 'Git' -or $script:installed);Reason='missing';Version='1.0';Path='fixture';Url='https://example.test'} }; function Read-Host { return 'y' }; function Install-WorkspaceTool { $script:installed=$true; $script:installs++; return $true }; @{ready=(Invoke-WorkspaceEnvironment);installs=$script:installs} | ConvertTo-Json -Compress`)
  assert.equal(result.ready,true)
  assert.equal(result.installs,1)
})
