import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Served behind relaymemory.com/dashboard via a cross-project rewrite from
  // the relay-landing Vercel project. basePath ensures every asset URL the
  // app emits (chunks, fonts, images) is prefixed so it proxies through the
  // same /dashboard rewrite and resolves on the landing origin.
  basePath: '/dashboard',
  // Landing iframes this app from a different origin; this header lets it.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://relaymemory.com https://*.vercel.app http://localhost:*" },
        ],
      },
    ];
  },
};

export default nextConfig;
