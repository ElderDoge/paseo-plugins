import { PROVIDER_IDS, PROVIDER_NAMES, type Account, type ProviderId } from "../shared/settings";

/** 服务商选择器的选项，顺序与用量面板里的分组顺序一致。 */
export const PROVIDER_OPTIONS = PROVIDER_IDS.map((id) => ({ label: PROVIDER_NAMES[id], value: id }));

export function countByProvider(accounts: readonly Account[]): Record<ProviderId, number> {
  const counts: Record<ProviderId, number> = { "cline-pass": 0, "opencode-go": 0, commandcode: 0 };
  for (const account of accounts) counts[account.provider] += 1;
  return counts;
}

/** 丢掉只填了一半的行，并去掉粘贴带进来的空白，避免保存被这些细节挡下。 */
export function savedAccounts(accounts: readonly Account[]): Account[] {
  return accounts.flatMap((account) => {
    const apiKey = account.apiKey.trim();
    if (!apiKey) return [];
    const label = account.label?.trim();
    return [{ provider: account.provider, ...(label ? { label } : {}), apiKey }];
  });
}

/** 新增的一行默认停在最常先填密钥的服务商上。 */
export function emptyAccount(): Account {
  return { provider: PROVIDER_IDS[0], apiKey: "" };
}
