import { clearSession, getSession } from '@/lib/auth';
import { writeAuditLog } from '@/lib/api/data-helpers';
import { ensureSameOriginRequest, jsonNoStore } from '@/lib/api/request-security';

export async function POST(request: Request) {
    const originError = ensureSameOriginRequest(request);
    if (originError) {
        return originError;
    }

    const session = await getSession();
    await clearSession();
    if (session) {
        await writeAuditLog(session, 'LOGOUT', 'admin-web-auth', session._id, 'Logout admin web');
    }
    return jsonNoStore({ success: true });
}
