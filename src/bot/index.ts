import { Bot, InputFile, InlineKeyboard, type Context } from "grammy";
import { config } from "@/lib/config";
import { BTN, MSG, mainKeyboard, reviewKeyboard } from "./text";
import { formatDaySummary } from "./format";
import {
  createProject,
  listProjects,
  getActiveProject,
  setActiveProject,
  setAwaitProjectName,
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
  setConfirm,
  setAwaitDate,
  addAnswer,
  clearConversationState,
} from "@/db/queries";
import { transcribeAudio } from "@/ai/extract";
import { runExtraction, currentGaps } from "@/services/review";
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
    await ctx.reply(MSG.welcome, { reply_markup: mainKeyboard() });
  });

  // ── پروژه جدید ─────────────────────────────────────
  bot.hears(BTN.newProject, async (ctx) => {
    await setAwaitProjectName(ctx.chat.id);
    await ctx.reply(MSG.askProjectName);
  });

  // ── فهرست پروژه‌ها برای انتخاب ──────────────────────
  bot.hears(BTN.projects, async (ctx) => {
    const projects = await listProjects(ctx.chat.id);
    if (!projects.length) {
      await ctx.reply(MSG.noProjects);
      return;
    }
    const active = await getActiveProject(ctx.chat.id);
    const kb = new InlineKeyboard();
    for (const p of projects) {
      const mark = active?.id === p.id ? "✅ " : "";
      kb.text(`${mark}${p.name}`, `p:${p.id}`).row();
    }
    await ctx.reply("پروژه‌ی موردنظر را انتخاب کن:", { reply_markup: kb });
  });

  // ── شروع روز → انتخاب تاریخ ─────────────────────────
  bot.hears(BTN.startDay, async (ctx) => {
    const project = await getActiveProject(ctx.chat.id);
    if (!project) {
      await ctx.reply(MSG.selectProjectFirst);
      return;
    }
    // اگر روزِ بازی وجود دارد، همان فعال است — دوباره باز نمی‌کنیم
    const open = await getOpenWorkDay(project.id);
    if (open) {
      await ctx.reply(MSG.dayAlreadyOpen(project.name, open.dateLabel));
      return;
    }
    const kb = new InlineKeyboard()
      .text("📅 امروز", "d:today")
      .text("📅 دیروز", "d:yesterday")
      .row()
      .text("✏️ تاریخ دیگر", "d:custom");
    await ctx.reply(`📁 ${project.name}\nگزارش برای چه روزی؟`, {
      reply_markup: kb,
    });
  });

  // ── گزارش امروز (پیش‌نمایش) ─────────────────────────
  bot.hears(BTN.todayReport, async (ctx) => {
    const project = await getActiveProject(ctx.chat.id);
    if (!project) {
      await ctx.reply(MSG.selectProjectFirst);
      return;
    }
    const day = await getOpenWorkDay(project.id);
    if (!day) {
      await ctx.reply(MSG.noOpenDay(project.name));
      return;
    }
    await ctx.reply(MSG.processing);
    const res = await runExtraction(project.id, day.id);
    await ctx.reply(formatDaySummary(day, res.summary));
    if (res.questions.length) {
      await ctx.reply(
        "⚠️ موارد ناقص (آخر روز پرسیده می‌شوند):\n" + numbered(res.questions),
      );
    }
  });

  // ── نیروها ─────────────────────────────────────────
  bot.hears(BTN.workers, async (ctx) => {
    const project = await getActiveProject(ctx.chat.id);
    if (!project) {
      await ctx.reply(MSG.selectProjectFirst);
      return;
    }
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
      `👷 نیروهای «${project.name}» (${toFaDigits(workers.length)}):\n\n` +
        lines.join("\n"),
    );
  });

  // ── پایان روز ──────────────────────────────────────
  bot.hears(BTN.endDay, async (ctx) => {
    const project = await getActiveProject(ctx.chat.id);
    if (!project) {
      await ctx.reply(MSG.selectProjectFirst);
      return;
    }
    const day = await getOpenWorkDay(project.id);
    if (!day) {
      await ctx.reply(MSG.noOpenDay(project.name));
      return;
    }
    await beginReview(bot, ctx, project, day);
  });

  // ── ثبت نهایی (در مرحله‌ی بازبینی) ──────────────────
  bot.hears(BTN.finalize, async (ctx) => {
    const state = await getConversationState(ctx.chat.id);
    const project = await getActiveProject(ctx.chat.id);
    if (state?.phase !== "review" || !state.workDayId || !project) {
      await ctx.reply("چیزی برای ثبت نیست.", { reply_markup: mainKeyboard() });
      return;
    }
    const day = await getWorkDayById(state.workDayId);
    if (!day) return;

    await ctx.reply(MSG.processing);
    const answers = state.answers ?? [];
    const res = answers.length
      ? await runExtraction(project.id, day.id, {
          questions: state.questions ?? [],
          answers,
        })
      : await currentGaps(day.id);

    await ctx.reply(formatDaySummary(day, res.summary));
    if (res.complete) {
      await showConfirm(ctx, day);
    } else {
      await setReviewQuestions(ctx.chat.id, res.questions, (state.round ?? 1) + 1);
      await ctx.reply(
        "چند مورد هنوز مونده — جواب بده بعد دوباره «✅ ثبت نهایی»:\n\n" +
          numbered(res.questions),
        { reply_markup: reviewKeyboard() },
      );
    }
  });

  // ── لغو ────────────────────────────────────────────
  bot.hears(BTN.cancel, async (ctx) => {
    const state = await getConversationState(ctx.chat.id);
    if (state?.workDayId && (state.phase === "review" || state.phase === "confirm")) {
      await setDayStatus(state.workDayId, "open");
    }
    await clearConversationState(ctx.chat.id);
    await ctx.reply("لغو شد. روز باز است.", { reply_markup: mainKeyboard() });
  });

  // ── دکمه‌های شیشه‌ای ────────────────────────────────
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat!.id;
    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageReplyMarkup();
    } catch {
      /* بی‌اهمیت */
    }

    // انتخاب پروژه
    if (data.startsWith("p:")) {
      const id = Number(data.slice(2));
      await setActiveProject(chatId, id);
      const project = await getActiveProject(chatId);
      await ctx.reply(MSG.projectSelected(project?.name ?? "-"), {
        reply_markup: mainKeyboard(),
      });
      return;
    }

    const project = await getActiveProject(chatId);

    // انتخاب تاریخ
    if (data.startsWith("d:")) {
      if (!project) {
        await ctx.reply(MSG.selectProjectFirst);
        return;
      }
      if (data === "d:today") await startDayForDate(ctx, project, toJalali());
      else if (data === "d:yesterday")
        await startDayForDate(ctx, project, jalaliDaysAgo(1));
      else if (data === "d:custom") {
        await setAwaitDate(chatId);
        await ctx.reply("تاریخ شمسی را بفرست، مثل: ۱۴۰۵/۰۴/۲۸");
      }
      return;
    }

    // تأیید/تغییر گزارش نهایی
    if (data === "confirm:yes") {
      const state = await getConversationState(chatId);
      if (!project || !state?.workDayId) return;
      const day = await getWorkDayById(state.workDayId);
      if (day) await finalize(bot, ctx, project, day);
      return;
    }
    if (data === "confirm:edit") {
      const state = await getConversationState(chatId);
      await setReviewQuestions(chatId, state?.questions ?? [], state?.round ?? 1);
      await ctx.reply(
        "بگو چی رو عوض کنم (مثلاً: «ساعت خروج علی ۶ بود» یا «شایان امروز نبود»).\n" +
          "بعد «✅ ثبت نهایی» رو بزن.",
        { reply_markup: reviewKeyboard() },
      );
      return;
    }
  });

  // ── ویس ────────────────────────────────────────────
  bot.on(["message:voice", "message:audio"], async (ctx) => {
    try {
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
      const res = await fetch(url);
      const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      const text = await transcribeAudio(b64);
      await routeMessage(bot, ctx, text, {
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
    try {
      await routeMessage(bot, ctx, ctx.message.text, {
        kind: "text",
        telegramMessageId: ctx.message.message_id,
      });
    } catch (e) {
      console.error("text error:", e);
      await ctx.reply(MSG.error);
    }
  });
}

/** مسیر‌دهی یک پیام بر اساس فاز فعلی */
async function routeMessage(
  bot: Bot,
  ctx: Context,
  text: string,
  meta: {
    kind: "text" | "voice";
    telegramMessageId?: number;
    telegramFileId?: string;
  },
) {
  const chatId = ctx.chat!.id;
  const state = await getConversationState(chatId);

  // ساخت پروژه‌ی جدید
  if (state?.phase === "await_project_name") {
    const project = await createProject(chatId, text);
    await setActiveProject(chatId, project.id);
    await ctx.reply(MSG.projectCreated(project.name), {
      reply_markup: mainKeyboard(),
    });
    return;
  }

  // ورودی تاریخ
  if (state?.phase === "await_date") {
    const project = await getActiveProject(chatId);
    if (!project) {
      await ctx.reply(MSG.selectProjectFirst);
      return;
    }
    const j = parseJalaliInput(text);
    if (!j) {
      await ctx.reply("تاریخ را درست بفرست، مثل: ۱۴۰۵/۰۴/۲۸");
      return;
    }
    await startDayForDate(ctx, project, j);
    return;
  }

  // پاسخ به سؤالات بازبینی
  if (state?.phase === "review") {
    await addAnswer(chatId, text);
    await ctx.reply("✅ پاسخت ثبت شد. وقتی تموم شد «✅ ثبت نهایی» رو بزن.");
    return;
  }

  // در مرحله‌ی تأیید، متن = اصلاحیه → برگشت به بازبینی
  if (state?.phase === "confirm") {
    await addAnswer(chatId, text);
    await setReviewQuestions(chatId, state.questions ?? [], state.round ?? 1);
    await ctx.reply(
      "✅ اصلاحیه ثبت شد. «✅ ثبت نهایی» رو بزن تا اعمال بشه.",
      { reply_markup: reviewKeyboard() },
    );
    return;
  }

  // جمع‌آوری پیام‌های روز برای پروژه‌ی فعال
  const project = await getActiveProject(chatId);
  if (!project) {
    await ctx.reply(MSG.selectProjectFirst);
    return;
  }
  const day = await getOpenWorkDay(project.id);
  if (!day) {
    await ctx.reply(MSG.noOpenDay(project.name));
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
  await ctx.reply(MSG.saved(project.name));
}

/** ساخت یا بازکردن روز برای یک تاریخ (پروژه‌ی فعال) */
async function startDayForDate(ctx: Context, project: Project, j: JalaliInfo) {
  const chatId = ctx.chat!.id;
  // فاز را پاک می‌کنیم ولی پروژه‌ی فعال حفظ می‌شود
  await clearConversationState(chatId);

  const existing = await getWorkDayByDate(project.id, j.key);
  if (existing) {
    if (existing.status !== "open") await setDayStatus(existing.id, "open");
    await ctx.reply(MSG.dayReopened(project.name, existing.dateLabel), {
      reply_markup: mainKeyboard(),
    });
    return;
  }

  const day = await startWorkDay(project, j);
  await ctx.reply(
    MSG.dayStarted(project.name, day.dateLabel, day.reportNo ?? "-"),
    { reply_markup: mainKeyboard() },
  );
}

/** شروع بازبینی: استخراج کل روز + طرح سؤال‌ها */
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
    await showConfirm(ctx, day);
    return;
  }
  await setReview(ctx.chat!.id, day.id, res.questions, 1);
  await ctx.reply(
    "📝 برای کامل‌شدن گزارش این‌ها رو جواب بده (چند تا با هم، متن یا ویس)، " +
      "بعد «✅ ثبت نهایی»:\n\n" +
      numbered(res.questions),
    { reply_markup: reviewKeyboard() },
  );
}

/** نمایش گزارش نهایی به‌صورت متن + دکمه‌های تأیید/تغییر */
async function showConfirm(ctx: Context, day: WorkDay) {
  await setConfirm(ctx.chat!.id, day.id);
  const kb = new InlineKeyboard()
    .text("✅ تأیید نهایی", "confirm:yes")
    .text("✏️ تغییر", "confirm:edit");
  await ctx.reply(
    "👆 گزارش نهایی این پروژه آماده‌ست. تأیید می‌کنی یا تغییری لازمه؟",
    { reply_markup: kb },
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
  const finalSummary = await loadDaySummary(day.id);

  const buffer = await buildDailyExcel(project, dayForReport, finalSummary);
  const revTag = `-rev${String(rev).padStart(2, "0")}`;
  const safe = project.name.replace(/[^\p{L}\p{N}]+/gu, "_");
  const filename = `roznegar-${safe}-${day.jalaliDate.replace(/\//g, "-")}${revTag}.xlsx`;

  await ctx.replyWithDocument(new InputFile(buffer, filename), {
    caption: `📊 ${project.name} — ${day.dateLabel} (${day.reportNo}${revTag})`,
  });

  if (config.telegram.backupChannelId) {
    try {
      await bot.api.sendDocument(
        config.telegram.backupChannelId,
        new InputFile(buffer, filename),
        { caption: `📊 بک‌آپ ${project.name} — ${day.dateLabel}${revTag}` },
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
