import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { config } from "@/lib/config";
import * as schema from "./schema";

/**
 * کلاینت دیتابیس روی درایور سرورلسِ Neon (HTTP) که برای Vercel مناسب است.
 * به‌صورت تنبل ساخته می‌شود تا در زمان build نیاز به DATABASE_URL نباشد.
 */
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const sql = neon(config.db.url);
    _db = drizzle(sql, { schema });
  }
  return _db;
}

export { schema };
