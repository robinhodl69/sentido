import type { NextConfig } from "next";

const apiUrl = process.env.SENTIDO_API_URL ?? "http://127.0.0.1:3000";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["172.20.10.3"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
