import { getDriverPortalAccessNotice, requireDriverSessionContext } from '@/lib/api/driver-portal';
import { extractRefId } from '@/lib/api/data-helpers';
import {
    handleDeliveryOrderDriverStatusRequest,
    handleDeliveryOrderStatusUpdate,
} from '@/lib/api/order-workflows';
import { validateDriverStatusTransition } from '@/lib/api/driver-status-guards';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { createDocument, getDocumentById, listDocumentsByFilter, updateDocument } from '@/lib/repositories/document-store';
import type { DeliveryOrder, PendingDriverStatusRequest, Vehicle } from '@/lib/types';
import type { SuratJalanRecord } from '@/lib/trip-document-types';

const DRIVER_ALLOWED_STATUS_UPDATES = new Set(['ON_DELIVERY', 'ARRIVED']);
const DRIVER_APPROVAL_REQUEST_STATUSES = new Set(['DELIVERED']);

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
            tripEndOdometerKm?: number;
            selectedSuratJalanRefs?: string[];
            podReceiverName?: string;
            podReceivedDate?: string;
            podNote?: string;
            actualItems?: Array<{
                deliveryOrderItemRef?: string;
                actualQtyKoli?: number;
                actualWeightInputValue?: number;
                actualWeightInputUnit?: string;
                actualVolumeInputValue?: number;
                actualVolumeInputUnit?: string;
            }>;
            actualDropPoints?: Array<{
                stopType?: string;
                deliveryOrderItemRef?: string;
                shipperReferenceKey?: string;
                shipperReferenceNumber?: string;
                billingCustomerRef?: string;
                billingCustomerName?: string;
                originLocationName?: string;
                originLocationAddress?: string;
                locationName?: string;
                locationAddress?: string;
                qtyKoli?: number;
                weightInputValue?: number;
                weightInputUnit?: string;
                volumeInputValue?: number;
                volumeInputUnit?: string;
                note?: string;
            }>;
            closeTripOnly?: boolean;
        }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }
        const body = parsedBody.data;

        const id = typeof body.id === 'string' ? body.id : '';
        const status = typeof body.status === 'string' ? body.status : '';
        const note = typeof body.note === 'string' ? body.note : '';
        const closeTripOnly = body.closeTripOnly === true;

        if (!id || !status) {
            return jsonNoStore({ error: 'Status DO tidak valid' }, { status: 400 });
        }

        if (!DRIVER_ALLOWED_STATUS_UPDATES.has(status) && !DRIVER_APPROVAL_REQUEST_STATUSES.has(status)) {
            return jsonNoStore(
                { error: 'Driver hanya boleh mengirim progres perjalanan atau mengajukan status selesai ke admin.' },
                { status: 403 }
            );
        }

        const deliveryOrder = await getDocumentById<DeliveryOrder>(id, 'deliveryOrder');
        if (!deliveryOrder) {
            return jsonNoStore({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
        }

        if (extractRefId(deliveryOrder.driverRef) !== auth.driver._id) {
            return jsonNoStore({ error: 'Surat jalan ini bukan milik supir yang login' }, { status: 403 });
        }

        let selectedDeliverySuratJalanRecords: SuratJalanRecord[] = [];
        if (!closeTripOnly && status === 'DELIVERED' && Array.isArray(body.selectedSuratJalanRefs) && body.selectedSuratJalanRefs.length > 0) {
            selectedDeliverySuratJalanRecords = await listDocumentsByFilter<SuratJalanRecord>('suratJalan', {
                _id: body.selectedSuratJalanRefs,
            });
        }
        const selectedDeliverySjReady =
            status === 'DELIVERED' &&
            selectedDeliverySuratJalanRecords.length > 0 &&
            selectedDeliverySuratJalanRecords
                .filter(record => record.tripRef === id)
                .every(record => record.tripStatus === 'ARRIVED' || record.tripStatus === 'PARTIAL_HOLD');
        const driverStatusTransitionError = closeTripOnly || selectedDeliverySjReady
            ? null
            : validateDriverStatusTransition(deliveryOrder, status);
        if (driverStatusTransitionError) {
            return jsonNoStore({ error: driverStatusTransitionError }, { status: 409 });
        }

        if (closeTripOnly) {
            if (status !== 'DELIVERED') {
                return jsonNoStore({ error: 'Permintaan tutup trip driver tidak valid.' }, { status: 400 });
            }
            const pendingDriverRequests = Array.isArray(deliveryOrder.pendingDriverRequests)
                ? deliveryOrder.pendingDriverRequests.filter(request => request && request.requestId && request.status)
                : [];
            if (deliveryOrder.pendingDriverStatus || pendingDriverRequests.length > 0) {
                return jsonNoStore({ error: 'Trip masih punya update driver yang menunggu approval admin.' }, { status: 409 });
            }
            if (deliveryOrder.tripClosedByAdminAt) {
                return jsonNoStore({ error: 'Trip ini sudah ditutup admin.' }, { status: 409 });
            }
            if (deliveryOrder.status !== 'DELIVERED') {
                return jsonNoStore({ error: 'Tutup trip hanya bisa diajukan setelah status trip sudah Terkirim.' }, { status: 409 });
            }
            const suratJalanRecords = await listDocumentsByFilter<SuratJalanRecord>('suratJalan', { tripRef: id });
            const activeSuratJalanRecords = suratJalanRecords.filter(record => record.suratJalanNumber || record.referenceKey || record._id);
            if (activeSuratJalanRecords.length === 0 || activeSuratJalanRecords.some(record => record.tripStatus !== 'DELIVERED')) {
                return jsonNoStore({ error: 'Semua SJ harus sudah Terkirim sebelum driver mengajukan tutup trip.' }, { status: 409 });
            }
            const tripEndOdometerKm = typeof body.tripEndOdometerKm === 'number' ? body.tripEndOdometerKm : 0;
            if (tripEndOdometerKm <= 0) {
                return jsonNoStore({ error: 'Odometer akhir trip wajib diisi sebelum tutup trip.' }, { status: 400 });
            }
            const vehicleRef = extractRefId(deliveryOrder.vehicleRef);
            if (!vehicleRef) {
                return jsonNoStore({ error: 'Kendaraan trip belum lengkap. Odometer akhir tidak bisa divalidasi.' }, { status: 409 });
            }
            const vehicle = await getDocumentById<Pick<Vehicle, '_id' | 'lastOdometer'>>(vehicleRef, 'vehicle');
            if (!vehicle) {
                return jsonNoStore({ error: 'Kendaraan trip tidak ditemukan untuk validasi odometer.' }, { status: 404 });
            }
            const lastOdometer = Math.max(Number(vehicle.lastOdometer) || 0, 0);
            if (tripEndOdometerKm < lastOdometer) {
                return jsonNoStore(
                    { error: `Odometer akhir trip tidak boleh lebih kecil dari odometer kendaraan terakhir (${lastOdometer.toLocaleString('id-ID')} km).` },
                    { status: 400 }
                );
            }
            const timestamp = new Date().toISOString();
            await createDocument({
                _id: crypto.randomUUID(),
                _type: 'trackingLog',
                refType: 'DO',
                refRef: id,
                status: 'DRIVER_REQUESTED_DELIVERED',
                note: note || 'Driver mengajukan tutup trip',
                timestamp,
                userRef: auth.session._id,
                userName: auth.session.name,
            });
            const selectedSuratJalanRefs = activeSuratJalanRecords.map(record => record._id);
            const pendingDriverRequest: PendingDriverStatusRequest = {
                requestId: crypto.randomUUID(),
                status: 'DELIVERED',
                requestedAt: timestamp,
                requestedBy: auth.session._id,
                requestedByName: auth.session.name,
                note,
                tripEndOdometerKm,
                targetSuratJalanRefs: selectedSuratJalanRefs,
                closeTripOnly: true,
            };
            const patch = {
                pendingDriverStatus: null,
                pendingDriverStatusRequestedAt: null,
                pendingDriverStatusRequestedBy: null,
                pendingDriverStatusRequestedByName: null,
                pendingDriverStatusNote: null,
                pendingDriverStatusSuratJalanRefs: null,
                pendingDriverRequests: [pendingDriverRequest],
                tripEndOdometerKm,
            };
            await updateDocument(id, patch, 'deliveryOrder');
            await addAuditLog(
                auth.session,
                'UPDATE',
                'delivery-orders',
                id,
                `Driver mengajukan tutup trip ${deliveryOrder.doNumber || id}; odometer akhir ${tripEndOdometerKm.toLocaleString('id-ID')} km${note ? ` | ${note}` : ''}`
            );
            return jsonNoStore({
                data: {
                    ...deliveryOrder,
                    ...patch,
                },
            });
        }

        if (DRIVER_APPROVAL_REQUEST_STATUSES.has(status)) {
            return await handleDeliveryOrderDriverStatusRequest(
                auth.session,
                {
                    id,
                    status,
                    note,
                    tripEndOdometerKm: body.tripEndOdometerKm,
                    selectedSuratJalanRefs: body.selectedSuratJalanRefs,
                    podReceiverName: body.podReceiverName,
                    podReceivedDate: body.podReceivedDate,
                    podNote: body.podNote,
                    actualItems: body.actualItems,
                    actualDropPoints: body.actualDropPoints,
                },
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
