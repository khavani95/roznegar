import type { ExtractedEventItem } from "./schema";

/**
 * پارسر قطعی (بدون هوش مصنوعی) برای الگوی رایج ورود/خروج.
 * تضمین می‌کند که خطوطی مثل «محمد خوانی ساعت ۸ اومد» هیچ‌وقت جا نمانند.
 * فقط خطوطی را می‌گیرد که هم فعل ورود/خروج دارند و هم زمان مشخص —
 * تا با شرح فعالیت‌ها تداخل نکند.
 */

const ENTRY_VERBS = [
  "اومدند",
  "اومدن",
  "اومد",
  "آمدند",
  "آمدن",
  "آمد",
  "امدند",
  "امدن",
  "امد",
  "رسیدند",
  "رسید",
  "حاضر",
  "اومدم",
];

const EXIT_VERBS = ["رفتند", "رفتن", "رفت", "مرخص", "خارج", "رفتم"];

/** تبدیل ارقام فارسی/عربی به لاتین */
function normalizeDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => {
    const code = d.charCodeAt(0);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    return d;
  });
}

function toHHMM(hour: number, minute: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** استخراج قطعی رویدادهای ورود/خروج از متن */
export function extractAttendanceFromText(text: string): ExtractedEventItem[] {
  const out: ExtractedEventItem[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // فقط خطوطی که «ساعت» دارند به‌عنوان ثبت کارکرد قطعی در نظر گرفته می‌شوند
    if (!line.includes("ساعت")) continue;

    const isExit = EXIT_VERBS.some((v) => line.includes(v));
    const isEntry = !isExit && ENTRY_VERBS.some((v) => line.includes(v));
    if (!isExit && !isEntry) continue;
    const event: "ورود" | "خروج" = isExit ? "خروج" : "ورود";

    // زمان: بعد از «ساعت»
    const norm = normalizeDigits(line);
    const m = norm.match(/ساعت\s*([0-2]?\d)(?::([0-5]\d))?/);
    if (!m) continue;
    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    // خروج معمولاً بعدازظهر است: ۵ رفت → ۱۷:۰۰ ، ۸ رفت → ۲۰:۰۰
    if (event === "خروج" && hour >= 1 && hour <= 11) hour += 12;
    const time = toHHMM(hour, minute);

    // نام: بخشِ قبل از «ساعت»
    const namePart = line.split("ساعت")[0].trim().replace(/[:،,\-]+$/, "").trim();
    if (!namePart) continue;

    // چند نام در یک خط: «علی و رضا» → دو نفر با همان زمان
    const names = namePart
      .split(/\s+و\s+|،|,/)
      .map((n) => n.trim())
      .filter(Boolean);

    for (const name of names) {
      out.push({ type: "attendance", workerName: name, event, time });
    }
  }

  return out;
}
