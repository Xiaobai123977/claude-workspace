# Windows 环境检查与启动

下载 Releases 中的 `Claude-Workspace-Environment-Check.zip`，解压后使用。不要在 ZIP 内直接运行；保留 `scripts` 文件夹与两个 CMD 文件的相对位置。

- 双击 `Check-Environment.cmd`：检查 Git、Node.js（22.12+）和 Claude CLI；缺少、无法运行或版本过低时，询问是否安装/修复。输入 `y` 确认，回车或 `n` 跳过。
- 双击 `Run-Claude.cmd`：检查通过后，启动同目录下解压的 `Claude Workspace.exe`，或默认路径中已安装的 Claude Workspace。检查工具包不包含 GUI；没有找到应用时，提示先安装应用。
- 在源码目录使用 `Run-Claude.cmd`：首次询问是否运行 `npm ci`，随后构建并启动应用；安装或构建失败不会打开旧构建。
- 不想交互：在 PowerShell 运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check-environment.ps1 -NoPrompt`，只检查，不安装，全部通过退出码为 0，否则为 1。

脚本仅读取三个程序的版本；每个版本命令最多等待 12 秒。不发送模型请求，不读取或修改聊天、API Key、Claude 登录信息、权限配置。检查通过只代表程序可执行，不代表账户、网络或供应商服务可用。

安装由 WinGet 完成，使用明确的官方包标识：`Git.Git`、`OpenJS.NodeJS.LTS`、`Anthropic.ClaudeCode`。脚本不自动接受安装许可，也不隐藏系统授权弹窗。没有 WinGet 或安装失败时提供官方安装地址，可手动安装后重试。安装后刷新本进程 PATH 并再次检查，不主动修改系统 PATH；如安装器要求重启，请完成后重新运行。

安装版 GUI 本身不需要 Node.js；此脚本按完整开发环境检查三项工具。

官方安装资料：

- Git：https://git-scm.com/downloads/win
- Node.js：https://nodejs.org/en/download
- Claude Code：https://code.claude.com/docs/en/setup （官方 README 也列出了 WinGet 安装：https://github.com/anthropics/claude-code）
- WinGet：https://learn.microsoft.com/en-us/windows/package-manager/winget/install

软件下载：https://github.com/Xiaobai123977/claude-workspace/releases/latest
