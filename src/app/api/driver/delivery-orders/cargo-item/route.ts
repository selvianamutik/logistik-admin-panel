import { extractRefId } from '@/lib/api/data-helpers';
import {
    handleDeliveryOrderCargoItemRemove,
    handleDeliveryOrderCargoItemUpdate,
} from '@/lib/api/order-workflows';
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
        console.warn('Audit log write failed for driver cargo item update');
    }
}

function hasPendingDriverApprovalRequest(deliveryOrder: Pick<DeliveryOrder, 'pendingDriverStatus' | 'pendingDriverRequests'>) {
    return Boolean(deliveryOrder.pendingDriverStatus) ||
        (Array.isArray(deliveryOrder.pendingDriverRequests) && deliveryOrder.pendingDriverRequests.length > 0);
}

async function parseAuthorizedCargoItemRequest(request: Request) {
    const hasBearerAuth = Boolean(request.headers.get('authorization')?.toLowerCase().startsWith('bearer '));
    if (!hasBearerAuth) {
        const originError = ensureSameOriginRequest(request);
        if (originError) {
            return { response: originError };
        }
    }

    const auth = await requireDriverSessionContext(request);
    if ('error' in auth) {
        return { response: jsonNoStore({ error: auth.error }, { status: auth.status }) };
    }
    const driverAccessNotice = await getDriverPortalAccessNotice(auth.driver._id);
    if (driverAccessNotice?.blocking) {
        return { response: jsonNoStore({ error: driverAccessNotice.message }, { status: 403 }) };
    }

    const parsedBody = await parseJsonBody<{
        id?: string;
        deliveryOrderItemId?: string;
        cargoItem?: Record<string, unknown>;
    }>(request);
    if ('error' in parsedBody) {
        return { response: parsedBody.error };
    }

    const id = typeof parsedBody.data.id === 'string' ? parsedBody.data.id : '';
    if (!id) {
        return { response: jsonNoStore({ error: 'Surat jalan tidak valid' }, { status: 400 }) };
    }

    const deliveryOrder = await getDocumentById<DeliveryOrder>(id, 'deliveryOrder');
    if (!deliveryOrder) {
        return { response: jsonNoStore({ error: 'Surat jalan tidak ditemukan' }, { status: 404 }) };
    }
    if (extractRefId(deliveryOrder.driverRef) !== auth.driver._id) {
        return { response: jsonNoStore({ error: 'Surat jalan ini bukan milik supir yang login' }, { status: 403 }) };
    }
    if (hasPendingDriverApprovalRequest(deliveryOrder)) {
        return { response: jsonNoStore({ error: 'Permintaan driver sedang menunggu approval admin. Barang tidak bisa diubah dulu dari portal driver.' }, { status: 409 }) };
    }

    return { auth, data: parsedBody.data };
}

export async function PATCH(request: Request) {
    try {
        const parsed = await parseAuthorizedCargoItemRequest(request);
        if ('response' in parsed) {
            return parsed.response;
        }
        const data = { ...parsed.data };
        const cargoItem = data.cargoItem && typeof data.cargoItem === 'object' ? { ...data.cargoItem } : undefined;
        if (cargoItem && !cargoItem.customerProductRef && data.deliveryOrderItemId) {
            const deliveryOrderItem = await getDocumentById<{
                _id: string;
                orderItemRef?: unknown;
            }>(data.deliveryOrderItemId, 'deliveryOrderItem');
            const orderItemRef = extractRefId(deliveryOrderItem?.orderItemRef);
            if (orderItemRef) {
                const orderItem = await getDocumentById<{
                    _id: string;
                    customerProductRef?: string;
                }>(orderItemRef, 'orderItem');
                if (orderItem?.customerProductRef) {
                    cargoItem.customerProductRef = orderItem.customerProductRef;
                    data.cargoItem = cargoItem;
                }
            }
        }

        return await handleDeliveryOrderCargoItemUpdate(
            parsed.auth.session,
            data,
            addAuditLog
        );
    } catch (error) {
        console.error('Driver cargo item update error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const parsed = await parseAuthorizedCargoItemRequest(request);
        if ('response' in parsed) {
            return parsed.response;
        }

        return await handleDeliveryOrderCargoItemRemove(
            parsed.auth.session,
            parsed.data,
            addAuditLog
        );
    } catch (error) {
        console.error('Driver cargo item delete error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
