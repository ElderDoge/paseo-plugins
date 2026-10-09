# omp 实时状态（OMP HUD）

在 Paseo 里给每个 omp agent 加一个 composer 药丸，实时显示它此刻在干什么、刚做完什么、模型响应速度和待办进度。

## 功能

- **当前动作指示**：守护进程读取该 omp 会话日志（journal）的尾部 1 MiB、最多 4000 行，从最新的 `tool_execution_start` 条目里找出「还没有匹配 `toolResult`」的那次工具调用，即正在执行的调用；同时统计并发在飞的调用数量。药丸文字优先显示该调用携带的 intent，没有 intent 时退回工具名。
- **阶段跟随**：只有在 Paseo 报告的 agent 状态为 `running` 时才算活；`running` 且有在飞调用显示「执行中」（Zap 图标、主题强调色），`running` 但模型还在响应显示「模型响应中」（Loader 图标）并把上一次动作留在药丸上，其他状态显示「空闲」（ListChecks 图标、次要前景色）。
- **最近动作**：记录最近 6 次工具调用开始（工具名、intent、开始时间），弹层里在当前动作下方再列出最多 5 条更早的动作。
- **性能指标**：从同一次扫描里取出最新的、可测量的 assistant 消息（有 `ttft`/`duration`、prompt 与 output 均大于 0），弹层显示 `首字 X.Xs · N tok/s · 缓存命中率 XX.XX%`，其中缓存命中率 = `cacheRead / (input + cacheRead + cacheWrite)`。
- **待办进度**：取最新的 `todo` 工具结果或 `user_todo_edit` 快照，按阶段列出任务，用 `✓ ▶ ! ✕ ·` 标记 completed / in_progress / blocked / abandoned / pending，进行中的任务高亮；药丸在空闲时显示当前 in_progress 任务的文本。

## 安装

从 GitHub 安装（在任意机器上执行）：

```bash
paseo plugin install git:ElderDoge/paseo-plugins:paseo-omp-hud
```

在本仓库中开发调试（进入插件目录后执行）：

```bash
cd paseo-omp-hud
paseo plugin install "$PWD"
paseo plugin reload paseo-omp-hud
```

## 依赖与前置条件

- **Paseo 版本**：需要 `>=0.8.0`（见 `paseo-plugin.json` 的 `requirements.paseo`）。
- **目标机器上必须有 OMP**：药丸只对 provider 为 `omp` 的 agent 生效，所以 Paseo 里要能创建/运行 omp agent。
- **omp 会话日志必须能被守护进程读到**：日志文件路径不是插件写死的，而是取自 Paseo agent 记录的 `persistence.nativeHandle`；插件不做路径配置。因此守护进程和 omp 的会话数据目录必须位于同一台机器（同一文件系统），远程或容器内的 omp 会话读不到。
- **OMP 之外无额外依赖**：插件自身不需要任何 CLI、密钥或环境变量。
- 刚创建的 omp 会话在写出第一条 assistant 消息前还没有日志文件，此时插件读到空快照并显示「空闲」，不报错。

## 用法

安装后在 Paseo 中无需任何配置：

1. 打开一个 omp agent（provider 为 `omp`，且属于某个 workspace）。
2. agent 的 composer 区会出现一个药丸：图标 + 一行当前状态文字（例如 `bash：运行测试`、`思考中…`、某条待办文本，或 `空闲`），文字过长由 Paseo 按药丸宽度截断，鼠标悬停的 title 里保留完整工具名。
3. 点击药丸弹出面板，从上到下依次是：阶段文字（`执行中` / `模型响应中` / `空闲`）、当前动作（`工具名：intent`）、`最近动作` 列表、性能行 `首字 4.6s · 88 tok/s · 缓存命中率 99.81%`、待办清单。还没有读到任何会话记录时面板显示「尚未读到 omp 会话记录。」。
4. agent 被删除或换了 workspace、不再有日志文件时，药丸自动移除。

## 文件结构

| 路径 | 职责 |
| --- | --- |
| `paseo-plugin.json` | 插件清单：`id`、`name`、`description`、`requirements.paseo` |
| `index.server.ts` | 守护进程入口：把 `activity.get` RPC 注册到 Paseo |
| `server/activity.ts` | RPC handler，把 `sessionFile` 转交给 `readOmpActivity` |
| `server/session-reader.ts` | 读取并解析 omp 会话日志尾部，产出快照；按文件 `ino/size/mtimeMs` 缓存上一次结果，文件未变时只做一次 `stat` |
| `shared/activity.ts` | 客户端与守护进程共享的 RPC 契约（Zod）：输入 `sessionFile`，输出 `tool` / `recent` / `todo` / `performance` |
| `index.client.tsx` | App 入口：调用 `contributePills` 注册药丸 |
| `client/pills.ts` | 跟踪 agent 列表（`agents.list` 分页 + `agents.subscribe`），订阅运行中 agent 的 timeline，按 400 ms 下限合并轮询，维护并刷新药丸 |
| `client/activity-model.ts` | 客户端活动状态容器（`useSyncExternalStore`）、阶段判定，以及药丸标签/悬停文案的生成 |
| `client/components.tsx` | 药丸图标与点击后的弹层 UI |
| `package.json` / `package-lock.json` / `tsconfig.json` | 依赖与 TypeScript 配置（依赖均为 devDependencies，运行时由 Paseo 提供宿主） |

## 已知限制

- 只扫描日志尾部：最多回看 1 MiB 或 4000 行（以先到者为准），更早的历史动作不可见；`recent` 上限 6 条，弹层只展示其中 5 条。
- 解析强依赖 omp 日志的具体结构（`tool_execution_start` 自定义条目、带 `toolCallId` 的 `toolResult` 消息、`todo` 工具结果的 `details.phases`、`user_todo_edit` 快照、消息上的 `usage`/`ttft`/`duration`）。不认识或解析失败的行会被静默跳过，因此 OMP 改变日志格式时表现为信息缺失而非报错。
- 性能行只来自最新一条可测量的 assistant 消息：纯工具调用响应没有 `ttft`，被中断或失败的请求 usage 全零且没有耗时，都会被跳过；此时弹层不显示性能行。
- 阶段与文案依赖 Paseo 推送的 agent 状态：状态不是 `running` 即判为「空闲」，只显示最新 in_progress 待办或「空闲」。
- 更新完全由守护进程推送驱动（agent 状态推送 + 运行中 agent 的 timeline 流），没有客户端定时器；宿主不提供 timeline 事件时药丸不会自动刷新。
- 文件级缓存以 `ino/size/mtimeMs` 为键：若日志被原地重写成同样大小且 mtime 未变，会继续返回上一次快照。
- 弹层自身不提供滚动容器，依赖 Paseo 宿主的外层滚动布局；这是为了不破坏移动端底部面板的高度测量。
- 每个 agent 一个药丸，不展示 omp 的子会话/子 agent；界面文案为简体中文，未做国际化。
