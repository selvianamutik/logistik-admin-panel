import { NextResponse } from 'next/server';

import {
    formatTrackingLocationText,
    normalizeTrackingNumber,
    requireDriverSessionContext,
    toSpeedKph,
} from '@/lib/api/driver-portal';
import { extractRefId } from '@/lib/api/data-helpers';
import { handleDeliveryOrderStatusUpdate } from '@/lib/api/order-workflows';
import { getSanityClient, sanityCreate, sanityGetById, sanityUpdate } from '@/lib/sanity';
import type { DeliveryOrder, Driver } from '@/lib/types';

async function addAuditLog(actor: { _id: string; name: string }, action: string, entityRef: string, summary: string) {
    try {
        await sanityCreate({
            _type: 'auditLog',
            actorUserRef: actor._id,
            actorUserName: actor.name,
            action,
            entityType: 'driverTracking',
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
    await sanityCreate({
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
    return sanityGetById<Driver>(driverId);
}

async function clearDriverTrackingLock(driver: Driver, now: string) {
    if (!driver._rev) {
        return false;
    }

    await getSanityClient()
        .patch(driver._id)
        .ifRevisionId(driver._rev)
        .unset(['activeTrackingDeliveryOrderRef'])
        .set({ activeTrackingUpdatedAt: now })
        .commit();

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

export async function POST(request: Request) {
    const auth = await requireDriverSessionContext();
    if ('error' in auth) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const body = await request.json() as {
            action?: 'start' | 'heartbeat' | 'pause' | 'resume' | 'stop';
            deliveryOrderRef?: string;
            latitude?: number;
            longitude?: number;
            accuracyM?: number;
            speedMps?: number;
        };

        const action = body.action;
        const deliveryOrderRef = typeof body.deliveryOrderRef === 'string' ? body.deliveryOrderRef : '';
        if (!action || !deliveryOrderRef) {
            return NextResponse.json({ error: 'Aksi tracking tidak valid' }, { status: 400 });
        }

        const deliveryOrder = await sanityGetById<DeliveryOrder>(deliveryOrderRef);
        if (!deliveryOrder) {
            return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
        }

        if (extractRefId(deliveryOrder.driverRef) !== auth.driver._id) {
            return NextResponse.json({ error: 'Surat jalan ini bukan milik supir yang login' }, { status: 403 });
        }

        if (deliveryOrder.status === 'CANCELLED') {
            return NextResponse.json({ error: 'Surat jalan dibatalkan dan tidak bisa ditrack' }, { status: 409 });
        }

        const latitude = normalizeTrackingNumber(body.latitude);
        const longitude = normalizeTrackingNumber(body.longitude);
        const accuracyM = normalizeTrackingNumber(body.accuracyM);
        const speedKph = toSpeedKph(normalizeTrackingNumber(body.speedMps));
        const now = new Date().toISOString();

        if ((latitude === null) !== (longitude === null)) {
            return NextResponse.json({ error: 'Koordinat GPS tidak lengkap' }, { status: 400 });
        }

        if (latitude !== null && (latitude < -90 || latitude > 90)) {
            return NextResponse.json({ error: 'Latitude tidak valid' }, { status: 400 });
        }

        if (longitude !== null && (longitude < -180 || longitude > 180)) {
            return NextResponse.json({ error: 'Longitude tidak valid' }, { status: 400 });
        }

        if (accuracyM !== null && accuracyM < 0) {
            return NextResponse.json({ error: 'Akurasi GPS tidak valid' }, { status: 400 });
        }

        if ((action === 'start' || action === 'resume' || action === 'heartbeat') && (latitude === null || longitude === null)) {
            return NextResponse.json({ error: 'Tracking live membutuhkan koordinat GPS yang valid' }, { status: 400 });
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
            const otherActiveDo = await getSanityClient().fetch<{ _id: string; doNumber?: string } | null>(
                `*[
                    _type == "deliveryOrder" &&
                    _id != $deliveryOrderRef &&
                    (driverRef == $driverRef || driverRef._ref == $driverRef) &&
                    trackingState == "ACTIVE"
                ][0]{
                    _id,
                    doNumber
                }`,
                { deliveryOrderRef, driverRef: auth.driver._id }
            );
            if (otherActiveDo) {
                return NextResponse.json(
                    { error: `Masih ada tracking aktif pada ${otherActiveDo.doNumber || otherActiveDo._id}. Hentikan dulu sebelum mulai yang baru.` },
                    { status: 409 }
                );
            }

            if (deliveryOrder.status !== 'CREATED' && deliveryOrder.status !== 'ON_DELIVERY') {
                return NextResponse.json({ error: 'Hanya DO aktif yang bisa mulai tracking' }, { status: 409 });
            }

            let driverState = await refreshDriverTrackingState(auth.driver._id);
            if (!driverState || driverState.active === false) {
                return NextResponse.json({ error: 'Data supir tidak aktif atau tidak ditemukan' }, { status: 403 });
            }

            const lockedDoRef = extractRefId(driverState.activeTrackingDeliveryOrderRef);
            if (lockedDoRef && lockedDoRef !== deliveryOrderRef) {
                const lockedDo = await sanityGetById<DeliveryOrder>(lockedDoRef);
                if (lockedDo && ['ACTIVE', 'PAUSED'].includes(lockedDo.trackingState || '')) {
                    return NextResponse.json(
                        { error: `Tracking supir ini masih terkunci pada ${lockedDo.doNumber || lockedDo._id}. Hentikan dulu sebelum mulai yang baru.` },
                        { status: 409 }
                    );
                }

                try {
                    await clearDriverTrackingLock(driverState, now);
                } catch (error) {
                    console.warn('Failed to clear stale driver tracking lock', error);
                    return NextResponse.json(
                        { error: 'Status tracking supir sedang berubah. Refresh lalu coba lagi.' },
                        { status: 409 }
                    );
                }

                driverState = await refreshDriverTrackingState(auth.driver._id);
                if (!driverState || driverState.active === false) {
                    return NextResponse.json({ error: 'Data supir tidak aktif atau tidak ditemukan' }, { status: 403 });
                }
            }

            if (!driverState._rev) {
                return NextResponse.json(
                    { error: 'Kunci tracking supir tidak tersedia. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }

            try {
                await getSanityClient()
                    .patch(driverState._id)
                    .ifRevisionId(driverState._rev)
                    .set({
                        activeTrackingDeliveryOrderRef: deliveryOrderRef,
                        activeTrackingUpdatedAt: now,
                    })
                    .commit();
            } catch (error) {
                console.warn('Failed to acquire driver tracking lock', error);
                return NextResponse.json(
                    { error: 'Tracking supir sedang dipakai sesi lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }

            try {
                if (deliveryOrder.status === 'CREATED') {
                    const statusResponse = await handleDeliveryOrderStatusUpdate(
                        auth.session,
                        { id: deliveryOrderRef, status: 'ON_DELIVERY', note: 'Tracking live dimulai via driver app' },
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

                const trackingPatch = getSanityClient()
                    .patch(deliveryOrderRef)
                    .set({
                        trackingState: 'ACTIVE',
                        trackingStartedAt: deliveryOrder.trackingStartedAt || now,
                        ...locationPatch,
                    })
                    .unset(['trackingStoppedAt']);
                const updated = await trackingPatch.commit() as DeliveryOrder;

                return NextResponse.json({ data: updated });
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
                return NextResponse.json({ error: 'Tracking belum aktif untuk DO ini' }, { status: 409 });
            }

            const updated = await sanityUpdate<DeliveryOrder>(deliveryOrderRef, {
                ...locationPatch,
                trackingState: 'ACTIVE',
            });
            return NextResponse.json({ data: updated });
        }

        if (action === 'pause') {
            if (deliveryOrder.trackingState !== 'ACTIVE') {
                return NextResponse.json({ error: 'Tracking tidak sedang aktif' }, { status: 409 });
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

            const updated = await sanityUpdate<DeliveryOrder>(deliveryOrderRef, {
                trackingState: 'PAUSED',
                ...locationPatch,
            });
            return NextResponse.json({ data: updated });
        }

        if (action === 'stop') {
            if (!['ACTIVE', 'PAUSED'].includes(deliveryOrder.trackingState || '')) {
                return NextResponse.json({ error: 'Tracking tidak sedang berjalan' }, { status: 409 });
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

            const updated = await sanityUpdate<DeliveryOrder>(deliveryOrderRef, {
                trackingState: 'STOPPED',
                trackingStoppedAt: now,
                ...locationPatch,
            });

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

            return NextResponse.json({ data: updated });
        }

        return NextResponse.json({ error: 'Aksi tracking tidak dikenal' }, { status: 400 });
    } catch (error) {
        console.error('Driver tracking route error:', error);
        return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
