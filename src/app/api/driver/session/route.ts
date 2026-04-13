import { getDriverAppContext, getDriverPortalAccessNotice, requireDriverSessionContext, sanitizeDriverForMobile } from '@/lib/api/driver-portal';
import { jsonNoStore } from '@/lib/api/request-security';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
    const result = await requireDriverSessionContext(request);
    if ('error' in result) {
        return jsonNoStore({ error: result.error }, { status: result.status });
    }

    const appContext = await getDriverAppContext();
    const driverAccessNotice = await getDriverPortalAccessNotice(result.driver._id);


    return jsonNoStore({
        user: result.session,
        driver: sanitizeDriverForMobile(result.driver),
        company: appContext.company,
        driverAccessNotice: driverAccessNotice ?? null,
    });
}
