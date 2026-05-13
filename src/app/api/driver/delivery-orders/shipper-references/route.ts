import { extractRefId } from '@/lib/api/data-helpers';
import { handleDeliveryOrderShipperReferenceUpdate } from '@/lib/api/order-workflows';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { getDriverPortalAccessNotice, requireDriverSessionContext } from '@/lib/api/driver-portal';
import { createDocument, getDocumentById } from '@/lib/repositories/document-store';
import type { DeliveryOrder } from '@/lib/types';

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
        console.warn('Audit log write failed for driver shipper reference update');
    }
}

function hasPendingDriverApprovalRequest(deliveryOrder: Pick<DeliveryOrder, 'pendingDriverStatus' | 'pendingDriverRequests'>) {
    return Boolean(deliveryOrder.pendingDriverStatus) ||
        (Array.isArray(deliveryOrder.pendingDriverRequests) && deliveryOrder.pendingDriverRequests.length > 0);
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
            shipperReferences?: Array<{
                _key?: string;
                referenceNumber?: string;
                pickupStopKey?: string;
            }>;
        }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }

        const id = typeof parsedBody.data.id === 'string' ? parsedBody.data.id : '';
        if (!id) {
            return jsonNoStore({ error: 'Surat jalan tidak valid' }, { status: 400 });
        }

        const deliveryOrder = await getDocumentById<DeliveryOrder>(id, 'deliveryOrder');
        if (!deliveryOrder) {
            return jsonNoStore({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
        }
        if (extractRefId(deliveryOrder.driverRef) !== auth.driver._id) {
            return jsonNoStore({ error: 'Surat jalan ini bukan milik supir yang login' }, { status: 403 });
        }
        if (hasPendingDriverApprovalRequest(deliveryOrder)) {
            return jsonNoStore({ error: 'Permintaan driver sedang menunggu approval admin. SJ tidak bisa diubah dulu dari portal driver.' }, { status: 409 });
        }
        if (deliveryOrder.status === 'CANCELLED') {
            return jsonNoStore({ error: 'SJ pada trip batal tidak bisa diubah.' }, { status: 409 });
        }

        return await handleDeliveryOrderShipperReferenceUpdate(
            auth.session,
            {
                id,
                shipperReferences: parsedBody.data.shipperReferences,
                removeLinkedCargoItemsForRemovedShipperReferences: true,
            },
            addAuditLog
        );
    } catch (error) {
        console.error('Driver shipper reference update error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
