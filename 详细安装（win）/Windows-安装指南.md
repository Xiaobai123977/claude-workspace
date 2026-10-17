Windows 安装指南
请根据指示进行安装
适用于 Windows 64 位（x64）发布包
请准备好可用的 Claude Code 订阅，或自己的 API 地址和 Key
应用不附带账号或额度。
使用安装版无需下载源码，也无需单独安装 Node.js。

      1. 安装 Claude Code 

如果你已经能运行 `claude --version` 并看到版本号，可以跳到第 2 步。

在 Windows 开始菜单搜索并打开 **PowerShell**，依次执行下面两条命令，按提示完成安装：

```powershell
winget install --id Git.Git --exact --source winget
winget install --id Anthropic.ClaudeCode --exact --source winget
```

Git 提供项目版本管理和 Git Bash；Claude Code 是应用调用的编程工具。

安装完成后，关闭 PowerShell，重新打开，再执行：

```powershell
claude --version
```

看到版本号，说明 Claude Code 已安装成功。

如果提示找不到 `winget`，可分别按 
[Git 官方下载页](https://git-scm.com/downloads/win)
[Claude Code 官方安装说明](https://code.claude.com/docs/en/setup)  
手动安装，再检查版本号。

    2. 下载安装应用

1. 打开 [最新版下载页](https://github.com/Xiaobai123977/claude-workspace/releases/latest)，展开页面下方的 **Assets**。
2. 下载名称包含 **`Setup`**、以 **`-x64.exe`** 结尾的安装包，例如 `Claude-Workspace-Setup-0.1.1-x64.exe`；选择当前版本的对应文件即可。
3. 双击安装，完成后从桌面或开始菜单打开 **Claude Workspace**。

`Source code` 是源码，不是安装包。不带 `Setup` 的 EXE 是便携版，启动时需要先解压，通常较慢。

    3. 选择一种接入方式

使用 Claude 订阅

已在本机登录 Claude Code 的用户可直接使用。尚未登录时，在 PowerShell 执行：

```powershell
claude auth login
```

按浏览器提示完成登录，再打开应用的 **设置 → 连接与模型 → Claude 订阅**，确认已启用。

### 使用自己的 API

在应用的 **设置 → 连接与模型 → 自定义 API** 中，添加供应商，填写服务商提供的 **接口协议、API 地址和 Key**。点击 **获取模型列表**，勾选需要的模型并选择 **默认模型**，再点击 **保存并启用自定义 API**。

如果服务商不提供模型列表，可展开 **手动添加模型**，填写服务商提供的模型 ID。配置细节见 [详细使用说明](https://github.com/Xiaobai123977/claude-workspace/blob/main/docs/usage-reference.md#功能入口)。

## 4. 开始第一次对话

在项目选择器中点击 **添加新项目…**，选择你要工作的文件夹，新建聊天并确认模型已选好。可以先发送：

> 请介绍这个文件夹里的项目，先不要修改文件。

收到回复，就完成了安装和接入。

## 遇到问题

| 情况 | 怎么处理 |
| --- | --- |
| 提示找不到 `claude` | 安装后重新打开 PowerShell 和应用；仍失败时，按官方安装说明检查 PATH，或在应用的“设置 → 常规 → 可执行文件”中指定 Claude 路径并保存。 |
| 想自动检查运行环境 | 下载发布页中的 `Claude-Workspace-Environment-Check.zip`，完整解压后双击 `Check-Environment.cmd`，按提示处理。它按完整开发环境检查 Git、Node.js 和 Claude CLI；安装版 GUI 本身不需要 Node.js。详见 [环境检查说明](https://github.com/Xiaobai123977/claude-workspace/blob/main/docs/windows-environment.md)。 |
| 提示未登录、认证失败或额度不足 | 订阅用户检查 Claude Code 登录和订阅状态；API 用户检查地址、协议、Key 和服务商额度。安装成功不代表接入已可用。 |

更多情况可以找我们对你进行协助，也可借助AI辅助完成
