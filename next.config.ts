import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {
    NEXT_PUBLIC_SANITY_PROJECT_ID: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 'p6do50hl',
    NEXT_PUBLIC_SANITY_DATASET: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
    SANITY_API_TOKEN: process.env.SANITY_API_TOKEN || 'sky7V0P7lW7gtRk3CP3GHuYd18QmYN5BYgzPZyLF7AiH4AcDc9M19pSEvef7RAAGqVoewy7sZd5hozupK9WXcXSNb3a1tS76KAduc16IzBBOwT6kx9ErKJgVKSYdQhd3pDLJi5bUtFlyAfYVtXFwJ8oNlpa793MONpBKyscK2Z75tXfpCdQ4',
    SANITY_API_VERSION: process.env.SANITY_API_VERSION || '2024-01-01',
    JWT_SECRET: process.env.JWT_SECRET || 'logistik-admin-jwt-secret-key-for-dev-2026',
  },
};

export default nextConfig;
