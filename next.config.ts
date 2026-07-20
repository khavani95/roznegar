import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs و درایور دیتابیس فقط باید سمت سرور اجرا شوند
  serverExternalPackages: ["exceljs", "@neondatabase/serverless"],
};

export default nextConfig;
