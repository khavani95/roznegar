import { Bot, InputFile } from "grammy";
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
} from "@/db/queries";
import { extractEvents } from "@/ai/extract";
import { consolidateDay } from "@/services/consolidate";
import { buildDailyExcel } from "@/services/report-excel";
import { toFaDigits } from "@/lib/jalali";
import type { ExtractedEventItem } from "@/ai/schema";

let _bot: Bot | null = null;

/**
 * بات را به‌صورت تنبل می‌سازد (singleton) تا در زمان build نیاز به توکن نباشد
 * و در محیط سرورلس بین درخواست‌ها بازاستفاده شود.
 */
export function getBot(): Bot {
  if (_bot) return _bot;
  const bot = new Bot(config.telegram.botToken);
  registerHandlers(bot);
  _bot = bot;
  return bot;
}

function registerHandlers(bot: Bot) {
  // ── میان‌افزار کنترل دسترسی ────────────────────────
  bot.use(async (ctx, next) => {
    const allow = config.telegram.allowedChatIds;
    if (allow.length && ctx.chat && !allow.includes(String(ctx.chat.id))) {
      await ctx.reply(MSG.notAllowed);
      return;
    }
    await next();
  });

  // ── دستور /start ───────────────────────────────────
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
    await ctx.reply(MSG.dayStarted(day.dateLabel, day.reportNo ?? "-"), {
      reply_markup: mainKeyboard(),
    });
  });

  // ── گزارش امروز (پیش‌نمایش بدون بستن روز) ───────────
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
    const lines = workers.map(
      (w, i) =>
        `${toFaDigits(i + 1)}. ${w.fullName}${w.trade ? ` — ${w.trade}` : ""}`,
    );
    await ctx.reply(
      `👷 نیروهای کارگاه (${toFaDigits(workers.length)}):\n\n` + lines.join("\n"),
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
    await ctx.reply(MSG.processing);

    const summary = await consolidateDay(project.id, day.id);
    await ctx.reply(formatDaySummary(day, summary));

    // ساخت و ارسال فایل اکسل
    const buffer = await buildDailyExcel(project, day, summary);
    const filename = `roznegar-${day.jalaliDate.replace(/\//g, "-")}.xlsx`;

    await ctx.replyWithDocument(new InputFile(buffer, filename), {
      caption: `📊 گزارش استاندارد ${day.dateLabel}`,
    });

    // ارسال به کانال بک‌آپ (اگر تنظیم شده باشد)
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
    await ctx.reply("✅ روز بسته شد و گزارش ذخیره گردید.", {
      reply_markup: mainKeyboard(),
    });
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

      const known = (await listWorkers(project.id)).map((w) => w.fullName);
      const { events } = await extractEvents({
        audioBase64,
        audioMimeType: "audio/ogg",
        knownWorkers: known,
      });

      await persist(day.id, ctx.message?.message_id, "voice", events, {
        telegramFileId: file.file_id,
      });
      await ctx.reply(formatAck(events));
    } catch (e) {
      console.error("voice handling error:", e);
      await ctx.reply(MSG.error);
    }
  });

  // ── پیام متنی (هر متنی که دکمه نباشد) ───────────────
  bot.on("message:text", async (ctx) => {
    const project = await getOrCreateProject(ctx.chat.id);
    const day = await getOpenWorkDay(project.id);
    if (!day) {
      await ctx.reply(MSG.noOpenDay);
      return;
    }

    try {
      const text = ctx.message.text;
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
