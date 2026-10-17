# Ekko Studio 源码接入调查

调查日期：2026-10-14。仓库：[EKKOLearnAI/ekko-studio](https://github.com/EKKOLearnAI/ekko-studio)。
本次读取固定提交 `d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db`。
源码检出到本机临时目录，仅用于阅读；未安装依赖、运行其服务或复制产品代码。

## 结论

Ekko 的 Claude 聊天实现直接使用 `claude -p`，与我们选定的接入范围一致。值得参考的是进程管理、原生会话恢复、图片输入、事件转换和配置隔离。它支持多个 Agent，但不同 Agent 使用不同协议，不能认为每个 Agent 都有相同能力。

## 多种接入方式分成三层

### 1. Agent 执行协议

| Agent | 在源码中看到的接入 |
| --- | --- |
| Claude Code | 每轮启动 `-p` 子进程，读取 stream-json |
| Codex | `exec` / `exec resume`，读取结构化事件 |
| Pi | RPC 进程，发送请求、处理工具及 UI 事件 |
| OpenCode | `run --format json`，恢复时传 `--session` |
| Qwen、Kimi、CodeBuddy、Qoder、Copilot | 注册到 ACP 适配器，进行会话和权限交互 |

来源：[运行管理器](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/runtime/run-manager.ts)、[OpenCode 接入](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/opencode/chat-turn.ts)、[Agent 注册表](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/registry/native-agents.ts)、[ACP 接入](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/runtime/acp-chat-turn.ts)。

这些执行结果转换为统一响应事件，再由 Studio 的聊天层处理。我们只实现 Claude 适配器即可，但应让前端使用自己的消息结构，避免界面到处依赖原始 Claude JSON。

### 2. 配置与认证模式

- **global**：继承进程环境，使用本机 Agent 配置；仍可追加 Studio 提示文件和 MCP 配置，并非完全无修改地启动。
- **scoped**：按应用配置准备 settings、MCP 和提示文件，子进程使用筛选后的环境变量。Claude 路径可以设置模型、API key、base URL，并按选项控制配置来源。
- scoped 不等于操作系统沙箱，也不保证所有配置默认完全隔离；需检查实际参数。

来源：[启动配置](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/index.ts#L2971)、[Claude scoped 配置](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/index.ts#L3272)、[子进程环境](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/runtime/child-env.ts)。

对我们而言，可先提供“使用本机 Claude 配置”，以后再加“独立 API 配置”。两种模式仍然都使用 `claude -p`。

### 3. 模型服务协议

Claude 代理实现支持三类上游：Anthropic Messages、OpenAI Chat Completions、OpenAI Responses。代理将上游回复及流事件转换为 Claude 所需格式，然后 CLI 继续执行 Agent 工具循环。

来源：[Claude API 代理](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/claude-code/proxy.ts#L484)。

因此它的多种模型服务接入，并不意味着绕过 Claude CLI 自己重建全部工具执行。这个代理属于扩展功能，当前需求不必同步实现。

## Claude 的具体数据流

1. 准备命令、参数数组、工作目录和环境。
2. 新原生会话可以使用 `--session-id`；已有原生会话使用 `--resume`。
3. 启动 `claude ... -p --input-format text --output-format stream-json --include-partial-messages --verbose`。
4. 提示通过 stdin 写入，随后关闭 stdin；图片场景切换为 stream-json 输入。
5. 缓冲 stdout，按行解析 JSON，保留跨数据块的半行。
6. 处理流事件、完整 assistant/user 消息、工具调用、压缩事件和 result。
7. 将返回的 `session_id` 保存到应用会话中。
8. 等 `close` 事件排空管道后收尾，处理错误与统计。

来源：[Claude 每轮启动](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/runtime/run-manager.ts#L2053)、[事件解析](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/runtime/run-manager.ts#L2209)。

这是“每轮一个进程＋原生会话恢复”的实现，不是把全部聊天历史每次拼成提示。应用自己的会话 ID 和 Claude 原生 session ID 分开保存。

## 可以直接借鉴的能力与实现细节

### 图片输入

`buildClaudeStreamJsonInput` 把文字和 base64 图片组成 user 消息，通过 stdin 发送。图片不会被当作命令行路径硬塞到提示参数中。

来源：[图片消息构造](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/runtime/run-manager.ts#L469)。仓库还有对应的 [Windows 图片输入测试](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/tests/server/coding-agent-run-manager-windows.test.ts#L1241)。

本轮确认的是源码和测试用例存在，未在本机调用 Claude 验证图片推理。先前将图片列为待调查能力，现在有了明确的实现参考。

### 消息收尾与去重

- `result` 到达后，原生进程仍可能输出后续消息。
- 使用 `close` 而不是仅用 `exit` 判定输出已排空。
- 完整 assistant 快照与流式 delta 可能描述同一段文字；按 message ID 与已接收内容对齐，防止重复。
- 单独处理 `isApiErrorMessage`，不能只根据退出码认为成功。

来源：[Claude 输出处理](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/runtime/run-manager.ts#L2165)、[result 和快照处理](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/runtime/run-manager.ts#L2267)。

我们应借鉴这些行为，同时保留对 result 错误字段、异常 EOF 和未知事件的明确处理，不能把参考实现当作完整协议规范。

### Windows 进程

提示走 stdin；执行使用参数数组；启动窗口隐藏；停止涉及所属进程树。停止进程和优雅中断的语义仍需针对本机验证。

来源：[进程启动和终止](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/runtime/run-manager.ts#L498)。

### 模型列表

模型发现通过 Claude 的流式控制协议发送 initialize，请求返回的 models，避免完全写死模型名。

来源：[模型发现](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/claude-code/models.ts)、[控制请求](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/models/process.ts#L166)。

这是可参考的进阶能力；控制协议需要按本机版本验证，不应因源码有实现便认定它是稳定 CLI 公共接口。

## /、@ 和权限的判断修正

### / 菜单不等于原生 CLI 命令列表

前端对 Coding Agent 的菜单限制为 context、compact、usage、status，并按 Agent 过滤。后台为这些应用命令提供处理逻辑。Claude 的 compact 会走恢复会话后的 `-p /compact` 调用。

来源：[输入框菜单](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/client/src/components/hermes/chat/ChatInput.vue#L247)、[应用命令处理](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/session-command.ts)、[Claude compact](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/runtime/run-manager.ts#L980)。

我们也可以用 / 菜单提供 GUI 操作，但要区分“GUI 本地动作”和“发送给 Claude 的命令”。不能把 Ekko 菜单里的同名命令全部当作 `-p` 原生支持证据。

### @ 文件补全

此次检查的聊天输入组件中，看到了 / 菜单、技能选择和附件上传，尚未找到足以确认 Claude `@文件` 原生展开行为的实现依据。它的图片附件方案不能用于证明文本文件的 @ 语法。我们仍需自行设计文件搜索，并验证提交策略。

### 权限

Claude 的 global 和 scoped 启动参数都包含 `--dangerously-skip-permissions`。ACP 与 Pi 的审批/澄清逻辑属于各自的协议，不是 Claude 在线审批的实现。

来源：[Claude 启动常量与参数](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/index.ts#L73)、[ACP 权限传递](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/runtime/acp-chat-turn.ts)、[Pi 审批处理](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/runtime/run-manager.ts#L1133)。

所以当前不能宣称“参考 Ekko 就能直接获得 Claude 的逐次权限弹窗”。我们的权限模式和在线审批应单独设计、验证。

## 对当前项目的建议

保持此前范围：只做 Claude，通过 `claude -p` 接入。

第一版的后端边界建议分为：
- 启动配置：工作目录、模型、权限、环境和参数。
- Claude 进程适配器：启动、stdin、输出缓冲、错误和停止。
- 事件转换：文字、工具、用量、结果、会话 ID。
- 会话存储：GUI 会话 ID 与 Claude 原生 ID 分开。
- 前端输入：/ 菜单、文件搜索、附件与多行编辑。

优先验证流式去重、输出收尾、会话恢复、图片输入和 Windows 停止。多个 Agent 和 API 协议代理留作后续扩展。

本轮为源码调查，未运行 Ekko 测试或启动产品；所有“已实现”均指固定提交中的代码证据。

