# Claude Workspace

Claude Code CLI 的 Windows 桌面界面。在一个窗口里管理项目、聊天、模型和代码变更。

## 下载安装

1. 安装 [Claude Code CLI](https://code.claude.com/docs/en/setup)。
2. 前往 [下载页面](https://github.com/Xiaobai123977/claude-workspace/releases/latest)，选择 **Setup 安装版**（推荐）或便携版。
3. 打开应用，使用本机 Claude 登录，或填写自己的 API 地址和 Key。

安装版不需要另装 Node.js。遇到环境问题，可下载同页的 **Environment-Check.zip**，解压后双击 `Check-Environment.cmd`，缺少工具时会询问是否安装。

## 主要功能

- **项目聊天**：共用 Claude CLI 会话，支持分支、重新生成和文件引用。
- **模型接入**：订阅或自定义 API，多供应商、多 Key、模型切换与自动重试。
- **代码开发**：工具审批、子代理记录、代码差异、网页预览与元素批注。
- **业务拓扑**：探索模块关系、逐层展开，通过批注讨论与修改项目。
- **扩展与设置**：插件、Skills、MCP、权限、记忆及任务完成提醒。

## 界面演示

**聊天与模型选择**

![聊天与模型选择](docs/images/chat-and-models.png)

**业务拓扑与批注**

![业务拓扑与批注](docs/images/business-topology.png)

<details>
<summary>查看更多：常规设置与供应商管理</summary>

![常规设置](docs/images/general-settings.png)

![供应商管理](docs/images/providers.png)

</details>

## 从源码运行

需要 Git、Node.js 22.12+ 和 Claude Code CLI。

```powershell
git clone https://github.com/Xiaobai123977/claude-workspace.git
cd claude-workspace
npm ci
npm start
```

也可双击 `Run-Claude.cmd`，按提示检查环境并启动。打包 Windows EXE：`npm run pack:win`。

## 更多说明

[详细使用](docs/usage-reference.md) · [环境检查](docs/windows-environment.md) · [业务拓扑](docs/business-topology.md) · [供应商路由](docs/model-routing.md)

## 许可证

[MIT](LICENSE)。Claude Code CLI 和第三方依赖遵循各自许可与服务条款。
