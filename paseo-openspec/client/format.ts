import type { ChangeStatus } from "../shared/openspec";

export const STATUS_LABEL: Record<ChangeStatus, string> = {
  "no-tasks": "无任务",
  "in-progress": "进行中",
  complete: "已完成",
};

/** `3 分钟前` style label for a CLI timestamp; an unparsable timestamp stays unknown. */
export function formatRelativeTime(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "时间未知";
  const minutes = Math.floor((Date.now() - time) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(time).toLocaleDateString();
}
