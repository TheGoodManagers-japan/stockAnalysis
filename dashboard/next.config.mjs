/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output for containerized deployment (Modal, Docker)
  output: "standalone",

  // Allow importing .js files from outside the dashboard directory (engine modules)
  transpilePackages: [],

  // Server-side Node.js config
  serverExternalPackages: ["pg", "yahoo-finance2", "@tensorflow/tfjs", "@tensorflow/tfjs-node"],

  // Increase API route timeout for long-running scans
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
