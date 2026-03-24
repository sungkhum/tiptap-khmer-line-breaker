import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NODE_ENV === "production" ? "/tiptap-khmer-line-breaker" : "",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
