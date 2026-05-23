import {
    createDriverRefreshSession,
    createSession,
    getDriverSessionFromRefreshToken,
} from '@/lib/auth';
import { getDriverAppContext, getDriverPortalAccessNotice, sanitizeDriverForMobile } from '@/lib/api/driver-portal';
import { jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { getDocumentById } from '@/lib/repositories/document-store';
import type { Driver, User } from '@/lib/types';

export async function POST(request: Request) {
    try {
        const parsedBody = await parseJsonBody<{ refreshToken?: string }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }

        const refreshToken = typeof parsedBody.data.refreshToken === 'string'
            ? parsedBody.data.refreshToken.trim()
            : '';
        if (!refreshToken) {
            return jsonNoStore({ error: 'Refresh token driver wajib diisi' }, { status: 400 });
        }

        const session = await getDriverSessionFromRefreshToken(refreshToken);
        if (!session || !session.driverRef) {
            return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await getDocumentById<User>(session._id, 'user');
        if (!user || user.active === false || user.role !== 'DRIVER' || !user.driverRef) {
            return jsonNoStore({ error: 'Akun driver tidak aktif' }, { status: 403 });
        }

        const driver = await getDocumentById<Driver>(user.driverRef, 'driver');
        if (!driver || driver.active === false) {
            return jsonNoStore({ error: 'Data supir tidak aktif atau tidak ditemukan' }, { status: 403 });
        }

        const token = await createSession(user);
        const nextRefreshToken = await createDriverRefreshSession(user);
        const appContext = await getDriverAppContext();
        const driverAccessNotice = await getDriverPortalAccessNotice(driver._id);

        return jsonNoStore({
            success: true,
            token,
            refreshToken: nextRefreshToken,
            expiresIn: 60 * 60 * 24,
            refreshExpiresIn: 60 * 60 * 24 * 60,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                driverRef: user.driverRef,
                driverName: user.driverName,
            },
            driver: sanitizeDriverForMobile(driver),
            company: appContext.company,
            driverAccessNotice,
        });
    } catch (error) {
        console.error('Driver mobile refresh error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
