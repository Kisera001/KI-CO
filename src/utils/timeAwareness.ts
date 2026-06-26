import type { UplinkSettings } from "../types";

const WEEKDAY_LABELS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

const SPECIAL_DATE_LABELS: Record<string, string> = {
  "01-01": "元旦",
  "02-14": "情人节",
  "05-20": "520",
  "08-29": "七夕",
  "10-31": "万圣夜",
  "12-24": "平安夜",
  "12-25": "圣诞节",
};

function getTimePeriodLabel(hour: number): string {
  if (hour < 5) return "凌晨";
  if (hour < 8) return "清晨";
  if (hour < 12) return "上午";
  if (hour < 14) return "中午";
  if (hour < 18) return "下午";
  if (hour < 22) return "晚上";
  return "深夜";
}

export function buildTimeAwarenessContext(settings: UplinkSettings, now = new Date()): string {
  const mode = settings.contextLoad.timeAwarenessMode || "date_only";
  if (mode === "off") return "";

  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const dateLabel = `${now.getFullYear()}-${month}-${day}`;
  const segments = [
    `日期 ${dateLabel}`,
    WEEKDAY_LABELS[now.getDay()] || "",
    `当前时段 ${getTimePeriodLabel(now.getHours())}`,
  ].filter(Boolean);
  const specialDateLabel = SPECIAL_DATE_LABELS[`${month}-${day}`];

  if (specialDateLabel) {
    segments.push(`特殊日期 ${specialDateLabel}`);
  }

  if (mode === "realtime") {
    const hour = String(now.getHours()).padStart(2, "0");
    const minute = String(now.getMinutes()).padStart(2, "0");
    segments.push(`当前时间 ${hour}:${minute}`);
  }

  return `[Time Awareness]: ${segments.join(" | ")}`;
}
