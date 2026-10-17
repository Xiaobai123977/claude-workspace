# Claude CLI 双向交互实测

日期：2026-10-15。安装版本：Claude Code 2.1.299，Windows 原生可执行文件。

## 结论

继续使用 `claude -p` 可以实现 GUI 内的工具审批、用户提问、计划确认、运行中补充消息和协议中断，无需为了这些交互先替换为 SDK。本报告记录最初的独立协议实验；随后已接入主界面的审批、提问、计划确认和中断，见 [实现验证](implementation-validation.md)。运行中补充消息与排队尚未接入主界面。

本次使用现有连接配置，实际响应报告中的模型标识为 `deepseek-v4.1-flash-free`。结果证明此安装版本和该连接组合可用，不代表所有 CLI 版本、模型、工具和代理服务都具有相同表现。

## 实验结果

| 实验 | 实际观察 |
|---|---|
| 写文件审批 | 收到 Write 请求后等待 600ms，文件不存在；回复允许后才写入 |
| 拒绝写文件 | 文件未生成，拒绝原因出现在模型后续回复中 |
| 用户提问 | 收到 AskUserQuestion 的 questions，返回 Detailed 选项后获得 CHOICE_Detailed |
| 计划确认 | plan 模式收到 ExitPlanMode，批准后获得 PLAN_APPROVED，未执行计划中的项目写入 |
| 中断流式回复 | interrupt 收到成功确认，当前轮结束；原进程接收下一条消息并回复 AFTER_INTERRUPT_OK |
| 执行中补充消息 | 等待 Write 审批期间发送另一条用户消息；批准后同一个 result 包含 FIRST_DONE 和 SECOND_SEEN_842 |
| 权限有效期 | 允许一次后，下一轮仍请求审批；设置 session 允许规则后，第三轮写入无需再次审批 |
| 取消待审批请求 | interrupt 后收到匹配 request_id 的 control_cancel_request；文件未写入；同进程继续成功 |
| 中断运行中的命令 | Bash 中的 Node 子进程先写 started.txt，15 秒后原本会写 late.txt；确认启动后发 interrupt，等待 16 秒仍无 late.txt，同进程继续成功 |

机器可读结果：[interactive-protocol-smoke.json](../artifacts/interactive-protocol-smoke.json)。各项协议事件位于 `artifacts/interactive-protocol/`，已去掉初始化响应的账户信息与思考内容，不保存凭据。

## 接入方式

实验启动参数的核心部分：

```text
claude -p --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages --permission-prompt-tool stdio
```

标准输入需要保持打开，每条 JSON 后添加换行。先发送 initialize 控制请求，再发送 user 消息。CLI 在标准输出发送 can_use_tool 请求；GUI 通过相同 request_id 返回 control_response。

允许操作的 response 使用 `behavior: "allow"` 和原始 `updatedInput`；拒绝使用 `behavior: "deny"` 和 `message`。用户提问在 updatedInput 中保留 questions，并添加以问题原文为键的 answers。会话内允许使用 updatedPermissions，destination 为 session。中断使用 subtype 为 interrupt 的 control_request。

协议字段与官方 Python SDK 的子进程实现交叉核对，但实验直接启动本机 CLI，没有安装 SDK 或复用第三方产品代码。

## 必须处理的边界

1. **补充消息不等于排队。** 本次是在工具等待审批时注入，消息并入了当前轮；没有证明正在生成文本时能立即改变输出。明确的发送队列应由 GUI 保存，在当前任务完成后依次发送。需要立即改变方向时，可以采用已验证的 interrupt 后发送新消息路径。
2. **中断不等于暂停。** 本次中断返回 error_during_execution，进程继续可用。GUI 应识别主动停止，避免当成普通服务错误；不能承诺恢复到被中断的代码执行位置。
3. **并非所有审批都能记住。** 初次权限有效期实验使用 Windows 8.3 短路径 ADMINI~1，触发 safetyCheck 和 suppress_always_allow_rule=true，会话规则仍未免除下一次审批。改用规范路径后，普通写入的会话规则通过。界面必须尊重该标记，不能绕过 CLI 的逐次检查。
4. **取消审批后应撤销对应卡片。** 根据 control_cancel_request 清理请求，禁止继续提交过期答案。迟到答案、重复答案和重连恢复尚未覆盖。
5. **一条 result 结束一轮，不等于进程结束。** 常驻会话需要重新设计当前每条消息一个进程、写完 stdin 即关闭的运行生命周期；后台任务还可能产生后续事件。
6. **停止命令的范围有限。** 本次确认了普通 Bash/Node 子进程，不涵盖主动脱离进程树的后台服务、所有 Windows 工具或所有并发子代理。
7. 计划拒绝与修改、多选题和自由输入、并行审批、断流恢复及版本兼容仍需后续覆盖。本次不将它们列为实测通过。

## 重现

```powershell
node scripts/interactive-protocol-smoke.cjs
# 只运行指定项：
node scripts/interactive-protocol-smoke.cjs permission-lifetime cancel-pending-approval
```

脚本会产生真实模型调用，使用临时工作目录、受限工具和不持久化会话；不更改应用会话数据及原生 settings.json。连接环境只在内存传给子进程。实验脚本中的自动审批仅用于这些固定测试，不是产品权限策略。

官方依据：

- [Claude Code 非交互运行](https://code.claude.com/docs/en/headless)
- [审批与用户输入](https://code.claude.com/docs/en/agent-sdk/user-input)
- [流式输入](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- [官方 SDK 子进程控制协议实现](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py)
