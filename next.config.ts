import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["192.168.68.*", "127.0.0.1", "localhost", "*.*.*.*"],
  devIndicators: false,
};

export default nextConfig;
