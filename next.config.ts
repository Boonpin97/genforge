import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir:
    process.env.NODE_ENV === "production" ? ".next-prod" : ".next",
};

export default nextConfig;
