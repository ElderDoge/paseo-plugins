import { unavailable, type UsageReport } from "@getpaseo/plugin/server/usage";

/** 所有服务商共用一个超时，避免某家接口卡死把用量面板拖住。 */
const REQUEST_TIMEOUT_MS = 15_000;

export type JsonOutcome =
  | { kind: "ok"; body: unknown }
  | { kind: "rejected"; status: number }
  | { kind: "failed"; error: string };

/** 区分"密钥被拒"与其它失败，后者带上能直接读懂的原因。 */
export async function getJson(url: string, headers: Record<string, string>): Promise<JsonOutcome> {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    return { kind: "failed", error: `${hostOf(url)} 无法访问：${describeError(error)}` };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "rejected", status: response.status };
  }
  if (!response.ok) {
    return { kind: "failed", error: `${hostOf(url)} 返回 HTTP ${response.status}` };
  }
  try {
    return { kind: "ok", body: await response.json() };
  } catch {
    return { kind: "failed", error: `${hostOf(url)} 返回的内容不是 JSON` };
  }
}

/**
 * Paseo 对"凭据被拒"只有一句写死的英文提示，无法翻译；这里改用可自带文案的问题种类，
 * 让密钥失效时提示完全由本插件给出，保持中文。
 */
export function credentialRejected(providerName: string, status: number): UsageReport {
  return unavailable({
    kind: "no_quota",
    detail: `${providerName} 拒绝了这把密钥（HTTP ${status}）。请在 Paseo 的 paseo-quota 插件设置里重新填写。`,
  });
}

export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.name === "TimeoutError" ? "请求超时" : error.message;
}

/** 同时接受 `{ data: … }` 包装与裸载荷。 */
export function unwrapData(body: unknown): unknown {
  if (typeof body !== "object" || body === null || !("data" in body)) return body;
  const data = body.data;
  return typeof data === "object" && data !== null ? data : body;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
