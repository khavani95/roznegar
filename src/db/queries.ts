import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  projects,
  workers,
  workDays,
  rawMessages,
  extractedEvents,
  activities,
  activityWorkers,
  conversationState,
  type Project,
  type Worker,
  type WorkDay,
  type ConversationState,
  type WizardItem,
} from "./schema";
import { toJalali } from "@/lib/jalali";

/** پروژه‌ی متناظر با یک چت تلگرام را می‌گیرد یا می‌سازد */
export async function getOrCreateProject(chatId: number): Promise<Project> {
  const db = getDb();
  const existing = await db
    .select()
    .from(projects)
    .where(eq(projects.chatId, chatId))
    .limit(1);
  if (existing[0]) return existing[0];

  const inserted = await db
    .insert(projects)
    .values({ chatId })
    .returning();
  return inserted[0];
}

/** روزکاریِ بازِ فعلی این پروژه (اگر باشد) */
export async function getOpenWorkDay(
  projectId: number,
): Promise<WorkDay | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(workDays)
    .where(and(eq(workDays.projectId, projectId), eq(workDays.status, "open")))
    .orderBy(desc(workDays.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

/** شروع یک روزکاری جدید */
export async function startWorkDay(project: Project): Promise<WorkDay> {
  const db = getDb();
  const j = toJalali();

  // شماره‌ی گزارش: پیشوند + شمارنده‌ی روزهای این پروژه
  const countRows = await db
    .select({ c: sql<number>`count(*)` })
    .from(workDays)
    .where(eq(workDays.projectId, project.id));
  const seq = Number(countRows[0]?.c ?? 0) + 1;
  const reportNo = `${project.reportPrefix}-${String(seq).padStart(4, "0")}`;

  const inserted = await db
    .insert(workDays)
    .values({
      projectId: project.id,
      jalaliDate: j.key,
      dateLabel: j.label,
      reportNo,
      status: "open",
    })
    .returning();
  return inserted[0];
}

/** بستن روزکاری */
export async function closeWorkDay(workDayId: number): Promise<void> {
  const db = getDb();
  await db
    .update(workDays)
    .set({ status: "closed", closedAt: new Date() })
    .where(eq(workDays.id, workDayId));
}

/** فهرست نیروهای فعال پروژه */
export async function listWorkers(projectId: number): Promise<Worker[]> {
  const db = getDb();
  return db
    .select()
    .from(workers)
    .where(and(eq(workers.projectId, projectId), eq(workers.isActive, true)))
    .orderBy(workers.fullName);
}

/**
 * تطبیق یا ساخت نیرو بر اساس نام گفته‌شده.
 * ابتدا با نام کامل یا نام‌های مستعار تطبیق می‌دهد، در غیر این صورت می‌سازد.
 */
export async function resolveWorker(
  projectId: number,
  name: string,
  trade?: string,
): Promise<Worker> {
  const db = getDb();
  const clean = name.trim();

  // تطبیق با نام کامل یا اگر نام داخل aliasها باشد
  const matches = await db
    .select()
    .from(workers)
    .where(
      and(
        eq(workers.projectId, projectId),
        or(
          ilike(workers.fullName, `%${clean}%`),
          sql`${workers.aliases}::text ilike ${"%" + clean + "%"}`,
        ),
      ),
    )
    .limit(1);

  if (matches[0]) return matches[0];

  const inserted = await db
    .insert(workers)
    .values({
      projectId,
      fullName: clean,
      aliases: [],
      trade: trade ?? null,
    })
    .returning();
  return inserted[0];
}

/** ذخیره‌ی پیام خام */
export async function saveRawMessage(data: {
  workDayId: number;
  telegramMessageId?: number;
  kind: "text" | "voice";
  text?: string;
  transcript?: string;
  telegramFileId?: string;
}) {
  const db = getDb();
  const inserted = await db.insert(rawMessages).values(data).returning();
  return inserted[0];
}

/** ذخیره‌ی رویدادهای استخراج‌شده */
export async function saveEvents(
  workDayId: number,
  rawMessageId: number,
  events: Array<{ type: string; payload: Record<string, unknown> }>,
) {
  if (!events.length) return;
  const db = getDb();
  await db.insert(extractedEvents).values(
    events.map((e) => ({
      workDayId,
      rawMessageId,
      type: e.type,
      payload: e.payload,
    })),
  );
}

// ── تکمیل پروفایل و فعالیت (ویزارد پایان روز) ────────────

/** تکمیل پروفایل یک نیرو و علامت‌گذاری به‌عنوان کامل */
export async function updateWorkerProfile(
  workerId: number,
  data: { fullName?: string; trade?: string; employmentType?: string },
) {
  const db = getDb();
  const patch: Record<string, unknown> = { profileStatus: "complete" };
  if (data.fullName) patch.fullName = data.fullName;
  if (data.trade) patch.trade = data.trade;
  if (data.employmentType) patch.employmentType = data.employmentType;
  await db.update(workers).set(patch).where(eq(workers.id, workerId));
}

/** ثبت بازه‌ی زمانی یک فعالیت */
export async function updateActivityTime(
  activityId: number,
  data: { startTime?: string; endTime?: string; isFullDay?: boolean },
) {
  const db = getDb();
  await db
    .update(activities)
    .set({
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      isFullDay: data.isFullDay ?? false,
    })
    .where(eq(activities.id, activityId));
}

/** افزودن یک فعالیت جدید برای نیروی بدون فعالیت + اتصال او */
export async function addCoverageActivity(
  workDayId: number,
  workerId: number,
  data: {
    description: string;
    workFront?: string;
    activityType?: string;
    startTime?: string;
    endTime?: string;
    isFullDay?: boolean;
  },
) {
  const db = getDb();
  const [act] = await db
    .insert(activities)
    .values({
      workDayId,
      workFront: data.workFront ?? null,
      activityType: data.activityType ?? null,
      description: data.description,
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
      isFullDay: data.isFullDay ?? false,
    })
    .returning({ id: activities.id });
  await db
    .insert(activityWorkers)
    .values({ activityId: act.id, workerId });
}

// ── وضعیت گفتگو (ویزارد) ─────────────────────────────────

export async function getConversationState(
  chatId: number,
): Promise<ConversationState | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(conversationState)
    .where(eq(conversationState.chatId, chatId))
    .limit(1);
  return rows[0] ?? null;
}

export async function setConversationState(
  chatId: number,
  workDayId: number,
  phase: string,
  queue: WizardItem[],
) {
  const db = getDb();
  await db
    .insert(conversationState)
    .values({ chatId, workDayId, phase, queue, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: conversationState.chatId,
      set: { workDayId, phase, queue, updatedAt: new Date() },
    });
}

export async function clearConversationState(chatId: number) {
  const db = getDb();
  await db
    .insert(conversationState)
    .values({ chatId, phase: "idle", queue: [], updatedAt: new Date() })
    .onConflictDoUpdate({
      target: conversationState.chatId,
      set: { phase: "idle", queue: [], workDayId: null, updatedAt: new Date() },
    });
}
