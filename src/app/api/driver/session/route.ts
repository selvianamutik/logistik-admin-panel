import { NextResponse } from 'next/server';

import { getDriverAppContext, requireDriverSessionContext, sanitizeDriverForMobile } from '@/lib/api/driver-portal';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
    const result = await requireDriverSessionContext(request);
    if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const appContext = await getDriverAppContext();

    return NextResponse.json({
        user: result.session,
        driver: sanitizeDriverForMobile(result.driver),
        company: appContext.company,
    });
}
