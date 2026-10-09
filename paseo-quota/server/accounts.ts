import type { PluginSettings } from "@getpaseo/plugin/server";
import { hashAccountKey, unavailable, type UsageReport } from "@getpaseo/plugin/server/usage";
import { type Account, type ProviderId, settingsSchema } from "../shared/settings";

export type QuotaSettings = PluginSettings<typeof settingsSchema>;

export interface ConfiguredAccount {
  provider: ProviderId;
  apiKey: string;
  label?: string;
  /** 这一组（服务商 + 密钥）的稳定标识；凭据本身不会离开本进程。 */
  accountKey: string;
}

/**
 * 每次调用都重读一遍已保存的密钥。设置由宿主串行写入，而每次发现账号读一个小文件，
 * 正是"存完密钥即可生效、无需重载插件"的代价所在。
 */
export async function configuredAccounts(
  settings: QuotaSettings,
  provider: ProviderId,
): Promise<ConfiguredAccount[]> {
  const state = await settings.read();
  if (state.status !== "ready") return [];
  return state.values.accounts
    .filter((account) => account.provider === provider)
    .map(toConfiguredAccount);
}

export async function findConfiguredAccount(
  settings: QuotaSettings,
  provider: ProviderId,
  accountKey: string,
): Promise<ConfiguredAccount | null> {
  const accounts = await configuredAccounts(settings, provider);
  return accounts.find((account) => account.accountKey === accountKey) ?? null;
}

/** 卡片还在屏幕上、密钥却已被删除时的报告。 */
export function missingAccountReport(): UsageReport {
  return unavailable({
    kind: "no_quota",
    detail: "这把密钥已从 Paseo 的 paseo-quota 插件设置中移除。",
  });
}

function toConfiguredAccount(account: Account): ConfiguredAccount {
  return {
    provider: account.provider,
    apiKey: account.apiKey,
    ...(account.label ? { label: account.label } : {}),
    accountKey: hashAccountKey(`${account.provider}:${account.apiKey}`),
  };
}
