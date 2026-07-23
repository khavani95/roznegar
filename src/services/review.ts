import { getDayConversation, listWorkers } from "@/db/queries";
import { extractDay } from "@/ai/day";
import {
  writeDayData,
  loadDaySummary,
  deterministicGaps,
  type DaySummary,
} from "./consolidate";

export interface ReviewResult {
  summary: DaySummary;
  questions: string[];
  complete: boolean;
}

/**
 * کل مکالمه‌ی روز (به‌علاوه‌ی پاسخ‌های تکمیلی) را یک‌بار به AI می‌دهد،
 * داده را می‌نویسد و فهرست سؤال‌های باقی‌مانده را برمی‌گرداند.
 */
export async function runExtraction(
  projectId: number,
  workDayId: number,
  qa?: { questions: string[]; answers: string[] },
): Promise<ReviewResult> {
  const conversation = await getDayConversation(workDayId);
  const known = (await listWorkers(projectId)).map((w) => w.fullName);

  let convo = conversation;
  if (qa && qa.answers.length) {
    // سؤال‌ها را کنار پاسخ‌ها می‌گذاریم تا AI بفهمد هر پاسخ به کدام نیرو مربوط است
    convo +=
      "\n\n[دستیار این سؤال‌ها را پرسید:]\n" +
      qa.questions.map((q, i) => `${i + 1}. ${q}`).join("\n") +
      "\n\n[سرکارگر در پاسخ گفت:]\n" +
      qa.answers.join("\n");
  }

  const { data } = await extractDay(convo, known);
  await writeDayData(projectId, workDayId, data);

  const summary = await loadDaySummary(workDayId);
  const questions = deterministicGaps(summary);
  return { summary, questions, complete: questions.length === 0 };
}

/** فقط وضعیت فعلی را از دیتابیس می‌خواند (بدون فراخوانی AI) */
export async function currentGaps(workDayId: number): Promise<ReviewResult> {
  const summary = await loadDaySummary(workDayId);
  const questions = deterministicGaps(summary);
  return { summary, questions, complete: questions.length === 0 };
}
