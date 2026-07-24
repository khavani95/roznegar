import { Bot, InputFile, InlineKeyboard, type Context } from "grammy";
import { config } from "@/lib/config";
import { BTN, MSG, homeKeyboard, projectKeyboard } from "./text";
import {
  formatDaySummary,
  formatWorkerCard,
  formatActivitiesCard,
  formatIssuesReworkCard,
} from "./format";
import {
  createProject,
  listProjects,
  getProjectById,
  getActiveProject,
  setActiveProject,
  clearActiveProject,
  setAwaitProjectName,
  listOpenDays,
  getOpenWorkDay,
  getWorkDayById,
  getWorkDayByDate,
  startWorkDay,
  setDayStatus,
  bumpRevision,
  listWorkers,
  saveRawMessage,
  getConversationState,
  setAwaitDate,
  setCards,
  updateCardState,
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
    await clearActiveProject(ctx.chat.id);
    await ctx.reply(MSG.welcome, { reply_markup: homeKeyboard() });
  });

  // ── منوی اصلی ──────────────────────────────────────
  bot.hears(BTN.newProject, async (ctx) => {
    await setAwaitProjectName(ctx.chat.id);
    await ctx.reply(MSG.askProjectName);
  });

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
    await ctx.reply("پروژه را انتخاب کن:", { reply_markup: kb });
  });

  bot.hears(BTN.back, async (ctx) => {
    const st = await getConversationState(ctx.chat.id);
    if (st?.workDayId && (st.phase === "cards" || st.phase === "card_edit")) {
      await setDayStatus(st.workDayId, "open"); // مرور را رها کن، روز باز بماند
    }
    await clearActiveProject(ctx.chat.id);
    await ctx.reply("منوی اصلی 🏠", { reply_markup: homeKeyboard() });
  });

  // ── پایان روز همه ──────────────────────────────────
  bot.hears(BTN.endAll, async (ctx) => {
    const opens = await listOpenDays(ctx.chat.id);
    if (!opens.length) {
      await ctx.reply(MSG.noOpenDaysAll);
      return;
    }
    const kb = new InlineKeyboard();
    for (const { day, project } of opens) {
      kb.text(`${project.name} — ${day.dateLabel}`, `end:${day.id}`).row();
    }
    await ctx.reply("کدام پروژه را ببندم؟", { reply_markup: kb });
  });

  // ── داخل پروژه ─────────────────────────────────────
  bot.hears(BTN.startDay, async (ctx) => {
    const project = await getActiveProject(ctx.chat.id);
    if (!project) return await ctx.reply(MSG.selectProjectFirst);
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

  bot.hears(BTN.endDay, async (ctx) => {
    const project = await getActiveProject(ctx.chat.id);
    if (!project) return await ctx.reply(MSG.selectProjectFirst);
    const day = await getOpenWorkDay(project.id);
    if (!day) return await ctx.reply(MSG.noOpenDay(project.name));
    await beginReview(bot, ctx, project, day);
  });

  bot.hears(BTN.todayReport, async (ctx) => {
    const project = await getActiveProject(ctx.chat.id);
    if (!project) return await ctx.reply(MSG.selectProjectFirst);
    const day = await getOpenWorkDay(project.id);
    if (!day) return await ctx.reply(MSG.noOpenDay(project.name));
    await ctx.reply(MSG.processing);
    const res = await runExtraction(project.id, day.id);
    await ctx.reply(formatDaySummary(day, res.summary));
  });

  bot.hears(BTN.workers, async (ctx) => {
    const project = await getActiveProject(ctx.chat.id);
    if (!project) return await ctx.reply(MSG.selectProjectFirst);
    const workers = await listWorkers(project.id);
    if (!workers.length) return await ctx.reply(MSG.noWorkers);
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
      await setActiveProject(chatId, Number(data.slice(2)));
      const project = await getActiveProject(chatId);
      await ctx.reply(MSG.projectSelected(project?.name ?? "-"), {
        reply_markup: projectKeyboard(),
      });
      return;
    }

    // بستن یک پروژه از «پایان روز همه»
    if (data.startsWith("end:")) {
      const day = await getWorkDayById(Number(data.slice(4)));
      if (!day) return;
      const project = await getProjectById(day.projectId);
      if (!project) return;
      await setActiveProject(chatId, project.id);
      await beginReview(bot, ctx, project, day);
      return;
    }

    // انتخاب تاریخ
    if (data.startsWith("d:")) {
      const project = await getActiveProject(chatId);
      if (!project) return await ctx.reply(MSG.selectProjectFirst);
      if (data === "d:today") await startDayForDate(ctx, project, toJalali());
      else if (data === "d:yesterday")
        await startDayForDate(ctx, project, jalaliDaysAgo(1));
      else if (data === "d:custom") {
        await setAwaitDate(chatId);
        await ctx.reply("تاریخ شمسی را بفرست، مثل: ۱۴۰۵/۰۴/۲۸");
      }
      return;
    }

    // کارت‌های مرور پایان روز
    if (data.startsWith("card:")) {
      await handleCardCallback(bot, ctx, data);
      return;
    }
  });

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

/** مسیر‌دهی پیام بر اساس فاز */
async function routeMessage(
  bot: Bot,
  ctx: Context,
  text: string,
  meta: { kind: "text" | "voice"; telegramMessageId?: number; telegramFileId?: string },
) {
  const chatId = ctx.chat!.id;
  const state = await getConversationState(chatId);

  if (state?.phase === "await_project_name") {
    const project = await createProject(chatId, text);
    await setActiveProject(chatId, project.id);
    await ctx.reply(MSG.projectCreated(project.name), {
      reply_markup: projectKeyboard(),
    });
    return;
  }

  if (state?.phase === "await_date") {
    const project = await getActiveProject(chatId);
    if (!project) return await ctx.reply(MSG.selectProjectFirst);
    const j = parseJalaliInput(text);
    if (!j) return await ctx.reply("تاریخ را درست بفرست، مثل: ۱۴۰۵/۰۴/۲۸");
    await startDayForDate(ctx, project, j);
    return;
  }

  // پاسخ به «تغییر» یک کارت
  if (state?.phase === "card_edit" && state.cardState) {
    const project = await getActiveProject(chatId);
    const cs = state.cardState;
    const change = `برای ${cs.editTarget ?? "گزارش"}: ${text}`;
    await updateCardState(
      chatId,
      { changes: [...cs.changes, change], editTarget: null, index: cs.index + 1 },
      "cards",
    );
    await ctx.reply("✅ اصلاحیه ثبت شد.");
    if (project && state.workDayId)
      await showCard(bot, ctx, project, state.workDayId, cs.index + 1);
    return;
  }

  if (state?.phase === "cards") {
    await ctx.reply("از دکمه‌های کارت استفاده کن: ✅ تأیید / ✏️ تغییر / 🗑️ حذف.");
    return;
  }

  // جمع‌آوری پیام‌های روز
  const project = await getActiveProject(chatId);
  if (!project) return await ctx.reply(MSG.selectProjectFirst);
  const day = await getOpenWorkDay(project.id);
  if (!day) return await ctx.reply(MSG.noOpenDay(project.name));
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

async function startDayForDate(ctx: Context, project: Project, j: JalaliInfo) {
  const chatId = ctx.chat!.id;
  const existing = await getWorkDayByDate(project.id, j.key);
  if (existing) {
    if (existing.status !== "open") await setDayStatus(existing.id, "open");
    await ctx.reply(MSG.dayReopened(project.name, existing.dateLabel), {
      reply_markup: projectKeyboard(),
    });
    return;
  }
  const day = await startWorkDay(project, j);
  await ctx.reply(
    MSG.dayStarted(project.name, day.dateLabel, day.reportNo ?? "-"),
    { reply_markup: projectKeyboard() },
  );
}

/** شروع مرور کارتی */
async function beginReview(bot: Bot, ctx: Context, project: Project, day: WorkDay) {
  await ctx.reply(MSG.processing);
  await runExtraction(project.id, day.id); // استخراج اولیه
  await setDayStatus(day.id, "review");
  await setCards(ctx.chat!.id, day.id);
  await ctx.reply(
    `📋 مرور گزارش «${project.name}» — ${day.dateLabel}\n` +
      "هر کارت را تأیید، تغییر یا حذف کن. تغییرها آخر یکجا اعمال می‌شوند.",
  );
  await showCard(bot, ctx, project, day.id, 0);
}

/** نمایش کارت شماره‌ی index */
async function showCard(
  bot: Bot,
  ctx: Context,
  project: Project,
  workDayId: number,
  index: number,
) {
  const s = await loadDaySummary(workDayId);
  const W = s.attendance.length;

  if (index < W) {
    const a = s.attendance[index];
    const kb = new InlineKeyboard()
      .text("✅ تأیید", "card:ok")
      .text("✏️ تغییر", "card:edit")
      .text("🗑️ حذف", `card:del:${a.workerId}`);
    await ctx.reply(formatWorkerCard(a, index, W), { reply_markup: kb });
  } else if (index === W) {
    const kb = new InlineKeyboard()
      .text("✅ تأیید", "card:ok")
      .text("✏️ تغییر", "card:edit");
    await ctx.reply(formatActivitiesCard(s.activities), { reply_markup: kb });
  } else if (index === W + 1) {
    const kb = new InlineKeyboard()
      .text("✅ تمام", "card:ok")
      .text("✏️ اضافه/تغییر", "card:edit");
    await ctx.reply(
      formatIssuesReworkCard(s) +
        "\n\nموانع یا دوباره‌کاری‌ای برای اضافه/اصلاح هست؟",
      { reply_markup: kb },
    );
  } else {
    await finalizeFromCards(bot, ctx, project, workDayId);
  }
}

/** پردازش دکمه‌های کارت */
async function handleCardCallback(bot: Bot, ctx: Context, data: string) {
  const chatId = ctx.chat!.id;
  const state = await getConversationState(chatId);
  const project = await getActiveProject(chatId);
  if (!state?.cardState || !state.workDayId || !project) return;
  const cs = state.cardState;

  if (data.startsWith("card:del:")) {
    const workerId = Number(data.split(":")[2]);
    const s = await loadDaySummary(state.workDayId);
    const w = s.attendance.find((x) => x.workerId === workerId);
    if (w) {
      await updateCardState(chatId, { deletions: [...cs.deletions, w.name] });
      await ctx.reply(`🗑️ «${w.name}» حذف شد.`);
    }
    await advanceCard(bot, ctx, project, state.workDayId, cs.index);
    return;
  }

  if (data === "card:edit") {
    const s = await loadDaySummary(state.workDayId);
    const W = s.attendance.length;
    let target = "گزارش";
    if (cs.index < W) target = s.attendance[cs.index].name;
    else if (cs.index === W) target = "فعالیت‌ها";
    else target = "موانع و دوباره‌کاری";
    await updateCardState(chatId, { editTarget: target }, "card_edit");
    await ctx.reply(`✏️ چی رو برای «${target}» عوض کنم؟ (متن یا ویس بفرست)`);
    return;
  }

  // card:ok
  await advanceCard(bot, ctx, project, state.workDayId, cs.index);
}

async function advanceCard(
  bot: Bot,
  ctx: Context,
  project: Project,
  workDayId: number,
  index: number,
) {
  await updateCardState(ctx.chat!.id, { index: index + 1, editTarget: null }, "cards");
  await showCard(bot, ctx, project, workDayId, index + 1);
}

/** اعمال تغییرات جمع‌شده و ساخت گزارش نهایی */
async function finalizeFromCards(
  bot: Bot,
  ctx: Context,
  project: Project,
  workDayId: number,
) {
  const state = await getConversationState(ctx.chat!.id);
  const cs = state?.cardState;
  await ctx.reply("⏳ در حال اعمال تغییرات و ساخت گزارش نهایی…");

  if (cs && (cs.changes.length || cs.deletions.length)) {
    await runExtraction(project.id, workDayId, {
      changes: cs.changes,
      deletions: cs.deletions,
    });
  }

  const day = await getWorkDayById(workDayId);
  if (!day) return;
  await finalize(bot, ctx, project, day);
}

/** ساخت اکسل + بستن روز */
async function finalize(bot: Bot, ctx: Context, project: Project, day: WorkDay) {
  const rev = await bumpRevision(day.id);
  const dayForReport: WorkDay = { ...day, revision: rev };
  const summary = await loadDaySummary(day.id);

  await ctx.reply(formatDaySummary(dayForReport, summary));

  const buffer = await buildDailyExcel(project, dayForReport, summary);
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
  await ctx.reply("✅ گزارش نهایی ثبت شد.", { reply_markup: projectKeyboard() });
}
