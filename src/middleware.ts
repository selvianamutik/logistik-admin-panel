/* ============================================================
   LOGISTIK — Middleware (Auth Route Guard)
   ============================================================ */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || 'logistik-admin-panel-secret-key-2026-very-secure'
);

const PUBLIC_PATHS = ['/login', '/api/auth/login'];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Allow public paths
    if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
        return NextResponse.next();
    }

    // Allow static assets and Next.js internals
    if (
        pathname.startsWith('/_next') ||
        pathname.startsWith('/favicon') ||
        pathname.includes('.')
    ) {
        return NextResponse.next();
    }

    // Check auth
    const token = request.cookies.get('logistik-session')?.value;

    if (!token) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
        const user = (payload as { user: { role: string } }).user;

        // RBAC: Owner-only routes
        const ownerOnlyPaths = ['/settings/company', '/settings/users', '/settings/audit-logs', '/reports'];
        if (user.role !== 'OWNER' && ownerOnlyPaths.some(p => pathname.startsWith(p))) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }

        // Redirect root to dashboard
        if (pathname === '/') {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }

        return NextResponse.next();
    } catch {
        // Invalid token
        return NextResponse.redirect(new URL('/login', request.url));
    }
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
