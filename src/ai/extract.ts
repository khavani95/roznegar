import { getGemini } from "./gemini";
import { extractionResponseSchema, type ExtractedEventItem } from "./schema";
import { config } from "@/lib/config";

const SYSTEM_INSTRUCTION = `تو دستیار ثبت گزارش روزانه‌ی یک کارگاه ساختمانی هستی.
از پیام (متنی یا صوتی) سرکارگر، داده‌های ساختاریافته استخراج می‌کنی.

قواعد مهم:
- هر پیام ممکن است شامل چند رویداد باشد؛ همه را در آرایه‌ی events برگردان.
- برای ثبت کارکرد نیرو از type="attendance" با فیلدهای workerName و event (ورود/خروج) و time استفاده کن.
- ساعت را همیشه به‌صورت HH:MM و ۲۴ساعته برگردان. از متن، صبح یا عصر بودن را تشخیص بده:
  «علی ساعت ۸ اومد» یعنی ورود ساعت ۰۸:۰۰ صبح.
  «علی ساعت ۸ رفت» یعنی خروج ساعت ۲۰:۰۰ عصر.
  «ظهر رفت» حدود ۱۲:۰۰، «عصر» بعدازظهر، «شب» بعد از ۱۸:۰۰.
- برای فعالیت اجرایی از type="activity" با workFront (محل/جبهه‌ی کاری)، activityType، description و workers استفاده کن.
- برای مانع/مشکل/تأخیر از type="issue" با issueType و description.
- برای دوباره‌کاری از type="rework" با workFront، amount، cause و description.
- برای معرفی نیروی جدید از type="worker_new" با workerName و trade (تخصص).
- اگر پیام نامفهوم بود یا داده‌ی گزارشی نداشت، type="other" برگردان.
- چیزی از خودت نساز؛ فقط آنچه در پیام هست را استخراج کن. اگر ساعت ذکر نشده، فیلد time را خالی بگذار.
- نام نیروها را دقیقاً همان‌طور که گفته شده برگردان (بدون تغییر).`;

interface ExtractInput {
  /** متن پیام (برای پیام متنی) */
  text?: string;
  /** صوت به‌صورت base64 (برای پیام صوتی) */
  audioBase64?: string;
  audioMimeType?: string;
  /** فهرست نام نیروهای شناخته‌شده برای کمک به تطبیق */
  knownWorkers?: string[];
}

export interface ExtractResult {
  events: ExtractedEventItem[];
  /** متن پیاده‌شده‌ی صوت (اگر ورودی صوتی بود) */
  transcript?: string;
}

/**
 * از متن یا صوت، رویدادهای گزارش را استخراج می‌کند.
 * برای صوت، جِمِنای هم‌زمان پیاده‌سازی و استخراج را انجام می‌دهد (مالتی‌مودال).
 */
export async function extractEvents(input: ExtractInput): Promise<ExtractResult> {
  const ai = getGemini();

  const knownList =
    input.knownWorkers && input.knownWorkers.length
      ? `\n\nنیروهای شناخته‌شده‌ی این کارگاه: ${input.knownWorkers.join("، ")}.\nاگر نامی نزدیک به این‌هاست، همان نام استاندارد را برگردان.`
      : "";

  // ساخت محتوای ورودی: متن یا صوت
  const parts: Array<Record<string, unknown>> = [];

  if (input.audioBase64) {
    parts.push({
      inlineData: {
        mimeType: input.audioMimeType || "audio/ogg",
        data: input.audioBase64,
      },
    });
    parts.push({
      text:
        "این یک پیام صوتی فارسی از سرکارگر است. اول آن را دقیق به متن فارسی پیاده کن، سپس رویدادها را استخراج کن." +
        " متن پیاده‌شده را در description رویداد نوع other هم بیاور اگر جای دیگری نمی‌گنجد." +
        knownList,
    });
  } else {
    parts.push({ text: `پیام سرکارگر: «${input.text || ""}»${knownList}` });
  }

  const response = await ai.models.generateContent({
    model: config.gemini.model,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: extractionResponseSchema,
      temperature: 0.1,
    },
  });

  const raw = response.text ?? "{}";
  let parsed: { events?: ExtractedEventItem[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { events: [] };
  }

  return { events: parsed.events ?? [] };
}

/**
 * فقط پیاده‌سازی صوت به متن (بدون استخراج) — برای موارد نیاز به متن خام.
 */
export async function transcribeAudio(
  audioBase64: string,
  mimeType = "audio/ogg",
): Promise<string> {
  const ai = getGemini();
  const response = await ai.models.generateContent({
    model: config.gemini.model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          {
            text: "این پیام صوتی فارسی را دقیق و کلمه‌به‌کلمه به متن فارسی تبدیل کن. فقط متن را برگردان.",
          },
        ],
      },
    ],
    config: { temperature: 0 },
  });
  return (response.text ?? "").trim();
}
