/* ============================================================
   LOGISTIK - Proxy (Auth Route Guard)
   ============================================================ */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { matchesPathSegment } from '@/lib/pathname';
import { DRIVER_SESSION_COOKIE, SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import type { SessionUser } from '@/lib/types';

const OWNER_ONLY_PATHS = ['/settings/company', '/settings/users', '/settings/audit-logs', '/reports'];

function isDriverPortalPath(pathname: string) {
    return matchesPathSegment(pathname, '/driver');
}

function isDriverLoginPath(pathname: string) {
    return matchesPathSegment(pathname, '/driver/login');
}

function isAdminLoginPath(pathname: string) {
    return matchesPathSegment(pathname, '/login');
}

async function getLiveSessionUser(
    request: NextRequest,
    token: string,
    scope: 'ADMIN' | 'DRIVER'
): Promise<{ user: SessionUser | null; checkedLive: boolean }> {
    const cookieName = scope === 'DRIVER' ? DRIVER_SESSION_COOKIE : SESSION_COOKIE;
    const sessionUrl = scope === 'DRIVER' ? '/api/driver/session' : '/api/auth/session';

    try {
        const response = await fetch(new URL(sessionUrl, request.url), {
            headers: {
                cookie: `${cookieName}=${token}`,
            },
            cache: 'no-store',
        });

        if (!response.ok) {
            return { user: null, checkedLive: true };
        }

        const payload = await response.json() as { user?: SessionUser | null };
        return { user: payload.user || null, checkedLive: true };
    } catch {
        return { user: null, checkedLive: false };
    }
}

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const driverLoginPath = isDriverLoginPath(pathname);
    const adminLoginPath = isAdminLoginPath(pathname);
    const driverPortalPath = isDriverPortalPath(pathname) && !driverLoginPath;

    if (
        pathname.startsWith('/api/') ||
        pathname.startsWith('/_next') ||
        pathname.startsWith('/favicon') ||
        pathname.includes('.')
    ) {
        return NextResponse.next();
    }

    const adminToken = request.cookies.get(SESSION_COOKIE)?.value;
    const driverToken = request.cookies.get(DRIVER_SESSION_COOKIE)?.value;

    if (driverLoginPath) {
        if (!driverToken) {
            return NextResponse.next();
        }
        const live = await getLiveSessionUser(request, driverToken, 'DRIVER');
        let user = live.user;
        if (!user && !live.checkedLive) {
            user = await verifySessionToken(driverToken);
        }
        if (!user) {
            const response = NextResponse.next();
            response.cookies.delete(DRIVER_SESSION_COOKIE);
            return response;
        }
        return NextResponse.redirect(new URL('/driver', request.url));
    }

    if (adminLoginPath) {
        if (!adminToken) {
            return NextResponse.next();
        }
        const live = await getLiveSessionUser(request, adminToken, 'ADMIN');
        let user = live.user;
        if (!user && !live.checkedLive) {
            user = await verifySessionToken(adminToken);
        }
        if (!user) {
            const response = NextResponse.next();
            response.cookies.delete(SESSION_COOKIE);
            return response;
        }
        return NextResponse.redirect(new URL(user.role === 'DRIVER' ? '/driver' : '/dashboard', request.url));
    }

    if (pathname === '/') {
        if (adminToken) {
            const live = await getLiveSessionUser(request, adminToken, 'ADMIN');
            let user = live.user;
            if (!user && !live.checkedLive) {
                user = await verifySessionToken(adminToken);
            }
            if (user && user.role !== 'DRIVER') {
                return NextResponse.redirect(new URL('/dashboard', request.url));
            }
        }
        if (driverToken) {
            const live = await getLiveSessionUser(request, driverToken, 'DRIVER');
            let user = live.user;
            if (!user && !live.checkedLive) {
                user = await verifySessionToken(driverToken);
            }
            if (user?.role === 'DRIVER') {
                return NextResponse.redirect(new URL('/driver', request.url));
            }
        }
        return NextResponse.redirect(new URL('/login', request.url));
    }

    try {
        if (driverPortalPath) {
            if (!driverToken) {
                return NextResponse.redirect(new URL('/driver/login', request.url));
            }

            const live = await getLiveSessionUser(request, driverToken, 'DRIVER');
            let user = live.user;
            if (!user && !live.checkedLive) {
                user = await verifySessionToken(driverToken);
            }
            if (!user) {
                const response = NextResponse.redirect(new URL('/driver/login', request.url));
                response.cookies.delete(DRIVER_SESSION_COOKIE);
                return response;
            }
            if (user.role !== 'DRIVER') {
                return NextResponse.redirect(new URL('/dashboard', request.url));
            }
            return NextResponse.next();
        }

        if (!adminToken) {
            return NextResponse.redirect(new URL('/login', request.url));
        }

        const live = await getLiveSessionUser(request, adminToken, 'ADMIN');
        let user = live.user;
        if (!user && !live.checkedLive) {
            user = await verifySessionToken(adminToken);
        }
        if (!user) {
            const response = NextResponse.redirect(new URL('/login', request.url));
            response.cookies.delete(SESSION_COOKIE);
            return response;
        }

        if (user.role === 'DRIVER') {
            return NextResponse.redirect(new URL('/driver', request.url));
        }

        if (user.role !== 'OWNER' && OWNER_ONLY_PATHS.some(path => matchesPathSegment(pathname, path))) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }

        return NextResponse.next();
    } catch {
        const loginPath = driverPortalPath ? '/driver/login' : '/login';
        const response = NextResponse.redirect(new URL(loginPath, request.url));
        if (driverPortalPath) {
            response.cookies.delete(DRIVER_SESSION_COOKIE);
        } else {
            response.cookies.delete(SESSION_COOKIE);
        }
        return response;
    }
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
