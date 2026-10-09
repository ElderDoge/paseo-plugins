import { unavailable, windowFromUsedPct, type UsageReport, type UsageWindow } from "@getpaseo/plugin/server/usage";
import { z } from "zod";
import { credentialRejected, getJson } from "../http";
import { PROVIDER_NAMES } from "../../shared/settings";

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const PROVIDER_NAME = PROVIDER_NAMES["opencode-go"];

const windowSchema = z.object({
  status: z.string(),
  percent: z.number().finite(),
  resetsAt: z.string(),
});

const responseSchema = z.object({
  usage: z.object({ rolling: windowSchema, weekly: windowSchema, monthly: windowSchema }),
});

/**
 * OpenCode Go 每个窗口只报一个百分比。滚动窗口不报长度，但 Go 套餐按 5 小时计；
 * `monthly` 最宽，所以它排在侧栏摘要的第一位。
 */
const WINDOWS = [
  { key: "rolling", id: "5h", label: "5 小时", shortLabel: "5时" },
  { key: "weekly", id: "7d", label: "每周", shortLabel: "周" },
  { key: "monthly", id: "30d", label: "每月", shortLabel: "月", summary: true },
] as const;

export async function fetchOpenCodeGoReport(apiKey: string): Promise<UsageReport> {
  const response = await getJson(USAGE_URL, {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  });
  if (response.kind === "rejected") return credentialRejected(PROVIDER_NAME, response.status);
  if (response.kind === "failed") return { status: "error", error: response.error };

  const parsed = responseSchema.safeParse(response.body);
  if (!parsed.success) {
    return unavailable({ kind: "no_quota", detail: `${PROVIDER_NAME} 没有返回这把密钥的额度窗口。` });
  }

  const windows = WINDOWS.map(({ key, ...window }) => {
    const value = parsed.data.usage[key];
    const percent = Math.min(Math.max(value.percent, 0), 100);
    return windowFromUsedPct({
      ...window,
      utilizationPct: percent,
      resetsAt: value.resetsAt,
      // 被限流的账号即使百分比不高也已用尽。
      tone: value.status === "rate-limited" ? "danger" : toneOf(percent),
    });
  });
  return { status: "available", windows };
}

function toneOf(percent: number): UsageWindow["tone"] {
  if (percent > 90) return "danger";
  if (percent >= 70) return "warning";
  return "ok";
}
