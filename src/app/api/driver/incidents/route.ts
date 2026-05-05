import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { getDriverPortalAccessNotice, requireDriverSessionContext } from '@/lib/api/driver-portal';
import { extractRefId } from '@/lib/api/data-helpers';
import { handleIncidentCreate } from '@/lib/api/operations-workflows';
import { createDocument, getDocumentById } from '@/lib/repositories/document-store';
import type { DeliveryOrder, Incident } from '@/lib/types';

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
        console.warn('Audit log write failed for driver incident report');
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
            relatedDeliveryOrderRef?: string;
            incidentType?: Incident['incidentType'];
            urgency?: Incident['urgency'];
            locationText?: string;
            odometer?: number;
            description?: string;
        }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }

        const relatedDeliveryOrderRef =
            typeof parsedBody.data.relatedDeliveryOrderRef === 'string'
                ? parsedBody.data.relatedDeliveryOrderRef.trim()
                : '';
        if (!relatedDeliveryOrderRef) {
            return jsonNoStore({ error: 'Pilih trip/SJ terkait untuk laporan insiden.' }, { status: 400 });
        }

        const deliveryOrder = await getDocumentById<DeliveryOrder>(relatedDeliveryOrderRef, 'deliveryOrder');
        if (!deliveryOrder) {
            return jsonNoStore({ error: 'Trip/SJ terkait tidak ditemukan.' }, { status: 404 });
        }
        if (extractRefId(deliveryOrder.driverRef) !== auth.driver._id) {
            return jsonNoStore({ error: 'Trip/SJ ini bukan milik driver yang login.' }, { status: 403 });
        }

        return await handleIncidentCreate(
            auth.session,
            {
                relatedDeliveryOrderRef,
                relatedDONumber: deliveryOrder.doNumber,
                vehicleRef: extractRefId(deliveryOrder.vehicleRef),
                vehiclePlate: deliveryOrder.vehiclePlate,
                driverRef: auth.driver._id,
                driverName: auth.driver.name,
                incidentType: parsedBody.data.incidentType,
                urgency: parsedBody.data.urgency,
                locationText: parsedBody.data.locationText,
                odometer: parsedBody.data.odometer,
                description: parsedBody.data.description,
            },
            addAuditLog
        );
    } catch (error) {
        console.error('Driver incident report error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
