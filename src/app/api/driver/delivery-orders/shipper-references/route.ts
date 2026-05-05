import { extractRefId } from '@/lib/api/data-helpers';
import {
    handleDeliveryOrderCargoItemRemove,
    handleDeliveryOrderShipperReferenceUpdate,
} from '@/lib/api/order-workflows';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { getDriverPortalAccessNotice, requireDriverSessionContext } from '@/lib/api/driver-portal';
import { createDocument, getDocumentById, listDocumentsByFilter } from '@/lib/repositories/document-store';
import type { DeliveryOrder, DeliveryOrderItem } from '@/lib/types';

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
        if (deliveryOrder.pendingDriverStatus === 'DELIVERED') {
            return jsonNoStore({ error: 'Permintaan selesai sudah diajukan. SJ tidak bisa diubah lagi dari portal driver.' }, { status: 409 });
        }
        if (deliveryOrder.status === 'CANCELLED') {
            return jsonNoStore({ error: 'SJ pada trip batal tidak bisa diubah.' }, { status: 409 });
        }

        const requestedReferences = Array.isArray(parsedBody.data.shipperReferences) ? parsedBody.data.shipperReferences : [];
        const requestedReferenceKeys = new Set(
            requestedReferences.map(reference => (reference._key || '').trim()).filter(Boolean)
        );
        const requestedReferenceNumbers = new Set(
            requestedReferences.map(reference => (reference.referenceNumber || '').trim().toUpperCase()).filter(Boolean)
        );
        const removedReferences = (deliveryOrder.shipperReferences || []).filter(reference => {
            const referenceKey = (reference._key || '').trim();
            const referenceNumber = (reference.referenceNumber || '').trim().toUpperCase();
            return !(
                (referenceKey && requestedReferenceKeys.has(referenceKey)) ||
                (referenceNumber && requestedReferenceNumbers.has(referenceNumber))
            );
        });
        if (removedReferences.length > 0) {
            const removedReferenceKeys = new Set(
                removedReferences.map(reference => (reference._key || '').trim()).filter(Boolean)
            );
            const removedReferenceNumbers = new Set(
                removedReferences.map(reference => (reference.referenceNumber || '').trim().toUpperCase()).filter(Boolean)
            );
            const deliveryOrderItems = await listDocumentsByFilter<DeliveryOrderItem>('deliveryOrderItem', { deliveryOrderRef: id });
            const itemsToDelete = deliveryOrderItems.filter(item => {
                const itemReferenceKey = (item.shipperReferenceKey || '').trim();
                const itemReferenceNumber = (item.shipperReferenceNumber || '').trim().toUpperCase();
                return (
                    (itemReferenceKey && removedReferenceKeys.has(itemReferenceKey)) ||
                    (itemReferenceNumber && removedReferenceNumbers.has(itemReferenceNumber))
                );
            });
            for (const item of itemsToDelete) {
                const removeResponse = await handleDeliveryOrderCargoItemRemove(
                    auth.session,
                    {
                        id,
                        deliveryOrderItemId: item._id,
                    },
                    addAuditLog
                );
                if (removeResponse.status >= 400) {
                    return removeResponse;
                }
            }
        }

        return await handleDeliveryOrderShipperReferenceUpdate(
            auth.session,
            {
                id,
                shipperReferences: parsedBody.data.shipperReferences,
            },
            addAuditLog
        );
    } catch (error) {
        console.error('Driver shipper reference update error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
