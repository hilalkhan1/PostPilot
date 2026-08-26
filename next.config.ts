import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Media lives in Supabase Storage; allow next/image to render it.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.supabase.co" }],
  },
};

export default nextConfig;
