param([switch]$NoPrompt)
$ErrorActionPreference = 'Stop'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $workspaceRoot
. (Join-Path $PSScriptRoot 'check-environment.ps1') -NoPrompt:$NoPrompt
if (-not (Invoke-WorkspaceEnvironment -NoPrompt:$NoPrompt)) { exit 1 }

# A standalone copy can also launch an already installed / extracted app.
if (-not (Test-Path -LiteralPath (Join-Path $workspaceRoot 'package.json'))) {
    $appCandidates = @(
        (Join-Path $workspaceRoot 'Claude Workspace.exe'),
        (Join-Path $workspaceRoot 'win-unpacked\Claude Workspace.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Claude Workspace\Claude Workspace.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\claude-workspace\Claude Workspace.exe')
    )
    $app = $appCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $app) { throw '环境检查通过，但没有找到已安装的应用。请先从 GitHub Releases 安装 Claude Workspace，或将脚本放到解压后的应用目录。' }
    Start-Process -FilePath $app -WorkingDirectory (Split-Path -Parent $app) -WindowStyle Normal
    exit 0
}

$npm = Find-WorkspaceCommand @('npm.cmd')
if (-not $npm) { throw 'Node.js 已找到，但 npm.cmd 缺失。请修复 Node.js 安装并重新运行。' }
$electronExecutable = Join-Path $workspaceRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electronExecutable)) {
    if (-not (Confirm-WorkspaceAction '首次源码启动，需要运行 npm ci 下载项目依赖，是否继续？' -NoPrompt:$NoPrompt)) { throw '尚未安装项目依赖。可手动运行 npm ci 后重新启动。' }
    & $npm ci
    if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，本次不会继续启动。' }
}
& $npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed; the previous build was not launched' }
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $electronExecutable -ArgumentList ('"' + $workspaceRoot + '"') -WorkingDirectory $workspaceRoot -WindowStyle Normal
