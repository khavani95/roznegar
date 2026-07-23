import type { WizardItem } from "@/db/schema";
import type { DaySummary } from "./consolidate";
import {
  parseWorkerProfile,
  parseActivityTime,
  parseCoverageActivity,
  parseEntryExit,
  type ProfileAnswer,
} from "@/ai/extract";
import {
  updateWorkerProfile,
  updateActivityTime,
  updateAttendanceTime,
  addCoverageActivity,
} from "@/db/queries";
import { humanDuration } from "./attendance-calc";
import { parseSingleTime, parseTimeRange } from "./time-parse";

const SKIP_WORDS = ["رد", "بعدا", "بعداً", "skip", "نمیدونم", "نمی‌دونم", "-"];

/**
 * تحلیل قطعیِ پروفایل (بدون هوش مصنوعی) برای حالت‌های رایج مثل
 * «برقکار روزمزد» یا «علی رضایی، برقکار، روزمزد».
 */
function profileDeterministic(text: string): ProfileAnswer {
  const employmentType = /پیمانکار/.test(text)
    ? "پیمانکار"
    : /روزمزد|روز ?مزد/.test(text)
      ? "روزمزد"
      : undefined;

  const cleaned = text.replace(/پیمانکار|روزمزد|روز ?مزد/g, " ");
  const parts = cleaned
    .split(/[،,]/)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  let fullName: string | undefined;
  let trade: string | undefined;

  if (parts.length >= 2) {
    fullName = parts[0];
    trade = parts[1];
  } else if (parts.length === 1) {
    const words = parts[0].split(" ").filter(Boolean);
    if (words.length === 1) {
      trade = words[0];
    } else {
      // چند کلمه بدون کاما: آخرین کلمه تخصص، بقیه نام
      trade = words[words.length - 1];
      fullName = words.slice(0, -1).join(" ");
    }
  }

  return { fullName, trade, employmentType };
}

/** آیا پاسخ کاربر به‌معنی «رد کردن این مورد» است */
export function isSkip(text: string): boolean {
  const t = text.trim().toLowerCase();
  return SKIP_WORDS.includes(t);
}

/**
 * از خلاصه‌ی روز، صف سؤال‌های اجباری ویزارد را می‌سازد:
 * ۱) پروفایل ناقص  ۲) ورود/خروج ناقص  ۳) فعالیت بدون زمان  ۴) نفرِ بدون فعالیت.
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

  // ورود/خروج اجباری: اگر یکی از ساعت‌ها ثبت نشده، پرسیده شود
  for (const w of summary.attendance) {
    if (!w.entry || !w.exit) {
      queue.push({
        kind: "attendance_time",
        workerId: w.workerId,
        workerName: w.name,
        entry: w.entry,
        exit: w.exit,
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
    case "attendance_time": {
      const known = item.entry
        ? `ورود ${item.entry} ثبت شده؛ ساعت خروجش را بگو.`
        : item.exit
          ? `خروج ${item.exit} ثبت شده؛ ساعت ورودش را بگو.`
          : `ساعت ورود و خروجش را بگو.`;
      return (
        `⏰ ساعتِ «${item.label}» کامل نیست. ${known}\n` +
        `مثال: «۷ تا ۵»\n` +
        `(برای رد کردن بنویس: رد)`
      );
    }
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
      // اول تلاش قطعی (بدون هوش مصنوعی)، بعد در صورت نیاز هوش مصنوعی
      let p = profileDeterministic(text);
      if (!p.trade && !p.employmentType) {
        p = await parseWorkerProfile(text);
      }
      if (!p.trade && !p.employmentType && !p.fullName) {
        return {
          ok: false,
          skipped: false,
          note: "متوجه نشدم. مثلاً: «علی رضایی، برقکار، روزمزد»",
        };
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
    case "attendance_time": {
      let entry = item.entry ?? null;
      let exit = item.exit ?? null;

      // ۱) بازه‌ی «X تا Y» (قطعی، بدون هوش مصنوعی)
      const range = parseTimeRange(text);
      if (range) {
        entry = range.entry;
        exit = range.exit;
      } else {
        // ۲) زمان تکی برای همان فیلدِ ناقص (قطعی)
        if (!exit) exit = parseSingleTime(text, "exit") ?? exit;
        else if (!entry) entry = parseSingleTime(text, "entry") ?? entry;

        // ۳) اگر باز هم کامل نشد، از هوش مصنوعی کمک بگیر (بدون کرش)
        if (!entry || !exit) {
          const t = await parseEntryExit(text, item.label);
          entry = entry ?? t.entry ?? t.exit ?? null;
          exit = exit ?? t.exit ?? t.entry ?? null;
        }
      }

      if (!entry || !exit) {
        return {
          ok: false,
          skipped: false,
          note: "ساعت را نفهمیدم. مثلاً بنویس «۵ عصر» یا «۷ تا ۵».",
        };
      }
      await updateAttendanceTime(workDayId, item.workerId!, entry, exit);
      return { ok: true, skipped: false, note: `✅ ${entry}–${exit}` };
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
