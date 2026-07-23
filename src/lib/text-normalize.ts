/**
 * نرمال‌سازی متن فارسی برای تطبیق نام‌ها.
 * تفاوت‌های ی/ي، ک/ك، آ/ا، فاصله‌ها و نیم‌فاصله را یکسان می‌کند.
 */
export function normalizeName(s: string): string {
  return s
    .replace(/[ىيﻱﻲ]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[‌‍‎‏]/g, "") // نیم‌فاصله و نشانه‌های جهت
    .replace(/[.,،؛;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** فاصله‌ی ویرایشی (Levenshtein) بین دو رشته */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/**
 * آیا دو نامِ نرمال‌شده «به‌احتمال زیاد» یک نفرند؟
 * برابرِ نرمال‌شده، یا فاصله‌ی ویرایشی ≤۱ برای نام‌های چندحرفی
 * (مثل «یدین نوری» و «ایدین نوری»).
 */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  if (na.length >= 6 && nb.length >= 6 && levenshtein(na, nb) <= 1) return true;
  return false;
}
