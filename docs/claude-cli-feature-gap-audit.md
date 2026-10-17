# Claude CLI 功能差距调查

日期：2026-10-15。对照当前 src/、electron/ 源码、本机 Claude Code 2.1.299 的 `--help` 和官方在线文档。此次没有安装新扩展、修改产品行为或发送生成请求。

“没有 GUI”不代表 CLI 无法自动执行；“有命令入口”也不代表已验证完整兼容。以下是源码审计和文档核对，不是逐项端到端测试。

## Mods：确实存在

Mod 是带 JavaScript / TypeScript 事件处理逻辑的 Claude 插件，可扩展命令、请求和工具行为，也可以绘制界面。官方当前文档要求终端 CLI v2.1.287 或更新；本机版本符合。

官方特别区分：`claude -p` / Agent SDK 会执行已加载 Mod 的 hooks，但不会显示其绘制的 UI。普通插件安装、启停通道可复用；本项目仍缺少 Mod 识别、加载状态、能力说明、诊断及 UI 兼容策略。不能将官方终端或 Desktop 的面板视为能自动嵌入 Electron React。

界面类 Mod 应标明不支持原生绘制，行为类 Mod 要另做加载与运行验证。不要直接把第三方 Mod 代码加载进 Electron renderer。官方 Mod 面板协议是否存在可复用的自定义宿主接口，还需要单独调查。

来源：[Mods overview](https://code.claude.com/docs/en/plugins/mods/overview)。

## 优先补齐的能力

| 功能 | 现状 | 需要做什么 |
| --- | --- | --- |
| 模型与多协议 | 基础模型设置已有，完整接入未做 | 见 model-provider-settings-research.md |
| 子代理 | CLI 可承担原生执行；GUI 主要显示通用工具卡片 | 自定义 agent 管理、选择、嵌套消息、独立进度与结果；利用父工具 ID 分组 |
| 后台任务 | 已跟踪 task_started / task_notification，防止提前结束 | 增加任务面板、日志、状态、停止；区分会话内后台工具和独立后台会话 |
| Worktree | 没有创建和生命周期管理入口 | 新聊天隔离工作区、分支与真实目录展示、恢复及安全清理；-p 不自动清理，GUI 要负责生命周期 |
| 检查点与回退 | 没有代码/对话回退 UI 与宿主调用 | 消息时间线、受影响文件预览、代码和对话分别恢复；需要验证非交互宿主接口 |
| Auto 权限模式 | 聊天菜单和设置枚举都没有 auto | 按 CLI、模型及策略能力启用，展示不可用或回退原因；不能把它当 bypassPermissions |
| Hooks | 原生配置或插件可携带；没有可视化管理 | 事件列表、启停、执行输出和失败诊断；现有流解析未展示 hook 生命周期 |
| 动态工作流 / Ultracode | 没有专用设置、分阶段进度及工作流管理 | 处理 Workflow 工具、阶段和子代理；先验证运行协议，再设计控制入口 |
| /goal | 没有目标状态和专用控制 | 设置、查看、清除目标，呈现评价结果；明确支持 -p，但需验证应用对多轮完成事件的处理 |
| /loop 与计划任务 | 没有计划列表、取消与调度管理 | 区分会话内定时和独立持久调度；核实 -p 的空闲生命周期，不把进程常驻视为已验证会触发 |
| 运行限制和结构化输出 | 没有相应表单与结果组件 | 可选预算、轮数、JSON Schema、结果导出；预算是客户端估算，非服务商账单硬限额 |
| 快速模式 | 只有 /fast 命令输入入口 | 需要能力检查、状态和正确启动配置，不能认定入口存在即功能完成 |

官方依据：[子代理](https://code.claude.com/docs/en/sub-agents)、[后台会话与 Agent View](https://code.claude.com/docs/en/agent-view)、[Worktrees](https://code.claude.com/docs/en/worktrees)、[Checkpointing](https://code.claude.com/docs/en/checkpointing)、[权限模式](https://code.claude.com/docs/en/permission-modes)、[Hooks](https://code.claude.com/docs/en/hooks-guide)、[Workflows](https://code.claude.com/docs/en/workflows)、[Goal](https://code.claude.com/docs/en/goal)、[计划任务](https://code.claude.com/docs/en/scheduled-tasks)、[CLI 参数](https://code.claude.com/docs/en/cli-reference)。

快速模式另有明确限制：非交互模式需要在启动的 `--settings` 中携带 fastMode 配置，不能只依赖任意会话发送 `/fast`。当前应用入口只预填命令，尚未构成完整实现。[Fast mode](https://code.claude.com/docs/en/fast-mode)

检查点并非任意系统副作用的撤销机制，重点追踪 Claude 文件编辑工具；不能把“回退”宣称为撤销所有 shell 操作或远端改动。[Checkpointing](https://code.claude.com/docs/en/checkpointing)

工作流明确支持 -p；但从非人工来源提示中出现某个关键词，不等于能触发与终端相同的快捷行为。需要使用明确工作流调用和宿主审批机制。[Workflows](https://code.claude.com/docs/en/workflows)

## 需要其他运行方式或额外条件的功能

| 功能 | 未完成部分与边界 |
| --- | --- |
| Agent Teams | 官方说明 -p 不创建 teammates，具名委派仍是普通 subagent；完整队友体验需要其他执行路径 |
| Remote Control | 未接入；官方要求符合条件的 claude.ai 订阅登录，不支持 API Key 和自定义 ANTHROPIC_BASE_URL 网关；当前第三方网关模式无法直接获得它 |
| Channels | 未提供会话启用、配对、消息及授权状态管理；普通 MCP 添加不等于开启 Channel；受认证、预览及组织策略限制 |
| Chrome | 未接入扩展连接、启动开关和诊断；它不是普通文件附件功能 |
| 云会话、Teleport、云例行任务与云审查 | 未做，属于云服务接入，需要账户、环境和服务可用性，不能仅凭本地 -p 承诺兼容 |
| 安全模式与受限运行 | 没有故障排查入口；可考虑安全模式启动、doctor 输出与诊断包。Electron renderer 的 sandbox:true 不是 Claude shell 沙箱 |

来源：[Agent Teams](https://code.claude.com/docs/en/agent-teams)、[Remote Control](https://code.claude.com/docs/en/remote-control)、[Channels](https://code.claude.com/docs/en/channels)、[Chrome](https://code.claude.com/docs/en/chrome)、[CLI reference](https://code.claude.com/docs/en/cli-reference)。云端功能的详细适用条件不在此次实现验证范围。

## 已有但不应算作完整对标的部分

已经有聊天流、思考与工具卡片、逐次审批、用户提问、计划审批、文件引用和图片、恢复及分支、归档、CLAUDE.md 编辑、配置作用域、插件/Skills/MCP 基础管理、公开目录浏览、本地用量记录和压缩入口。

尚缺少上下文占用细分、可操作的文件差异审阅、丰富的子任务状态、自动记忆内容管理、原生会话列表导入/检索/导出、安装健康诊断等完整体验。部分可以复用原生能力，部分需要 GUI 自己实现；它们不全是新的 CLI 启动参数。

## 建议顺序

1. 模型接入与能力识别，修正 Fast / Auto 的实际可用性判定。
2. 子代理、后台任务、文件差异与检查点，把执行过程和恢复能力做清楚。
3. Mods 识别与兼容状态、Hooks 管理及诊断。
4. /goal、动态工作流和计划任务。
5. 有实际需要时扩展远程、Channel、云端与完整 Agent Teams 执行方式。

不要用添加 slash 命令文本替代宿主协议支持，也不要把 CLI 继承行为标成已经通过 GUI 验收。
