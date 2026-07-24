import { Keyboard } from "grammy";

/** متن دکمه‌های منو (برای تطبیق دقیق استفاده می‌شوند) */
export const BTN = {
  startDay: "▶️ شروع روز",
  endDay: "⏹️ پایان روز",
  workers: "👷 نیروها",
  todayReport: "📊 گزارش امروز",
  projects: "📁 پروژه‌ها",
  newProject: "➕ پروژه جدید",
  finalize: "✅ ثبت نهایی",
  cancel: "✖️ لغو",
} as const;

/** صفحه‌کلید منوی اصلی */
export function mainKeyboard() {
  return new Keyboard()
    .text(BTN.startDay)
    .text(BTN.endDay)
    .row()
    .text(BTN.todayReport)
    .text(BTN.workers)
    .row()
    .text(BTN.projects)
    .text(BTN.newProject)
    .resized()
    .persistent();
}

/** صفحه‌کلید مرحله‌ی بازبینی */
export function reviewKeyboard() {
  return new Keyboard()
    .text(BTN.finalize)
    .text(BTN.cancel)
    .resized()
    .persistent();
}

export const MSG = {
  welcome:
    "به روزنگار خوش آمدی 👷‍♂️\n\n" +
    "دستیار هوشمند گزارش روزانه‌ی کارگاه (چندپروژه‌ای).\n\n" +
    "۱) با «➕ پروژه جدید» پروژه‌هایت را بساز.\n" +
    "۲) از «📁 پروژه‌ها» پروژه‌ی موردنظر را انتخاب کن.\n" +
    "۳) «▶️ شروع روز» → گزارش‌ها را با متن یا ویس بفرست.\n" +
    "۴) «⏹️ پایان روز» → دستیار سؤال می‌پرسد، جواب می‌دهی، تأیید می‌کنی.",

  selectProjectFirst:
    "اول یک پروژه انتخاب کن یا بساز:\n«📁 پروژه‌ها» یا «➕ پروژه جدید».",

  noProjects: "هنوز پروژه‌ای نساختی. «➕ پروژه جدید» را بزن.",
  askProjectName: "نام پروژه‌ی جدید را بفرست:",
  projectCreated: (name: string) => `✅ پروژه «${name}» ساخته و فعال شد.`,
  projectSelected: (name: string) => `📁 پروژه‌ی فعال: «${name}»`,

  noOpenDay: (name: string) =>
    `برای پروژه‌ی «${name}» روزی باز نیست. «▶️ شروع روز» را بزن.`,

  dayAlreadyOpen: (name: string, label: string) =>
    `⚠️ پروژه‌ی «${name}» یک روز باز دارد (${label}) و همان فعال است.\n` +
    "گزارش‌هایت را بفرست، یا «⏹️ پایان روز» را بزن.",

  dayStarted: (project: string, label: string, reportNo: string) =>
    `✅ روز باز شد.\n📁 ${project}\n📅 ${label}\n🔖 ${reportNo}\n\n` +
    "گزارش‌هایت را با متن یا ویس بفرست.",

  dayReopened: (project: string, label: string) =>
    `🔓 روز «${label}» پروژه‌ی «${project}» دوباره باز شد. پیام‌ها را بفرست.`,

  saved: (name: string) => `✅ ثبت شد (پروژه: ${name}).`,

  notAllowed: "⛔️ دسترسی مجاز نیست.",
  noWorkers: "هنوز نیرویی ثبت نشده.",
  processing: "⏳ در حال بررسی کل روز…",
  error: "❌ خطایی رخ داد. لطفاً دوباره تلاش کن.",
};
