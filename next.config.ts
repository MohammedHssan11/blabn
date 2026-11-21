import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The report field map and synthetic fixtures live outside src/.
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
