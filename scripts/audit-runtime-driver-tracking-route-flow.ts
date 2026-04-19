import { loadScriptEnv } from './_env';
import type { DeliveryOrder, Driver, User } from '../src/lib/types';

loadScriptEnv(process.cwd());

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function parseJsonSafe(response: Response) {
    return response.json().catch(() => ({}));
}

async function parseResponse(response: Response | undefined) {
    assert(response instanceof Response, 'Route tracking tidak mengembalikan response.');
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
        const error = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
        throw new Error(error);
    }
    return payload;
}

async function expectResponseStatus(response: Response | undefined, expectedStatus: number, containsText: string) {
    assert(response instanceof Response, 'Route tracking tidak mengembalikan response.');
    const payload = await parseJsonSafe(response);
    if (response.status !== expectedStatus) {
        throw new Error(
            `Expected HTTP ${expectedStatus}, got ${response.status}: ${typeof payload?.error === 'string' ? payload.error : 'Tanpa pesan error'}`
        );
    }
    if (typeof payload?.error !== 'string' || !payload.error.includes(containsText)) {
        throw new Error(`Expected error to contain "${containsText}", got "${payload?.error || '(kosong)'}"`);
    }
}

async function deleteDocumentsByIds(ids: string[]) {
    if (ids.length === 0) {
        return;
    }
    const transaction = client.transaction();
    ids.forEach(id => transaction.delete(id));
    await transaction.commit();
}

async function cleanupAuditArtifacts() {
    const userIds = await client.fetch<string[]>(
        `*[_type == "user" && email match "audit.driver.tracking.route.*@company.local"]._id`
    );
    const driverIds = await client.fetch<string[]>(
        `*[_type == "driver" && licenseNumber match "AUDIT-DRIVER-TRACKING-ROUTE-*"]._id`
    );
    const vehicleIds = await client.fetch<string[]>(
        `*[_type == "vehicle" && unitCode match "AUDIT-DRIVER-TRACKING-ROUTE-*"]._id`
    );
    const doIds = await client.fetch<string[]>(
        `*[_type == "deliveryOrder" && doNumber match "DO-AUDIT-DRIVER-TRACKING-*"]._id`
    );
    const trackingLogIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "trackingLog" && refRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const auditLogIds = [...driverIds, ...doIds].length > 0
        ? await client.fetch<string[]>(
            `*[_type == "auditLog" && entityRef in $ids]._id`,
            { ids: [...driverIds, ...doIds] }
        )
        : [];

    await deleteDocumentsByIds([
        ...trackingLogIds,
        ...auditLogIds,
        ...doIds,
        ...userIds,
        ...driverIds,
        ...vehicleIds,
    ]);
}

async function main() {
    const { getSanityClient } = await import('../src/lib/sanity');
    const { createSession } = await import('../src/lib/auth');
    const { POST: updateDriverTrackingRoute } = await import('../src/app/api/driver/tracking/route');
    const { getBusinessDateValue } = await import('../src/lib/business-date');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const issueDate = getBusinessDateValue();
    const driverId = `audit-drv-driver-tracking-route-${uniqueSeed.toLowerCase()}`;
    const userId = `audit-user-driver-tracking-route-${uniqueSeed.toLowerCase()}`;
    const vehicleAId = `audit-veh-driver-tracking-route-a-${uniqueSeed.toLowerCase()}`;
    const vehicleBId = `audit-veh-driver-tracking-route-b-${uniqueSeed.toLowerCase()}`;
    const doAId = `audit-do-driver-tracking-route-a-${uniqueSeed.toLowerCase()}`;
    const doBId = `audit-do-driver-tracking-route-b-${uniqueSeed.toLowerCase()}`;

    const trackingRequest = (body: Record<string, unknown>) =>
        new Request('http://localhost/api/driver/tracking', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(body),
        });

    let authHeaders: Record<string, string>;

    try {
        await client.create({
            _id: driverId,
            _type: 'driver',
            name: `Audit Driver Tracking Route ${uniqueSeed}`,
            phone: '081299993333',
            licenseNumber: `AUDIT-DRIVER-TRACKING-ROUTE-${uniqueSeed}`,
            active: true,
        });
        await client.create({
            _id: userId,
            _type: 'user',
            name: `Audit Driver Tracking Route User ${uniqueSeed}`,
            email: `audit.driver.tracking.route.${uniqueSeed.toLowerCase()}@company.local`,
            role: 'DRIVER',
            active: true,
            driverRef: driverId,
            driverName: `Audit Driver Tracking Route ${uniqueSeed}`,
            passwordHash: 'unused-for-token',
        });
        await client.create({
            _id: vehicleAId,
            _type: 'vehicle',
            unitCode: `AUDIT-DRIVER-TRACKING-ROUTE-A-${uniqueSeed}`,
            plateNumber: `W 7${uniqueSeed.slice(-4)} TA`,
            vehicleType: 'FUSO',
            brandModel: 'Audit Driver Tracking Vehicle A',
            year: 2025,
            capacityKg: 8000,
            status: 'ACTIVE',
        });
        await client.create({
            _id: vehicleBId,
            _type: 'vehicle',
            unitCode: `AUDIT-DRIVER-TRACKING-ROUTE-B-${uniqueSeed}`,
            plateNumber: `W 6${uniqueSeed.slice(-4)} TB`,
            vehicleType: 'FUSO',
            brandModel: 'Audit Driver Tracking Vehicle B',
            year: 2025,
            capacityKg: 8000,
            status: 'ACTIVE',
        });
        await client.create({
            _id: doAId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-DRIVER-TRACKING-A-${uniqueSeed}`,
            masterResi: `AUDIT-DRIVER-TRACKING-A-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: issueDate,
            status: 'CREATED',
            vehicleRef: vehicleAId,
            vehiclePlate: `W 7${uniqueSeed.slice(-4)} TA`,
            driverRef: driverId,
            driverName: `Audit Driver Tracking Route ${uniqueSeed}`,
            pickupAddress: 'Gudang Audit Driver Tracking A',
            receiverAddress: 'Jl. Audit Driver Tracking A, Surabaya',
            trackingState: 'STOPPED',
        });
        await client.create({
            _id: doBId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-DRIVER-TRACKING-B-${uniqueSeed}`,
            masterResi: `AUDIT-DRIVER-TRACKING-B-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: issueDate,
            status: 'CREATED',
            vehicleRef: vehicleBId,
            vehiclePlate: `W 6${uniqueSeed.slice(-4)} TB`,
            driverRef: driverId,
            driverName: `Audit Driver Tracking Route ${uniqueSeed}`,
            pickupAddress: 'Gudang Audit Driver Tracking B',
            receiverAddress: 'Jl. Audit Driver Tracking B, Surabaya',
            trackingState: 'STOPPED',
        });

        const driverUser = await client.fetch<User | null>(
            `*[_type == "user" && _id == $id][0]`,
            { id: userId }
        );
        assert(driverUser, 'User driver tracking route tidak ditemukan.');
        const bearerToken = await createSession(driverUser);
        authHeaders = {
            authorization: `Bearer ${bearerToken}`,
            'content-type': 'application/json',
        };

        const startAResponse = await updateDriverTrackingRoute(trackingRequest({
            action: 'start',
            deliveryOrderRef: doAId,
            latitude: -7.2575,
            longitude: 112.7521,
            accuracyM: 6,
            speedMps: 0,
        }));
        await parseResponse(startAResponse);

        let doA = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doAId }
        );
        let driver = await client.fetch<Driver | null>(
            `*[_type == "driver" && _id == $id][0]`,
            { id: driverId }
        );
        assert(doA?.status === 'HEADING_TO_PICKUP', 'Tracking start harus memindahkan DO CREATED ke HEADING_TO_PICKUP.');
        assert(doA?.trackingState === 'ACTIVE', 'Tracking start tidak mengaktifkan tracking DO A.');
        assert(driver?.activeTrackingDeliveryOrderRef === doAId, 'Tracking start tidak mengunci driver ke DO A.');

        const heartbeatAResponse = await updateDriverTrackingRoute(trackingRequest({
            action: 'heartbeat',
            deliveryOrderRef: doAId,
            latitude: -7.258,
            longitude: 112.753,
            accuracyM: 4,
            speedMps: 8,
        }));
        await parseResponse(heartbeatAResponse);

        doA = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doAId }
        );
        assert(doA?.trackingLastLat === -7.258, 'Heartbeat tidak menyimpan latitude terbaru.');
        assert(doA?.trackingLastLng === 112.753, 'Heartbeat tidak menyimpan longitude terbaru.');

        const startBWhileAActive = await updateDriverTrackingRoute(trackingRequest({
            action: 'start',
            deliveryOrderRef: doBId,
            latitude: -7.27,
            longitude: 112.77,
            accuracyM: 6,
            speedMps: 0,
        }));
        await expectResponseStatus(startBWhileAActive, 409, 'Masih ada tracking aktif');

        const stopABeforeClosed = await updateDriverTrackingRoute(trackingRequest({
            action: 'stop',
            deliveryOrderRef: doAId,
            latitude: -7.258,
            longitude: 112.753,
        }));
        await expectResponseStatus(stopABeforeClosed, 409, 'Driver tidak boleh mematikan tracking sebelum DO benar-benar selesai');

        const rollbackAResponse = await updateDriverTrackingRoute(trackingRequest({
            action: 'rollback-start',
            deliveryOrderRef: doAId,
            latitude: -7.258,
            longitude: 112.753,
        }));
        await parseResponse(rollbackAResponse);

        doA = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doAId }
        );
        driver = await client.fetch<Driver | null>(
            `*[_type == "driver" && _id == $id][0]`,
            { id: driverId }
        );
        assert(doA?.trackingState === 'STOPPED', 'Rollback-start tidak menghentikan tracking DO A.');
        assert(!driver?.activeTrackingDeliveryOrderRef, 'Rollback-start tidak melepas lock driver.');

        const startBResponse = await updateDriverTrackingRoute(trackingRequest({
            action: 'start',
            deliveryOrderRef: doBId,
            latitude: -7.27,
            longitude: 112.77,
            accuracyM: 6,
            speedMps: 0,
        }));
        await parseResponse(startBResponse);

        let doB = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doBId }
        );
        assert(doB?.status === 'HEADING_TO_PICKUP', 'Tracking start DO B harus memindahkan status ke HEADING_TO_PICKUP.');
        assert(doB?.trackingState === 'ACTIVE', 'Tracking start DO B tidak aktif.');

        await client
            .patch(doBId)
            .set({
                status: 'DELIVERED',
                podReceiverName: 'Penerima Tracking Audit',
                podReceivedDate: issueDate,
            })
            .commit();

        const stopBResponse = await updateDriverTrackingRoute(trackingRequest({
            action: 'stop',
            deliveryOrderRef: doBId,
            latitude: -7.271,
            longitude: 112.771,
        }));
        await parseResponse(stopBResponse);

        doB = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doBId }
        );
        driver = await client.fetch<Driver | null>(
            `*[_type == "driver" && _id == $id][0]`,
            { id: driverId }
        );
        assert(doB?.trackingState === 'STOPPED', 'Stop tracking DO B tidak menyimpan STOPPED.');
        assert(!driver?.activeTrackingDeliveryOrderRef, 'Stop tracking DO B tidak melepas lock driver.');

        const heartbeatAfterStop = await updateDriverTrackingRoute(trackingRequest({
            action: 'heartbeat',
            deliveryOrderRef: doBId,
            latitude: -7.272,
            longitude: 112.772,
        }));
        await expectResponseStatus(heartbeatAfterStop, 409, 'Tracking belum aktif');

        console.log('Audit Runtime Driver Tracking Route Flow');
        console.log(`Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
        console.log('');
        console.log('Semua langkah runtime route: OK');
        console.log(`- DO audit A: ${doAId}`);
        console.log(`- DO audit B: ${doBId}`);
        console.log('- Start mengaktifkan tracking dan mengunci driver');
        console.log('- Heartbeat memperbarui lokasi');
        console.log('- Tracking ganda untuk satu driver ditolak');
        console.log('- Stop sebelum DO closed ditolak');
        console.log('- Rollback-start melepas lock driver');
        console.log('- Stop setelah DO delivered melepas lock driver');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime driver tracking route flow gagal:', error);
    process.exitCode = 1;
});
