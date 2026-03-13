import { getSession, getSessionFromToken } from '@/lib/auth';
import { getSanityClient, sanityGetById, sanityGetCompanyProfile } from '@/lib/sanity';
import type { CompanyProfile, DeliveryOrder, Driver, SessionUser, User } from '@/lib/types';

export type DriverSessionContext = {
    session: SessionUser;
    user: User;
    driver: Driver;
};

export async function requireAdminOrOwnerSession() {
    const session = await getSession();
    if (!session) {
        return { error: 'Unauthorized', status: 401 } as const;
    }
    if (session.role !== 'OWNER' && session.role !== 'ADMIN') {
        return { error: 'Forbidden', status: 403 } as const;
    }
    return { session } as const;
}

function getBearerToken(request?: Request) {
    if (!request) return null;
    const authorization = request.headers.get('authorization') || '';
    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
        return null;
    }
    return token.trim() || null;
}

export function hasBearerDriverAuth(request?: Request) {
    return Boolean(getBearerToken(request));
}

export async function requireDriverSessionContext(request?: Request): Promise<DriverSessionContext | { error: string; status: number }> {
    const bearerToken = getBearerToken(request);
    const session = bearerToken ? await getSessionFromToken(bearerToken) : await getSession();
    if (!session) {
        return { error: 'Unauthorized', status: 401 };
    }
    if (session.role !== 'DRIVER' || !session.driverRef) {
        return { error: 'Forbidden', status: 403 };
    }

    const user = await sanityGetById<User>(session._id);
    if (!user || user.role !== 'DRIVER' || !user.driverRef || user.active === false) {
        return { error: 'Akun driver tidak aktif', status: 403 };
    }

    const driver = await sanityGetById<Driver>(user.driverRef);
    if (!driver || driver.active === false) {
        return { error: 'Data supir tidak aktif atau tidak ditemukan', status: 403 };
    }

    return { session, user, driver };
}

export async function getDriverAppContext() {
    const company = await sanityGetCompanyProfile() as CompanyProfile | null;
    return {
        company: company
            ? {
                _id: company._id,
                name: company.name,
                phone: company.phone,
                themeColor: company.themeColor,
            }
            : null,
    };
}

export async function getDriverAssignedDeliveryOrders(driverRef: string) {
    return getSanityClient().fetch<DeliveryOrder[]>(
        `*[
            _type == "deliveryOrder" &&
            (driverRef == $driverRef || driverRef._ref == $driverRef) &&
            status in ["CREATED", "ON_DELIVERY", "DELIVERED"]
        ] | order(date desc, _createdAt desc)`,
        { driverRef }
    );
}

export function formatTrackingLocationText(latitude: number, longitude: number) {
    return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function normalizeTrackingNumber(value: unknown) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

export function toSpeedKph(speedMetersPerSecond: number | null) {
    if (speedMetersPerSecond === null || speedMetersPerSecond < 0) return undefined;
    return Math.round(speedMetersPerSecond * 3.6 * 10) / 10;
}
