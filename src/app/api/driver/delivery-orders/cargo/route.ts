import { extractRefId } from '@/lib/api/data-helpers';
import { handleDeliveryOrderAppendCargoItems } from '@/lib/api/order-workflows';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { getDriverPortalAccessNotice, requireDriverSessionContext } from '@/lib/api/driver-portal';
import { sanityCreate, sanityGetById } from '@/lib/sanity';
import type { DeliveryOrder } from '@/lib/types';

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
        console.warn('Audit log write failed for driver delivery cargo update');
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
            cargoItems?: Array<{
                customerProductRef?: string;
                description?: string;
                qtyKoli?: number;
                weightInputValue?: number;
                weightInputUnit?: string;
                volumeInputValue?: number;
                volumeInputUnit?: string;
                shipperReferenceNumber?: string;
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

        const deliveryOrder = await sanityGetById<DeliveryOrder>(id);
        if (!deliveryOrder) {
            return jsonNoStore({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
        }
        if (extractRefId(deliveryOrder.driverRef) !== auth.driver._id) {
            return jsonNoStore({ error: 'Surat jalan ini bukan milik supir yang login' }, { status: 403 });
        }
        if (deliveryOrder.pendingDriverStatus === 'DELIVERED') {
            return jsonNoStore({ error: 'Permintaan selesai sudah diajukan. Muatan tidak bisa diubah lagi dari portal driver.' }, { status: 409 });
        }

        return await handleDeliveryOrderAppendCargoItems(
            auth.session,
            {
                id,
                cargoItems: parsedBody.data.cargoItems,
            },
            addAuditLog
        );
    } catch (error) {
        console.error('Driver delivery cargo update error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
