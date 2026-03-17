import { NextResponse } from 'next/server';

import { clearSession, getDriverSession } from '@/lib/auth';
import { writeAuditLog } from '@/lib/api/data-helpers';
import { ensureSameOriginRequest } from '@/lib/api/request-security';
import { DRIVER_SESSION_COOKIE } from '@/lib/session';

export async function POST(request: Request) {
    const originError = ensureSameOriginRequest(request);
    if (originError) {
        return originError;
    }

    const session = await getDriverSession();
    await clearSession(DRIVER_SESSION_COOKIE);
    if (session) {
        await writeAuditLog(session, 'LOGOUT', 'driver-web-auth', session._id, 'Logout portal driver');
    }
    return NextResponse.json({ success: true });
}
