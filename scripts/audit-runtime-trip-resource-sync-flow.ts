import { loadScriptEnv } from './_env';

loadScriptEnv(process.cwd());

type ApiSession = {
    _id: string;
    name: string;
    email?: string;
    role: 'OWNER' | 'OPERASIONAL' | 'FINANCE' | 'ARMADA' | 'DRIVER';
};

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

const ownerSession: ApiSession = {
    _id: 'user-audit-owner-script',
    name: 'Audit Owner',
    email: 'audit.owner@company.local',
    role: 'OWNER',
};

const noopAuditLog = async () => undefined;

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function parseResponse(response: Response | undefined) {
    assert(response instanceof Response, 'Handler tidak mengembalikan response.');
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
        throw new Error(error);
    }
    return payload;
}

async function deleteDocumentsByIds(ids: string[]) {
    if (ids.length === 0) return;
    const transaction = client.transaction();
    ids.forEach(id => transaction.delete(id));
    await transaction.commit();
}

async function cleanupAuditArtifacts() {
    const orderIds = await client.fetch<string[]>(
        `*[_type == "order" && masterResi match "AUDIT-TRIP-SYNC-*"]._id`
    );
    const doIds = orderIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrder" && orderRef in $ids]._id`,
            { ids: orderIds }
        )
        : [];
    const vehicleIds = await client.fetch<string[]>(
        `*[_type == "vehicle" && unitCode match "AUDIT-TRIP-SYNC-*"]._id`
    );
    const driverIds = await client.fetch<string[]>(
        `*[_type == "driver" && licenseNumber match "AUDIT-TRIP-SYNC-*"]._id`
    );

    await deleteDocumentsByIds([
        ...doIds,
        ...orderIds,
        ...vehicleIds,
        ...driverIds,
    ]);
}

async function main() {
    const { getSanityClient } = await import('../src/lib/sanity');
    const { handleDeliveryOrderTripResourceAssign } = await import('../src/lib/api/order-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const orderId = `audit-order-trip-sync-${uniqueSeed.toLowerCase()}`;
    const doId = `audit-do-trip-sync-${uniqueSeed.toLowerCase()}`;
    const oldVehicleId = `audit-veh-old-${uniqueSeed.toLowerCase()}`;
    const newVehicleId = `audit-veh-new-${uniqueSeed.toLowerCase()}`;
    const oldDriverId = `audit-drv-old-${uniqueSeed.toLowerCase()}`;
    const newDriverId = `audit-drv-new-${uniqueSeed.toLowerCase()}`;
    const tripKey = `trip-${uniqueSeed.toLowerCase()}`;
    const orderDate = '2026-04-19';

    try {
        await client.create({
            _id: oldVehicleId,
            _type: 'vehicle',
            unitCode: `AUDIT-TRIP-SYNC-OLD-${uniqueSeed}`,
            plateNumber: `L 9${uniqueSeed.slice(-4)} A`,
            vehicleType: 'CDD',
            brandModel: 'Audit Vehicle Old',
            year: 2024,
            capacityKg: 4000,
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            status: 'ACTIVE',
        });
        await client.create({
            _id: newVehicleId,
            _type: 'vehicle',
            unitCode: `AUDIT-TRIP-SYNC-NEW-${uniqueSeed}`,
            plateNumber: `L 8${uniqueSeed.slice(-4)} B`,
            vehicleType: 'CDD',
            brandModel: 'Audit Vehicle New',
            year: 2025,
            capacityKg: 4500,
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            status: 'ACTIVE',
        });
        await client.create({
            _id: oldDriverId,
            _type: 'driver',
            name: `Audit Driver Old ${uniqueSeed}`,
            phone: '081200000001',
            licenseNumber: `AUDIT-TRIP-SYNC-OLD-${uniqueSeed}`,
            active: true,
        });
        await client.create({
            _id: newDriverId,
            _type: 'driver',
            name: `Audit Driver New ${uniqueSeed}`,
            phone: '081200000002',
            licenseNumber: `AUDIT-TRIP-SYNC-NEW-${uniqueSeed}`,
            active: true,
        });

        await client.create({
            _id: orderId,
            _type: 'order',
            masterResi: `AUDIT-TRIP-SYNC-${uniqueSeed}`,
            cargoEntryMode: 'DELIVERY_ORDER',
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            pickupAddress: 'Pickup Audit Trip Sync',
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            status: 'OPEN',
            createdAt: new Date().toISOString(),
            createdBy: ownerSession._id,
            tripPlans: [
                {
                    _key: tripKey,
                    sequence: 1,
                    pickupStopKeys: [],
                    vehicleRef: oldVehicleId,
                    vehiclePlate: `L 9${uniqueSeed.slice(-4)} A`,
                    vehicleServiceRef: 'svc-002',
                    vehicleServiceName: 'CDD',
                    driverRef: oldDriverId,
                    driverName: `Audit Driver Old ${uniqueSeed}`,
                    issueBankRef: 'bank-jatim-001',
                    issueBankName: 'Bank Jatim',
                    cashGiven: 100000,
                    taripBorongan: 250000,
                    date: orderDate,
                    linkedDeliveryOrderRef: doId,
                    linkedDeliveryOrderNumber: `DO-AUDIT-TRIP-SYNC-${uniqueSeed}`,
                },
            ],
        });

        await client.create({
            _id: doId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-TRIP-SYNC-${uniqueSeed}`,
            orderRef: orderId,
            masterResi: `AUDIT-TRIP-SYNC-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            pickupAddress: 'Pickup Audit Trip Sync',
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            vehicleRef: oldVehicleId,
            vehiclePlate: `L 9${uniqueSeed.slice(-4)} A`,
            vehicleServiceRef: 'svc-002',
            vehicleServiceName: 'CDD',
            driverRef: oldDriverId,
            driverName: `Audit Driver Old ${uniqueSeed}`,
            status: 'CREATED',
            date: orderDate,
        });

        await parseResponse(
            await handleDeliveryOrderTripResourceAssign(
                ownerSession,
                {
                    id: doId,
                    vehicleRef: newVehicleId,
                    driverRef: newDriverId,
                },
                noopAuditLog
            )
        );

        const deliveryOrder = await client.fetch<{
            vehicleRef?: string;
            vehiclePlate?: string;
            driverRef?: string;
            driverName?: string;
        } | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{ vehicleRef, vehiclePlate, driverRef, driverName }`,
            { id: doId }
        );
        const order = await client.fetch<{
            tripPlans?: Array<{
                _key?: string;
                linkedDeliveryOrderRef?: string;
                vehicleRef?: string;
                vehiclePlate?: string;
                driverRef?: string;
                driverName?: string;
            }>;
        } | null>(
            `*[_type == "order" && _id == $id][0]{ tripPlans[]{ _key, linkedDeliveryOrderRef, vehicleRef, vehiclePlate, driverRef, driverName } }`,
            { id: orderId }
        );

        assert(deliveryOrder, 'DO audit trip sync tidak ditemukan sesudah assign.');
        assert(order, 'Order audit trip sync tidak ditemukan sesudah assign.');
        assert(deliveryOrder.vehicleRef === newVehicleId, 'DO tidak memperbarui vehicleRef ke armada baru.');
        assert(deliveryOrder.driverRef === newDriverId, 'DO tidak memperbarui driverRef ke supir baru.');
        assert(deliveryOrder.vehiclePlate === `L 8${uniqueSeed.slice(-4)} B`, 'DO tidak memperbarui nomor polisi baru.');
        assert(deliveryOrder.driverName === `Audit Driver New ${uniqueSeed}`, 'DO tidak memperbarui nama supir baru.');

        const linkedTrip = (order.tripPlans || []).find(plan => plan.linkedDeliveryOrderRef === doId);
        assert(linkedTrip, 'Trip plan terkait DO tidak ditemukan di order.');
        assert(linkedTrip?._key === tripKey, 'Trip plan yang diupdate bukan trip plan linked yang benar.');
        assert(linkedTrip?.vehicleRef === newVehicleId, 'Order.tripPlans tidak sinkron vehicleRef baru.');
        assert(linkedTrip?.driverRef === newDriverId, 'Order.tripPlans tidak sinkron driverRef baru.');
        assert(linkedTrip?.vehiclePlate === `L 8${uniqueSeed.slice(-4)} B`, 'Order.tripPlans tidak sinkron vehiclePlate baru.');
        assert(linkedTrip?.driverName === `Audit Driver New ${uniqueSeed}`, 'Order.tripPlans tidak sinkron driverName baru.');

        console.log('Audit Runtime Trip Resource Sync Flow');
        console.log(`Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
        console.log('');
        console.log('Semua langkah runtime mutation: OK');
        console.log(`- DO audit: ${doId}`);
        console.log('- Assign armada/supir mengubah DO aktif');
        console.log('- Trip plan order yang linked ikut sinkron ke resource baru');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime trip resource sync flow gagal:', error);
    process.exitCode = 1;
});
