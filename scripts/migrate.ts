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
  console.error("❌ خطا در اعمال مایگریشن:", e);
  process.exit(1);
});
