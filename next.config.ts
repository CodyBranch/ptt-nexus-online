import type { NextConfig } from 'next';

const supabaseHost = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname; } catch { return ''; }
})();

const nextConfig: NextConfig = {
  // Enable server actions
  experimental: {},

  // School logos on the live results page are fetched through the image
  // resizer (/_next/image) at badge size. Only these two sources: our own
  // Logos bucket, and MSHSAA, whose logo files for Missouri meets run to 2 MB
  // apiece. Anything else the page loads as it is.
  images: {
    remotePatterns: [
      ...(supabaseHost
        ? [{ protocol: 'https' as const, hostname: supabaseHost, pathname: '/storage/v1/object/public/Logos/**' }]
        : []),
      { protocol: 'https', hostname: 'www.mshsaa.org', pathname: '/**' },
      { protocol: 'https', hostname: 'mshsaa.org', pathname: '/**' },
    ],
    // A school's logo rarely changes, and a replaced one gets a new address.
    minimumCacheTTL: 2592000,
  },

  async rewrites() {
    return [
      // Live cross country results: the list of meets publishing them, and
      // one static page for every meet, which reads the meet named in the
      // address straight from Firebase. Both written by the desk app's
      // scripts/export-live-web.js.
      { source: '/results/xc', destination: '/results-xc/meets.html' },
      { source: '/results/xc/:meet', destination: '/results-xc/index.html' },
    ];
  },
};

export default nextConfig;
