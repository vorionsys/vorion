const path = require('path');
const fs = require('fs');

// Detect monorepo context: ../../package.json exists when deployed
// from apps/aurais/ within the monorepo (GitHub deploy), but not
// when deployed standalone via CLI (where __dirname is /vercel/path0).
const monoRepoRoot = path.resolve(__dirname, '../..');
const isMonorepo = fs.existsSync(path.join(monoRepoRoot, 'package.json'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(isMonorepo && { outputFileTracingRoot: monoRepoRoot }),
  transpilePackages: ['@vorionsys/platform-core'],
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    ...(isMonorepo && { root: monoRepoRoot }),
    resolveAlias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
      {
        source: '/api/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
    ];
  },
  async rewrites() {
    const cognigateUrl = process.env.COGNIGATE_API_URL || 'https://cognigate.dev';
    return [
      {
        source: '/api/cognigate/:path*',
        destination: `${cognigateUrl}/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
