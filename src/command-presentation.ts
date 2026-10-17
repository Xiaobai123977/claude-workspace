// Default shortcuts are deliberately smaller than the CLI's available catalog.
export const commonCommands = ['code-review', 'simplify', 'security-review', 'init', 'run', 'goal', 'loop', 'compact', 'clear']
const purposes: Record<string, string> = {
  'code-review': '审查代码改动，查找错误与潜在问题',
  simplify: '检查代码复用、简化与效率，整理最近改动',
  'security-review': '检查当前分支改动中的安全风险',
  init: '分析项目，创建或完善项目说明 CLAUDE.md',
  run: '启动当前项目，检查应用运行与改动效果',
  compact: '压缩当前对话上下文，保留摘要继续聊天',
  verify: '验证改动，检查实现是否符合要求',
  debug: '排查当前问题，定位原因并协助修复',
  'deep-research': '围绕指定主题开展深入研究',
  dataviz: '读取图表与数据可视化的制作规范',
  'update-config': '让 Claude 修改原生设置，遵循当前权限',
  'fewer-permission-prompts': '整理常用命令的权限规则，减少重复询问',
  doctor: '检查 Claude 安装与运行环境',
  loop: '按指定间隔重复执行提示或命令',
  'claude-api': '读取 Claude API 与 SDK 的开发参考',
  'workflow-authoring': '读取多智能体工作流的编写参考',
  'plugin-authoring': '读取插件与界面扩展的开发参考',
  'run-skill-generator': '为项目生成启动与验证应用的技能',
  agents: '查看或管理智能体配置',
  'auto-mode-setup': '配置原生自动权限模式',
  autocompact: '调整原生自动压缩上下文功能',
  color: '调整原生会话的颜色标识',
  'output-style': '选择 Claude 回复的输出风格',
  focus: '调整当前会话的专注模式',
  heapdump: '导出 CLI 内存快照，供故障诊断使用',
  'reload-plugins': '重新加载已安装的插件',
  'reload-skills': '重新加载本地技能',
  rename: '重命名当前会话',
  insights: '分析 Claude 的使用情况与工作习惯',
  recap: '回顾当前会话进展',
  goal: '持续工作直到完成目标；无参数查看状态，clear 清除目标',
  'list-agents': '列出可用的智能体',
  'team-onboarding': '协助团队了解项目与使用方式',
}

export function commandPurpose(command: {name: string; description: string; source: string}) {
  // A local skill can override a builtin: never describe it as the builtin.
  if (command.source === 'CLI' && purposes[command.name]) return purposes[command.name]
  if (/[\u3400-\u9fff]/.test(command.description)) return command.description
  if (command.source.includes('插件')) return `运行插件技能「${command.name}」，执行其定义的流程`
  if (command.source !== 'CLI') return `运行本地技能「${command.name}」，执行其定义的流程`
  return `执行 Claude 命令「${command.name}」；当前未提供中文用途说明`
}

export function visibleCommands<T extends {key: string; description: string}>(commands: T[], query: string): T[] {
  const search = query.trim().toLowerCase()
  if (search) {
    const rank=(key:string)=>key.toLowerCase()===search?0:key.toLowerCase().startsWith(search)?1:2
    return commands.filter(c => (c.key + ' ' + c.description).toLowerCase().includes(search)).sort((a,b)=>rank(a.key)-rank(b.key))
  }
  return commonCommands.flatMap(key => commands.filter(c => c.key === key))
}

export function visibleSuggestion(suggestion?: string) {
  return !!suggestion?.trim() && !/^\s*\//.test(suggestion)
}
