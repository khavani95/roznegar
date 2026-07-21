import { Type } from "@google/genai";
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
  * نام نیروهایی که در فعالیت درگیر بودند را حتماً در آرایه‌ی workers بیاور (مثلاً «علی و رضا آرماتوربندی کردن» → workers=["علی","رضا"]).
  * اگر بازه‌ی زمانی فعالیت گفته شد، startTime و endTime را پر کن (HH:MM). اگر گفته شد تمام روز/کل روز/از صبح تا شب، isFullDay=true بگذار.
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

// ────────────────────────────────────────────────────────────
//  تحلیل جواب‌های «ویزارد کنترل پایان روز»
// ────────────────────────────────────────────────────────────

/** اجرای یک درخواست متنی با اسکیمای مشخص و برگرداندن JSON تحلیل‌شده */
async function parseWithSchema<T>(
  prompt: string,
  schema: Record<string, unknown>,
): Promise<T> {
  const ai = getGemini();
  const response = await ai.models.generateContent({
    model: config.gemini.model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0,
    },
  });
  try {
    return JSON.parse(response.text ?? "{}") as T;
  } catch {
    return {} as T;
  }
}

export interface ProfileAnswer {
  fullName?: string;
  trade?: string;
  employmentType?: "روزمزد" | "پیمانکار";
}

/** تحلیل پاسخ کاربر برای تکمیل پروفایل یک نیرو */
export function parseWorkerProfile(text: string): Promise<ProfileAnswer> {
  return parseWithSchema<ProfileAnswer>(
    `از این جمله، اطلاعات یک نیروی کارگاه را استخراج کن: «${text}».\n` +
      `- fullName: نام و نام‌خانوادگی کامل اگر گفته شده.\n` +
      `- trade: تخصص (مثل بنا، آرماتوربند، جوشکار، برقکار، کارگر ساده).\n` +
      `- employmentType: اگر روزمزد بود «روزمزد»، اگر پیمانکاری بود «پیمانکار».`,
    {
      type: Type.OBJECT,
      properties: {
        fullName: { type: Type.STRING, nullable: true },
        trade: { type: Type.STRING, nullable: true },
        employmentType: {
          type: Type.STRING,
          enum: ["روزمزد", "پیمانکار"],
          nullable: true,
        },
      },
    },
  );
}

export interface TimeAnswer {
  startTime?: string;
  endTime?: string;
  isFullDay?: boolean;
}

/** تحلیل پاسخ کاربر برای بازه‌ی زمانی یک فعالیت */
export function parseActivityTime(text: string): Promise<TimeAnswer> {
  return parseWithSchema<TimeAnswer>(
    `از این جمله بازه‌ی زمانی فعالیت را استخراج کن: «${text}».\n` +
      `- اگر تمام‌روز/کل روز/از صبح تا شب بود isFullDay=true.\n` +
      `- در غیر این صورت startTime و endTime را به‌صورت HH:MM ۲۴ساعته بده.\n` +
      `- «۸ تا ۴» یعنی startTime=08:00 و endTime=16:00.`,
    {
      type: Type.OBJECT,
      properties: {
        startTime: { type: Type.STRING, nullable: true },
        endTime: { type: Type.STRING, nullable: true },
        isFullDay: { type: Type.BOOLEAN, nullable: true },
      },
    },
  );
}

export interface CoverageAnswer {
  description?: string;
  workFront?: string;
  activityType?: string;
  startTime?: string;
  endTime?: string;
  isFullDay?: boolean;
}

/** تحلیل پاسخ کاربر برای فعالیتِ یک نیروی بدون فعالیت */
export function parseCoverageActivity(
  text: string,
  workerName: string,
): Promise<CoverageAnswer> {
  return parseWithSchema<CoverageAnswer>(
    `نیرویی به نام «${workerName}» امروز کاری انجام داده که هنوز ثبت نشده.\n` +
      `از این توضیح، فعالیتش را استخراج کن: «${text}».\n` +
      `- description: شرح فعالیت.\n` +
      `- workFront: محل/جبهه‌ی کاری.\n` +
      `- activityType: نوع فعالیت.\n` +
      `- اگر زمان گفته شد startTime/endTime (HH:MM) وگرنه اگر تمام‌روز بود isFullDay=true.`,
    {
      type: Type.OBJECT,
      properties: {
        description: { type: Type.STRING, nullable: true },
        workFront: { type: Type.STRING, nullable: true },
        activityType: { type: Type.STRING, nullable: true },
        startTime: { type: Type.STRING, nullable: true },
        endTime: { type: Type.STRING, nullable: true },
        isFullDay: { type: Type.BOOLEAN, nullable: true },
      },
    },
  );
}
