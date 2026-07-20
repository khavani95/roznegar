import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "روزنگار — گزارش روزانه‌ی کارگاه",
  description: "چت‌بات هوشمند تلگرام برای گزارش روزانه‌ی کارگاه",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body
        style={{
          fontFamily:
            "Vazirmatn, Tahoma, system-ui, -apple-system, sans-serif",
          margin: 0,
        }}
      >
        {children}
      </body>
    </html>
  );
}
