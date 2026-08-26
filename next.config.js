/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/bpm',
  output: 'standalone',
  // Next 16.3 appends a <!-- BEGIN:nextjs-agent-rules --> block to CLAUDE.md on
  // every `next dev`, and re-adds it if removed — so the file reads as modified
  // forever unless the block is committed. CLAUDE.md here is hand-authored
  // project documentation, not a generated artifact, so opt out and keep the
  // framework out of it. Flip to true (or delete this line) to take the block.
  agentRules: false,
  async headers() {
    const isDev = process.env.NODE_ENV === 'development';
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          // In dev, Turbopack reuses chunk URLs across rebuilds, so an immutable
          // header makes the browser serve stale bytes after edits. Only emit
          // the long-cache header in production builds.
          {
            key: 'Cache-Control',
            value: isDev
              ? 'no-cache, no-store, must-revalidate'
              : 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              process.env.NODE_ENV === 'development'
                ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
                : "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com",
              "img-src 'self' data:",
              "connect-src 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

const createNextIntlPlugin = require('next-intl/plugin');
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

module.exports = withNextIntl(nextConfig);
