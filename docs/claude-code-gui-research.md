# Claude Code GUI 基础调查

调查日期：2026-10-14。对象是 Claude Code CLI，不是 Claude 网页聊天。

## 已确定的产品范围

用户已确认：**只需要 `claude -p` 支持的能力，GUI 通过 CLI 接入。** 后文终端交互表保留为背景资料，不作为必须实现的需求；不再比较嵌入终端或 Python/TypeScript SDK 路线。

后续参考调查见 [Ekko Studio 源码调查](./ekko-studio-source-research.md)：确认其 Claude 接入也是 `-p`，并找到图片输入、原生会话恢复和 `/compact` 的代码参考；`@` 原生展开及 Claude 在线权限审批仍待本机验证。

第一版按以下范围设计：

| 功能 | 接入方式或边界 |
| --- | --- |
| 聊天与流式回复 | `claude -p`，使用 `--output-format stream-json --verbose --include-partial-messages` |
| 多轮会话 | 保存返回的 session ID，后续使用 `--resume <id>`；新会话不传恢复参数 |
| 模型选择 | `--model <model>` |
| 计划模式和权限配置 | `--permission-mode`、`--allowedTools`、`--disallowedTools`；在线审批 UI 需单独核实 CLI 协议，暂不承诺 |
| `/` 菜单 | GUI 自己提供菜单，仅展示确认可在 `-p` 中调用的命令与 Skills |
| Skills、自定义命令 | 将 `/skill-name 参数` 作为提示发送；可用项取决于实际加载配置 |
| 部分内置命令 | 官方明确列出 `/model`、`/effort`、`/fast`、`/color`、`/rename` 的带参数形式，以及无参数 `/mcp` 状态摘要；按各命令可用条件展示 |
| `@` 文件选择 | GUI 自己实现路径搜索；`-p` 对引用语法的展开需实测，不能沿用终端补全的结论。文件路径作为普通提示供 Claude 使用文件工具读取是基础方案 |
| 工具调用记录与结果状态 | 解析结构化输出；同时处理 stderr、进程退出码及结果中的错误 |
| 停止执行 | 控制 CLI 子进程，需验证 Windows 上中断与终止的区别及会话恢复行为 |

依据：[程序调用说明](https://code.claude.com/docs/en/headless)、[CLI 参数参考](https://code.claude.com/docs/en/cli-reference)。此表中的 GUI 菜单和路径搜索是界面层功能，不是 `-p` 自动提供的组件。

终端 Shell 模式 `!`、快捷键帮助 `?`、终端弹窗和双 Esc 回退不纳入第一版。图片附件、MCP 资源引用、差异面板和在线权限审批待确认 `-p` 的具体接入后再决定。

## 调查范围与证据

- 本机执行 `claude --version`，结果为 **2.1.299 (Claude Code)**。
- 本机查看 `claude --help`，确认结构化输入输出、模型、权限和会话参数存在。
- 项目目录 `D:\claudeGUI` 调查前为空，尚无现有 GUI 实现。
- 交互行为依据 Anthropic 官方文档确认；此次没有启动登录会话、发送模型请求或实测终端补全。因此“文档支持”与“本机端到端验证”需区分。

## 输入框交互

| 入口 | 已确认的 Claude Code 行为 | GUI 设计建议 |
| --- | --- | --- |
| `/` | 打开命令列表，继续输入可筛选；来源包括内置命令、Skills、插件和 MCP | 显示名称、说明、参数提示、来源和当前可用状态 |
| `@` | 触发文件路径补全，可以引用文件、目录 | 搜索文件，插入引用标签，支持预览和移除 |
| `!` 位于开头 | 进入 Shell 模式，执行命令并将输出加入会话 | 使用明确的 Shell 状态和执行入口 |
| 空输入时 `?` | 显示快捷键帮助 | 提供可发现的快捷键面板 |
| `Shift+Tab` | 切换权限模式；Windows 部分环境使用 `Alt+M` | 用模式选择器显示当前模式 |
| `Esc` | 中断响应或关闭弹窗，行为取决于当前状态 | 提供停止按钮和清晰的弹窗关闭规则 |
| 空输入时双击 `Esc` | 打开回退菜单；输入有内容时则清空草稿 | 提供独立的回退入口，避免快捷键含义混淆 |
| 图片粘贴 | 支持从剪贴板插入图片，快捷键因平台而异 | 使用图片附件缩略图 |
| 多行输入、历史搜索 | 支持多行输入及 `Ctrl+R` 历史搜索 | 建议 Enter 发送、Shift+Enter 换行，并提供历史搜索 |

上述终端行为见 [Interactive mode](https://code.claude.com/docs/en/interactive-mode)。右列是设计建议，不表示 Claude Code 已提供对应 GUI 组件。

### `/` 的细节

消息开头的 `/命令` 才会由 Claude Code 直接执行。句中也能补全命令，但补全不等于执行。GUI 应避免将普通绝对路径误识别为命令。

命令列表受版本、平台、账户和环境影响，应根据实际会话能力展示，而不是固定复制完整列表。[交互文档](https://code.claude.com/docs/en/interactive-mode)

第一版优先覆盖这些常用入口：

| 命令 | 用途 | GUI 对应位置 |
| --- | --- | --- |
| `/help` | 帮助 | 帮助菜单 |
| `/model` | 切换模型 | 模型选择器 |
| `/plan` | 进入计划模式 | 模式选择器 |
| `/permissions` | 管理工具权限 | 权限设置 |
| `/clear` | 新建空上下文会话 | 新会话按钮 |
| `/compact` | 压缩当前会话上下文 | 上下文菜单 |
| `/resume` | 恢复历史会话 | 会话列表 |
| `/context` | 查看上下文使用 | 上下文状态 |
| `/diff` | 查看修改差异 | 差异面板 |
| `/mcp` | 管理 MCP 连接 | 连接设置 |
| `/memory` | 管理记忆 | 项目记忆设置 |
| `/skills` | 查看技能 | 技能列表 |
| `/tasks` | 查看后台任务 | 任务面板 |

此表是终端能力清单，不保证全部可以通过程序接口直接执行。[官方命令参考](https://code.claude.com/docs/en/commands)

### `@` 的细节

- 文件例子：`解释 @src/utils/auth.js`。
- 目录例子：`查看 @src/components 的结构`。目录引用加入目录列表，并不递归注入全部文件内容。
- 文件内容受大小及读取 token 限制，不能把“已选择文件”理解为“全文一定进入上下文”。当前文档列出默认 25,000 token 的读取上限和 256KB 文本文件限制。

来源：[Common workflows](https://code.claude.com/docs/en/common-workflows#reference-files-and-directories)。

`@` 也可以引用已连接 MCP 服务提供的资源，例如 `@github:issue://123`。资源可与文件一起出现在补全列表中；MCP 工具和 MCP 资源是不同能力，连接服务不代表一定能引用资源。[MCP 资源文档](https://code.claude.com/docs/en/mcp#use-mcp-resources)

## 接入 GUI 的边界

### CLI 结构化调用

本机帮助确认支持：

- `-p/--print`：非交互调用。
- `--output-format stream-json`：结构化输出。
- `--input-format stream-json`：结构化输入。
- `--include-partial-messages`：部分流事件。
- `--resume`、`--continue`：继续会话。
- `--model`、`--permission-mode`：模型和权限配置。

流式输出可作为聊天、工具执行和状态展示的数据来源。具体事件处理参考 [程序调用文档](https://code.claude.com/docs/en/headless)。

**不能假设将所有 `/xxx` 原样发给 `claude -p` 就能得到终端里的功能。** 官方说明：Skills 和自定义命令可在提示中调用；仅依赖终端界面的命令，例如 `/login`，不可用；部分命令支持带参数的非交互形式，例如 `/model sonnet`。[非交互命令支持说明](https://code.claude.com/docs/en/headless)

### Agent SDK

Anthropic 提供 Python 和 TypeScript Agent SDK，将 Claude Code 的工具和执行循环作为程序能力提供。这是自定义 GUI 的另一条接入路线。[SDK 概览](https://code.claude.com/docs/en/agent-sdk/overview)

SDK 接入时需确认配置加载范围，否则用户与项目 Skills 可能没有加载。权限审批应接入 SDK 的权限处理流程，不能仅展示一个无效的“允许”按钮。[SDK Skills 与权限入口](https://code.claude.com/docs/en/agent-sdk/slash-commands)

### 设计判断

已确定使用 CLI JSON 接入，仅覆盖 `claude -p` 能力；上面的 SDK 介绍保留为调查背景。GUI 技术栈尚未选定。

GUI 自身需负责补全列表、文件搜索、附件展示、会话导航和设置面板。原终端的快捷键及弹窗不会自动出现在自定义输入框中。

## 第一版需求建议

1. 工作目录选择与安装版本检测。
2. 聊天输入框：多行、受限的 `/` 菜单、`@` 文件路径选择。
3. 模型与权限模式选择。
4. 流式回复、工具执行记录、错误状态、停止执行。
5. 新建及恢复会话。

后续实现前需验证：`-p` 中的 `@` 解析、可调用命令列表、停止后的会话继续，以及 Windows 上含空格路径和中文输入法的行为。若后续加入在线权限审批或图片附件，再验证对应协议。
