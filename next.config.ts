import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable server actions
  experimental: {},

  async rewrites() {
    return [
      // Live cross country results: one static page for every meet, which
      // reads the meet named in the address straight from Firebase. Written
      // by the desk app's scripts/export-live-web.js.
      { source: '/results/xc/:meet', destination: '/results-xc/index.html' },
    ];
  },
};

export default nextConfig;
