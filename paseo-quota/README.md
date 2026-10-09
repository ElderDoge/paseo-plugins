# 订阅额度

把你在 Paseo 里保存的服务商密钥，用来直接向服务商接口查询订阅额度，并把结果作为用量来源显示在 Paseo 的用量面板中。

## 功能

- 支持三家服务商，各自注册为一个独立的用量来源：ClinePass、OpenCode Go、Command Code。
- ClinePass：带密钥请求 `https://api.cline.bot/api/v1/users/me/plan/usage-limits`，按响应里的窗口类型映射为 5 小时 / 每周 / 每月三个窗口；再尽力请求 `/api/v1/users/me`，把邮箱（没有则用户 id）作为「账号」明细显示。
- OpenCode Go：请求 `https://opencode.ai/zen/go/v1/usage`，读取响应里的 `rolling` / `weekly` / `monthly` 三个窗口百分比，其中 `rolling` 按 5 小时窗口展示；接口报 `rate-limited` 时该窗口直接标为危险色。
- Command Code：先请求 `https://api.commandcode.ai/alpha/whoami` 识别账号（没有用户 id 就判为无法识别），再按需带上 `orgId` 请求 `/alpha/billing/credits`，输出 5 小时 / 每周窗口用量，并在明细里显示账号、套餐 id 与积分余额（月度额度 + 已购 + 赠送之和）。
- 每个服务商都可配置多把密钥，每把密钥是一个独立的用量来源；同一服务商配了多把时，用量卡片上会用你填的名称区分（没填名称则显示标识的前 8 位）。
- 错误提示为中文且区分原因：密钥被拒（HTTP 401/403）提示重新填写，接口不可达、15 秒超时、返回非 JSON、账号已无密钥等情况各有对应说明。
- 密钥不进入用量报告的输入：取数时只传 `accountKey`（`provider:apiKey` 的哈希，由 Paseo 提供的 `hashAccountKey` 计算），真正的密钥只在守护进程内使用。

## 安装

从 GitHub 安装：

```sh
paseo plugin install git:ElderDoge/paseo-plugins:paseo-quota
paseo plugin reload paseo-quota
```

在本地仓库中以开发模式安装（在插件目录下执行）：

```sh
paseo plugin install "$PWD"
paseo plugin reload paseo-quota
```

## 依赖与前置条件

- Paseo 版本下限：`^0.11.0`（见 `paseo-plugin.json` 的 `requirements.paseo`）。
- 至少一个服务商账号的 API 密钥，由本插件的「服务商密钥」设置页填写；密钥不来自 Paseo 的模型凭据设置，也不需要外部 CLI。
- 运行 Paseo 守护进程的机器需要能出网访问 `api.cline.bot`、`opencode.ai`、`api.commandcode.ai`。
- ClinePass 的密钥从 Cline 控制台的密钥页面获取；OpenCode Go 的密钥来自 opencode.ai 的 OpenCode Go 订阅；Command Code 的密钥从 commandcode.ai 控制台的密钥页面获取。

## 用法

- 安装后打开 Paseo 的插件设置，找到本插件的「服务商密钥」页面（图标为 KeyRound）。点「添加」新增一行：选服务商、粘贴密钥，同一服务商有多把密钥时可以再填一个「名称」，然后点「保存」。
- 密钥属于整个 Paseo 宿主（host 级设置），在这里配置一次即对所有工作区生效，保存在本机 `~/.paseo/plugin-settings/paseo-quota/accounts.json`。
- 用量显示在左侧栏的用量面板中，每个服务商一组的组名分别是 `ClinePass`、`OpenCode Go（自配密钥）`、`Command Code`；后者的后缀用于与 Paseo 内置的同名 opencode 来源区分。
- 用量面板每次取数时都会重读已保存的密钥，因此保存后不需要重载插件，刷新用量面板即可看到新账号。
- 页面支持放弃未保存的修改、删除单把密钥；读取或保存失败时提供「重试」，设置内容与插件版本不匹配时可「重置」清空密钥列表。
- 若某把密钥已被删除、而它的用量卡片仍在显示，卡片会提示该密钥已从插件设置中移除。

## 文件结构

| 路径 | 职责 |
| --- | --- |
| `paseo-plugin.json` | 插件清单：id、名称、说明与 Paseo 版本下限 |
| `package.json` / `package-lock.json` | 本地开发依赖（全部为 devDependencies，含 `@getpaseo/plugin`）与 `typecheck` 脚本 |
| `tsconfig.json` | TypeScript 配置（`noEmit`，覆盖全部 `.ts` / `.tsx`） |
| `index.server.ts` | 守护进程端入口：注册设置定义，按服务商注册用量来源，实现账号发现（仅全局范围）与取数分发 |
| `index.client.tsx` | App 端入口：在插件设置中注册「服务商密钥」页面 |
| `shared/settings.ts` | 共享定义：服务商 id、品牌名、用量面板分组名、密钥提示文案，以及 host 级设置的 schema |
| `shared/input.ts` | 共享定义：用量源输入 schema，只含 `accountKey`，不含密钥 |
| `server/accounts.ts` | 守护进程端：每次调用重读已保存密钥、按服务商过滤、计算 `accountKey`，以及密钥被删时的兜底报告 |
| `server/http.ts` | 守护进程端：带 15 秒超时的 JSON 请求封装，区分「密钥被拒」「不可达/超时」「非 JSON」，并兼容 `{ data: … }` 包装 |
| `server/providers/cline-pass.ts` | ClinePass 取数、窗口映射与账号明细 |
| `server/providers/opencode-go.ts` | OpenCode Go 取数、三个窗口映射与状态着色 |
| `server/providers/commandcode.ts` | Command Code 取数、积分余额计算、重置时间归一化与账号明细 |
| `client/accounts-screen.tsx` | 设置页 UI：密钥行的增删改、保存/放弃、错误重试与版本不匹配时的重置 |
| `client/accounts-model.ts` | 设置页纯逻辑：服务商选项、各服务商密钥计数、保存前清洗半填行、新行默认值 |
| `icons/cline-pass.svg`、`icons/opencode-go.svg`、`icons/commandcode.svg` | 三个用量来源在面板中使用的单色描边图标，跟随主题 `currentColor` |

## 已知限制

- 只发布全局（host）范围的用量来源：账号发现对非 global 范围直接返回空，所以会话级的用量卡片不会出现这些服务商；密钥为所有工作区共用。
- 密钥以明文存放在本机 Paseo 的插件设置文件中，安全性依赖该机器的文件权限；插件本身不做加密。
- 三家接口路径与响应字段都写在代码里，且 Command Code 用的是 `/alpha/` 前缀接口，服务商调整接口或字段即会导致读取失败（届时只显示错误文案）。
- 窗口长度由本插件按套餐硬编码（5 小时 / 每周 / 每月）；接口本身不报窗口长度，其中 OpenCode Go 的 `rolling` 窗口按 5 小时展示属于约定。
- 刷新时机完全由 Paseo 的用量面板决定，插件内部没有轮询或定时器。
- 单一服务商只配一把密钥时不显示名称，多把才显示；名称长度上限 60 字符，密钥保存前会去掉首尾空白。
- ClinePass 的账号明细是尽力而为：接口不可用或字段缺失时只是少一行明细，不影响窗口用量；Command Code 的窗口缺失时报告为「没有返回额度」。
