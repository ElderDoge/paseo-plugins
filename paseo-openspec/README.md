# OpenSpec 变更面板

在 Paseo 里直接查看当前工作区的 OpenSpec 变更列表，并阅读每个变更的提案、设计、任务与规格文档，不必再切到编辑器或终端。

## 功能

- 在面板中列出当前工作区所有活跃变更，每行显示变更 id、任务状态（无任务／进行中／已完成）、由 `proposal.md` 首行标题或首段正文提取的一句话摘要、任务进度条与完成数（如 `3/5`）、以及最近修改时间的相对描述（`刚刚`、`3 分钟前` 等）。
- 变更数据来自守护进程在**工作区目录**下执行 `openspec-cn list --json`（找不到时回退到 `openspec`），面板每 15 秒视为新鲜，可随时点「刷新」重新拉取。
- 选中变更后，用标签页阅读四类文档：`proposal.md`（提案）、`design.md`（设计）、`tasks.md`（任务），以及该变更 `specs/<规格 id>/spec.md` 下的每个规格；尚未创建的文件标签显示为「<名称>（尚未创建）」并置灰不可点。
- 文档正文由 `openspec-cn list --json` 返回的项目根目录下的 `openspec/` 读取，以 Markdown 渲染（标题、列表与任务复选框、表格、代码块、引用、行内代码／粗体／斜体／链接）。
- 变更详情头部提供复制菜单，可一键复制变更 id 或 `/opsx:apply <id>`、`/opsx:archive <id>`、`/opsx:verify <id>` 三个斜杠命令，复制结果通过 toast 提示。
- 面板同时注册在工作区侧栏与 Explorer 中；窄布局下一次只显示一列，可用「变更／文档」按钮在列表与文档之间切换（宽布局下按钮为「隐藏列表／显示列表」）。

## 安装

从 GitHub 安装：

```sh
paseo plugin install git:ElderDoge/paseo-plugins:paseo-openspec
```

在本仓库内以开发模式安装：

```sh
paseo plugin install "$PWD"
paseo plugin reload paseo-openspec
```

（开发模式命令需在本插件目录 `paseo-openspec/` 下执行。）

## 依赖与前置条件

- **目标机器必须已安装 openspec CLI，并能在守护进程的 PATH 中或常见安装目录下被找到。** 插件按 `openspec-cn` → `openspec` 的顺序查找可执行文件；查找目录依次为守护进程的 `PATH`、nvm 各版本 node 的 `bin`（新版本优先）、`~/.local/bin`、`~/bin`、`~/.bun/bin`、`~/Library/pnpm`、`~/.volta/bin`、`~/.npm-global/bin`、`/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`。若找不到，面板会列出实际查找过的目录。
- CLI 是 `#!/usr/bin/env node` 脚本，因此运行时会把该可执行文件所在目录加进 `PATH` 前缀，让 shebang 能找到安装它的 node。
- 工作区中必须有 OpenSpec 根目录（即存在 `openspec/` 目录）；没有时面板提示在项目根目录运行 `openspec-cn init`。
- 需要 Paseo 版本 `>=0.8.0`（见 `paseo-plugin.json` 的 `requirements.paseo`）。
- 无需配置任何密钥或环境变量。

## 用法

1. 打开一个已初始化 OpenSpec 的工作区，在侧栏或 Explorer 中打开「OpenSpec 变更」面板（也可在命令中心搜索「打开 OpenSpec 变更面板」，关键词支持 openspec／变更／规范／spec／任务）。
2. 面板顶部显示项目根路径与活跃变更数量；左侧（窄屏为列表视图）是变更列表，点击任意一行查看详情。
3. 详情区顶部是该变更的 id、状态、任务进度与最近修改时间，右侧复制图标可展开复制菜单。
4. 下方标签页切换提案／设计／任务／规格文档，正文以 Markdown 渲染并滚动阅读。
5. 点「刷新」重新执行 CLI 并重新读取文档，再切换标签页查看其余文档。

## 文件结构

| 路径 | 职责 |
| --- | --- |
| `index.server.ts` | 守护进程侧入口，注册 `openspec.list` 与 `openspec.document` 两个 RPC。 |
| `index.client.tsx` | App 侧入口，注册工作区面板（`locations: ["workspace", "explorer"]`）与命令中心条目。 |
| `server/cli.ts` | 定位 `openspec-cn`／`openspec` 可执行文件、构造查找目录、以 20 秒超时和 32MB 上限执行 `list --json`。 |
| `server/panel.ts` | 调用 CLI 并解析其 JSON，解析工作区根目录、缓存工作区→`openspec/` 映射，向面板返回变更列表或错误状态。 |
| `server/documents.ts` | 从 `openspec/changes/<id>/` 读取 `proposal.md`／`design.md`／`tasks.md`／`specs/*/spec.md`，提取摘要，做路径与符号链接校验。 |
| `shared/openspec.ts` | 客户端与守护进程共用的 RPC 定义（输入/输出 zod schema）与文档大小上限常量。 |
| `client/panel.tsx` | 面板组件：变更列表、详情头部与复制菜单、文档标签页、刷新与各类空/错误状态，并做窄布局适配。 |
| `client/markdown.tsx` / `client/markdown-parse.ts` | 轻量 Markdown 解析与渲染（块级与行内）。 |
| `client/format.ts` | 任务状态中文标签与相对时间格式化。 |
| `paseo-plugin.json` / `package.json` / `tsconfig.json` | 插件清单（id、name、description、Paseo 版本要求）与 TypeScript 构建配置。 |

## 已知限制

- 面板只读：可以查看变更与文档，但创建、应用、归档变更仍需在终端里运行 openspec CLI 或使用斜杠命令（复制菜单只负责把命令文本放进剪贴板）。
- 强依赖 `openspec-cn list --json` 的 JSON 结构与字段名（`changes[].name`、`completedTasks`、`totalTasks`、`lastModified`、`status`、`root.path`、`root.source`）；上游 CLI 若改变输出格式，面板会退化为「未返回可解析的 JSON」错误。
- 只读取变更目录内的 Markdown：路径必须匹配 `changes/<id>/**/*.md`，且解析符号链接后仍位于 OpenSpec 根目录内，否则拒绝读取；`openspec/changes` 之外的文档（如 `openspec/project.md`）不展示。
- 单个文档最多读取并渲染 512KB，超出部分被截断，界面会提示实际大小。
- 一次 `list --json` 超过 20 秒未返回或输出超过 32MB 会直接报错。
- 面板不做归档过滤，展示的就是 `list --json` 返回的变更集合；已归档变更是否出现取决于 CLI 的输出。
- 变更列表依赖 CLI 报告的 `lastModified`；时间戳无法解析时显示「时间未知」。
