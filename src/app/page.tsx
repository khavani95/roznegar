export default function Home() {
  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "48px 24px",
        lineHeight: 1.9,
        color: "#1f2937",
      }}
    >
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>🏗️ روزنگار</h1>
      <p style={{ fontSize: 18, color: "#4b5563" }}>
        چت‌بات هوشمند تلگرام برای مرتب‌سازی و طبقه‌بندی گزارش روزانه‌ی کارگاه.
      </p>

      <div
        style={{
          background: "#f0f9ff",
          border: "1px solid #bae6fd",
          borderRadius: 12,
          padding: 20,
          marginTop: 24,
        }}
      >
        <strong>وضعیت:</strong> سرویس فعال است ✅
        <br />
        وبهوک تلگرام روی مسیر <code>/api/telegram</code> قرار دارد.
      </div>

      <h2 style={{ fontSize: 22, marginTop: 32 }}>نحوه‌ی کار</h2>
      <ol>
        <li>در تلگرام دکمه‌ی «▶️ شروع روز» را بزن.</li>
        <li>در طول روز گزارش‌ها را با متن یا ویس بفرست.</li>
        <li>آخر روز «⏹️ پایان روز» را بزن تا گزارش اکسل ساخته شود.</li>
      </ol>
    </main>
  );
}
