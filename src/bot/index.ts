import { Bot, InputFile, InlineKeyboard, type Context } from "grammy";
import { config } from "@/lib/config";
import { BTN, MSG, mainKeyboard, reviewKeyboard } from "./text";
import { formatDaySummary } from "./format";
import {
  getOrCreateProject,
  getOpenWorkDay,
  getWorkDayById,
  getWorkDayByDate,
  startWorkDay,
  setDayStatus,
  bumpRevision,
  listWorkers,
  saveRawMessage,
  getConversationState,
  setReview,
  setReviewQuestions,
  setAwaitDate,
  addAnswer,
  clearConversationState,
} from "@/db/queries";
import { transcribeAudio } from "@/ai/extract";
import { runExtraction } from "@/services/review";
import { loadDaySummary } from "@/services/consolidate";
import { buildDailyExcel } from "@/services/report-excel";
import {
  toJalali,
  jalaliDaysAgo,
  parseJalaliInput,
  toFaDigits,
  type JalaliInfo,
} from "@/lib/jalali";
import type { Project, WorkDay } from "@/db/schema";

let _bot: Bot | null = null;

export function getBot(): Bot {
  if (_bot) return _bot;
  const bot = new Bot(config.telegram.botToken);
  registerHandlers(bot);
  _bot = bot;
  return bot;
}

function registerHandlers(bot: Bot) {
  bot.use(async (ctx, next) => {
    const allow = config.telegram.allowedChatIds;
    if (allow.length && ctx.chat && !allow.includes(String(ctx.chat.id))) {
      await ctx.reply(MSG.notAllowed);
      return;
    }
    await next();
  });

  bot.command("start", async (ctx) => {
    await clearConversationState(ctx.chat.id);
    await ctx.reply(MSG.welcome, { reply_markup: mainKeyboard() });
  });

  // ── شروع روز → انتخاب تاریخ ─────────────────────────
  bot.hears(BTN.startDay, async (ctx) => {
    const kb = new InlineKeyboard()
      .text("📅 امروز", "d:today")
      .text("📅 دیروز", "d:yesterday")
      .row()
      .text("✏️ تاریخ دیگر", "d:custom");
    await ctx.reply("گزارش برای چه روزی ثبت شود؟", { reply_markup: kb });
  });

  // ── گزارش امروز (پیش‌نمایش، بدون تغییر وضعیت) ────────
  bot.hears(BTN.todayReport, async (ctx) => {
    const project = await getOrCreateProject(ctx.chat.id);
    const day = await getOpenWorkDay(project.id);
    if (!day) {
      await ctx.reply(MSG.noOpenDay);
      return;
    }
    await ctx.reply(MSG.processing);
    const res = await runExtraction(project.id, day.id);
    await ctx.reply(formatDaySummary(day, res.summary));
    if (res.questions.length) {
      await ctx.reply(
        "⚠️ موارد ناقص (آخر روز پرسیده می‌شوند):\n" +
          numbered(res.questions),
      );
    }
  });

  // ── فهرست نیروها ───────────────────────────────────
  bot.hears(BTN.workers, async (ctx) => {
    const project = await getOrCreateProject(ctx.chat.id);
    const workers = await listWorkers(project.id);
    if (!workers.length) {
      await ctx.reply(MSG.noWorkers);
      return;
    }
    const lines = workers.map((w, i) => {
      const tags = [w.trade, w.employmentType].filter(Boolean).join("، ");
      const flag = w.profileStatus !== "complete" ? " ⚠️" : "";
      return `${toFaDigits(i + 1)}. ${w.fullName}${tags ? ` — ${tags}` : ""}${flag}`;
    });
    await ctx.reply(
      `👷 نیروهای کارگاه (${toFaDigits(workers.length)}):\n\n` +
        lines.join("\n"),
    );
  });

  // ── پایان روز → شروع بازبینی ────────────────────────
  bot.hears(BTN.endDay, async (ctx) => {
    const project = await getOrCreateProject(ctx.chat.id);
    const day = await getOpenWorkDay(project.id);
    if (!day) {
      await ctx.reply(MSG.noOpenDay);
      return;
    }
    await beginReview(bot, ctx, project, day);
  });

  // ── ثبت نهایی (در مرحله‌ی بازبینی) ──────────────────
  bot.hears(BTN.finalize, async (ctx) => {
    const project = await getOrCreateProject(ctx.chat.id);
    const state = await getConversationState(ctx.chat.id);
    if (state?.phase !== "review" || !state.workDayId) {
      await ctx.reply("چیزی برای ثبت نهایی نیست.", {
        reply_markup: mainKeyboard(),
      });
      return;
    }
    const day = await getWorkDayById(state.workDayId);
    if (!day) return;

    await ctx.reply(MSG.processing);
    const answers = state.answers ?? [];

    // بدون پاسخ جدید → همین‌طور نهایی کن؛ با پاسخ → دوباره بررسی
    if (answers.length === 0) {
      await finalize(bot, ctx, project, day);
      return;
    }

    const res = await runExtraction(project.id, day.id, {
      questions: state.questions ?? [],
      answers,
    });
    await ctx.reply(formatDaySummary(day, res.summary));
    if (res.complete) {
      await finalize(bot, ctx, project, day);
    } else {
      // پاسخ‌های قبلی حفظ می‌شوند تا از دست نروند
      await setReviewQuestions(ctx.chat.id, res.questions, (state.round ?? 1) + 1);
      await ctx.reply(
        "چند مورد هنوز مونده — جواب بده بعد دوباره «✅ ثبت نهایی»:\n\n" +
          numbered(res.questions),
        { reply_markup: reviewKeyboard() },
      );
    }
  });

  // ── لغو بازبینی ────────────────────────────────────
  bot.hears(BTN.cancel, async (ctx) => {
    const state = await getConversationState(ctx.chat.id);
    if (state?.phase === "review" && state.workDayId) {
      await setDayStatus(state.workDayId, "open");
    }
    await clearConversationState(ctx.chat.id);
    await ctx.reply("لغو شد. روز باز است.", { reply_markup: mainKeyboard() });
  });

  // ── انتخاب تاریخ (callback) ─────────────────────────
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const project = await getOrCreateProject(ctx.chat!.id);
    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageReplyMarkup();
    } catch {
      /* بی‌اهمیت */
    }

    if (data === "d:today") {
      await startDayForDate(ctx, project, toJalali());
    } else if (data === "d:yesterday") {
      await startDayForDate(ctx, project, jalaliDaysAgo(1));
    } else if (data === "d:custom") {
      await setAwaitDate(ctx.chat!.id);
      await ctx.reply("تاریخ شمسی را بفرست، مثل: ۱۴۰۵/۰۴/۲۸");
    }
  });

  // ── ویس ────────────────────────────────────────────
  bot.on(["message:voice", "message:audio"], async (ctx) => {
    const project = await getOrCreateProject(ctx.chat.id);
    try {
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
      const res = await fetch(url);
      const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      const text = await transcribeAudio(b64);
      await routeMessage(bot, ctx, project, text, {
        kind: "voice",
        telegramFileId: file.file_id,
      });
    } catch (e) {
      console.error("voice error:", e);
      await ctx.reply(MSG.error);
    }
  });

  // ── متن ────────────────────────────────────────────
  bot.on("message:text", async (ctx) => {
    const project = await getOrCreateProject(ctx.chat.id);
    try {
      await routeMessage(bot, ctx, project, ctx.message.text, {
        kind: "text",
        telegramMessageId: ctx.message.message_id,
      });
    } catch (e) {
      console.error("text error:", e);
      await ctx.reply(MSG.error);
    }
  });
}

/** مسیر‌دهی یک پیام بر اساس فاز فعلی (تاریخ / بازبینی / جمع‌آوری) */
async function routeMessage(
  bot: Bot,
  ctx: Context,
  project: Project,
  text: string,
  meta: {
    kind: "text" | "voice";
    telegramMessageId?: number;
    telegramFileId?: string;
  },
) {
  const chatId = ctx.chat!.id;
  const state = await getConversationState(chatId);

  // منتظر ورودی تاریخ
  if (state?.phase === "await_date") {
    const j = parseJalaliInput(text);
    if (!j) {
      await ctx.reply("تاریخ را درست بفرست، مثل: ۱۴۰۵/۰۴/۲۸");
      return;
    }
    await startDayForDate(ctx, project, j);
    return;
  }

  // در حال پاسخ به سؤالات بازبینی
  if (state?.phase === "review") {
    await addAnswer(chatId, text);
    await ctx.reply(
      "✅ پاسخت ثبت شد. وقتی همه رو گفتی «✅ ثبت نهایی» رو بزن.",
    );
    return;
  }

  // جمع‌آوری پیام‌های روز
  const day = await getOpenWorkDay(project.id);
  if (!day) {
    await ctx.reply(MSG.noOpenDay);
    return;
  }
  await saveRawMessage({
    workDayId: day.id,
    telegramMessageId: meta.telegramMessageId,
    kind: meta.kind,
    text: meta.kind === "text" ? text : undefined,
    transcript: meta.kind === "voice" ? text : undefined,
    telegramFileId: meta.telegramFileId,
  });
  await ctx.reply(MSG.saved);
}

/** ساخت یا بازکردن روز برای یک تاریخ */
async function startDayForDate(
  ctx: Context,
  project: Project,
  j: JalaliInfo,
) {
  const chatId = ctx.chat!.id;
  await clearConversationState(chatId);

  const existing = await getWorkDayByDate(project.id, j.key);
  if (existing) {
    if (existing.status === "closed") {
      await setDayStatus(existing.id, "open");
      await ctx.reply(MSG.dayReopened(existing.dateLabel), {
        reply_markup: mainKeyboard(),
      });
    } else {
      await ctx.reply(MSG.dayReopened(existing.dateLabel), {
        reply_markup: mainKeyboard(),
      });
    }
    return;
  }

  const day = await startWorkDay(project, j);
  await ctx.reply(MSG.dayStarted(day.dateLabel, day.reportNo ?? "-"), {
    reply_markup: mainKeyboard(),
  });
}

/** شروع مرحله‌ی بازبینی: استخراج کل روز + طرح سؤال‌ها */
async function beginReview(
  bot: Bot,
  ctx: Context,
  project: Project,
  day: WorkDay,
) {
  await ctx.reply(MSG.processing);
  const res = await runExtraction(project.id, day.id);
  await setDayStatus(day.id, "review");
  await ctx.reply(formatDaySummary(day, res.summary));

  if (res.complete) {
    await finalize(bot, ctx, project, day);
    return;
  }
  await setReview(ctx.chat!.id, day.id, res.questions, 1);
  await ctx.reply(
    "📝 برای کامل‌شدن گزارش، این‌ها رو جواب بده (هرچند تا با هم، متن یا ویس)، " +
      "بعد «✅ ثبت نهایی» رو بزن:\n\n" +
      numbered(res.questions),
    { reply_markup: reviewKeyboard() },
  );
}

/** نهایی‌سازی: نسخه‌ی جدید + اکسل + بستن روز */
async function finalize(
  bot: Bot,
  ctx: Context,
  project: Project,
  day: WorkDay,
) {
  const rev = await bumpRevision(day.id);
  const dayForReport: WorkDay = { ...day, revision: rev };

  // خلاصه‌ی نهایی از دیتابیس (بدون فراخوانی مجدد AI)
  const finalSummary = await loadDaySummary(day.id);

  const buffer = await buildDailyExcel(project, dayForReport, finalSummary);
  const revTag = `-rev${String(rev).padStart(2, "0")}`;
  const filename = `roznegar-${day.jalaliDate.replace(/\//g, "-")}${revTag}.xlsx`;

  await ctx.replyWithDocument(new InputFile(buffer, filename), {
    caption: `📊 گزارش استاندارد ${day.dateLabel} (${day.reportNo}${revTag})`,
  });

  if (config.telegram.backupChannelId) {
    try {
      await bot.api.sendDocument(
        config.telegram.backupChannelId,
        new InputFile(buffer, filename),
        { caption: `📊 بک‌آپ ${day.dateLabel} — ${project.name}${revTag}` },
      );
    } catch (e) {
      console.error("backup send failed:", e);
    }
  }

  await setDayStatus(day.id, "closed");
  await clearConversationState(ctx.chat!.id);
  await ctx.reply("✅ گزارش نهایی ثبت شد.", { reply_markup: mainKeyboard() });
}

/** فهرست شماره‌دار فارسی */
function numbered(items: string[]): string {
  return items.map((q, i) => `${toFaDigits(i + 1)}. ${q}`).join("\n");
}
