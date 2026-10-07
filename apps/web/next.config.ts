import type { NextConfig } from 'next';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@ctn/shared'],
  // Lint runs separately (`pnpm lint`); a lint warning must never block a production build.
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    // Same-origin proxy: the browser calls /api/*, cookies stay first-party.
    return [{ source: '/api/:path*', destination: `${API_URL}/:path*` }];
  },
  async headers() {
    return [
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};

export default nextConfig;
