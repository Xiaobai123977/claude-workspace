import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.CLAUDE_GUI_DATA_DIR
const app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env })
try {
  const page = await app.firstWindow()
  const input = page.getByRole('textbox', { name: '消息输入' })
  await input.waitFor()
  await page.getByText('Claude 已连接', { exact: true }).waitFor()
  await page.screenshot({ path: path.join(root, 'artifacts/desktop-home.png') })
  await input.fill('/')
  await page.getByRole('listbox', { name: '命令菜单' }).waitFor()
  await page.screenshot({ path: path.join(root, 'artifacts/desktop-commands.png') })
} finally { await app.close() }
