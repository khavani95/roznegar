import type { ExtractedEventItem } from "@/ai/schema";
import type { DaySummary } from "@/services/consolidate";
import { humanDuration } from "@/services/attendance-calc";
import { toFaDigits } from "@/lib/jalali";
import type { WorkDay } from "@/db/schema";

/** خلاصه‌ی «چه چیزی فهمیدم» برای بازخورد آنیِ بعد از هر پیام */
export function formatAck(events: ExtractedEventItem[]): string {
  if (!events.length) return "✅ پیام ذخیره شد.";

  const lines: string[] = [];
  for (const e of events) {
    switch (e.type) {
      case "attendance":
        lines.push(
          `🕒 ${e.event ?? "کارکرد"} ${e.workerName ?? ""}` +
            (e.time ? ` ساعت ${toFaDigits(e.time)}` : ""),
        );
        break;
      case "activity":
        lines.push(
          `🏗️ فعالیت${e.workFront ? ` (${e.workFront})` : ""}: ${e.description ?? e.activityType ?? ""}`,
        );
        break;
      case "issue":
        lines.push(`⚠️ ${e.issueType ?? "مشکل"}: ${e.description ?? ""}`);
        break;
      case "rework":
        lines.push(
          `🔁 دوباره‌کاری${e.workFront ? ` (${e.workFront})` : ""}: ${e.description ?? ""}`,
        );
        break;
      case "worker_new":
        lines.push(
          `➕ نیروی جدید: ${e.workerName ?? ""}${e.trade ? ` (${e.trade})` : ""}`,
        );
        break;
    }
  }
  if (!lines.length) return "✅ پیام ذخیره شد.";
  return "✅ ثبت شد:\n" + lines.join("\n");
}

/** خلاصه‌ی کامل روز برای نمایش قبل از/هنگام پایان روز */
export function formatDaySummary(day: WorkDay, s: DaySummary): string {
  const parts: string[] = [];
  parts.push(`📋 گزارش ${day.dateLabel}`);
  parts.push(`🔖 ${day.reportNo ?? ""}`);
  parts.push("");

  parts.push(`👷 نیروها (${toFaDigits(s.workerCount)} نفر):`);
  if (s.attendance.length) {
    for (const a of s.attendance) {
      const dur =
        a.dayFraction >= 1
          ? "۱ روز کامل"
          : a.workedMinutes
            ? humanDuration(a.workedMinutes)
            : "—";
      const ot = a.overtimeMinutes
        ? ` + ${humanDuration(a.overtimeMinutes)} اضافه‌کاری`
        : "";
      const hours =
        a.entry && a.exit
          ? ` [${toFaDigits(a.entry)}–${toFaDigits(a.exit)}]`
          : "";
      parts.push(`• ${a.name}: ${dur}${ot}${hours}`);
    }
  } else {
    parts.push("—");
  }

  if (s.activities.length) {
    parts.push("");
    parts.push("🏗️ فعالیت‌ها:");
    for (const a of s.activities) {
      const time = a.isFullDay
        ? " (تمام‌روز)"
        : a.startTime && a.endTime
          ? ` (${a.startTime}–${a.endTime})`
          : "";
      parts.push(
        `• ${a.workFront ? a.workFront + " — " : ""}${a.description}${time}`,
      );
    }
  }

  if (s.issues.length) {
    parts.push("");
    parts.push("⚠️ موانع/مشکلات:");
    for (const i of s.issues) parts.push(`• ${i.type}: ${i.description}`);
  }

  if (s.reworks.length) {
    parts.push("");
    parts.push("🔁 دوباره‌کاری‌ها:");
    for (const r of s.reworks)
      parts.push(
        `• ${r.workFront ? r.workFront + " — " : ""}${r.description}${r.cause ? ` (علت: ${r.cause})` : ""}`,
      );
  }

  return parts.join("\n");
}
