import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** 本插件直接调用服务商接口读取额度的服务商集合。id 沿用服务商自身的名字，便于辨认。 */
export const PROVIDER_IDS = ["cline-pass", "opencode-go", "commandcode"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** 服务商品牌名：选择器、提示文案与分组名共用，品牌名本身保持原写法。 */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  "cline-pass": "ClinePass",
  "opencode-go": "OpenCode Go",
  commandcode: "Command Code",
};

/**
 * 用量面板里的分组名：每个服务商一组。Paseo 自带一个同名的 opencode-go 来源（读的是
 * opencode 自己的登录态），因此补一个后缀把两者区分开。
 */
export const PROVIDER_GROUP_LABELS: Record<ProviderId, string> = {
  "cline-pass": PROVIDER_NAMES["cline-pass"],
  "opencode-go": `${PROVIDER_NAMES["opencode-go"]}（自配密钥）`,
  commandcode: PROVIDER_NAMES.commandcode,
};

/** 密钥从哪里拿，显示在输入框下方。 */
export const PROVIDER_KEY_HELP: Record<ProviderId, string> = {
  "cline-pass": "从 Cline 控制台的密钥页面获取。",
  "opencode-go": "来自 opencode.ai 的 OpenCode Go 订阅。",
  commandcode: "从 commandcode.ai 控制台的密钥页面获取。",
};

/** 输入框占位提示，点出各服务商密钥的样子。 */
export const PROVIDER_KEY_PLACEHOLDER: Record<ProviderId, string> = {
  "cline-pass": "Cline 密钥",
  "opencode-go": "OpenCode Go 密钥",
  commandcode: "Command Code 密钥",
};

export const accountSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  /** 只有同一服务商配了多把密钥时才需要，用于在用量卡片上区分。 */
  label: z.string().trim().max(60).optional(),
  apiKey: z.string().trim().min(1),
});
export type Account = z.infer<typeof accountSchema>;

export const settingsSchema = z.object({
  accounts: z.array(accountSchema).default([]),
});

/**
 * host 级设置，所有工作区与会话共用同一批密钥。Paseo 把值存在
 * `~/.paseo/plugin-settings/paseo-quota/accounts.json`，用量源每次发现账号时重读，
 * 因此保存后无需重载插件即可生效。
 */
export const settingsDefinition = defineSettings({
  id: "accounts",
  scope: "host",
  version: 1,
  schema: settingsSchema,
});
