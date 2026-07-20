import { webhookCallback } from "grammy";
import { getBot } from "@/bot";
import { config } from "@/lib/config";

// این مسیر باید روی رانتایم Node اجرا شود (نیاز به دیتابیس و exceljs)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * نقطه‌ی ورود وبهوک تلگرام.
 * تلگرام آپدیت‌ها را با POST به این آدرس می‌فرستد.
 */
export async function POST(req: Request): Promise<Response> {
  const handler = webhookCallback(getBot(), "std/http", {
    secretToken: config.telegram.webhookSecret || undefined,
    timeoutMilliseconds: 55_000,
  });
  return handler(req);
}

// برای بررسی سلامت از مرورگر
export async function GET(): Promise<Response> {
  return new Response("روزنگار فعال است ✅", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
