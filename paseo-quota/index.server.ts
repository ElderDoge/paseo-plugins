import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { UsageAccount, UsageReport } from "@getpaseo/plugin/server/usage";
import { inputSchema } from "./shared/input";
import {
  PROVIDER_GROUP_LABELS,
  PROVIDER_IDS,
  settingsDefinition,
  type ProviderId,
} from "./shared/settings";
import {
  configuredAccounts,
  findConfiguredAccount,
  missingAccountReport,
  type QuotaSettings,
} from "./server/accounts";
import { fetchClinePassReport } from "./server/providers/cline-pass";
import { fetchCommandCodeReport } from "./server/providers/commandcode";
import { fetchOpenCodeGoReport } from "./server/providers/opencode-go";

/** 来源 id 不能与 Paseo 内置来源撞车，内置来源占用了服务商的裸名。 */
const SOURCE_IDS: Record<ProviderId, string> = {
  "cline-pass": "quota-cline-pass",
  "opencode-go": "quota-opencode-go",
  commandcode: "quota-commandcode",
};

const ICONS: Record<ProviderId, string> = {
  "cline-pass": "icons/cline-pass.svg",
  "opencode-go": "icons/opencode-go.svg",
  commandcode: "icons/commandcode.svg",
};

/** 直接调用服务商接口读取一把密钥的额度；密钥来自插件设置。 */
const FETCHERS: Record<ProviderId, (apiKey: string) => Promise<UsageReport>> = {
  "cline-pass": fetchClinePassReport,
  "opencode-go": fetchOpenCodeGoReport,
  commandcode: fetchCommandCodeReport,
};

/**
 * 把每把已配置的密钥发布成一个 Paseo 用量来源。密钥属于整个宿主、与发起提问的会话无关，
 * 因此只有全局范围报告账号——这也是 Paseo 自带凭据型来源的做法，可避免每个会话的用量
 * 卡片里塞进不相干的服务商。
 */
export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(settingsDefinition);
  for (const provider of PROVIDER_IDS) {
    server.registerUsageSource({
      id: SOURCE_IDS[provider],
      label: PROVIDER_GROUP_LABELS[provider],
      icon: ICONS[provider],
      input: inputSchema,
      discover: (scope) => discoverAccounts(settings, provider, scope.kind === "global"),
      fetch: (input) => fetchReport(settings, provider, input),
    });
  }
  return () => {};
}

async function discoverAccounts(
  settings: QuotaSettings,
  provider: ProviderId,
  global: boolean,
): Promise<UsageAccount[]> {
  if (!global) return [];
  const accounts = await configuredAccounts(settings, provider);
  return accounts.map((account) => ({
    key: account.accountKey,
    // 只有一把密钥时无需区分；多把时才用用户起的名字，没起名就用短指纹。
    ...(accounts.length > 1
      ? { label: account.label ?? account.accountKey.slice(0, 8) }
      : {}),
    input: { accountKey: account.accountKey },
  }));
}

async function fetchReport(
  settings: QuotaSettings,
  provider: ProviderId,
  input: unknown,
): Promise<UsageReport> {
  const { accountKey } = inputSchema.parse(input);
  const account = await findConfiguredAccount(settings, provider, accountKey);
  if (!account) return missingAccountReport();
  return FETCHERS[provider](account.apiKey);
}
