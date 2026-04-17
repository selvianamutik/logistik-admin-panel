/* ============================================================
   LOGISTIK - Proxy (Auth Route Guard)
   ============================================================ */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { matchesPathSegment } from '@/lib/pathname';
import { hasPageAccess, hasPermission, type AppModule, type ModulePermissions } from '@/lib/rbac';
import { DRIVER_SESSION_COOKIE, SESSION_COOKIE } from '@/lib/session';
import type { SessionUser } from '@/lib/types';

const INTERNAL_PATH_MODULES: Array<{ path: string; module: AppModule }> = [
    { path: '/dashboard', module: 'dashboard' },
    { path: '/orders', module: 'orders' },
    { path: '/delivery-orders', module: 'deliveryOrders' },
    { path: '/invoices', module: 'freightNotas' },
    { path: '/customers', module: 'customers' },
    { path: '/trip-rates', module: 'tripRouteRates' },
    { path: '/services', module: 'services' },
    { path: '/expense-categories', module: 'expenseCategories' },
    { path: '/expenses', module: 'expenses' },
    { path: '/reports', module: 'reports' },
    { path: '/fleet/vehicles', module: 'vehicles' },
    { path: '/fleet/drivers', module: 'drivers' },
    { path: '/fleet/maintenance', module: 'maintenance' },
    { path: '/fleet/tires', module: 'tires' },
    { path: '/fleet/incidents', module: 'incidents' },
    { path: '/bank-accounts', module: 'bankAccounts' },
    { path: '/driver-vouchers', module: 'driverVouchers' },
    { path: '/borongan', module: 'driverBorongans' },
    { path: '/settings/profile', module: 'profile' },
    { path: '/settings/password', module: 'profile' },
    { path: '/settings/company', module: 'companySettings' },
    { path: '/settings/users', module: 'userManagement' },
    { path: '/settings/audit-logs', module: 'auditLogs' },
];

function isDriverPortalPath(pathname: string) {
    return matchesPathSegment(pathname, '/driver');
}

function isDriverLoginPath(pathname: string) {
    return matchesPathSegment(pathname, '/driver/login');
}

function isAdminLoginPath(pathname: string) {
    return matchesPathSegment(pathname, '/login');
}

function getModuleForPath(pathname: string) {
    const matched = INTERNAL_PATH_MODULES.find(item => matchesPathSegment(pathname, item.path));
    return matched?.module || null;
}

function getRequiredModuleAction(pathname: string): keyof ModulePermissions {
    if (pathname.endsWith('/new')) {
        return 'create';
    }
    if (pathname.endsWith('/edit')) {
        return 'update';
    }
    return 'view';
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
        if (driverToken) {
            const live = await getLiveSessionUser(request, driverToken, 'DRIVER');
            const user = live.user;
            if (user?.role === 'DRIVER') {
                return NextResponse.redirect(new URL('/driver', request.url));
            }
            if (!user) {
                const response = NextResponse.next();
                response.cookies.delete(DRIVER_SESSION_COOKIE);
                return response;
            }
        }

        if (adminToken) {
            const live = await getLiveSessionUser(request, adminToken, 'ADMIN');
            const user = live.user;
            if (user && user.role !== 'DRIVER') {
                return NextResponse.redirect(new URL('/dashboard', request.url));
            }
            if (!user) {
                const response = NextResponse.next();
                response.cookies.delete(SESSION_COOKIE);
                return response;
            }
        }

        return NextResponse.next();
    }

    if (adminLoginPath) {
        if (adminToken) {
            const live = await getLiveSessionUser(request, adminToken, 'ADMIN');
            const user = live.user;
            if (user) {
                return NextResponse.redirect(new URL(user.role === 'DRIVER' ? '/driver' : '/dashboard', request.url));
            }
            if (!user) {
                const response = NextResponse.next();
                response.cookies.delete(SESSION_COOKIE);
                return response;
            }
        }

        if (driverToken) {
            const live = await getLiveSessionUser(request, driverToken, 'DRIVER');
            const user = live.user;
            if (user?.role === 'DRIVER') {
                return NextResponse.redirect(new URL('/driver', request.url));
            }
            if (!user) {
                const response = NextResponse.next();
                response.cookies.delete(DRIVER_SESSION_COOKIE);
                return response;
            }
        }

        return NextResponse.next();
    }

    if (pathname === '/') {
        if (adminToken) {
            const live = await getLiveSessionUser(request, adminToken, 'ADMIN');
            const user = live.user;
            if (user && user.role !== 'DRIVER') {
                return NextResponse.redirect(new URL('/dashboard', request.url));
            }
        }
        if (driverToken) {
            const live = await getLiveSessionUser(request, driverToken, 'DRIVER');
            const user = live.user;
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
            const user = live.user;
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
        const user = live.user;
        if (!user) {
            const response = NextResponse.redirect(new URL('/login', request.url));
            response.cookies.delete(SESSION_COOKIE);
            return response;
        }

        if (user.role === 'DRIVER') {
            return NextResponse.redirect(new URL('/driver', request.url));
        }

        const targetModule = getModuleForPath(pathname);
        const requiredAction = getRequiredModuleAction(pathname);
        const hasAccess = targetModule
            ? (requiredAction === 'view'
                ? hasPageAccess(user.role, targetModule)
                : hasPermission(user.role, targetModule, requiredAction))
            : true;

        if (targetModule && !hasAccess) {
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
