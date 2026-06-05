import { acknowledgeDriverWarningScore } from '@/lib/api/driver-score-workflows';
import { getDriverPortalAccessNotice, hasBearerDriverAuth, requireDriverSessionContext } from '@/lib/api/driver-portal';
import { writeAuditLog } from '@/lib/api/data-helpers';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { getDataServiceErrorInfo } from '@/lib/service-errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
    try {
        if (!hasBearerDriverAuth(request)) {
            const originError = ensureSameOriginRequest(request);
            if (originError) {
                return originError;
            }
        }

        const auth = await requireDriverSessionContext(request);
        if ('error' in auth) {
            return jsonNoStore({ error: auth.error }, { status: auth.status });
        }

        const parsedBody = await parseJsonBody<{ scoreId?: string }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }

        const scoreId = typeof parsedBody.data.scoreId === 'string' ? parsedBody.data.scoreId : '';
        if (!scoreId) {
            return jsonNoStore({ error: 'Scoring warning tidak valid' }, { status: 400 });
        }

        const updated = await acknowledgeDriverWarningScore(scoreId, auth.driver._id);
        if (!updated) {
            return jsonNoStore({ error: 'Warning driver tidak ditemukan' }, { status: 404 });
        }

        await writeAuditLog(
            auth.session,
            'UPDATE',
            'driver-scores',
            scoreId,
            `Driver ${auth.driver.name || auth.driver._id} mengakui warning scoring`
        );

        const driverAccessNotice = await getDriverPortalAccessNotice(auth.driver._id);
        return jsonNoStore({ data: updated, driverAccessNotice });
    } catch (error) {
        const serviceError = getDataServiceErrorInfo(
            error,
            'Layanan scoring driver sedang tidak tersedia. Coba lagi beberapa saat.'
        );
        if (serviceError) {
            return jsonNoStore({ error: serviceError.message }, { status: serviceError.status });
        }
        throw error;
    }
}
