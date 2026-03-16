import { NextResponse } from 'next/server';

import { clearSession } from '@/lib/auth';
import { ensureSameOriginRequest } from '@/lib/api/request-security';
import { DRIVER_SESSION_COOKIE } from '@/lib/session';

export async function POST(request: Request) {
    const originError = ensureSameOriginRequest(request);
    if (originError) {
        return originError;
    }

    await clearSession(DRIVER_SESSION_COOKIE);
    return NextResponse.json({ success: true });
}
