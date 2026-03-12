/* ============================================================
   LOGISTIK - Proxy (Auth Route Guard)
   ============================================================ */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

const PUBLIC_PATHS = ['/login', '/driver/login'];
const OWNER_ONLY_PATHS = ['/settings/company', '/settings/users', '/settings/audit-logs', '/reports'];

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const isPublicPath = PUBLIC_PATHS.some(path => pathname.startsWith(path));

    if (
        pathname.startsWith('/api/') ||
        pathname.startsWith('/_next') ||
        pathname.startsWith('/favicon') ||
        pathname.includes('.')
    ) {
        return NextResponse.next();
    }

    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!token) {
        if (isPublicPath) {
            return NextResponse.next();
        }
        const loginPath = pathname.startsWith('/driver') ? '/driver/login' : '/login';
        return NextResponse.redirect(new URL(loginPath, request.url));
    }

    try {
        const user = await verifySessionToken(token);

        if (isPublicPath) {
            const redirectPath = user.role === 'DRIVER' ? '/driver' : '/dashboard';
            return NextResponse.redirect(new URL(redirectPath, request.url));
        }

        if (user.role === 'DRIVER') {
            if (pathname === '/' || pathname === '/dashboard' || !pathname.startsWith('/driver')) {
                return NextResponse.redirect(new URL('/driver', request.url));
            }
            return NextResponse.next();
        }

        if (pathname.startsWith('/driver')) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }

        if (user.role !== 'OWNER' && OWNER_ONLY_PATHS.some(path => pathname.startsWith(path))) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }

        if (pathname === '/') {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }

        return NextResponse.next();
    } catch {
        const loginPath = pathname.startsWith('/driver') ? '/driver/login' : '/login';
        return NextResponse.redirect(new URL(loginPath, request.url));
    }
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
