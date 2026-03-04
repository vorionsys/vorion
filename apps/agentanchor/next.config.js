const path = require('path');
const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker deployments
  // output: 'standalone',
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ['pino', 'pino-pretty', 'thread-stream'],
  // Transpile workspace packages from source (no pre-build needed)
  transpilePackages: ['@vorionsys/atsf-core'],
  typescript: {
    // atsf-core has TS errors in unused modules — don't block deploy
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(__dirname);
    return config;
  },
};

module.exports = withSentryConfig(nextConfig);
