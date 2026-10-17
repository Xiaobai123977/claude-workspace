param([switch]$NoPrompt)

# Compatible with Windows PowerShell 5.1. No account or API requests are made.
function Update-WorkspacePath {
    $paths = @($env:PATH -split ';')
    $paths += @([Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';')
    $paths += @([Environment]::GetEnvironmentVariable('Path', 'User') -split ';')
    $paths += @(
        (Join-Path $env:USERPROFILE '.local\bin'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links'),
        (Join-Path $env:APPDATA 'npm'),
        (Join-Path $env:ProgramFiles 'nodejs'),
        (Join-Path $env:ProgramFiles 'Git\cmd')
    )
    $env:PATH = ($paths | Where-Object { $_ } | Select-Object -Unique) -join ';'
}

function Find-WorkspaceCommand([string[]]$Names) {
    foreach ($name in $Names) {
        $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) { return $command.Source }
    }
    return $null
}

function Read-WorkspaceVersion([string]$Executable) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    if ($Executable -match '\.(cmd|bat)$') {
        # An encoded PowerShell command avoids cmd.exe path/quoting expansion.
        $literal = $Executable.Replace("'", "''")
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("& '$literal' --version; exit `$LASTEXITCODE"))
        $info.FileName = Join-Path $PSHOME 'powershell.exe'
        if (-not (Test-Path -LiteralPath $info.FileName)) { $info.FileName = Join-Path $PSHOME 'pwsh.exe' }
        $info.Arguments = '-NoProfile -EncodedCommand ' + $encoded
    } else {
        $info.FileName = $Executable
        $info.Arguments = '--version'
    }
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(12000)) {
            $process.Kill()
            throw '版本检查超过 12 秒，请手动检查此程序。'
        }
        if ($process.ExitCode -ne 0) { throw ('版本检查失败，退出码：' + $process.ExitCode) }
        return $stdout.GetAwaiter().GetResult().Trim()
    } finally { $process.Dispose() }
}

function Get-WorkspaceTool([string]$Name) {
    $spec = switch ($Name) {
        'Git' { @{ Commands=@('git.exe'); Package='Git.Git'; Url='https://git-scm.com/downloads/win' } }
        'Node.js' { @{ Commands=@('node.exe'); Package='OpenJS.NodeJS.LTS'; Url='https://nodejs.org/en/download' } }
        'Claude CLI' { @{ Commands=@('claude.exe','claude.cmd'); Package='Anthropic.ClaudeCode'; Url='https://code.claude.com/docs/en/setup' } }
        default { throw ('未知工具：' + $Name) }
    }
    $executable = Find-WorkspaceCommand $spec.Commands
    $version = ''
    $reason = '未找到可执行文件'
    $ready = $false
    if ($executable) {
        try {
            $version = Read-WorkspaceVersion $executable
            if (-not $version) { throw '没有返回版本信息。' }
            if ($Name -eq 'Node.js') {
                if ($version -notmatch '^v?(\d+\.\d+\.\d+)') { throw '无法识别 Node.js 版本。' }
                if ([version]$matches[1] -lt [version]'22.12.0') { throw '需要 Node.js 22.12 或更高版本，推荐 LTS。' }
            }
            $ready = $true
            $reason = ''
        } catch { $reason = $_.Exception.Message }
    }
    return [pscustomobject]@{Name=$Name; Ready=$ready; Path=$executable; Version=$version; Reason=$reason; Package=$spec.Package; Url=$spec.Url}
}

function Confirm-WorkspaceAction([string]$Message, [switch]$NoPrompt) {
    if ($NoPrompt) { return $false }
    $answer = Read-Host ($Message + ' [y/N]')
    return $answer -match '^(y|yes|是)$'
}

function Install-WorkspaceTool($Tool) {
    $winget = Find-WorkspaceCommand @('winget.exe')
    if (-not $winget) {
        Write-Host '未找到 WinGet，无法自动安装。请从官方页面手动安装后重新运行：' -ForegroundColor Yellow
        Write-Host $Tool.Url
        return $false
    }
    Write-Host ('正在通过 WinGet 安装：' + $Tool.Package)
    # Keep license/UAC prompts visible; do not silently accept agreements.
    & $winget install --id $Tool.Package --exact --source winget --interactive | Out-Host
    if ($LASTEXITCODE -notin @(0, 3010)) {
        Write-Host ('安装未成功，退出码：' + $LASTEXITCODE + '。官方安装说明：' + $Tool.Url) -ForegroundColor Yellow
        return $false
    }
    Update-WorkspacePath
    return $true
}

function Invoke-WorkspaceEnvironment([switch]$NoPrompt) {
    Update-WorkspacePath
    Write-Host 'Claude Workspace - 环境检查' -ForegroundColor Cyan
    Write-Host '仅检查程序版本，不读取聊天、API Key，也不检查账号登录。'
    $allReady = $true
    foreach ($name in @('Git', 'Node.js', 'Claude CLI')) {
        $tool = Get-WorkspaceTool $name
        if (-not $tool.Ready) {
            Write-Host ('[待处理] ' + $name + '：' + $tool.Reason) -ForegroundColor Yellow
            if (Confirm-WorkspaceAction ('是否安装/修复 ' + $name + '？来源：WinGet / ' + $tool.Package) -NoPrompt:$NoPrompt) {
                $installed = Install-WorkspaceTool $tool
                if ($installed) { $tool = Get-WorkspaceTool $name }
            }
        }
        if ($tool.Ready) {
            Write-Host ('[正常] ' + $name + '：' + $tool.Version) -ForegroundColor Green
            Write-Host ('       ' + $tool.Path)
        } else {
            $allReady = $false
            Write-Host ('[未就绪] ' + $name + '。安装后可重新运行；安装失败不会显示成功。') -ForegroundColor Yellow
            Write-Host ('官方安装：' + $tool.Url)
        }
    }
    if ($allReady) { Write-Host '三项环境检查通过。' -ForegroundColor Green }
    else { Write-Host '仍有环境未就绪，本次不会继续启动。' -ForegroundColor Yellow }
    return $allReady
}

if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    try {
        if (Invoke-WorkspaceEnvironment -NoPrompt:$NoPrompt) { exit 0 }
        exit 1
    } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
}
