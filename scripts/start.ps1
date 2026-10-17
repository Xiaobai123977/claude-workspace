$ErrorActionPreference = 'Stop'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $workspaceRoot
$electronExecutable = Join-Path $workspaceRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electronExecutable)) { throw 'Run npm install first' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed; the previous build was not launched' }
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $electronExecutable -ArgumentList ('"' + $workspaceRoot + '"') -WorkingDirectory $workspaceRoot -WindowStyle Normal
