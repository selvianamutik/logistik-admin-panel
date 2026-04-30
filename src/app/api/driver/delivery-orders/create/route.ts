import { handleDeliveryOrderCreate } from '@/lib/api/order-workflows';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import {
    getDriverAssignedTripPlans,
    getDriverPortalAccessNotice,
    requireDriverSessionContext,
} from '@/lib/api/driver-portal';
import { createDocument } from '@/lib/repositories/document-store';

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
        console.warn('Audit log write failed for driver delivery order create');
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
            orderRef?: string;
            orderTripPlanKey?: string;
            customerDoNumber?: string;
            shipperReferences?: Array<{
                referenceNumber?: string;
                pickupStopKey?: string;
            }>;
            notes?: string;
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

        const orderRef = typeof parsedBody.data.orderRef === 'string' ? parsedBody.data.orderRef : '';
        const orderTripPlanKey = typeof parsedBody.data.orderTripPlanKey === 'string' ? parsedBody.data.orderTripPlanKey : '';
        if (!orderRef || !orderTripPlanKey) {
            return jsonNoStore({ error: 'Trip order driver tidak valid' }, { status: 400 });
        }

        const assignedTripPlans = await getDriverAssignedTripPlans(auth.driver._id);
        const selectedTripPlan = assignedTripPlans.find(
            plan => plan.orderRef === orderRef && plan.tripPlanKey === orderTripPlanKey
        );
        if (!selectedTripPlan) {
            return jsonNoStore({ error: 'Trip order ini tidak tersedia untuk akun driver yang login' }, { status: 403 });
        }

        return await handleDeliveryOrderCreate(
            auth.session,
            {
                orderRef,
                orderTripPlanKey,
                customerDoNumber: parsedBody.data.customerDoNumber,
                shipperReferences: parsedBody.data.shipperReferences,
                notes: parsedBody.data.notes,
                cargoItems: parsedBody.data.cargoItems,
            },
            addAuditLog
        );
    } catch (error) {
        console.error('Driver delivery order create error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
