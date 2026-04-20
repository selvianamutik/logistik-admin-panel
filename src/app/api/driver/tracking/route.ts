import {
    formatTrackingLocationText,
    hasBearerDriverAuth,
    getDriverPortalAccessNotice,
    normalizeTrackingNumber,
    requireDriverSessionContext,
    toSpeedKph,
} from '@/lib/api/driver-portal';
import { extractRefId, isMutationConflictError } from '@/lib/api/data-helpers';
import { ensureSameOriginRequest, jsonNoStore, parseJsonBody } from '@/lib/api/request-security';
import { handleDeliveryOrderStatusUpdate } from '@/lib/api/order-workflows';
import { createDocument, getDocumentById, listDocumentsByFilter, updateDocument } from '@/lib/repositories/document-store';
import type { DeliveryOrder, Driver } from '@/lib/types';

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
        console.warn('Audit log write failed for driver tracking');
    }
}

async function createTrackingLog(input: {
    deliveryOrderRef: string;
    status: string;
    note: string;
    userRef: string;
    userName: string;
    latitude?: number;
    longitude?: number;
    accuracyM?: number;
    speedKph?: number;
}) {
    await createDocument({
        _id: crypto.randomUUID(),
        _type: 'trackingLog',
        refType: 'DO',
        refRef: input.deliveryOrderRef,
        status: input.status,
        note: input.note,
        locationText:
            typeof input.latitude === 'number' && typeof input.longitude === 'number'
                ? formatTrackingLocationText(input.latitude, input.longitude)
                : undefined,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyM: input.accuracyM,
        speedKph: input.speedKph,
        source: 'DRIVER_APP',
        timestamp: new Date().toISOString(),
        userRef: input.userRef,
        userName: input.userName,
    });
}

async function refreshDriverTrackingState(driverId: string) {
    return getDocumentById<Driver>(driverId, 'driver');
}

async function clearDriverTrackingLock(driver: Driver, now: string) {
    await updateDocument(driver._id, {
        activeTrackingDeliveryOrderRef: null,
        activeTrackingUpdatedAt: now,
    });

    return true;
}

async function releaseDriverTrackingLockIfOwned(driverId: string, deliveryOrderRef: string, now: string) {
    const driverState = await refreshDriverTrackingState(driverId);
    if (!driverState) {
        return false;
    }

    if (extractRefId(driverState.activeTrackingDeliveryOrderRef) !== deliveryOrderRef) {
        return false;
    }

    return clearDriverTrackingLock(driverState, now);
}

const TRACKING_ROLLBACK_GRACE_MS = 2 * 60 * 1000;

function isClosedDeliveryOrder(status?: DeliveryOrder['status']) {
    return status === 'DELIVERED' || status === 'CANCELLED';
}

function canRollbackFreshTrackingStart(deliveryOrder: DeliveryOrder, now: string) {
    const nowMs = Date.parse(now);
    if (Number.isNaN(nowMs)) {
        return false;
    }

    const candidates = [deliveryOrder.trackingLastSeenAt, deliveryOrder.trackingStartedAt]
        .map(value => (value ? Date.parse(value) : Number.NaN))
        .filter(value => Number.isFinite(value));

    if (candidates.length === 0) {
        return false;
    }

    const latestTrackingMs = Math.max(...candidates);
    return nowMs - latestTrackingMs <= TRACKING_ROLLBACK_GRACE_MS;
}

function buildTrackingConflictResponse(message = 'Status tracking berubah karena ada update lain. Refresh lalu coba lagi.') {
    return jsonNoStore({ error: message }, { status: 409 });
}

async function patchDeliveryOrderTrackingState(
    deliveryOrder: DeliveryOrder,
    setData: Record<string, unknown>,
    unsetFields: string[] = []
) {
    const nextPayload: Record<string, unknown> = {
        ...setData,
    };
    for (const field of unsetFields) {
        nextPayload[field] = null;
    }
    return updateDocument<DeliveryOrder>(deliveryOrder._id, nextPayload);
}

export async function POST(request: Request) {
    if (!hasBearerDriverAuth(request)) {
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
            action?: 'start' | 'heartbeat' | 'pause' | 'resume' | 'stop' | 'rollback-start';
            deliveryOrderRef?: string;
            latitude?: number;
            longitude?: number;
            accuracyM?: number;
            speedMps?: number;
        }>(request);
        if ('error' in parsedBody) {
            return parsedBody.error;
        }
        const body = parsedBody.data;

        const action = body.action;
        const deliveryOrderRef = typeof body.deliveryOrderRef === 'string' ? body.deliveryOrderRef : '';
        if (!action || !deliveryOrderRef) {
            return jsonNoStore({ error: 'Aksi tracking tidak valid' }, { status: 400 });
        }

        const deliveryOrder = await getDocumentById<DeliveryOrder & { _rev?: string }>(deliveryOrderRef, 'deliveryOrder');
        if (!deliveryOrder) {
            return jsonNoStore({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
        }

        if (extractRefId(deliveryOrder.driverRef) !== auth.driver._id) {
            return jsonNoStore({ error: 'Surat jalan ini bukan milik supir yang login' }, { status: 403 });
        }

        if (deliveryOrder.status === 'CANCELLED') {
            return jsonNoStore({ error: 'Surat jalan dibatalkan dan tidak bisa ditrack' }, { status: 409 });
        }

        const latitude = normalizeTrackingNumber(body.latitude);
        const longitude = normalizeTrackingNumber(body.longitude);
        const accuracyM = normalizeTrackingNumber(body.accuracyM);
        const speedKph = toSpeedKph(normalizeTrackingNumber(body.speedMps));
        const now = new Date().toISOString();

        if ((latitude === null) !== (longitude === null)) {
            return jsonNoStore({ error: 'Koordinat GPS tidak lengkap' }, { status: 400 });
        }

        if (latitude !== null && (latitude < -90 || latitude > 90)) {
            return jsonNoStore({ error: 'Latitude tidak valid' }, { status: 400 });
        }

        if (longitude !== null && (longitude < -180 || longitude > 180)) {
            return jsonNoStore({ error: 'Longitude tidak valid' }, { status: 400 });
        }

        if (accuracyM !== null && accuracyM < 0) {
            return jsonNoStore({ error: 'Akurasi GPS tidak valid' }, { status: 400 });
        }

        if ((action === 'start' || action === 'resume' || action === 'heartbeat') && (latitude === null || longitude === null)) {
            return jsonNoStore({ error: 'Tracking live membutuhkan koordinat GPS yang valid' }, { status: 400 });
        }

        const locationPatch =
            latitude !== null && longitude !== null
                ? {
                    trackingLastLat: latitude,
                    trackingLastLng: longitude,
                    trackingLastAccuracyM: accuracyM ?? undefined,
                    trackingLastSpeedKph: speedKph,
                    trackingLastSeenAt: now,
                    trackingLastSource: 'DRIVER_APP' as const,
                }
                : {
                    trackingLastSeenAt: now,
                    trackingLastSource: 'DRIVER_APP' as const,
                };

        if (action === 'start' || action === 'resume') {
            if (!extractRefId(deliveryOrder.vehicleRef) || !extractRefId(deliveryOrder.driverRef)) {
                return jsonNoStore(
                    { error: 'Armada trip belum lengkap. Minta admin isi kendaraan dan supir dulu sebelum tracking dimulai.' },
                    { status: 409 }
                );
            }

            const currentTrackingState = deliveryOrder.trackingState || 'STOPPED';

            if (action === 'start') {
                if (currentTrackingState === 'ACTIVE') {
                    return jsonNoStore({ error: 'Tracking sudah aktif untuk DO ini' }, { status: 409 });
                }
                if (currentTrackingState === 'PAUSED') {
                    return jsonNoStore({ error: 'Tracking sedang dijeda. Gunakan lanjutkan tracking, bukan mulai baru.' }, { status: 409 });
                }
            }

            if (action === 'resume' && currentTrackingState !== 'PAUSED') {
                return jsonNoStore(
                    {
                        error:
                            currentTrackingState === 'ACTIVE'
                                ? 'Tracking sudah aktif untuk DO ini'
                                : 'Tracking tidak sedang dijeda',
                    },
                    { status: 409 }
                );
            }

            const otherActiveDo =
                (await listDocumentsByFilter<{ _id: string; doNumber?: string; trackingState?: string }>('deliveryOrder', { driverRef: auth.driver._id }))
                    .find(item => item._id !== deliveryOrderRef && item.trackingState === 'ACTIVE')
                || null;
            if (otherActiveDo) {
                return jsonNoStore(
                    { error: `Masih ada tracking aktif pada ${otherActiveDo.doNumber || otherActiveDo._id}. Hentikan dulu sebelum mulai yang baru.` },
                    { status: 409 }
                );
            }

            if (!['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(deliveryOrder.status)) {
                return jsonNoStore({ error: 'Hanya DO aktif yang bisa mulai tracking' }, { status: 409 });
            }

            let driverState = await refreshDriverTrackingState(auth.driver._id);
            if (!driverState || driverState.active === false) {
                return jsonNoStore({ error: 'Data supir tidak aktif atau tidak ditemukan' }, { status: 403 });
            }

            const lockedDoRef = extractRefId(driverState.activeTrackingDeliveryOrderRef);
            if (lockedDoRef && lockedDoRef !== deliveryOrderRef) {
                const lockedDo = await getDocumentById<DeliveryOrder>(lockedDoRef, 'deliveryOrder');
                if (lockedDo && ['ACTIVE', 'PAUSED'].includes(lockedDo.trackingState || '')) {
                    return jsonNoStore(
                        { error: `Tracking supir ini masih terkunci pada ${lockedDo.doNumber || lockedDo._id}. Hentikan dulu sebelum mulai yang baru.` },
                        { status: 409 }
                    );
                }

                try {
                    await clearDriverTrackingLock(driverState, now);
                } catch (error) {
                    console.warn('Failed to clear stale driver tracking lock', error);
                    return jsonNoStore(
                        { error: 'Status tracking supir sedang berubah. Refresh lalu coba lagi.' },
                        { status: 409 }
                    );
                }

                driverState = await refreshDriverTrackingState(auth.driver._id);
                if (!driverState || driverState.active === false) {
                    return jsonNoStore({ error: 'Data supir tidak aktif atau tidak ditemukan' }, { status: 403 });
                }
            }

            try {
                await updateDocument(driverState._id, {
                    activeTrackingDeliveryOrderRef: deliveryOrderRef,
                    activeTrackingUpdatedAt: now,
                });
            } catch (error) {
                console.warn('Failed to acquire driver tracking lock', error);
                return jsonNoStore(
                    { error: 'Tracking supir sedang dipakai sesi lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }

            try {
                if (deliveryOrder.status === 'CREATED') {
                    const statusResponse = await handleDeliveryOrderStatusUpdate(
                        auth.session,
                        { id: deliveryOrderRef, status: 'HEADING_TO_PICKUP', note: 'Tracking live dimulai via driver app' },
                        addAuditLog
                    );
                    if (!statusResponse.ok) {
                        await releaseDriverTrackingLockIfOwned(auth.driver._id, deliveryOrderRef, now);
                        return statusResponse;
                    }
                } else if (action === 'start') {
                    await createTrackingLog({
                        deliveryOrderRef,
                        status: deliveryOrder.status,
                        note: 'Tracking live dimulai via driver app',
                        userRef: auth.session._id,
                        userName: auth.session.name,
                        latitude: latitude ?? undefined,
                        longitude: longitude ?? undefined,
                        accuracyM: accuracyM ?? undefined,
                        speedKph,
                    });
                } else {
                    await createTrackingLog({
                        deliveryOrderRef,
                        status: deliveryOrder.status,
                        note: 'Tracking live dilanjutkan via driver app',
                        userRef: auth.session._id,
                        userName: auth.session.name,
                        latitude: latitude ?? undefined,
                        longitude: longitude ?? undefined,
                        accuracyM: accuracyM ?? undefined,
                        speedKph,
                    });
                }

                const latestDeliveryOrder = await getDocumentById<DeliveryOrder & { _rev?: string }>(deliveryOrderRef, 'deliveryOrder');
                if (!latestDeliveryOrder) {
                    await releaseDriverTrackingLockIfOwned(auth.driver._id, deliveryOrderRef, now);
                    return jsonNoStore({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
                }
                if (isClosedDeliveryOrder(latestDeliveryOrder.status)) {
                    await releaseDriverTrackingLockIfOwned(auth.driver._id, deliveryOrderRef, now);
                    return buildTrackingConflictResponse('DO sudah ditutup admin sebelum tracking aktif. Refresh lalu cek status terbaru.');
                }

                let updated: DeliveryOrder;
                try {
                    updated = await patchDeliveryOrderTrackingState(
                        latestDeliveryOrder,
                        {
                            trackingState: 'ACTIVE',
                            trackingStartedAt: latestDeliveryOrder.trackingStartedAt || now,
                            ...locationPatch,
                        },
                        ['trackingStoppedAt']
                    );
                } catch (error) {
                    await releaseDriverTrackingLockIfOwned(auth.driver._id, deliveryOrderRef, now);
                    if (isMutationConflictError(error)) {
                        return buildTrackingConflictResponse('Tracking gagal diaktifkan karena status DO baru berubah. Refresh lalu coba lagi.');
                    }
                    throw error;
                }

                return jsonNoStore({ data: updated });
            } catch (error) {
                try {
                    await releaseDriverTrackingLockIfOwned(auth.driver._id, deliveryOrderRef, now);
                } catch (releaseError) {
                    console.warn('Failed to release driver tracking lock after start/resume error', releaseError);
                }
                throw error;
            }
        }

        if (action === 'heartbeat') {
            if (deliveryOrder.trackingState !== 'ACTIVE') {
                return jsonNoStore({ error: 'Tracking belum aktif untuk DO ini' }, { status: 409 });
            }

            let updated: DeliveryOrder;
            try {
                updated = await patchDeliveryOrderTrackingState(deliveryOrder, {
                    ...locationPatch,
                    trackingState: 'ACTIVE',
                });
            } catch (error) {
                if (isMutationConflictError(error)) {
                    return buildTrackingConflictResponse('Tracking berubah karena DO sudah diubah admin. Refresh lalu cek status terbaru.');
                }
                throw error;
            }
            return jsonNoStore({ data: updated });
        }

        if (action === 'pause') {
            if (!isClosedDeliveryOrder(deliveryOrder.status)) {
                return jsonNoStore(
                    { error: 'Driver tidak boleh mematikan tracking sebelum DO benar-benar selesai. Tracking akan berhenti otomatis saat admin menutup DO.' },
                    { status: 409 }
                );
            }
            if (deliveryOrder.trackingState !== 'ACTIVE') {
                return jsonNoStore({ error: 'Tracking tidak sedang aktif' }, { status: 409 });
            }

            await createTrackingLog({
                deliveryOrderRef,
                status: deliveryOrder.status,
                note: 'Tracking dijeda via driver app',
                userRef: auth.session._id,
                userName: auth.session.name,
                latitude: latitude ?? undefined,
                longitude: longitude ?? undefined,
                accuracyM: accuracyM ?? undefined,
                speedKph,
            });

            let updated: DeliveryOrder;
            try {
                updated = await patchDeliveryOrderTrackingState(deliveryOrder, {
                    trackingState: 'PAUSED',
                    ...locationPatch,
                });
            } catch (error) {
                if (isMutationConflictError(error)) {
                    return buildTrackingConflictResponse();
                }
                throw error;
            }

            try {
                await releaseDriverTrackingLockIfOwned(auth.driver._id, deliveryOrderRef, now);
            } catch (error) {
                console.warn('Failed to release driver tracking lock after pause', error);
            }

            return jsonNoStore({ data: updated });
        }

        if (action === 'rollback-start') {
            if (deliveryOrder.trackingState !== 'ACTIVE') {
                return jsonNoStore({ error: 'Tracking tidak sedang aktif' }, { status: 409 });
            }

            if (!canRollbackFreshTrackingStart(deliveryOrder, now)) {
                return jsonNoStore(
                    { error: 'Tracking ini sudah berjalan terlalu lama untuk dibatalkan otomatis. Hubungi admin bila DO perlu diselesaikan.' },
                    { status: 409 }
                );
            }

            await createTrackingLog({
                deliveryOrderRef,
                status: deliveryOrder.status,
                note: 'Tracking dibatalkan otomatis karena service perangkat gagal aktif',
                userRef: auth.session._id,
                userName: auth.session.name,
                latitude: latitude ?? undefined,
                longitude: longitude ?? undefined,
                accuracyM: accuracyM ?? undefined,
                speedKph,
            });

            let updated: DeliveryOrder;
            try {
                updated = await patchDeliveryOrderTrackingState(deliveryOrder, {
                    trackingState: 'STOPPED',
                    trackingStoppedAt: now,
                    ...locationPatch,
                });
            } catch (error) {
                if (isMutationConflictError(error)) {
                    return buildTrackingConflictResponse();
                }
                throw error;
            }

            try {
                await releaseDriverTrackingLockIfOwned(auth.driver._id, deliveryOrderRef, now);
            } catch (error) {
                console.warn('Failed to release driver tracking lock after rollback-start', error);
            }

            return jsonNoStore({ data: updated });
        }

        if (action === 'stop') {
            if (!isClosedDeliveryOrder(deliveryOrder.status)) {
                return jsonNoStore(
                    { error: 'Driver tidak boleh mematikan tracking sebelum DO benar-benar selesai. Tracking akan berhenti otomatis saat admin menutup DO.' },
                    { status: 409 }
                );
            }
            if (!['ACTIVE', 'PAUSED'].includes(deliveryOrder.trackingState || '')) {
                return jsonNoStore({ error: 'Tracking tidak sedang berjalan' }, { status: 409 });
            }

            await createTrackingLog({
                deliveryOrderRef,
                status: deliveryOrder.status,
                note: 'Tracking dihentikan via driver app',
                userRef: auth.session._id,
                userName: auth.session.name,
                latitude: latitude ?? undefined,
                longitude: longitude ?? undefined,
                accuracyM: accuracyM ?? undefined,
                speedKph,
            });

            let updated: DeliveryOrder;
            try {
                updated = await patchDeliveryOrderTrackingState(deliveryOrder, {
                    trackingState: 'STOPPED',
                    trackingStoppedAt: now,
                    ...locationPatch,
                });
            } catch (error) {
                if (isMutationConflictError(error)) {
                    return buildTrackingConflictResponse();
                }
                throw error;
            }

            try {
                let driverState = await refreshDriverTrackingState(auth.driver._id);
                if (driverState && extractRefId(driverState.activeTrackingDeliveryOrderRef) === deliveryOrderRef) {
                    try {
                        await clearDriverTrackingLock(driverState, now);
                    } catch {
                        driverState = await refreshDriverTrackingState(auth.driver._id);
                        if (driverState && extractRefId(driverState.activeTrackingDeliveryOrderRef) === deliveryOrderRef) {
                            await clearDriverTrackingLock(driverState, now);
                        }
                    }
                }
            } catch (error) {
                console.warn('Failed to release driver tracking lock', error);
            }

            return jsonNoStore({ data: updated });
        }

        return jsonNoStore({ error: 'Aksi tracking tidak dikenal' }, { status: 400 });
    } catch (error) {
        console.error('Driver tracking route error:', error);
        return jsonNoStore({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
