/**
 * اعمال خودکار مایگریشن‌ها روی دیتابیس.
 * در Build Vercel قبل از ساخت سایت اجرا می‌شود تا شِما همیشه هماهنگ باشد.
 * اگر DATABASE_URL تنظیم نشده باشد (مثلاً build محلی)، بی‌صدا رد می‌شود.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("⏭️  DATABASE_URL تنظیم نشده؛ مایگریشن رد شد.");
    return;
  }
  const sql = neon(url);
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✅ مایگریشن‌ها با موفقیت اعمال شدند.");
}

main().catch((e) => {
  // شکست مایگریشن نباید کل دیپلوی را بخواباند.
  // (مثلاً وقتی جدول‌ها از قبل وجود دارند.) فقط لاگ می‌کنیم و build ادامه می‌یابد؛
  // در صورت نیاز، شِما به‌صورت دستی در Neon هماهنگ می‌شود.
  console.error("⚠️ مایگریشن اعمال نشد (build ادامه می‌یابد):", e);
});
