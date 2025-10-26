/** @type {import('next').NextConfig} */
const nextConfig = {
    transpilePackages: ["@kadoo/server-utils"],
    eslint: { ignoreDuringBuilds: true },
    typescript: { ignoreBuildErrors: true },
};
export default nextConfig;
