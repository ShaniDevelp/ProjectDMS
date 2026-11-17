import type { NextConfig } from "next";

// Cache Components is off on purpose: every screen in a DMS shows live stock and
// balances, so pages always render at request time (see `connection()` in
// src/server/queries.ts). Nothing here benefits from a prerendered static shell.
const nextConfig: NextConfig = {
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
