import { getDriverPortalAccessNotice, requireDriverSessionContext } from '@/lib/api/driver-portal';
import { extractRefId } from '@/lib/api/data-helpers';
import {
    handleDeliveryOrderDriverStatusRequest,
    handleDeliveryOrderStatusUpdate,
} from '@/lib/api/order-workflows';
import { validateDriverStatusTransition } from '@/lib/api/driver-status-guards';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { sanityCreate, sanityGetById } from '@/lib/sanity';
import type { DeliveryOrder } from '@/lib/types';

const DRIVER_ALLOWED_STATUS_UPDATES = new Set(['ON_DELIVERY', 'ARRIVED']);
const DRIVER_APPROVAL_REQUEST_STATUSES = new Set(['DELIVERED']);

async function addAuditLog(actor: { _id: string; name: string; email?: string; role?: string }, action: string, entityRef: string, summary: string) {
    try {
        await sanityCreate({
            _type: 'auditLog',
            actorUserRef: actor._id,
            actorUserName: actor.name,
            actorUserEmail: actor.email,
            actorUserRole: actor.role,
            action,
            entityType: 'delivery-orders',
            entityRef,
            changesSummary: summary,
            timestamp: new Date().toISOString(),
        });
    } catch {
        console.warn('Audit log write failed for driver delivery status');
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

    const auth = await requireDriverSessionContext(request);
    if ('error' in auth) {
        return jsonNoStore({ error: auth.error }, { status: auth.status });
    }
    const driverAccessNotice = await getDriverPortalAccessNotice(auth.driver._id);
    if (driverAccessNotice?.blocking) {
        return jsonNoStore({ error: driverAccessNotice.message }, { status: 403 });
    }

    try {
        const parsedBody = await parseJsonBody<{
            id?: string;
            status?: string;
            note?: string;
            actualItems?: Array<{
                deliveryOrderItemRef?: string;
                actualQtyKoli?: number;
                actualWeightInputValue?: number;
                actualWeightInputUnit?: string;
                actualVolumeInputValue?: number;
                actualVolumeInputUnit?: string;
            }>;
        }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }
        const body = parsedBody.data;

        const id = typeof body.id === 'string' ? body.id : '';
        const status = typeof body.status === 'string' ? body.status : '';
        const note = typeof body.note === 'string' ? body.note : '';

        if (!id || !status) {
            return jsonNoStore({ error: 'Status DO tidak valid' }, { status: 400 });
        }

        if (!DRIVER_ALLOWED_STATUS_UPDATES.has(status) && !DRIVER_APPROVAL_REQUEST_STATUSES.has(status)) {
            return jsonNoStore(
                { error: 'Driver hanya boleh mengirim progres perjalanan atau mengajukan status selesai ke admin.' },
                { status: 403 }
            );
        }

        const deliveryOrder = await sanityGetById<DeliveryOrder>(id);
        if (!deliveryOrder) {
            return jsonNoStore({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
        }

        if (extractRefId(deliveryOrder.driverRef) !== auth.driver._id) {
            return jsonNoStore({ error: 'Surat jalan ini bukan milik supir yang login' }, { status: 403 });
        }

        const driverStatusTransitionError = validateDriverStatusTransition(deliveryOrder, status);
        if (driverStatusTransitionError) {
            return jsonNoStore({ error: driverStatusTransitionError }, { status: 409 });
        }

        if (DRIVER_APPROVAL_REQUEST_STATUSES.has(status)) {
            return await handleDeliveryOrderDriverStatusRequest(
                auth.session,
                { id, status, note, actualItems: body.actualItems },
                addAuditLog
            );
        }

        return await handleDeliveryOrderStatusUpdate(
            auth.session,
            { id, status, note },
            addAuditLog
        );
    } catch (error) {
        console.error('Driver delivery status update error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
