/* ============================================================
   LOGISTIK - Proxy (Auth Route Guard)
   ============================================================ */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { matchesPathSegment } from '@/lib/pathname';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import type { SessionUser } from '@/lib/types';

const PUBLIC_PATHS = ['/login', '/driver/login'];
const OWNER_ONLY_PATHS = ['/settings/company', '/settings/users', '/settings/audit-logs', '/reports'];

function isDriverPortalPath(pathname: string) {
    return matchesPathSegment(pathname, '/driver');
}

async function getLiveSessionUser(request: NextRequest): Promise<SessionUser | null> {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!token) return null;

    try {
        const response = await fetch(new URL('/api/auth/session', request.url), {
            headers: {
                cookie: `${SESSION_COOKIE}=${token}`,
            },
            cache: 'no-store',
        });

        if (!response.ok) {
            return null;
        }

        const payload = await response.json() as { user?: SessionUser | null };
        return payload.user || null;
    } catch {
        return null;
    }
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const isPublicPath = PUBLIC_PATHS.some(path => matchesPathSegment(pathname, path));

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
        const loginPath = isDriverPortalPath(pathname) ? '/driver/login' : '/login';
        return NextResponse.redirect(new URL(loginPath, request.url));
    }

    try {
        let user = await getLiveSessionUser(request);
        if (!user) {
            user = await verifySessionToken(token);
        }

        if (isPublicPath) {
            const redirectPath = user.role === 'DRIVER' ? '/driver' : '/dashboard';
            return NextResponse.redirect(new URL(redirectPath, request.url));
        }

        if (user.role === 'DRIVER') {
            if (pathname === '/' || pathname === '/dashboard' || !isDriverPortalPath(pathname)) {
                return NextResponse.redirect(new URL('/driver', request.url));
            }
            return NextResponse.next();
        }

        if (isDriverPortalPath(pathname)) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }

        if (user.role !== 'OWNER' && OWNER_ONLY_PATHS.some(path => matchesPathSegment(pathname, path))) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }

        if (pathname === '/') {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }

        return NextResponse.next();
    } catch {
        const loginPath = isDriverPortalPath(pathname) ? '/driver/login' : '/login';
        const response = NextResponse.redirect(new URL(loginPath, request.url));
        response.cookies.delete(SESSION_COOKIE);
        return response;
    }
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
