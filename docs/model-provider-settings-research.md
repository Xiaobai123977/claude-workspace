# 模型接入与设置调查

调查日期：2026-10-15。范围：现有应用、Ekko Studio 源码、本机 Claude Code 2.1.299、官方协议文档。此次只研究；没有修改产品设置界面或接入流程。

## 结论

建议将当前平铺环境变量的设置重构成“服务商连接 → 模型列表 → 每个模型的能力与默认参数”。保留“继承本机 Claude”作为独立入口。普通用户只需要选连接、模型和模型实际支持的思考选项；协议兼容、模型别名和参数修正放进高级设置。

不能把 CLI 接受的参数、CLI 内置模型选项和上游模型能力视为同一个来源。多协议接入也需要实际转换请求、流事件和工具消息，增加协议下拉框本身不能实现接入。

## 当前应用的实际问题

- `src/main.tsx` 写死 sonnet / opus / haiku；思考菜单对所有模型显示同一组档位。
- `src/SettingsPage.tsx` 主要编辑 API 地址、两种凭证和别名；没有多连接管理、协议选择、模型获取、能力来源及按模型保存参数。
- “测试连接”使用已保存配置和当前聊天的模型，未必是设置页正在编辑的目标；修改后必须先保存，无法测试草稿连接。
- 原生登录状态和独立 API 连接状态混在一起。CLI 没有订阅登录，不等于 API Key 接入不可用。
- 默认模型和 `ANTHROPIC_MODEL` 同时可编辑，存在覆盖关系；需要展示最终来源，降低重复设置。
- 当前默认推理强度包含 `max`。官方文档说明会话 `--effort` 与持久化键接受的取值不同，原生 `effortLevel` / `modelSettings` 不接受 `max`。应分开校验；应用若保存会话偏好，也不能原样写入这些原生键。

以上原生配置语义参见 [Claude Code 模型配置](https://code.claude.com/docs/en/model-config)。

## 本机只读验证

脚本：`scripts/model-capability-research.cjs`；脱敏结果：`artifacts/model-capability-research.json`。

执行 CLI initialize 和当前已配置网关的 Models GET，没有发送生成消息，没有修改用户 Claude 设置，没有读取或输出订阅 OAuth 凭证。

| 来源 | 实际结果 | 能证明什么 |
| --- | --- | --- |
| CLI initialize | 返回 default、opus、fable、sonnet、haiku，带 resolvedModel 和 supportedEffortLevels | CLI 自己提供的选项和能力判断 |
| 当前网关模型接口 | HTTP 200，返回 deepseek-v4-flash、deepseek-v4-pro、deepseek-v4.1-flash | 该连接当前公布的模型 ID |
| 网关元数据 | 只有基本字段及 supported_endpoint_types: ["openai"] | 不能确认思考档位、上下文长度，也不能据此断定 Responses 或 Messages 已通过验证 |

本机 opus / sonnet / haiku 都解析到 deepseek-v4.1-flash；CLI 中的 fable 在网关返回列表里没有出现。CLI 报告的思考档位不能直接作为网关支持证明；模型不在列表里也不应直接删除用户手动配置，因为目录可能不完整。

应区分用户选择的别名、CLI 解析的 ID、服务端响应报告的 ID。最后一项仍是服务端声明，不能作为实际模型权重身份的独立证明。

## Ekko Studio 应参考什么

源码版本：`d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db`。

1. Claude 仍执行 Agent 工具循环，前面增加本地转换代理。代理分别接入 Anthropic Messages、OpenAI Chat Completions、OpenAI Responses，转换普通回复与流事件。[proxy.ts](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/services/claude-code/proxy.ts)
2. 适配器处理 system、工具定义、工具结果、图片和历史推理字段；Chat 与 Responses 的思考字段不同，不能只替换 URL。[anthropic.ts](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/protocol/adapters/anthropic.ts)
3. 地址解析独立处理 API 根地址、版本前缀和完整端点，避免重复拼接 `/v1`。[endpoint-resolver.ts](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/coding-agents/protocol/endpoint-resolver.ts)
4. 目录刷新保留缓存和已选模型，比每次失败就清空列表更适合桌面应用。[model-catalog-cache.ts](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/hermes/services/providers/model-catalog-cache.ts)

不宜照搬的部分：其简单目录获取只留下 ID、失败返回空数组；思考选项缺少元数据时会回退到整套档位。我们应保留未知状态和具体错误，而不是把未知视为全部支持。[provider-catalog.ts](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/server/src/modules/studio/public/provider-catalog.ts)、[model-reasoning-effort.ts](https://github.com/EKKOLearnAI/ekko-studio/blob/d4fd93e1d9ee2c20f9190e37b13d8a40928cd7db/packages/client/src/utils/model-reasoning-effort.ts)。

Ekko 源码当前采用 BSL 1.1。此处参考架构，后续独立实现。

## 应提供的设置

| 设置 | 展示层级 | 规则 |
| --- | --- | --- |
| 使用本机 Claude / 独立服务商连接 | 基础 | 本机模式继承 CLI 登录与配置，独立模式提供连接表单 |
| 连接名称、多连接切换 | 基础 | 密钥按连接隔离存储；聊天记录绑定稳定的连接 ID |
| 接口协议 | 基础 | 三类 HTTP 协议；预设可代填，但允许手动选择 |
| API 地址 | 基础 | 预览最终请求端点，支持合法路径前缀，避免重复拼接 |
| 认证方式与凭证 | 基础 | API Key / Bearer / 环境变量引用 / 无认证；按协议预设，避免同时要求两套凭证 |
| 获取模型、搜索、手动添加 | 基础 | 获取失败仍可手填；分页、刷新、最近更新时间和错误明确展示 |
| 默认模型、收藏或常用模型 | 基础 | 默认影响新聊天；当前聊天单独选择；不静默改动运行中的请求 |
| 思考模式与强度 | 按能力展示 | 继承默认始终可用；支持开关才显示开关，支持档位才列真实档位 |
| 连接与兼容性检查 | 基础 | 区分模型目录读取、文本生成、工具调用验证；测试使用草稿连接 |
| 每个模型的上下文与输出限制 | 自动展示；高级修正 | 优先元数据；未知时可修正，但必须由运行时实际采用；不能突破服务端硬限制 |
| 固定思考预算 | 高级、条件显示 | 仅适配器和具体模型都支持时出现，不能把强度直接换算成固定 token |
| 子代理模型、Claude 别名映射 | 高级 | 默认继承；按实际路由能力开放，不强制用户填写三个别名 |
| 超时与有限重试 | 高级 | 区分连接、流空闲等超时；已经产生回复或工具操作后不能盲目重放 |
| 备用模型 | 后续高级功能 | 明确是否允许切换，并显示实际切换；跨连接需要单独路由支持 |
| 自定义请求头、兼容参数 | 专家选项 | 明确合并顺序；防止覆盖消息、工具、流和认证等关键字段 |

连接协议预设属于易用性功能，不应将“服务商名称”与“协议”永久绑定。同一服务商可以有多个地址、账户及协议连接。

## 模型列表和能力如何获取

优先使用该连接的官方模型接口、模型详情接口及供应商扩展字段；本机继承模式同时读取 CLI initialize。保留来源，分别显示，不互相伪装。

- OpenAI 官方 Models 接口提供 ID、归属等基本信息，没有统一的思考档位字段；不能承诺所有 OpenAI 兼容服务都能自动发现完整能力。[OpenAI Docs：List models](https://developers.openai.com/api/reference/resources/models/methods/list)
- Anthropic Models 定义包含能力信息，可用于按模型发现支持情况。[Claude API：Models](https://platform.claude.com/docs/en/api/models)
- DeepSeek 当前官方模型列表包含上下文、输出限制、模态和 `effort.supported_levels` 等字段；第三方转发站可能不转发这些信息，本次网关就是如此。[DeepSeek：Lists Models](https://api-docs.deepseek.com/api/list-models/)

无法发现时：显示“未知 / 使用服务商默认”，允许高级手动声明。官方文档和第三方静态目录只能提供标明来源的参考，不能把相似名称当成精确匹配或网关验证结果。

每项能力至少记录支持 / 不支持 / 未知、来源、更新时间；可执行选项还必须受转换适配器、CLI 版本和组织限制约束。不同协议的同名档位不保证同等含义，应由适配器显式映射。

列表缓存按连接身份、地址、协议隔离，不在日志或缓存键中明文存密钥。刷新失败保留最后成功列表；区分无模型、鉴权失败、接口不支持和网络错误。支持手动保留目录中已消失的模型。

## 思考相关设置必须拆开

| 概念 | GUI 处理 |
| --- | --- |
| 是否进行思考 | 模型与协议支持时提供开关 |
| 思考强度 | 每个模型自己的可用档位；默认不显式覆盖 |
| 固定思考 token 预算 | 仅支持固定预算的模型显示 |
| 显示思考内容或摘要 | 展示偏好，只能显示服务实际返回的内容 |

“继承默认”“明确关闭”“固定预算为 0”不能混为一谈。请求参数按协议产生；切换模型后重新确认有效选项。Responses 的 reasoning 配置和 Chat 的字段不能通用复制；OpenAI 返回的推理摘要也不等于完整内部思考。[OpenAI Docs：Reasoning](https://developers.openai.com/api/docs/guides/reasoning)

## 无需作为普通设置的内容

- 完整环境变量清单、重复默认模型入口、三组必填 Claude 别名：保留来源诊断和高级兼容入口即可。
- temperature、top_p、top_k、seed、惩罚系数等通用聊天参数：目前没有足够的编码 Agent 使用需求；只有确认能生效且有明确场景时才加入高级设置。
- 流协议版本、事件分片、SSE 保活、工具格式、代理路由 token：由后端处理，不要求普通用户配置。
- 工具支持、图片输入等：主要是能力标识和校验；开一个开关无法让模型获得不存在的能力。不要静默丢弃附件。
- “允许模型调用工具”不能与 Claude 的工具执行授权混淆；权限继续使用现有权限机制。
- Embedding、音频生成、图片生成模型选择：不属于当前 Claude 编码 Agent 的模型设置。
- ACP、其他 Agent 的 RPC、Codex App Server：属于执行器接入，不是本次三个模型 HTTP 协议。
- 原始 OAuth token 编辑器：本机模式沿用原生登录。
- 价格和 token 限制不要写成保证值；元数据来源与实际账单不同，未知时不编造。
- 打开设置页自动发送生成探测：无需；目录获取可自动刷新，产生用量的兼容性测试由明确的测试操作触发。

## 推荐页面组织和后续验收

设置侧边栏：服务商连接、模型管理、模型高级设置。聊天输入框只保留连接 / 模型 / 条件出现的思考控制；选中模型可查看能力来源和最终生效配置。

实施顺序：连接数据结构与安全凭证 → 三协议代理 → 目录缓存和能力模型 → 动态设置与聊天选择 → 草稿测试与诊断。保持本机继承路径可用，不先发布没有实际请求映射的控件。

验收应覆盖三协议的文本流、工具参数分片、工具结果回传、思考历史、图片、错误、取消和用量统计。使用本地模拟服务验证协议转换；真实生成测试单独执行。Models GET 成功、生成成功、工具循环成功是三个不同层级的结果。

本次只验证初始化和模型目录读取，尚未证明三个上游协议和各思考档位在当前网关端到端可用。
