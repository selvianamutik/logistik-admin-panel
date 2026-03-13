import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/auth';
import { ensureSameOriginRequest } from '@/lib/api/request-security';

export async function POST(request: Request) {
    const originError = ensureSameOriginRequest(request);
    if (originError) {
        return originError;
    }

    await clearSession();
    return NextResponse.json({ success: true });
}
