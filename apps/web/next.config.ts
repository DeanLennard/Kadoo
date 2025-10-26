import type { NextConfig } from "next";

const nextConfig = {
    transpilePackages: ["@kadoo/server-utils"],
    eslint: { ignoreDuringBuilds: true },
    typescript: { ignoreBuildErrors: true },
};
export default nextConfig;
