import type { WizardItem } from "@/db/schema";
import type { DaySummary } from "./consolidate";
import {
  parseWorkerProfile,
  parseActivityTime,
  parseCoverageActivity,
} from "@/ai/extract";
import {
  updateWorkerProfile,
  updateActivityTime,
  addCoverageActivity,
} from "@/db/queries";
import { humanDuration } from "./attendance-calc";

const SKIP_WORDS = ["رد", "بعدا", "بعداً", "skip", "نمیدونم", "نمی‌دونم", "-"];

/** آیا پاسخ کاربر به‌معنی «رد کردن این مورد» است */
export function isSkip(text: string): boolean {
  const t = text.trim().toLowerCase();
  return SKIP_WORDS.includes(t);
}

/**
 * از خلاصه‌ی روز، صف سؤال‌های اجباری ویزارد را می‌سازد:
 * ۱) پروفایل ناقص  ۲) فعالیت بدون زمان  ۳) نفرِ بدون فعالیت.
 */
export function buildWizardQueue(summary: DaySummary): WizardItem[] {
  const queue: WizardItem[] = [];

  for (const w of summary.attendance) {
    if (w.profileStatus !== "complete") {
      queue.push({
        kind: "profile",
        workerId: w.workerId,
        workerName: w.name,
        label: w.name,
      });
    }
  }

  for (const a of summary.activities) {
    if (!a.hasTime) {
      queue.push({
        kind: "activity_time",
        activityId: a.activityId,
        label: a.description || a.workFront || "فعالیت",
      });
    }
  }

  for (const w of summary.attendance) {
    if (!w.hasActivity) {
      queue.push({
        kind: "coverage",
        workerId: w.workerId,
        workerName: w.name,
        label: w.name,
      });
    }
  }

  return queue;
}

/** هشدارهای نرم (نمایشی، بلاک نمی‌کنند): نفری که فعالیتش خیلی کمتر از حضورش است */
export function softWarnings(summary: DaySummary): string[] {
  const out: string[] = [];
  for (const w of summary.attendance) {
    if (!w.hasActivity || w.workedMinutes <= 0) continue;
    const gap = w.workedMinutes - w.assignedActivityMinutes;
    if (gap > 120 && gap / w.workedMinutes > 0.25) {
      out.push(
        `⚠️ ${w.name}: ${humanDuration(w.workedMinutes)} حضور ولی فقط ` +
          `${humanDuration(w.assignedActivityMinutes)} فعالیت ثبت شده.`,
      );
    }
  }
  return out;
}

/** متن سؤالی که برای یک آیتم ویزارد به کاربر نشان داده می‌شود */
export function questionText(item: WizardItem): string {
  switch (item.kind) {
    case "profile":
      return (
        `👤 نیروی «${item.label}» تازه است و پروفایلش کامل نیست.\n` +
        `نام کامل، تخصص و نوع همکاری (روزمزد یا پیمانکار) را بگو.\n` +
        `مثال: «علی رضایی، آرماتوربند، روزمزد»\n` +
        `(برای رد کردن بنویس: رد)`
      );
    case "activity_time":
      return (
        `⏱️ فعالیتِ «${item.label}» چه ساعتی تا چه ساعتی انجام شد؟\n` +
        `مثال: «۸ تا ۴» یا «تمام‌روز»\n` +
        `(برای رد کردن بنویس: رد)`
      );
    case "coverage":
      return (
        `🏗️ «${item.label}» امروز چه کاری و در چه محلی انجام داد؟\n` +
        `مثال: «آرماتوربندی طبقه ۳، از ۸ تا ۴»\n` +
        `(برای رد کردن بنویس: رد)`
      );
  }
}

/**
 * پردازش پاسخ کاربر برای یک آیتم ویزارد.
 * برمی‌گرداند که آیا با موفقیت اعمال شد یا رد/ناقص بود.
 */
export async function processAnswer(
  item: WizardItem,
  text: string,
  workDayId: number,
): Promise<{ ok: boolean; skipped: boolean; note: string }> {
  if (isSkip(text)) {
    return { ok: false, skipped: true, note: "رد شد." };
  }

  switch (item.kind) {
    case "profile": {
      const p = await parseWorkerProfile(text);
      if (!p.trade && !p.employmentType && !p.fullName) {
        return { ok: false, skipped: false, note: "متوجه نشدم." };
      }
      await updateWorkerProfile(item.workerId!, p);
      return {
        ok: true,
        skipped: false,
        note:
          `✅ ${p.fullName ?? item.label}` +
          (p.trade ? ` — ${p.trade}` : "") +
          (p.employmentType ? ` (${p.employmentType})` : ""),
      };
    }
    case "activity_time": {
      const t = await parseActivityTime(text);
      if (!t.isFullDay && !(t.startTime && t.endTime)) {
        return { ok: false, skipped: false, note: "زمان را نفهمیدم." };
      }
      await updateActivityTime(item.activityId!, t);
      return {
        ok: true,
        skipped: false,
        note: t.isFullDay ? "✅ تمام‌روز" : `✅ ${t.startTime}–${t.endTime}`,
      };
    }
    case "coverage": {
      const c = await parseCoverageActivity(text, item.label);
      if (!c.description) {
        return { ok: false, skipped: false, note: "فعالیت را نفهمیدم." };
      }
      await addCoverageActivity(workDayId, item.workerId!, {
        ...c,
        description: c.description,
      });
      return { ok: true, skipped: false, note: `✅ ثبت شد: ${c.description}` };
    }
  }
}
