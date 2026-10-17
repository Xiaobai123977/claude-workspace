# 插件、Skills、MCP 与公开市场

实现与实测日期：2026-10-15。

入口：左侧拼图图标“扩展”，或 `/` 菜单的“扩展”。页面采用与设置页一致的左侧分类和右侧内容布局。

## 公开目录

| 来源 | 获取方式 | 无登录实测 |
|---|---|---|
| Anthropic 官方插件 | `anthropics/claude-plugins-official` 的 marketplace.json | HTTP 200，315 个插件 |
| Anthropic Skills | `anthropics/skills` 的 marketplace.json，独立技能读取 SKILL.md | HTTP 200，本次显示 24 个插件/Skill 条目 |
| Superpowers 社区 | `obra/superpowers-marketplace` 的 marketplace.json | HTTP 200，10 个插件 |
| MCP 官方 Registry | `/v0.1/servers?version=latest&limit=30` | HTTP 200，支持搜索和游标分页 |

条目数量会变化。前三个来源通过 GitHub Raw 公共文件读取，没有调用需要令牌的 GitHub 搜索接口。另支持添加公开 GitHub 仓库 `owner/repository` 的 main 分支市场清单。

添加来源只加入本应用的浏览列表；选择具体插件安装时，才通过 Claude CLI 注册对应市场和安装插件。打开扩展页面不会安装任何插件、执行 Skill 或启动 MCP。MCP 的“检测连接”以及后续聊天可能启动 stdio 服务器或连接远程服务。

Skills.sh 的 `/api/v1/skills` 实测返回 HTTP 401，要求 Vercel OIDC Token，因此没有作为免登录 API 接入。目录免登录不代表扩展服务免鉴权或免费；Registry 没有提供足以保证所有服务免鉴权的统一字段，页面保留这一差别。

## 已实现

- 插件：读取 Claude 原生安装记录，按当前项目过滤；安装预览、安装作用域、启用、停用、更新、卸载。卸载保留插件数据目录。管理命令通过原生 CLI 完成，未自行伪造安装状态。
- Skills：扫描用户和项目目录，以及启用插件提供的技能；显示内容；独立安装 Anthropic Skill 及其配套文件；配置原生 skillOverrides 的四种调用方式。插件 Skill 以插件命名空间进入 `/` 菜单，随插件管理。
- 独立 Skill 安装：使用临时 Git 稀疏检出；校验预览内容；拒绝覆盖已有目录和复制符号链接；复制完整技能目录。Windows 检出禁用自动换行转换，避免内容校验误报。临时下载完成后清理。
- MCP：读取 user/local/project 配置，显示作用域、传输和脱敏地址；从 Registry 预填配置，或手动添加 JSON；按项目启停、主动检测连接、移除。读取列表不执行服务器。
- Registry 转换：支持 HTTP/SSE 远程端点和公开 npm Registry 的固定版本 stdio 包。缺少必要信息、非 npm 包或复杂运行时参数时要求手动填写，未猜测执行命令。
- 修改 Skill 调用方式或 MCP 启停时保留原配置的其他字段并备份；项目个人设置加入 Git 忽略。
- 扩展修改及相关原生配置变化在下次发送消息时重建 Claude 连接，让新增扩展生效；不会中断正在运行的任务。只将 MCP 相关字段纳入配置变更判断，避免普通历史/UI 状态更新清空会话内授权。
- 修复默认配置目录行为：未显式选择 profile 时不传 CLAUDE_CONFIG_DIR，避免把原生 `~/.claude.json` 中的个人 MCP 错误迁移到 `~/.claude/.claude.json` 查找。

## 目前边界

- 尚无插件选项配置表单、MCP OAuth 登录向导、独立 Skill 卸载/升级界面。
- 插件自带 MCP、组织管理服务器和 claude.ai 连接器不在个人 MCP 配置列表中；插件 MCP 随插件管理。
- 部分插件要求原生安装命令确认或额外配置，CLI 会报告要求；本应用不自动传 `--yes` 接受市场声明的安装命令。
- 安装依赖本机 Claude CLI 和 Git；stdio MCP 的运行还依赖对应运行时。
- 不把“已配置”“已启用”标为“已连接”。连接检测只显示 CLI 报告的状态，不回显原生配置中的 Token、环境变量值或完整连接详情。
- 目录缓存仅在进程内保留 5 分钟；网络不可用时显示错误，可重试或切换来源。

## 验证

- 23 个单元测试通过，新增覆盖公开目录的被动读取、安装预览变化拒绝、插件作用域、命名空间、Skill 设置与备份、MCP 脱敏/启停、配置指纹和默认 profile 行为。
- 聊天、审批、设置三个既有 Electron 集成测试通过。
- `npm run test:extensions-ui` 使用真实公开目录和原生 CLI，在隔离 profile 中通过 UI 安装 Superpowers 市场的 elements-of-style，执行启停/卸载；验证 Skill 内容预览/调用方式和菜单刷新，MCP 添加/启停/移除。
- `node scripts/extensions-real-smoke.cjs` 额外完成原生插件完整生命周期、HTTP MCP 实际握手、公开 Skill 下载/安装、原生配置保持不变。无模型调用。
- 结果：`artifacts/extensions-real-smoke.json`；截图：`artifacts/extensions-market-official.png`、`extensions-skill-preview.png`、`extensions-installed.png`、`extensions-mcp.png`、`extensions-market-mcp.png`。

## 来源

- [Claude 插件管理](https://code.claude.com/docs/en/discover-plugins)
- [Claude Skills 配置](https://code.claude.com/docs/en/skills#override-skill-visibility-from-settings)
- [Claude MCP 配置](https://code.claude.com/docs/en/mcp)
- [Anthropic 官方插件市场](https://github.com/anthropics/claude-plugins-official)
- [Anthropic Skills](https://github.com/anthropics/skills)
- [Superpowers Marketplace](https://github.com/obra/superpowers-marketplace)
- [MCP Registry API](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/openapi.yaml)
- [Skills.sh API 鉴权](https://www.skills.sh/docs/api)
