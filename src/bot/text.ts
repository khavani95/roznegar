import { Keyboard } from "grammy";

/** متن دکمه‌های منوی اصلی (برای تطبیق دقیق استفاده می‌شوند) */
export const BTN = {
  startDay: "▶️ شروع روز",
  endDay: "⏹️ پایان روز",
  workers: "👷 نیروها",
  todayReport: "📊 گزارش امروز",
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

export const MSG = {
  welcome:
    "به روزنگار خوش آمدی 👷‍♂️\n\n" +
    "دستیار هوشمند گزارش روزانه‌ی کارگاه.\n\n" +
    "۱) دکمه‌ی «▶️ شروع روز» را بزن.\n" +
    "۲) در طول روز، گزارش‌ها را به‌صورت متن یا ویس بفرست " +
    "(مثلاً: «علی ساعت ۸ اومد» یا «اکیپ آرماتوربندی طبقه ۳ بودن»).\n" +
    "۳) آخر روز «⏹️ پایان روز» را بزن تا گزارش استاندارد ساخته شود.",

  dayAlreadyOpen: (label: string) =>
    `⚠️ یک روز باز از قبل وجود دارد (${label}). اول آن را با «⏹️ پایان روز» ببند.`,

  dayStarted: (label: string, reportNo: string) =>
    `✅ روز کاری شروع شد.\n📅 ${label}\n🔖 شماره گزارش: ${reportNo}\n\n` +
    "حالا گزارش‌هایت را به‌صورت متن یا ویس بفرست.",

  noOpenDay:
    "هنوز روزی شروع نشده. اول دکمه‌ی «▶️ شروع روز» را بزن.",

  processing: "⏳ در حال پردازش…",

  saved: (n: number) =>
    n > 0
      ? `✅ ثبت شد (${n} مورد استخراج شد).`
      : "✅ پیام ذخیره شد.",

  noWorkers: "هنوز نیرویی ثبت نشده. با گزارش کارکرد، نیروها خودکار اضافه می‌شوند.",

  notAllowed: "⛔️ دسترسی مجاز نیست.",

  error: "❌ خطایی رخ داد. لطفاً دوباره تلاش کن.",
};
