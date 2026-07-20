import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  extractedEvents,
  attendance,
  activities,
  issues,
  reworks,
} from "@/db/schema";
import { resolveWorker } from "@/db/queries";
import { calcWork } from "./attendance-calc";
import type { ExtractedEventItem } from "@/ai/schema";
import { workRules } from "@/lib/config";

export interface DaySummary {
  attendance: Array<{
    name: string;
    trade: string | null;
    entry: string | null;
    exit: string | null;
    workedMinutes: number;
    overtimeMinutes: number;
    dayFraction: number;
    workFront: string | null;
  }>;
  activities: Array<{
    workFront: string | null;
    activityType: string | null;
    description: string;
    workers: string[];
  }>;
  issues: Array<{ type: string; description: string; impact: string | null }>;
  reworks: Array<{
    workFront: string | null;
    amount: string | null;
    cause: string | null;
    description: string;
  }>;
  workerCount: number;
}

/**
 * همه‌ی رویدادهای یک روز را می‌خواند، ورود/خروج نیروها را جفت می‌کند،
 * کارکرد را محاسبه می‌کند و جدول‌های نهایی را می‌سازد.
 * idempotent است: با اجرای دوباره، نتایج قبلی روز پاک و بازسازی می‌شوند.
 */
export async function consolidateDay(
  projectId: number,
  workDayId: number,
): Promise<DaySummary> {
  const db = getDb();

  const events = await db
    .select()
    .from(extractedEvents)
    .where(eq(extractedEvents.workDayId, workDayId));

  // پاک‌سازی نتایج قبلی این روز (برای اجرای مجدد)
  await db.delete(attendance).where(eq(attendance.workDayId, workDayId));
  await db.delete(activities).where(eq(activities.workDayId, workDayId));
  await db.delete(issues).where(eq(issues.workDayId, workDayId));
  await db.delete(reworks).where(eq(reworks.workDayId, workDayId));

  // جمع‌آوری رویدادها بر اساس نوع
  const attByWorker = new Map<
    string,
    { entry?: string; exit?: string; workFront?: string; trade?: string }
  >();
  const activityRows: DaySummary["activities"] = [];
  const issueRows: DaySummary["issues"] = [];
  const reworkRows: DaySummary["reworks"] = [];
  const newWorkers: Array<{ name: string; trade?: string }> = [];

  for (const ev of events) {
    const p = ev.payload as unknown as ExtractedEventItem;
    switch (ev.type) {
      case "attendance": {
        const name = (p.workerName || "").trim();
        if (!name) break;
        const rec = attByWorker.get(name) ?? {};
        if (p.event === "ورود" && p.time) rec.entry = p.time;
        if (p.event === "خروج" && p.time) rec.exit = p.time;
        if (p.workFront) rec.workFront = p.workFront;
        attByWorker.set(name, rec);
        break;
      }
      case "activity": {
        activityRows.push({
          workFront: p.workFront ?? null,
          activityType: p.activityType ?? null,
          description: p.description ?? "",
          workers: p.workers ?? [],
        });
        // نیروهای درگیر در فعالیت هم اگر در کارکرد نبودند، حاضر محسوب شوند
        for (const w of p.workers ?? []) {
          const nm = w.trim();
          if (nm && !attByWorker.has(nm)) {
            attByWorker.set(nm, { workFront: p.workFront });
          }
        }
        break;
      }
      case "issue": {
        issueRows.push({
          type: p.issueType ?? "مشکل",
          description: p.description ?? "",
          impact: p.cause ?? null,
        });
        break;
      }
      case "rework": {
        reworkRows.push({
          workFront: p.workFront ?? null,
          amount: p.amount ?? null,
          cause: p.cause ?? null,
          description: p.description ?? "",
        });
        break;
      }
      case "worker_new": {
        if (p.workerName) newWorkers.push({ name: p.workerName, trade: p.trade });
        break;
      }
    }
  }

  // ثبت نیروهای جدید معرفی‌شده
  for (const nw of newWorkers) {
    await resolveWorker(projectId, nw.name, nw.trade);
  }

  // ساخت ردیف‌های کارکرد
  const attendanceSummary: DaySummary["attendance"] = [];
  for (const [name, rec] of attByWorker) {
    const worker = await resolveWorker(projectId, name, rec.trade);

    let workedMinutes = 0;
    let overtimeMinutes = 0;
    let dayFraction = 0;
    let breakMinutes = 0;

    if (rec.entry && rec.exit) {
      const calc = calcWork(rec.entry, rec.exit);
      if (calc) {
        workedMinutes = calc.workedMinutes;
        overtimeMinutes = calc.overtimeMinutes;
        dayFraction = calc.dayFraction;
        breakMinutes = calc.breakMinutes;
      }
    } else if (rec.entry || rec.exit) {
      // فقط یکی از ورود/خروج ثبت شده → روز کامل فرض می‌شود (قابل اصلاح)
      dayFraction = 1;
      workedMinutes = workRules.standardWorkMinutes;
    }

    await db.insert(attendance).values({
      workDayId,
      workerId: worker.id,
      entryTime: rec.entry ?? null,
      exitTime: rec.exit ?? null,
      breakMinutes,
      workedMinutes,
      dayFraction,
      overtimeMinutes,
      workFront: rec.workFront ?? null,
    });

    attendanceSummary.push({
      name: worker.fullName,
      trade: worker.trade,
      entry: rec.entry ?? null,
      exit: rec.exit ?? null,
      workedMinutes,
      overtimeMinutes,
      dayFraction,
      workFront: rec.workFront ?? null,
    });
  }

  // ثبت فعالیت‌ها، موانع و دوباره‌کاری‌ها
  for (const a of activityRows) {
    await db.insert(activities).values({
      workDayId,
      workFront: a.workFront,
      activityType: a.activityType,
      description: a.description,
      workerNames: a.workers,
    });
  }
  for (const i of issueRows) {
    await db.insert(issues).values({
      workDayId,
      type: i.type,
      description: i.description,
      impact: i.impact,
    });
  }
  for (const r of reworkRows) {
    await db.insert(reworks).values({
      workDayId,
      workFront: r.workFront,
      amount: r.amount,
      cause: r.cause,
      description: r.description,
    });
  }

  // علامت‌گذاری رویدادها به‌عنوان تجمیع‌شده
  await db
    .update(extractedEvents)
    .set({ status: "consolidated" })
    .where(eq(extractedEvents.workDayId, workDayId));

  return {
    attendance: attendanceSummary,
    activities: activityRows,
    issues: issueRows,
    reworks: reworkRows,
    workerCount: attendanceSummary.length,
  };
}
