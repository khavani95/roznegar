import { workRules, type WorkRules } from "@/lib/config";

/** تبدیل "HH:MM" به دقیقه از ابتدای شبانه‌روز */
export function timeToMinutes(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** تبدیل دقیقه به "HH:MM" */
export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface WorkCalcResult {
  clockSpanMinutes: number; // مدت حضور خام (خروج منهای ورود)
  breakMinutes: number; // استراحت کسرشده
  workedMinutes: number; // کارِ خالص
  dayFraction: number; // نسبت روز کامل (۱ = یک روز کامل)
  overtimeMinutes: number; // اضافه‌کاری
}

/**
 * محاسبه‌ی کارکرد بر اساس ساعت ورود/خروج.
 *
 * مثال «علی»:
 *   ورود ۰۸:۰۰ ، خروج ۲۰:۰۰  →  ۱۲ ساعت حضور
 *   منهای ۱ ساعت ناهار        →  ۱۱ ساعت کار خالص
 *   روز استاندارد ۸ ساعت      →  اضافه‌کاری ۳ ساعت، یک روز کامل
 */
export function calcWork(
  entry: string,
  exit: string,
  rules: WorkRules = workRules,
): WorkCalcResult | null {
  const start = timeToMinutes(entry);
  let end = timeToMinutes(exit);
  if (start === null || end === null) return null;

  // اگر خروج «کوچک‌تر» از ورود بود، یعنی از نیمه‌شب رد شده
  if (end <= start) end += 24 * 60;

  const clockSpanMinutes = end - start;

  const breakMinutes =
    clockSpanMinutes > rules.lunchAppliesAfterMinutes
      ? rules.lunchBreakMinutes
      : 0;

  const workedMinutes = Math.max(0, clockSpanMinutes - breakMinutes);

  const dayFraction =
    workedMinutes >= rules.standardWorkMinutes
      ? 1
      : round2(workedMinutes / rules.standardWorkMinutes);

  const overtimeMinutes = Math.max(
    0,
    workedMinutes - rules.standardWorkMinutes,
  );

  return {
    clockSpanMinutes,
    breakMinutes,
    workedMinutes,
    dayFraction,
    overtimeMinutes,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** نمایش دقیقه به‌صورت خوانا مثل «۱۱ ساعت و ۳۰ دقیقه» */
export function humanDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} ساعت و ${m} دقیقه`;
  if (h) return `${h} ساعت`;
  return `${m} دقیقه`;
}
