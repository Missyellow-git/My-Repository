import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright launches a real browser binary — it must not be bundled.
  serverExternalPackages: ["playwright-core"],
};

export default nextConfig;
