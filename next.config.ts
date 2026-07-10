import { execSync } from "child_process";
import type { NextConfig } from "next";

let gitHash = "dev";
try {
  gitHash = execSync("git rev-parse --short HEAD").toString().trim();
} catch {}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_GIT_HASH: gitHash },
  turbopack: {},
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["192.168.68.*", "127.0.0.1", "localhost", "*.*.*.*"],
  devIndicators: false,
  experimental: {
    proxyClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
