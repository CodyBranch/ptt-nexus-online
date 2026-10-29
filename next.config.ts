import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable server actions
  experimental: {},

  async rewrites() {
    return [
      // Live cross country results: the list of meets publishing them, and
      // one static page for every meet, which reads the meet named in the
      // address straight from Firebase. Both written by the desk app's
      // scripts/export-live-web.js.
      { source: '/results/xc', destination: '/results-xc/meets.html' },
      { source: '/results/xc/:meet', destination: '/results-xc/index.html' },
      // The announcer's second screen: the same page, which lays itself out
      // as a focus screen when it sees /screen/ in its address.
      { source: '/results/xc/:meet/screen/:code', destination: '/results-xc/index.html' },
    ];
  },
};

export default nextConfig;
