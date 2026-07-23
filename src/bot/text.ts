import { Keyboard } from "grammy";

/** متن دکمه‌های منو (برای تطبیق دقیق استفاده می‌شوند) */
export const BTN = {
  startDay: "▶️ شروع روز",
  endDay: "⏹️ پایان روز",
  workers: "👷 نیروها",
  todayReport: "📊 گزارش امروز",
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
    .resized()
    .persistent();
}

/** صفحه‌کلید مرحله‌ی بازبینی (پاسخ به سؤالات) */
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
    "دستیار هوشمند گزارش روزانه‌ی کارگاه.\n\n" +
    "۱) دکمه‌ی «▶️ شروع روز» را بزن و تاریخ را انتخاب کن.\n" +
    "۲) در طول روز، گزارش‌ها را با متن یا ویس بفرست (فقط ذخیره می‌شوند).\n" +
    "۳) آخر روز «⏹️ پایان روز» را بزن؛ دستیار کل روز را می‌خواند، چند سؤال " +
    "می‌پرسد، جواب می‌دهی و با «✅ ثبت نهایی» گزارش استاندارد ساخته می‌شود.",

  noOpenDay: "هنوز روزی باز نیست. اول دکمه‌ی «▶️ شروع روز» را بزن.",

  dayStarted: (label: string, reportNo: string) =>
    `✅ روز کاری باز شد.\n📅 ${label}\n🔖 ${reportNo}\n\n` +
    "حالا گزارش‌هایت را با متن یا ویس بفرست. (فقط ذخیره می‌شوند تا پایان روز)",

  dayReopened: (label: string) =>
    `🔓 روز «${label}» دوباره باز شد برای ویرایش. پیام‌های جدید را بفرست، ` +
    "بعد «⏹️ پایان روز» را بزن.",

  saved: "✅ ثبت شد.",

  notAllowed: "⛔️ دسترسی مجاز نیست.",
  noWorkers: "هنوز نیرویی ثبت نشده.",
  processing: "⏳ در حال بررسی کل روز…",
  error: "❌ خطایی رخ داد. لطفاً دوباره تلاش کن.",
};
