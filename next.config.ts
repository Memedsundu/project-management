import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Every screen is personal and behind sign-in, so pages render per request.
  // Cache Components stays off to keep data access simple to read and maintain.
  cacheComponents: false,
  typedRoutes: false,
  poweredByHeader: false,
  // PGlite (local database for development and tests) ships WASM files and must
  // load from node_modules at runtime instead of being bundled.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@electric-sql/pglite-pgvector",
    "pdfjs-dist",
    "unpdf",
    "exceljs",
    "web-push",
    "archiver",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
