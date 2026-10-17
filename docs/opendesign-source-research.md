# OpenDesign 源码调查

调查日期：2026-10-16。参考仓库：[nexu-io/open-design](https://github.com/nexu-io/open-design)，固定提交 `7abd6fc2b11987c3940eb4ffc461478ff37c0b33`。同名项目较多，本次按这个 Claude Design 开源替代项目研究。

## 查阅的实现

- [评论协议类型](https://github.com/nexu-io/open-design/blob/7abd6fc2b11987c3940eb4ffc461478ff37c0b33/packages/contracts/src/api/comments.ts)：目标包括文件、元素 ID、选择器、文字、位置、HTML 提示、样式；支持附图、成员集合和版本信息。评论锚点区分 anchored、reanchored、stale、lost，避免元素变化后静默指向错误位置。
- [评论上下文组织](https://github.com/nexu-io/open-design/blob/7abd6fc2b11987c3940eb4ffc461478ff37c0b33/apps/web/src/comments.ts)：将结构化元素信息、批注、样式和可用截图组织为聊天上下文；明确截图不存在时不能声称已附图。
- [编辑模式桥](https://github.com/nexu-io/open-design/blob/7abd6fc2b11987c3940eb4ffc461478ff37c0b33/apps/web/src/edit-mode/bridge.ts)：使用显式元素标识和来源路径映射，区分文本、链接、图片、容器；复杂嵌套内容不能假设可安全直接改写为平面文本。
- [预览面板](https://github.com/nexu-io/open-design/blob/7abd6fc2b11987c3940eb4ffc461478ff37c0b33/apps/web/src/components/PreviewModal.tsx)：沙箱预览、视口处理、截图与配套编辑界面的组织。

## 本应用采用的方式

采用“元素快照 + 用户要求 + 截图”的上下文思路，保留选择器、文字、HTML、计算样式和位置，并把详细数据从输入框移到元素标签及消息详情中。发送前发现文档或元素不再匹配时要求重新选择，当前不实现 OpenDesign 的完整锚点漂移和重定位系统。

OpenDesign 对自己生成或注入来源标识的内容，可以实现更准确的 DOM 到源码映射。本应用需要浏览任意开发服务器与外部网站，因此不假设元素天然有来源标记；交由 Claude 结合项目搜索源码，再使用原生编辑工具修改，最后刷新验证。

本应用的浏览器与操作桥为独立实现，使用 Electron WebContentsView、每聊天浏览器会话与临时 stdio MCP 工具。没有复制上述项目的产品源码、提示词、素材或设计系统，也没有将其作为运行依赖。

## 许可

仓库顶层 [LICENSE](https://github.com/nexu-io/open-design/blob/7abd6fc2b11987c3940eb4ffc461478ff37c0b33/LICENSE) 为 Apache-2.0。若未来实际引入其代码，应按照许可保留版权、许可及适用 NOTICE，标注改动，并单独检查所使用目录和素材的许可。本次只参考行为和架构。
