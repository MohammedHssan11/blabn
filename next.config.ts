import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lets pages answer a refused request with a real HTTP 403 (forbidden()) and render forbidden.tsx.
  experimental: { authInterrupts: true },
  // The report field map and synthetic fixtures live outside src/.
  turbopack: { root: path.resolve(__dirname) },
  // The Excel writer (Phase 9) runs as plain Node.js code on the server, outside the bundle.
  serverExternalPackages: ["exceljs", "jszip"],
};

export default nextConfig;
