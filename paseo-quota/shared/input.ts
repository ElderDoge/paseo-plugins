import { z } from "zod";

/**
 * 定位一把已配置的密钥。凭据本身不进输入，因此 Paseo 缓存的用量报告里不会带上密钥，
 * 服务端会按 accountKey 从设置里取回真正的 key。
 */
export const inputSchema = z.object({ accountKey: z.string().min(1) }).strict();
export type QuotaInput = z.infer<typeof inputSchema>;
