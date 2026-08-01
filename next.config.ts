import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * These all load real binaries or native bindings and must stay outside the
   * bundle: the browser launcher, its serverless Chromium build, the SQLite
   * addon, and the Postgres client.
   */
  serverExternalPackages: [
    "playwright-core",
    "@sparticuz/chromium",
    "better-sqlite3",
    "pg",
  ],
};

export default nextConfig;
