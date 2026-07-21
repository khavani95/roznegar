import { Type } from "@google/genai";

/**
 * اسکیمای خروجی ساختاریافته‌ی جِمِنای.
 * مدل، از هر پیام، آرایه‌ای از «رویداد» استخراج می‌کند.
 * از یک شیء منعطف با فیلدهای اختیاری استفاده می‌کنیم تا انواع مختلف
 * رویداد (کارکرد، فعالیت، مانع، دوباره‌کاری، نیروی جدید) را پوشش دهد.
 */
export const EVENT_TYPES = [
  "attendance", // ثبت ورود/خروج نیرو
  "activity", // فعالیت اجرایی
  "issue", // مانع/مشکل/تأخیر
  "rework", // دوباره‌کاری
  "worker_new", // معرفی نیروی جدید
  "other", // نامشخص
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface ExtractedEventItem {
  type: EventType;
  workerName?: string;
  event?: "ورود" | "خروج";
  time?: string; // HH:MM (۲۴ ساعته)
  workFront?: string;
  activityType?: string;
  description?: string;
  workers?: string[];
  startTime?: string; // HH:MM شروع فعالیت
  endTime?: string; // HH:MM پایان فعالیت
  isFullDay?: boolean; // فعالیت تمام‌روز
  issueType?: "مانع" | "مشکل" | "تاخیر";
  amount?: string;
  cause?: string;
  trade?: string;
  confidence?: number;
}

export const extractionResponseSchema = {
  type: Type.OBJECT,
  properties: {
    events: {
      type: Type.ARRAY,
      description: "فهرست رویدادهای استخراج‌شده از پیام",
      items: {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            enum: [...EVENT_TYPES],
            description: "نوع رویداد",
          },
          workerName: {
            type: Type.STRING,
            description: "نام نیرو (برای ثبت ورود/خروج)",
            nullable: true,
          },
          event: {
            type: Type.STRING,
            enum: ["ورود", "خروج"],
            description: "نوع رویداد کارکرد",
            nullable: true,
          },
          time: {
            type: Type.STRING,
            description: "ساعت به‌صورت HH:MM و ۲۴ساعته",
            nullable: true,
          },
          workFront: {
            type: Type.STRING,
            description: "جبهه‌ی کاری یا محل فعالیت",
            nullable: true,
          },
          activityType: {
            type: Type.STRING,
            description: "نوع فعالیت (مثلاً آرماتوربندی)",
            nullable: true,
          },
          description: {
            type: Type.STRING,
            description: "شرح رویداد",
            nullable: true,
          },
          workers: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "نام نیروهای درگیر در فعالیت",
            nullable: true,
          },
          startTime: {
            type: Type.STRING,
            description: "ساعت شروع فعالیت به‌صورت HH:MM",
            nullable: true,
          },
          endTime: {
            type: Type.STRING,
            description: "ساعت پایان فعالیت به‌صورت HH:MM",
            nullable: true,
          },
          isFullDay: {
            type: Type.BOOLEAN,
            description: "آیا فعالیت تمام‌روز بوده است",
            nullable: true,
          },
          issueType: {
            type: Type.STRING,
            enum: ["مانع", "مشکل", "تاخیر"],
            nullable: true,
          },
          amount: {
            type: Type.STRING,
            description: "مقدار (برای دوباره‌کاری)",
            nullable: true,
          },
          cause: {
            type: Type.STRING,
            description: "علت (برای دوباره‌کاری)",
            nullable: true,
          },
          trade: {
            type: Type.STRING,
            description: "تخصص نیروی جدید",
            nullable: true,
          },
          confidence: {
            type: Type.NUMBER,
            description: "میزان اطمینان بین ۰ تا ۱",
            nullable: true,
          },
        },
        required: ["type"],
      },
    },
  },
  required: ["events"],
};
