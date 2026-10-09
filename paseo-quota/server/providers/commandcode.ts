import {
  toneFromUsedPct,
  unavailable,
  usedPctOf,
  windowFromUsedPct,
  type UsageDetail,
  type UsageReport,
  type UsageWindow,
} from "@getpaseo/plugin/server/usage";
import { z } from "zod";
import { credentialRejected, getJson, unwrapData } from "../http";
import { PROVIDER_NAMES } from "../../shared/settings";

const BASE_URL = "https://api.commandcode.ai";
const PROVIDER_NAME = PROVIDER_NAMES.commandcode;
const WINDOWS = [
  { key: "fiveHour", id: "5h", label: "5 小时", shortLabel: "5时" },
  { key: "weekly", id: "7d", label: "每周", shortLabel: "周" },
] as const;

const windowLimitSchema = z.object({
  used: z.number().finite(),
  cap: z.number().finite().optional(),
  exceeded: z.boolean().optional(),
  resetAt: z.union([z.number(), z.string()]).optional(),
});

const whoamiSchema = z.object({
  user: z.object({ id: z.string(), email: z.string().optional() }).optional(),
  org: z.object({ id: z.string().optional(), login: z.string().optional() }).optional(),
});

const creditsSchema = z.object({
  credits: z
    .object({
      monthlyCredits: z.number().finite().optional(),
      purchasedCredits: z.number().finite().optional(),
      freeCredits: z.number().finite().optional(),
      planId: z.string().optional(),
    })
    .optional(),
  windowLimits: z
    .object({ fiveHour: windowLimitSchema.optional(), weekly: windowLimitSchema.optional() })
    .optional(),
});

export async function fetchCommandCodeReport(apiKey: string): Promise<UsageReport> {
  const headers = { Accept: "application/json", Authorization: `Bearer ${apiKey}` };

  const whoami = await getJson(`${BASE_URL}/alpha/whoami`, headers);
  if (whoami.kind === "rejected") return credentialRejected(PROVIDER_NAME, whoami.status);
  if (whoami.kind === "failed") return { status: "error", error: whoami.error };

  const account = whoamiSchema.safeParse(unwrapData(whoami.body));
  if (!account.success || !account.data.user?.id) {
    return unavailable({ kind: "no_quota", detail: `${PROVIDER_NAME} 没能识别这把密钥对应的账号。` });
  }

  const orgId = account.data.org?.id;
  const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  const credits = await getJson(`${BASE_URL}/alpha/billing/credits${query}`, headers);
  if (credits.kind === "rejected") return credentialRejected(PROVIDER_NAME, credits.status);
  if (credits.kind === "failed") return { status: "error", error: credits.error };

  const billing = creditsSchema.safeParse(unwrapData(credits.body));
  if (!billing.success) {
    return unavailable({ kind: "no_quota", detail: `${PROVIDER_NAME} 没有返回这把密钥的计费窗口。` });
  }

  const windows = WINDOWS.flatMap(({ key, ...window }) => {
    const limit = billing.data.windowLimits?.[key];
    if (!limit) return [];
    const percent = usedPctOf(limit.used, limit.cap);
    return [
      windowFromUsedPct({
        ...window,
        utilizationPct: percent,
        resetsAt: resetAtIso(limit.resetAt),
        // 已判定超限的窗口即使算出的比例不到 100% 也算用尽。
        tone: limit.exceeded ? "danger" : toneFromUsedPct(percent),
      }),
    ];
  });
  if (windows.length === 0) {
    return unavailable({ kind: "no_quota", detail: `${PROVIDER_NAME} 没有返回这把密钥的计费窗口。` });
  }

  const details = accountDetails(account.data, billing.data.credits);
  return { status: "available", windows, ...(details.length > 0 ? { details } : {}) };
}

/** Command Code 按积分计费：套餐月度额度，加上已购与赠送的部分。 */
function creditBalance(credits: z.infer<typeof creditsSchema>["credits"]): number | null {
  if (!credits) return null;
  const parts = [credits.monthlyCredits, credits.purchasedCredits, credits.freeCredits].filter(
    (part): part is number => typeof part === "number",
  );
  if (parts.length === 0) return null;
  return parts.reduce((total, part) => total + part, 0);
}

/**
 * 账号、套餐与积分余额都放进明细行：Paseo 的余额条会在没有上限时拼一句写死的英文
 * （“N left”），而明细行的文字完全由本插件给出，可以保持中文。
 */
function accountDetails(
  account: z.infer<typeof whoamiSchema>,
  credits: z.infer<typeof creditsSchema>["credits"],
): UsageDetail[] {
  const details: UsageDetail[] = [];
  const name = account.user?.email ?? account.org?.login;
  if (name) details.push({ id: "account", label: "账号", value: name });
  if (credits?.planId) details.push({ id: "plan", label: "套餐", value: credits.planId });
  const balance = creditBalance(credits);
  if (balance !== null) details.push({ id: "credits", label: "积分余额", value: String(balance) });
  return details;
}

/** Command Code 的重置时间按字段不同，可能是秒级时间戳、毫秒时间戳或 ISO 字符串。 */
function resetAtIso(value: number | string | undefined): string | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value < 1e12 ? value * 1000 : value).toISOString();
}
