import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle so the runtime image needs no node_modules.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  experimental: {
    // Import only the icons actually used rather than the whole library.
    optimizePackageImports: ["lucide-react", "recharts", "motion"],
  },
};

export default nextConfig;
