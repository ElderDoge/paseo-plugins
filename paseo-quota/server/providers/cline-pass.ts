import {
  toneFromUsedPct,
  unavailable,
  windowFromUsedPct,
  type UsageDetail,
  type UsageReport,
  type UsageWindow,
} from "@getpaseo/plugin/server/usage";
import { z } from "zod";
import { credentialRejected, getJson, unwrapData } from "../http";
import { PROVIDER_NAMES } from "../../shared/settings";

const BASE_URL = "https://api.cline.bot/api/v1";
const PROVIDER_NAME = PROVIDER_NAMES["cline-pass"];

/**
 * ClinePass 按名字给窗口计数，窗口长度来自套餐而非响应本身。
 * `monthly` 最宽，所以它是侧栏摘要优先展示的窗口。
 */
const WINDOWS = {
  five_hour: { id: "5h", label: "5 小时", shortLabel: "5时" },
  weekly: { id: "7d", label: "每周", shortLabel: "周" },
  monthly: { id: "30d", label: "每月", shortLabel: "月", summary: true },
} as const;

const limitsSchema = z.object({
  limits: z.array(
    z.object({
      type: z.string(),
      percentUsed: z.number().finite(),
      resetsAt: z.string().optional(),
    }),
  ),
});

const identitySchema = z.object({
  email: z.string().optional(),
  id: z.string().optional(),
});

export async function fetchClinePassReport(apiKey: string): Promise<UsageReport> {
  const headers = { Accept: "application/json", Authorization: `Bearer ${apiKey}` };
  const usage = await getJson(`${BASE_URL}/users/me/plan/usage-limits`, headers);
  if (usage.kind === "rejected") return credentialRejected(PROVIDER_NAME, usage.status);
  if (usage.kind === "failed") return { status: "error", error: usage.error };

  const parsed = limitsSchema.safeParse(unwrapData(usage.body));
  const windows = parsed.success ? parsed.data.limits.flatMap(toWindow) : [];
  if (windows.length === 0) {
    return unavailable({ kind: "no_quota", detail: `${PROVIDER_NAME} 没有返回这把密钥的套餐额度。` });
  }

  const details = await readAccountDetails(headers);
  return { status: "available", windows, ...(details.length > 0 ? { details } : {}) };
}

function toWindow(limit: z.infer<typeof limitsSchema>["limits"][number]): UsageWindow[] {
  const window = WINDOWS[limit.type as keyof typeof WINDOWS];
  if (!window) return [];
  const percent = clampPercent(limit.percentUsed);
  return [
    windowFromUsedPct({
      ...window,
      utilizationPct: percent,
      resetsAt: limit.resetsAt ?? null,
      tone: toneFromUsedPct(percent),
    }),
  ];
}

/** 尽力而为：能读用量的密钥通常也能读自己的账号，但不靠它决定成败。 */
async function readAccountDetails(headers: Record<string, string>): Promise<UsageDetail[]> {
  const identity = await getJson(`${BASE_URL}/users/me`, headers);
  if (identity.kind !== "ok") return [];
  const parsed = identitySchema.safeParse(unwrapData(identity.body));
  if (!parsed.success) return [];
  const account = parsed.data.email ?? parsed.data.id;
  return account ? [{ id: "account", label: "账号", value: account }] : [];
}

function clampPercent(percent: number): number {
  return Math.min(Math.max(percent, 0), 100);
}
