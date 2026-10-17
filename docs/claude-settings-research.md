# .claude 配置与 GUI 设置调查

调查日期：2026-10-14。当前产品只通过本机 `claude -p` 接入。

## 本机现状

只检查目录、配置键名及少量非敏感字段，未输出认证值，未读取凭据文件、聊天正文或修改 Claude 配置。

- 用户目录是 `C:\Users\Administrator\.claude`，有 `settings.json`、`plugins/`、`projects/`、`sessions/`、`cache/`、`backups/`、`history.jsonl`。
- 当前 `settings.json` 的顶层只有 `env` 和 `theme`。
- `env` 包含 API 地址、认证变量、默认模型、Opus/Sonnet/Haiku 别名映射和子代理模型配置。
- 未配置顶层 `permissions` 或 `hooks`。
- `~/.claude.json` 存在；本轮只确认存在，没有读取其内容。
- 当前 `D:\claudeGUI` 没有项目 `.claude` 目录。

因此连接配置与模型映射应列为优先事项。界面上的 `sonnet` 是选择别名，CLI 报告的实际模型可能是网关背后的另一模型。两者应分别展示。[模型配置](https://code.claude.com/docs/en/model-config)、[环境变量](https://code.claude.com/docs/en/env-vars)

## 什么可以做成设置

| 页面 | 适合提供的控件 | 配置依据 | 优先级 |
| --- | --- | --- | --- |
| 连接与模型 | 使用本机配置/应用独立配置、API 地址、认证方式、模型 ID、别名映射、子代理模型、连通性检查 | `env`、`model`、模型 CLI 参数 | 第一批 |
| 权限与目录 | 默认权限模式、允许/询问/拒绝规则表、额外工作目录 | `permissions`、`--permission-mode`、`--add-dir` | 第一批 |
| 回复偏好 | 回复语言、推理强度、输出风格 | `language`、`effortLevel`、`modelSettings`、`outputStyle` | 第一批 |
| 项目说明与记忆 | 全局/项目说明编辑器、路径规则、自动记忆开关、记忆文件浏览 | `CLAUDE.md`、`CLAUDE.local.md`、`rules/`、自动记忆设置 | 第一批 |
| MCP | 服务器列表、stdio/HTTP 配置、作用域、状态、启停、重新连接 | MCP CLI 与 `.mcp.json` | 第二批 |
| 技能与插件 | 技能列表、手动/自动调用状态、参数、来源；插件安装与启停 | `skills/`、`commands/`、`skillOverrides`、插件 CLI | 第二批 |
| 子代理 | 名称、描述、模型、工具、权限、轮数、记忆与正文编辑 | `agents/*.md` 的 frontmatter | 第二批 |
| Hooks | 事件、匹配条件、执行方式、命令/地址、超时、全部禁用 | `settings.json` 的 `hooks`、`disableAllHooks` | 第三批/高级 |
| 上下文与数据 | 自动压缩窗口、历史保留天数、Git 署名、配置诊断与备份 | `autoCompactWindow`、`cleanupPeriodDays`、`attribution` | 第二批/高级 |

上表是产品建议，不表示这些页面已经实现。JSON 键应按安装的 CLI 版本验证，不能把最新文档所有键直接写进旧版本配置。[全部设置](https://code.claude.com/docs/en/settings-reference)

## 配置在哪里写

设置页需要让用户明确选择作用域：

| 作用域 | 存放位置 | 意义 |
| --- | --- | --- |
| 仅本应用/当前调用 | 应用自己的配置，转换为 CLI 参数或 `--settings` | 不改变其他 Claude 客户端的默认配置 |
| 全局个人设置 | `~/.claude/settings.json` | 影响本机各项目 |
| 项目个人设置 | `<项目>/.claude/settings.local.json` | 当前项目个人覆盖，不应加入版本控制 |
| 项目共享设置 | `<项目>/.claude/settings.json` | 可提交给团队共享 |
| 组织管理设置 | managed settings 的实际来源 | 显示来源与限制，不作为普通可写文件 |

普通设置文件的优先级为：组织管理 → `--settings` → 项目个人 → 项目共享 → 用户。其他 CLI 参数及环境变量按字段决定覆盖关系；权限数组会合并，不能简单把整个低优先级文件丢弃。[设置来源与优先级](https://code.claude.com/docs/en/settings)

界面建议同时显示“此处保存的值”和“预计生效值”，标出继承、当前会话覆盖、组织限制；最终运行信息再用 CLI 回报校验。

## 本应用现有实现需要注意的地方

现在设置窗保存到 `%APPDATA%\Claude Workspace\workspace.json`，不是 `.claude/settings.json`。这是应用默认值，后续界面应明确标注。

现在每轮都会传模型、推理强度和权限模式。因此即使用户更改 `.claude` 默认配置，应用仍可能使用自己的会话参数。应新增“继承 Claude 配置”，只有用户显式覆盖时才传对应参数；读取到本机配置不等于已经跟随该配置运行。

模型、推理强度目前对会话有效；设置页中的默认值主要影响新聊天。工具允许/拒绝字符串则用于后续调用。新设置页需要统一解释何时生效，并避免在执行中的调用上声称设置已即时改变。

当前 Skills 扫描写死了用户目录 `.claude`。增加配置目录选择后，应按实际 `CLAUDE_CONFIG_DIR` 查找设置、技能和插件；不能只改变 CLI 的目录却继续扫描旧位置。[目录参考](https://code.claude.com/docs/en/claude-directory)

## 几个容易做错的设置

### 权限不只是“完全访问”开关

应使用规则表，而不是只有两个逗号分隔输入框。支持 allow、ask、deny 和工具/路径模板；规则顺序是 deny → ask → allow。普通设置中的 deny 不能被另一处 allow 抵消。

当前应用没有权限交互宿主，ask 规则不应显示成“会弹出确认框”。在 `-p` 中实现在线审批，需要接入专门协议。官方 Hooks 文档已描述工具暂停/恢复等集成机制，适合作为后续专项，不是增加一个开关就完成。[权限规则](https://code.claude.com/docs/en/permissions)、[Hooks 协议](https://code.claude.com/docs/en/hooks)

### MCP 不是统一写进 ~/.claude/mcp.json

- 项目共享服务器在项目根目录 `.mcp.json`。
- user/local 范围通过 `claude mcp` 管理，配置记录在 `~/.claude.json`。
- MCP 的 local 范围与 `settings.local.json` 不是同一个概念。

应优先调用 CLI 做增删改，避免覆盖 Claude 自己维护的大文件。认证应交给相应登录流程。[MCP 配置作用域](https://code.claude.com/docs/en/mcp#local-scope)

### 说明文件和自动记忆不是同一种设置

`CLAUDE.md` 和 `rules/` 是人编写的协作指令，适合编辑器；`projects/<project>/memory/` 是自动记忆文件，适合浏览、编辑、开关与路径管理。记忆路径可能被 `autoMemoryDirectory` 改写，不能仅按目录名猜测。

自动记忆受启动环境影响，应显示实际启用状态，不能只根据 JSON 的布尔值承诺一定加载。[记忆机制](https://code.claude.com/docs/en/memory)

### 技能启停不应直接改插件缓存

用户/项目技能可以编辑 SKILL.md，也可通过 `skillOverrides` 设置可见性。其状态包括 on、name-only、user-invocable-only、off；“仅手动调用”与“完全关闭”不同。

插件技能不受该字段控制，应通过插件管理器处理。安装版本、缓存、市场索引由 Claude 管理。[技能可见性](https://code.claude.com/docs/en/skills#override-skill-visibility-from-settings)、[插件](https://code.claude.com/docs/en/plugins)

### 子代理和 Hooks 适合管理页

子代理定义是 Markdown 加 frontmatter，涉及模型、工具、提示和记忆，适合表单配正文编辑器。其权限会受主会话模式影响，不应显示成独立且始终生效的权限。[子代理配置](https://code.claude.com/docs/en/sub-agents)

Hooks 是会执行的脚本或请求，适合事件列表与详细编辑器。我们的实现是每轮一个 `-p` 进程，因此启动/结束 Hooks 会在每轮进程生命周期触发，需要明确说明。官方没有“保留定义并逐个禁用 Hook”的通用开关；可删除该条定义，或禁用全部 Hooks，不应凭空写入每条 `enabled` 字段。[Hooks 配置](https://code.claude.com/docs/en/hooks)

### 原生 Windows 的沙箱选项

当前 GUI 在原生 Windows 上启动 CLI，Claude 的内置 Bash 沙箱不支持这个环境。只能显示支持状态，不能做出已开启系统沙箱的假象。WSL2 接入是另一条执行路线。[沙箱支持平台](https://code.claude.com/docs/en/sandboxing)

## 不适合作为普通配置编辑的内容

- `history.jsonl`、会话 transcript：做历史浏览/导入功能，不编辑成设置。
- `cache/`、运行期 `sessions/`、插件市场索引：做状态与维护功能，不提供任意字段修改。
- 登录会话、OAuth、凭据文件：通过登录流程与凭据存储管理，设置页只显示认证状态或遮罩。
- `theme`、`keybindings.json`、终端 renderer/statusLine：主要服务于原生终端；GUI 的主题、字号、快捷键应存为应用自己的设置。
- 组织管理设置：显示来源和锁定原因。

历史保留设置只改变 Claude 的数据清理策略；GUI 自己保存的聊天需要单独策略。不能把两种历史当作同一份存储。[目录与应用数据](https://code.claude.com/docs/en/claude-directory)

## 下一版推荐范围

第一批先做：配置作用域/来源、连接与模型映射、权限规则表、回复语言与风格、CLAUDE.md/项目规则编辑器。

写入实现应保留未知键、只改选中字段、保存前校验、备份原文件、检测外部修改。用户看到修改预览后主动保存，不在打开页面或切换项目时自动改写本机配置。涉及认证值时只在专用输入/存储通道处理，不放进日志或发送给模型。

第二批做 MCP、技能/插件、子代理与记忆管理；高级页再承接 Hooks、压缩、数据保留与 Git 署名。

本轮只完成调查，没有修改用户 `.claude` 或当前应用设置行为。
