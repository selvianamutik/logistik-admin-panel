import { extractRefId } from '@/lib/api/data-helpers';
import { handleDeliveryOrderBatchSuratJalanStatusUpdate } from '@/lib/api/order-workflows';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { getDriverPortalAccessNotice, requireDriverSessionContext } from '@/lib/api/driver-portal';
import { createDocument, getDocumentById } from '@/lib/repositories/document-store';
import type { DeliveryOrder, PendingDriverStatusRequest } from '@/lib/types';
import type { SuratJalanRecord } from '@/lib/trip-document-types';

async function addAuditLog(
    actor: { _id: string; name: string; email?: string; role?: string },
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) {
    try {
        await createDocument({
            _type: 'auditLog',
            actorUserRef: actor._id,
            actorUserName: actor.name,
            actorUserEmail: actor.email,
            actorUserRole: actor.role,
            action,
            entityType,
            entityRef,
            changesSummary: summary,
            timestamp: new Date().toISOString(),
        });
    } catch {
        console.warn('Audit log write failed for driver batch SJ status');
    }
}

export async function POST(request: Request) {
    const hasBearerAuth = Boolean(request.headers.get('authorization')?.toLowerCase().startsWith('bearer '));
    if (!hasBearerAuth) {
        const originError = ensureSameOriginRequest(request);
        if (originError) {
            return originError;
        }
    }

    try {
        const auth = await requireDriverSessionContext(request);
        if ('error' in auth) {
            return jsonNoStore({ error: auth.error }, { status: auth.status });
        }
        const driverAccessNotice = await getDriverPortalAccessNotice(auth.driver._id);
        if (driverAccessNotice?.blocking) {
            return jsonNoStore({ error: driverAccessNotice.message }, { status: 403 });
        }

        const parsedBody = await parseJsonBody<{
            id?: string;
            status?: string;
            note?: string;
            targetSuratJalanRefs?: string[];
        }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }

        const id = typeof parsedBody.data.id === 'string' ? parsedBody.data.id : '';
        const status = typeof parsedBody.data.status === 'string' ? parsedBody.data.status.trim().toUpperCase() : '';
        if (!id || !status) {
            return jsonNoStore({ error: 'Update batch SJ tidak valid' }, { status: 400 });
        }
        if (status === 'DELIVERED') {
            return jsonNoStore({ error: 'Status terkirim harus dikirim lewat finalisasi batch SJ driver.' }, { status: 400 });
        }

        const deliveryOrder = await getDocumentById<DeliveryOrder>(id, 'deliveryOrder');
        if (!deliveryOrder) {
            return jsonNoStore({ error: 'Trip tidak ditemukan' }, { status: 404 });
        }
        if (extractRefId(deliveryOrder.driverRef) !== auth.driver._id) {
            return jsonNoStore({ error: 'Trip ini bukan milik supir yang login' }, { status: 403 });
        }
        if ((status === 'ON_DELIVERY' || status === 'ARRIVED') && deliveryOrder.trackingState !== 'ACTIVE') {
            return jsonNoStore({ error: 'Tracking live harus aktif sebelum driver mengirim progres perjalanan.' }, { status: 409 });
        }
        const targetSuratJalanRefs = Array.isArray(parsedBody.data.targetSuratJalanRefs)
            ? parsedBody.data.targetSuratJalanRefs.filter(value => typeof value === 'string')
            : [];
        if (targetSuratJalanRefs.length === 0) {
            return jsonNoStore({ error: 'Pilih minimal 1 SJ untuk update batch.' }, { status: 400 });
        }
        const suratJalanRecords = await Promise.all(
            targetSuratJalanRefs.map(ref => getDocumentById<SuratJalanRecord>(ref, 'suratJalan'))
        );
        const deliveredTarget = suratJalanRecords.find(record => record?.tripRef === id && record.tripStatus === 'DELIVERED');
        if (deliveredTarget) {
            return jsonNoStore({ error: `SJ ${deliveredTarget.suratJalanNumber || deliveredTarget._id} sudah terkirim dan tidak bisa diupdate lagi.` }, { status: 409 });
        }
        const pendingRequests: PendingDriverStatusRequest[] = Array.isArray(deliveryOrder.pendingDriverRequests)
            ? deliveryOrder.pendingDriverRequests.filter(request => request && request.requestId && request.status)
            : deliveryOrder.pendingDriverStatus
                ? [{
                    requestId: `${id}:legacy-pending-driver-request`,
                    status: deliveryOrder.pendingDriverStatus,
                    targetSuratJalanRefs: deliveryOrder.pendingDriverStatusSuratJalanRefs || [],
                }]
                : [];
        const targetRefSet = new Set(targetSuratJalanRefs);
        const blockingPendingRequest = pendingRequests.find(request =>
            request.closeTripOnly ||
            request.status !== 'DELIVERED' ||
            !Array.isArray(request.targetSuratJalanRefs) ||
            request.targetSuratJalanRefs.length === 0
        );
        if (blockingPendingRequest) {
            return jsonNoStore({ error: 'Trip ini masih punya permintaan driver yang menunggu approval admin.' }, { status: 409 });
        }
        const conflictsWithPendingRequest = pendingRequests.some(request =>
            (request.targetSuratJalanRefs || []).some(ref => targetRefSet.has(ref))
        );
        if (conflictsWithPendingRequest) {
            return jsonNoStore({ error: 'SJ yang dipilih masih punya permintaan driver yang menunggu approval admin.' }, { status: 409 });
        }

        return await handleDeliveryOrderBatchSuratJalanStatusUpdate(
            auth.session,
            {
                id,
                status,
                note: parsedBody.data.note,
                targetSuratJalanRefs,
            },
            addAuditLog
        );
    } catch (error) {
        console.error('Driver batch SJ status error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
