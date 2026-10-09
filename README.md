# paseo-plugins

ElderDoge 自制的一组 [Paseo](https://paseo.sh) 插件，放在同一个仓库里，每个子目录一个插件。

| 子目录                | 插件         | 作用                                                     | 额外前提                              |
| --------------------- | ------------ | -------------------------------------------------------- | ------------------------------------- |
| `paseo-slash-palette` | 斜杠命令面板 | 在输入框旁为每个 agent 提供斜杠命令面板，可搜索、填参数、编辑并固定常用命令 | 无                                    |
| `paseo-quota`         | 额度看板     | 用 Paseo 里配置的服务商密钥实时读取订阅额度               | 需要在插件设置页填入各服务商密钥      |
| `paseo-omp-hud`       | omp 实时状态 | 在 agent 药丸上显示 omp 当前工具调用、生成速度与待办进度 | 目标机器使用 omp                      |
| `paseo-openspec`      | OpenSpec     | 在工作区面板查看 OpenSpec 变更列表与提案/设计/任务/规格文档 | 目标机器 PATH 上有 `openspec-cn` 或 `openspec` |

每个插件的功能、用法与已知限制见对应子目录的 `README.md`。

## 安装

先在目标机器的 Paseo 里启用插件（设置 → 插件），然后执行：

```bash
paseo plugin install git:ElderDoge/paseo-plugins:paseo-slash-palette
paseo plugin install git:ElderDoge/paseo-plugins:paseo-quota
paseo plugin install git:ElderDoge/paseo-plugins:paseo-omp-hud
paseo plugin install git:ElderDoge/paseo-plugins:paseo-openspec
```

冒号后的部分是仓库内的子目录。装到别的守护进程时加 `--host <url>`。

## 更新

```bash
paseo plugin update
```

已安装的插件跟随本仓库的新提交更新。

## 开发

本机调试时直接指向工作目录，改完重载即可：

```bash
cd paseo-quota
npm install
npm run typecheck
paseo plugin install "$PWD"
paseo plugin reload paseo-quota
```

## 目录约定

每个插件子目录结构一致：

| 路径               | 运行位置 | 作用                         |
| ------------------ | -------- | ---------------------------- |
| `paseo-plugin.json` | 清单     | 插件 id、显示名、描述、Paseo 版本要求 |
| `index.server.ts`  | 守护进程 | 服务端能力注册入口           |
| `index.client.tsx` | App      | 界面能力注册入口             |
| `server/`          | 守护进程 | 服务端实现                   |
| `client/`          | App      | 界面实现                     |
| `shared/`          | both     | RPC 契约与共享类型           |

## 许可

MIT，见 [LICENSE](LICENSE)。
