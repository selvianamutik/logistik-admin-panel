/* ============================================================
   LOGISTIK - Proxy (Auth Route Guard)
   ============================================================ */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

const PUBLIC_PATHS = ['/login', '/api/auth/login'];
const OWNER_ONLY_PATHS = ['/settings/company', '/settings/users', '/settings/audit-logs', '/reports'];

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
        return NextResponse.next();
    }

    if (
        pathname.startsWith('/_next') ||
        pathname.startsWith('/favicon') ||
        pathname.includes('.')
    ) {
        return NextResponse.next();
    }

    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!token) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    try {
        const user = await verifySessionToken(token);

        if (user.role !== 'OWNER' && OWNER_ONLY_PATHS.some(path => pathname.startsWith(path))) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }

        if (pathname === '/') {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }

        return NextResponse.next();
    } catch {
        return NextResponse.redirect(new URL('/login', request.url));
    }
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
