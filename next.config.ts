import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
                    { key: 'Content-Security-Policy', value: "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'" },
                ],
            },
            {
                source: '/api/:path*',
                headers: [
                    { key: 'Cache-Control', value: 'private, no-store, no-cache, max-age=0, must-revalidate' },
                    { key: 'Pragma', value: 'no-cache' },
                    { key: 'Expires', value: '0' },
                    { key: 'Vary', value: 'Cookie, Authorization, Origin' },
                ],
            },
        ];
    },
};

export default nextConfig;
