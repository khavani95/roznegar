import { Bot, InputFile, InlineKeyboard, type Context } from "grammy";
import { config } from "@/lib/config";
import { BTN, MSG, mainKeyboard } from "./text";
import { formatAck, formatDaySummary } from "./format";
import {
  getOrCreateProject,
  getOpenWorkDay,
  startWorkDay,
  closeWorkDay,
  listWorkers,
  saveRawMessage,
  saveEvents,
  getConversationState,
  setConversationState,
  clearConversationState,
  listDayActivities,
  linkWorkerToActivity,
} from "@/db/queries";
import { extractEvents, transcribeAudio } from "@/ai/extract";
import { consolidateDay, loadDaySummary } from "@/services/consolidate";
import {
  buildWizardQueue,
  softWarnings,
  questionText,
  processAnswer,
} from "@/services/wizard";
import { buildDailyExcel } from "@/services/report-excel";
import { toFaDigits } from "@/lib/jalali";
import type { ExtractedEventItem } from "@/ai/schema";
import type { Project, WorkDay, ConversationState, WizardItem } from "@/db/schema";

let _bot: Bot | null = null;

/** بات را به‌صورت تنبل می‌سازد (singleton) — مناسب سرورلس. */
export function getBot(): Bot {
  if (_bot) return _bot;
  const bot = new Bot(config.telegram.botToken);
  registerHandlers(bot);
  _bot = bot;
  return bot;
}

function registerHandlers(bot: Bot) {
  // ── کنترل دسترسی ───────────────────────────────────
  bot.use(async (ctx, next) => {
    const allow = config.telegram.allowedChatIds;
    if (allow.length && ctx.chat && !allow.includes(String(ctx.chat.id))) {
      await ctx.reply(MSG.notAllowed);
      return;
    }
    await next();
  });

  // ── /start ─────────────────────────────────────────
  bot.command("start", async (ctx) => {
    await ctx.reply(MSG.welcome, { reply_markup: mainKeyboard() });
  });

  // ── شروع روز ───────────────────────────────────────
  bot.hears(BTN.startDay, async (ctx) => {
    const project = await getOrCreateProject(ctx.chat.id);
    const open = await getOpenWorkDay(project.id);
    if (open) {
      await ctx.reply(MSG.dayAlreadyOpen(open.dateLabel));
      return;
    }
    const day = await startWorkDay(project);
    await clearConversationState(ctx.chat.id);
    await ctx.reply(MSG.dayStarted(day.dateLabel, day.reportNo ?? "-"), {
      reply_markup: mainKeyboard(),
    });
  });

  // ── گزارش امروز (پیش‌نمایش) ─────────────────────────
  bot.hears(BTN.todayReport, async (ctx) => {
    const project = await getOrCreateProject(ctx.chat.id);
    const day = await getOpenWorkDay(project.id);
    if (!day) {
      await ctx.reply(MSG.noOpenDay);
      return;
    }
    await ctx.reply(MSG.processing);
    const summary = await consolidateDay(project.id, day.id);
    await ctx.reply(formatDaySummary(day, summary));
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
        lines.join("\n") +
        `\n\n⚠️ = پروفایل ناقص`,
    );
  });

  // ── پایان روز ──────────────────────────────────────
  bot.hears(BTN.endDay, async (ctx) => {
    const project = await getOrCreateProject(ctx.chat.id);
    const day = await getOpenWorkDay(project.id);
    if (!day) {
      await ctx.reply(MSG.noOpenDay);
      return;
    }

    // اگر وسط ویزارد هستیم، «پایان روز» یعنی «همین حالا نهایی کن»
    const state = await getConversationState(ctx.chat.id);
    if (state?.phase === "wizard") {
      await ctx.reply("در حال نهایی‌سازی (موارد باقی‌مانده رد می‌شوند)…");
      await finalizeDay(bot, ctx, project, day);
      return;
    }

    await ctx.reply(MSG.processing);
    const summary = await consolidateDay(project.id, day.id);
    const warns = softWarnings(summary);
    const queue = buildWizardQueue(summary);

    if (queue.length === 0) {
      if (warns.length) await ctx.reply(warns.join("\n"));
      await finalizeDay(bot, ctx, project, day);
      return;
    }

    await setConversationState(ctx.chat.id, day.id, "wizard", queue);
    let intro = `📝 قبل از ثبت نهایی، ${toFaDigits(queue.length)} مورد باید کامل شود:`;
    if (warns.length) intro += "\n\n" + warns.join("\n");
    await ctx.reply(intro);
    await askItem(ctx, queue[0], day.id);
  });

  // ── انتخاب فعالیت با دکمه (مرحله‌ی پوشش ویزارد) ─────
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat?.id;
    if (!chatId) {
      await ctx.answerCallbackQuery();
      return;
    }

    const state = await getConversationState(chatId);
    if (!state || state.phase !== "wizard" || !state.queue.length) {
      await ctx.answerCallbackQuery({ text: "این مورد منقضی شده." });
      return;
    }
    const item = state.queue[0];
    const parts = data.split(":"); // wz:cov:<workerId>:<activityId> | wz:skip:<workerId>
    if (item.kind !== "coverage" || Number(parts[2]) !== item.workerId) {
      await ctx.answerCallbackQuery({ text: "مربوط به مورد دیگری است." });
      return;
    }

    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageReplyMarkup();
    } catch {
      // بی‌اهمیت
    }

    const project = await getOrCreateProject(chatId);
    const day = await getOpenWorkDay(project.id);
    if (!day) {
      await ctx.reply(MSG.noOpenDay);
      return;
    }
    const workDayId = state.workDayId ?? day.id;

    if (parts[1] === "skip") {
      await ctx.reply("رد شد.");
    } else if (parts[1] === "cov") {
      await linkWorkerToActivity(Number(parts[3]), item.workerId!);
      await ctx.reply(`✅ «${item.label}» به فعالیت وصل شد.`);
    }
    await advanceWizard(bot, ctx, project, day, state.queue.slice(1), workDayId);
  });

  // ── پیام صوتی ──────────────────────────────────────
  bot.on(["message:voice", "message:audio"], async (ctx) => {
    const project = await getOrCreateProject(ctx.chat.id);
    const day = await getOpenWorkDay(project.id);
    if (!day) {
      await ctx.reply(MSG.noOpenDay);
      return;
    }

    try {
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
      const res = await fetch(url);
      const audioBase64 = Buffer.from(await res.arrayBuffer()).toString("base64");

      const state = await getConversationState(ctx.chat.id);
      if (state?.phase === "wizard" && state.queue.length) {
        const answer = await transcribeAudio(audioBase64);
        await handleWizardAnswer(bot, ctx, project, day, state, answer);
        return;
      }

      const known = (await listWorkers(project.id)).map((w) => w.fullName);
      const { events, transcript } = await extractEvents({
        audioBase64,
        audioMimeType: "audio/ogg",
        knownWorkers: known,
      });
      await persist(day.id, ctx.message?.message_id, "voice", events, {
        telegramFileId: file.file_id,
        transcript,
      });
      await ctx.reply(formatAck(events));
    } catch (e) {
      console.error("voice handling error:", e);
      await ctx.reply(MSG.error);
    }
  });

  // ── پیام متنی ──────────────────────────────────────
  bot.on("message:text", async (ctx) => {
    const project = await getOrCreateProject(ctx.chat.id);
    const day = await getOpenWorkDay(project.id);
    if (!day) {
      await ctx.reply(MSG.noOpenDay);
      return;
    }

    try {
      const text = ctx.message.text;

      const state = await getConversationState(ctx.chat.id);
      if (state?.phase === "wizard" && state.queue.length) {
        await handleWizardAnswer(bot, ctx, project, day, state, text);
        return;
      }

      const known = (await listWorkers(project.id)).map((w) => w.fullName);
      const { events } = await extractEvents({ text, knownWorkers: known });
      await persist(day.id, ctx.message.message_id, "text", events, { text });
      await ctx.reply(formatAck(events));
    } catch (e) {
      console.error("text handling error:", e);
      await ctx.reply(MSG.error);
    }
  });
}

/** نمایش یک آیتم ویزارد؛ برای «پوشش» دکمه‌های انتخاب فعالیت نشان می‌دهد */
async function askItem(ctx: Context, item: WizardItem, workDayId: number) {
  if (item.kind !== "coverage") {
    await ctx.reply(questionText(item));
    return;
  }

  const acts = await listDayActivities(workDayId);
  const kb = new InlineKeyboard();
  for (const a of acts) {
    const raw = a.workFront ? `${a.workFront} — ${a.description}` : a.description;
    kb.text(truncate(raw, 45), `wz:cov:${item.workerId}:${a.id}`).row();
  }
  kb.text("رد کردن", `wz:skip:${item.workerId}`);

  const head = acts.length
    ? `🏗️ «${item.label}» کدام فعالیت را انجام داد؟\n` +
      `یکی را انتخاب کن، یا فعالیت جدیدی تایپ کن (مثلاً: «بتن‌ریزی طبقه ۲، تمام‌روز»).`
    : `🏗️ «${item.label}» امروز چه کاری و کجا انجام داد؟\n` +
      `مثال: «آرماتوربندی طبقه ۳، از ۸ تا ۴» (یا بنویس: رد)`;
  await ctx.reply(head, { reply_markup: kb });
}

/** رفتن به آیتم بعدی ویزارد یا نهایی‌سازی روز */
async function advanceWizard(
  bot: Bot,
  ctx: Context,
  project: Project,
  day: WorkDay,
  rest: WizardItem[],
  workDayId: number,
) {
  if (rest.length) {
    await setConversationState(ctx.chat!.id, workDayId, "wizard", rest);
    await ctx.reply(`(باقی‌مانده: ${toFaDigits(rest.length)})`);
    await askItem(ctx, rest[0], workDayId);
  } else {
    await ctx.reply("✅ همه‌ی موارد کامل شد. در حال ساخت گزارش…");
    await finalizeDay(bot, ctx, project, day);
  }
}

/** پردازش یک پاسخ متنی/صوتی در ویزارد و رفتن به مرحله‌ی بعد */
async function handleWizardAnswer(
  bot: Bot,
  ctx: Context,
  project: Project,
  day: WorkDay,
  state: ConversationState,
  answerText: string,
) {
  const queue = state.queue;
  const item = queue[0];
  const workDayId = state.workDayId ?? day.id;

  const res = await processAnswer(item, answerText, workDayId);
  await ctx.reply(res.note);

  // اگر پاسخ فهمیده نشد و رد هم نکرد، همان سؤال دوباره پرسیده شود
  if (!res.ok && !res.skipped) {
    await askItem(ctx, item, workDayId);
    return;
  }

  await advanceWizard(bot, ctx, project, day, queue.slice(1), workDayId);
}

/** ساخت و ارسال گزارش نهایی، بستن روز و پاک‌کردن وضعیت */
async function finalizeDay(
  bot: Bot,
  ctx: Context,
  project: Project,
  day: WorkDay,
) {
  const summary = await loadDaySummary(day.id);
  await ctx.reply(formatDaySummary(day, summary));

  const buffer = await buildDailyExcel(project, day, summary);
  const filename = `roznegar-${day.jalaliDate.replace(/\//g, "-")}.xlsx`;

  await ctx.replyWithDocument(new InputFile(buffer, filename), {
    caption: `📊 گزارش استاندارد ${day.dateLabel}`,
  });

  if (config.telegram.backupChannelId) {
    try {
      await bot.api.sendDocument(
        config.telegram.backupChannelId,
        new InputFile(buffer, filename),
        { caption: `📊 بک‌آپ گزارش ${day.dateLabel} — ${project.name}` },
      );
    } catch (e) {
      console.error("backup channel send failed:", e);
    }
  }

  await closeWorkDay(day.id);
  await clearConversationState(ctx.chat!.id);
  await ctx.reply("✅ روز بسته شد و گزارش ذخیره گردید.", {
    reply_markup: mainKeyboard(),
  });
}

/** ذخیره‌ی پیام خام + رویدادهای استخراج‌شده */
async function persist(
  workDayId: number,
  telegramMessageId: number | undefined,
  kind: "text" | "voice",
  events: ExtractedEventItem[],
  extra: { text?: string; transcript?: string; telegramFileId?: string },
) {
  const raw = await saveRawMessage({
    workDayId,
    telegramMessageId,
    kind,
    text: extra.text,
    transcript: extra.transcript,
    telegramFileId: extra.telegramFileId,
  });
  await saveEvents(
    workDayId,
    raw.id,
    events.map((e) => ({
      type: e.type,
      payload: e as unknown as Record<string, unknown>,
    })),
  );
}

/** کوتاه‌کردن متن دکمه */
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
