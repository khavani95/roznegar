import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  extractedEvents,
  attendance,
  activities,
  activityWorkers,
  issues,
  reworks,
  workers,
} from "@/db/schema";
import { resolveWorker } from "@/db/queries";
import { calcWork, timeToMinutes } from "./attendance-calc";
import type { ExtractedEventItem } from "@/ai/schema";
import { workRules } from "@/lib/config";

export interface AttendanceRow {
  workerId: number;
  name: string;
  trade: string | null;
  employmentType: string | null;
  profileStatus: string;
  entry: string | null;
  exit: string | null;
  workedMinutes: number;
  overtimeMinutes: number;
  dayFraction: number;
  workFront: string | null;
  assignedActivityMinutes: number;
  hasActivity: boolean;
}

export interface ActivityRow {
  activityId: number;
  workFront: string | null;
  activityType: string | null;
  description: string;
  workers: string[];
  workerIds: number[];
  startTime: string | null;
  endTime: string | null;
  isFullDay: boolean;
  hasTime: boolean;
}

export interface DaySummary {
  attendance: AttendanceRow[];
  activities: ActivityRow[];
  issues: Array<{ type: string; description: string; impact: string | null }>;
  reworks: Array<{
    workFront: string | null;
    amount: string | null;
    cause: string | null;
    description: string;
  }>;
  workerCount: number;
}

interface RawActivity {
  workFront: string | null;
  activityType: string | null;
  description: string;
  workers: string[];
  startTime: string | null;
  endTime: string | null;
  isFullDay: boolean;
}

/**
 * همه‌ی رویدادهای یک روز را می‌خواند، ورود/خروج نیروها را جفت می‌کند،
 * کارکرد را محاسبه، فعالیت‌ها را به نفرات نسبت می‌دهد و جدول‌های نهایی را می‌سازد.
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
  const oldActs = await db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.workDayId, workDayId));
  for (const a of oldActs) {
    await db.delete(activityWorkers).where(eq(activityWorkers.activityId, a.id));
  }
  await db.delete(attendance).where(eq(attendance.workDayId, workDayId));
  await db.delete(activities).where(eq(activities.workDayId, workDayId));
  await db.delete(issues).where(eq(issues.workDayId, workDayId));
  await db.delete(reworks).where(eq(reworks.workDayId, workDayId));

  // جمع‌آوری رویدادها بر اساس نوع
  const attByWorker = new Map<
    string,
    { entry?: string; exit?: string; workFront?: string; trade?: string }
  >();
  const rawActivities: RawActivity[] = [];
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
        rawActivities.push({
          workFront: p.workFront ?? null,
          activityType: p.activityType ?? null,
          description: p.description ?? "",
          workers: (p.workers ?? []).map((w) => w.trim()).filter(Boolean),
          startTime: p.startTime ?? null,
          endTime: p.endTime ?? null,
          isFullDay: p.isFullDay ?? false,
        });
        // نیروهای درگیر در فعالیت اگر در کارکرد نبودند، حاضر محسوب شوند
        for (const w of p.workers ?? []) {
          const nm = w.trim();
          if (nm && !attByWorker.has(nm)) {
            attByWorker.set(nm, { workFront: p.workFront });
          }
        }
        break;
      }
      case "issue":
        issueRows.push({
          type: p.issueType ?? "مشکل",
          description: p.description ?? "",
          impact: p.cause ?? null,
        });
        break;
      case "rework":
        reworkRows.push({
          workFront: p.workFront ?? null,
          amount: p.amount ?? null,
          cause: p.cause ?? null,
          description: p.description ?? "",
        });
        break;
      case "worker_new":
        if (p.workerName)
          newWorkers.push({ name: p.workerName, trade: p.trade });
        break;
    }
  }

  // ثبت نیروهای جدید معرفی‌شده
  for (const nw of newWorkers) {
    await resolveWorker(projectId, nw.name, nw.trade);
  }

  // ساخت ردیف‌های کارکرد
  const attendanceSummary: AttendanceRow[] = [];
  const workerIdByName = new Map<string, number>();
  const workedByWorkerId = new Map<number, number>();

  for (const [name, rec] of attByWorker) {
    const worker = await resolveWorker(projectId, name, rec.trade);
    workerIdByName.set(name, worker.id);

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
      dayFraction = 1;
      workedMinutes = workRules.standardWorkMinutes;
    }

    workedByWorkerId.set(worker.id, workedMinutes);

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
      workerId: worker.id,
      name: worker.fullName,
      trade: worker.trade,
      employmentType: worker.employmentType,
      profileStatus: worker.profileStatus,
      entry: rec.entry ?? null,
      exit: rec.exit ?? null,
      workedMinutes,
      overtimeMinutes,
      dayFraction,
      workFront: rec.workFront ?? null,
      assignedActivityMinutes: 0,
      hasActivity: false,
    });
  }

  // ثبت فعالیت‌ها + نسبت‌دادن نفرات
  const activitySummary: ActivityRow[] = [];
  const assignedByWorkerId = new Map<number, number>();
  const hasActivityWorkerId = new Set<number>();

  for (const a of rawActivities) {
    const [inserted] = await db
      .insert(activities)
      .values({
        workDayId,
        workFront: a.workFront,
        activityType: a.activityType,
        description: a.description,
        workerNames: a.workers,
        startTime: a.startTime,
        endTime: a.endTime,
        isFullDay: a.isFullDay,
      })
      .returning({ id: activities.id });

    const durationMin = activityDuration(a);
    const workerIds: number[] = [];

    for (const nm of a.workers) {
      const worker = await resolveWorker(projectId, nm);
      workerIds.push(worker.id);
      await db
        .insert(activityWorkers)
        .values({ activityId: inserted.id, workerId: worker.id });

      hasActivityWorkerId.add(worker.id);
      const worked = workedByWorkerId.get(worker.id) ?? 0;
      const prev = assignedByWorkerId.get(worker.id) ?? 0;
      // فعالیت تمام‌روز → پوشش کامل؛ فعالیت زمان‌دار → جمع مدت
      const add = a.isFullDay ? Math.max(worked - prev, 0) : durationMin;
      assignedByWorkerId.set(worker.id, prev + add);
    }

    activitySummary.push({
      activityId: inserted.id,
      workFront: a.workFront,
      activityType: a.activityType,
      description: a.description,
      workers: a.workers,
      workerIds,
      startTime: a.startTime,
      endTime: a.endTime,
      isFullDay: a.isFullDay,
      hasTime: a.isFullDay || Boolean(a.startTime && a.endTime),
    });
  }

  // پرکردن اطلاعات پوشش در ردیف‌های کارکرد
  for (const row of attendanceSummary) {
    row.assignedActivityMinutes = assignedByWorkerId.get(row.workerId) ?? 0;
    row.hasActivity = hasActivityWorkerId.has(row.workerId);
  }

  // ثبت موانع و دوباره‌کاری‌ها
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
    activities: activitySummary,
    issues: issueRows,
    reworks: reworkRows,
    workerCount: attendanceSummary.length,
  };
}

/** مدت فعالیت زمان‌دار به دقیقه (۰ اگر بدون زمان یا تمام‌روز) */
function activityDuration(a: {
  startTime: string | null;
  endTime: string | null;
}): number {
  if (a.startTime && a.endTime) {
    const s = timeToMinutes(a.startTime);
    let e = timeToMinutes(a.endTime);
    if (s === null || e === null) return 0;
    if (e <= s) e += 24 * 60;
    return e - s;
  }
  return 0;
}

/**
 * خلاصه‌ی روز را از جدول‌های تجمیع‌شده (نه از رویدادها) می‌خواند.
 * بعد از ویزارد پایان روز استفاده می‌شود تا تغییرات دستی حفظ شوند.
 */
export async function loadDaySummary(workDayId: number): Promise<DaySummary> {
  const db = getDb();

  const attRows = await db
    .select({
      workerId: attendance.workerId,
      entry: attendance.entryTime,
      exit: attendance.exitTime,
      workedMinutes: attendance.workedMinutes,
      overtimeMinutes: attendance.overtimeMinutes,
      dayFraction: attendance.dayFraction,
      workFront: attendance.workFront,
      name: workers.fullName,
      trade: workers.trade,
      employmentType: workers.employmentType,
      profileStatus: workers.profileStatus,
    })
    .from(attendance)
    .innerJoin(workers, eq(attendance.workerId, workers.id))
    .where(eq(attendance.workDayId, workDayId));

  const actRows = await db
    .select()
    .from(activities)
    .where(eq(activities.workDayId, workDayId));

  const links = await db
    .select({
      activityId: activityWorkers.activityId,
      workerId: activityWorkers.workerId,
      name: workers.fullName,
    })
    .from(activityWorkers)
    .innerJoin(activities, eq(activityWorkers.activityId, activities.id))
    .innerJoin(workers, eq(activityWorkers.workerId, workers.id))
    .where(eq(activities.workDayId, workDayId));

  const namesByActivity = new Map<number, string[]>();
  const idsByActivity = new Map<number, number[]>();
  for (const l of links) {
    if (!namesByActivity.has(l.activityId)) {
      namesByActivity.set(l.activityId, []);
      idsByActivity.set(l.activityId, []);
    }
    namesByActivity.get(l.activityId)!.push(l.name);
    idsByActivity.get(l.activityId)!.push(l.workerId);
  }

  const workedByWorkerId = new Map<number, number>();
  for (const a of attRows) workedByWorkerId.set(a.workerId, a.workedMinutes);

  const assignedByWorkerId = new Map<number, number>();
  const hasActivityWorkerId = new Set<number>();
  for (const act of actRows) {
    const dur = activityDuration(act);
    for (const wid of idsByActivity.get(act.id) ?? []) {
      hasActivityWorkerId.add(wid);
      const worked = workedByWorkerId.get(wid) ?? 0;
      const prev = assignedByWorkerId.get(wid) ?? 0;
      const add = act.isFullDay ? Math.max(worked - prev, 0) : dur;
      assignedByWorkerId.set(wid, prev + add);
    }
  }

  const attendanceSummary: AttendanceRow[] = attRows.map((a) => ({
    workerId: a.workerId,
    name: a.name,
    trade: a.trade,
    employmentType: a.employmentType,
    profileStatus: a.profileStatus,
    entry: a.entry,
    exit: a.exit,
    workedMinutes: a.workedMinutes,
    overtimeMinutes: a.overtimeMinutes,
    dayFraction: a.dayFraction,
    workFront: a.workFront,
    assignedActivityMinutes: assignedByWorkerId.get(a.workerId) ?? 0,
    hasActivity: hasActivityWorkerId.has(a.workerId),
  }));

  const activitySummary: ActivityRow[] = actRows.map((act) => ({
    activityId: act.id,
    workFront: act.workFront,
    activityType: act.activityType,
    description: act.description,
    workers: namesByActivity.get(act.id) ?? [],
    workerIds: idsByActivity.get(act.id) ?? [],
    startTime: act.startTime,
    endTime: act.endTime,
    isFullDay: act.isFullDay,
    hasTime: act.isFullDay || Boolean(act.startTime && act.endTime),
  }));

  const issueRows = await db
    .select()
    .from(issues)
    .where(eq(issues.workDayId, workDayId));
  const reworkRows = await db
    .select()
    .from(reworks)
    .where(eq(reworks.workDayId, workDayId));

  return {
    attendance: attendanceSummary,
    activities: activitySummary,
    issues: issueRows.map((i) => ({
      type: i.type,
      description: i.description,
      impact: i.impact,
    })),
    reworks: reworkRows.map((r) => ({
      workFront: r.workFront,
      amount: r.amount,
      cause: r.cause,
      description: r.description,
    })),
    workerCount: attendanceSummary.length,
  };
}
