import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Every route sits behind AuthGate, which deliberately renders nothing but a spinner until
    // the session resolves (so protected content never flashes for a signed-out user). Next's
    // dev-only instant-navigation check can only report that as "segment dropped from
    // rendering", which is expected here, so validate only segments that opt in explicitly.
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
