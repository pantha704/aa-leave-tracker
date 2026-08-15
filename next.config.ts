import type { NextConfig } from "next";
import { extraSecurityHeaders } from "./src/server/csp";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  experimental: {
    authInterrupts: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: extraSecurityHeaders.map(({ key, value }) => ({ key, value })),
      },
    ];
  },
};

export default nextConfig;
