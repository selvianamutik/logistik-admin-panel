import { loadScriptEnv } from './_env';
import type { DeliveryOrder, DeliveryOrderItem, User } from '../src/lib/types';

loadScriptEnv(process.cwd());

type CompanyNumberingSnapshot = {
    _id: string;
    numberingSettings?: Record<string, unknown>;
};

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

const noopAuditLog = async () => undefined;

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function parseJsonSafe(response: Response) {
    return response.json().catch(() => ({}));
}

async function parseResponse(response: Response) {
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
        const error = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
        throw new Error(error);
    }
    return payload;
}

function assertResponse(response: Response | undefined, label: string): Response {
    assert(response instanceof Response, `${label} tidak mengembalikan response.`);
    return response;
}

async function deleteDocumentsByIds(ids: string[]) {
    if (ids.length === 0) {
        return;
    }
    const transaction = client.transaction();
    for (const id of ids) {
        transaction.delete(id);
    }
    await transaction.commit();
}

async function cleanupAuditArtifacts() {
    const userIds = await client.fetch<string[]>(
        `*[_type == "user" && email match "audit.driver.route.*@company.local"]._id`
    );
    const driverIds = await client.fetch<string[]>(
        `*[_type == "driver" && licenseNumber match "AUDIT-DRIVER-ROUTE-*"]._id`
    );
    const vehicleIds = await client.fetch<string[]>(
        `*[_type == "vehicle" && unitCode match "AUDIT-DRIVER-ROUTE-*"]._id`
    );
    const orderIds = await client.fetch<string[]>(
        `*[_type == "order" && masterResi match "AUDIT-DRIVER-ROUTE-*"]._id`
    );
    const doIds = orderIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrder" && orderRef in $ids]._id`,
            { ids: orderIds }
        )
        : [];
    const doItemIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const trackingLogIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "trackingLog" && refRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const auditLogIds = [...orderIds, ...doIds].length > 0
        ? await client.fetch<string[]>(
            `*[_type == "auditLog" && entityRef in $ids]._id`,
            { ids: [...orderIds, ...doIds] }
        )
        : [];

    await deleteDocumentsByIds([
        ...trackingLogIds,
        ...auditLogIds,
        ...doItemIds,
        ...doIds,
        ...orderIds,
        ...userIds,
        ...driverIds,
        ...vehicleIds,
    ]);
}

async function restoreCompanyNumbering(snapshot: CompanyNumberingSnapshot | null) {
    if (!snapshot?._id) {
        return;
    }
    const current = await client.fetch<{ _id: string; _rev?: string } | null>(
        `*[_type == "companyProfile" && _id == $id][0]{ _id, _rev }`,
        { id: snapshot._id }
    );
    if (!current?._id || !current._rev) {
        return;
    }
    await client
        .patch(current._id)
        .ifRevisionId(current._rev)
        .set({ numberingSettings: snapshot.numberingSettings || {} })
        .commit();
}

async function main() {
    const { getSanityClient } = await import('../src/lib/sanity');
    const { createSession } = await import('../src/lib/auth');
    const { handleOrderCreate } = await import('../src/lib/api/order-workflows');
    const { GET: getDriverSessionRoute } = await import('../src/app/api/driver/session/route');
    const { GET: getDriverDeliveryOrdersRoute } = await import('../src/app/api/driver/delivery-orders/route');
    const { POST: createDriverDeliveryOrderRoute } = await import('../src/app/api/driver/delivery-orders/create/route');
    const { POST: updateDriverDeliveryOrderStatusRoute } = await import('../src/app/api/driver/delivery-orders/status/route');
    const { POST: updateDriverTrackingRoute } = await import('../src/app/api/driver/tracking/route');
    const { getBusinessDateValue } = await import('../src/lib/business-date');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const issueDate = getBusinessDateValue();
    const driverId = `audit-drv-driver-route-${uniqueSeed.toLowerCase()}`;
    const userId = `audit-user-driver-route-${uniqueSeed.toLowerCase()}`;
    const vehicleId = `audit-veh-driver-route-${uniqueSeed.toLowerCase()}`;
    const pickupStopKey = `pickup-${uniqueSeed.toLowerCase()}`;
    const shipperRefA = `AUDIT-DRIVER-ROUTE-SJ-A-${uniqueSeed}`;
    const shipperRefB = `AUDIT-DRIVER-ROUTE-SJ-B-${uniqueSeed}`;

    const companySnapshot = await client.fetch<CompanyNumberingSnapshot | null>(
        `*[_type == "companyProfile"][0]{ _id, numberingSettings }`
    );

    try {
        await client.create({
            _id: driverId,
            _type: 'driver',
            name: `Audit Driver Route ${uniqueSeed}`,
            phone: '081299991111',
            licenseNumber: `AUDIT-DRIVER-ROUTE-${uniqueSeed}`,
            active: true,
        });
        await client.create({
            _id: userId,
            _type: 'user',
            name: `Audit Driver Route User ${uniqueSeed}`,
            email: `audit.driver.route.${uniqueSeed.toLowerCase()}@company.local`,
            role: 'DRIVER',
            active: true,
            driverRef: driverId,
            driverName: `Audit Driver Route ${uniqueSeed}`,
            passwordHash: 'unused-for-token',
        });
        const driverUser = await client.fetch<User | null>(
            `*[_type == "user" && _id == $id][0]`,
            { id: userId }
        );
        assert(driverUser, 'User driver audit tidak ditemukan.');
        assert(driverUser.driverRef === driverId, 'User driver audit tidak sinkron dengan driver temporary.');

        await client.create({
            _id: vehicleId,
            _type: 'vehicle',
            unitCode: `AUDIT-DRIVER-ROUTE-${uniqueSeed}`,
            plateNumber: `W 9${uniqueSeed.slice(-4)} RT`,
            vehicleType: 'FUSO',
            brandModel: 'Audit Driver Route Vehicle',
            year: 2025,
            capacityKg: 8000,
            serviceRef: 'svc-003',
            serviceName: 'Fuso Bak',
            status: 'ACTIVE',
        });

        const createOrderResponse = await handleOrderCreate(
            {
                _id: 'user-owner-001',
                name: 'Audit Owner Driver Route',
                email: 'audit.driver.route@company.local',
                role: 'OWNER',
            },
            {
                customerRef: 'cust-001',
                serviceRef: 'svc-003',
                receiverAddress: 'Jl. Audit Driver Route, Surabaya',
                pickupAddress: 'Gudang Audit Driver Route, Gresik',
                notes: 'Order audit runtime route driver',
                items: [],
                pickupStops: [
                    {
                        _key: pickupStopKey,
                        sequence: 1,
                        pickupLabel: 'Pickup Audit 1',
                        pickupAddress: 'Gudang Audit Driver Route, Gresik',
                        notes: 'Pickup stop audit route driver',
                    },
                ],
                tripDrafts: [
                    {
                        vehicleRef: vehicleId,
                    driverRef: driverId,
                    date: issueDate,
                    taripBorongan: 450000,
                    issueBankRef: 'bank-jatim-001',
                        cashGiven: 100000,
                        notes: 'Trip plan audit route driver',
                        pickupStopKeys: [pickupStopKey],
                    },
                ],
            },
            noopAuditLog
        );
        const createOrderPayload = await parseResponse(createOrderResponse);
        const createdOrderId = createOrderPayload?.id;
        assert(typeof createdOrderId === 'string' && createdOrderId.length > 0, 'Order audit route driver tidak berhasil dibuat.');

        const bearerToken = await createSession(driverUser);
        const authHeaders = {
            authorization: `Bearer ${bearerToken}`,
            'content-type': 'application/json',
        };

        const sessionResponse = await getDriverSessionRoute(
            new Request('http://localhost/api/driver/session', {
                method: 'GET',
                headers: authHeaders,
            })
        );
        const sessionPayload = await parseResponse(sessionResponse);
        assert(sessionPayload?.driver?._id === driverId, 'Route session driver tidak mengembalikan driver yang benar.');

        const beforeCreateResponse = await getDriverDeliveryOrdersRoute(
            new Request('http://localhost/api/driver/delivery-orders', {
                method: 'GET',
                headers: authHeaders,
            })
        );
        const beforeCreatePayload = await parseResponse(beforeCreateResponse);
        const plannedTripsBefore = Array.isArray(beforeCreatePayload?.plannedTrips) ? beforeCreatePayload.plannedTrips : [];
        const targetTrip = plannedTripsBefore.find(
            (item: { orderRef?: string; tripPlanKey?: string }) => item.orderRef === createdOrderId
        );
        assert(targetTrip, 'Route GET driver/delivery-orders tidak menampilkan trip plan audit.');
        const actualTripPlanKey = typeof targetTrip.tripPlanKey === 'string' ? targetTrip.tripPlanKey : '';
        assert(actualTripPlanKey, 'Trip plan audit route driver tidak punya _key.');

        const createResponse = assertResponse(await createDriverDeliveryOrderRoute(
            new Request('http://localhost/api/driver/delivery-orders/create', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    orderRef: createdOrderId,
                    orderTripPlanKey: actualTripPlanKey,
                    shipperReferences: [
                        { referenceNumber: shipperRefA, pickupStopKey },
                        { referenceNumber: shipperRefB, pickupStopKey },
                    ],
                    receiverName: 'Penerima Audit Driver Route',
                    receiverAddress: 'Jl. Audit Driver Route, Surabaya',
                    cargoItems: [
                        {
                            description: 'Keramik Audit Route A',
                            qtyKoli: 6,
                            weightInputValue: 180,
                            weightInputUnit: 'KG',
                            shipperReferenceNumber: shipperRefA,
                            pickupStopKey,
                        },
                        {
                            description: 'Keramik Audit Route B',
                            qtyKoli: 4,
                            weightInputValue: 120,
                            weightInputUnit: 'KG',
                            shipperReferenceNumber: shipperRefB,
                            pickupStopKey,
                        },
                    ],
                }),
            })
        ), 'Route create driver');
        const createPayload = await parseResponse(createResponse);
        const deliveryOrderId = createPayload?.id || createPayload?.data?._id;
        assert(typeof deliveryOrderId === 'string' && deliveryOrderId.length > 0, 'Route create driver tidak menghasilkan DO.');

        const createdDo = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: deliveryOrderId }
        );
        assert(createdDo?.driverRef === driverId, 'DO hasil route create tidak menempel ke driver trip plan.');
        assert(createdDo?.vehicleRef === vehicleId, 'DO hasil route create tidak menempel ke vehicle trip plan.');

        const doItems = await client.fetch<DeliveryOrderItem[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id] | order(_createdAt asc)`,
            { id: deliveryOrderId }
        );
        assert(doItems.length === 2, 'Route create driver tidak menyimpan 2 item cargo sesuai payload.');

        const afterCreateResponse = await getDriverDeliveryOrdersRoute(
            new Request('http://localhost/api/driver/delivery-orders', {
                method: 'GET',
                headers: authHeaders,
            })
        );
        const afterCreatePayload = await parseResponse(afterCreateResponse);
        const plannedTripsAfter = Array.isArray(afterCreatePayload?.plannedTrips) ? afterCreatePayload.plannedTrips : [];
        const activeDosAfter = Array.isArray(afterCreatePayload?.data) ? afterCreatePayload.data : [];
        assert(
            !plannedTripsAfter.some((item: { orderRef?: string; tripPlanKey?: string }) => item.orderRef === createdOrderId && item.tripPlanKey === actualTripPlanKey),
            'Trip plan audit masih muncul setelah route create berhasil.'
        );
        assert(
            activeDosAfter.some((item: { _id?: string; doNumber?: string }) => item._id === deliveryOrderId || item.doNumber === createdDo?.doNumber),
            'DO hasil create tidak muncul di route GET driver/delivery-orders.'
        );

        const trackingStartResponse = assertResponse(await updateDriverTrackingRoute(
            new Request('http://localhost/api/driver/tracking', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    action: 'start',
                    deliveryOrderRef: deliveryOrderId,
                    latitude: -7.2575,
                    longitude: 112.7521,
                    accuracyM: 5,
                    speedMps: 0,
                }),
            })
        ), 'Route tracking start');
        await parseResponse(trackingStartResponse);

        const onDeliveryResponse = assertResponse(await updateDriverDeliveryOrderStatusRoute(
            new Request('http://localhost/api/driver/delivery-orders/status', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    id: deliveryOrderId,
                    status: 'ON_DELIVERY',
                    note: 'Audit route driver menuju lokasi drop',
                }),
            })
        ), 'Route status ON_DELIVERY');
        await parseResponse(onDeliveryResponse);

        const arrivedResponse = assertResponse(await updateDriverDeliveryOrderStatusRoute(
            new Request('http://localhost/api/driver/delivery-orders/status', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    id: deliveryOrderId,
                    status: 'ARRIVED',
                    note: 'Audit route driver tiba di lokasi',
                }),
            })
        ), 'Route status ARRIVED');
        await parseResponse(arrivedResponse);

        const deliveredRequestResponse = assertResponse(await updateDriverDeliveryOrderStatusRoute(
            new Request('http://localhost/api/driver/delivery-orders/status', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    id: deliveryOrderId,
                    status: 'DELIVERED',
                    note: 'Audit route driver ajukan selesai',
                    actualItems: doItems.map(item => ({
                        deliveryOrderItemRef: item._id,
                        actualQtyKoli: item.orderItemQtyKoli,
                        actualWeightInputValue: item.orderItemWeight,
                        actualWeightInputUnit: 'KG',
                    })),
                    actualDropPoints: [
                        {
                            stopType: 'DROP',
                            locationName: 'Drop Audit Route A',
                            locationAddress: 'Jl. Audit Driver Route A, Surabaya',
                            qtyKoli: 6,
                            weightInputValue: 180,
                            weightInputUnit: 'KG',
                        },
                        {
                            stopType: 'DROP',
                            locationName: 'Drop Audit Route B',
                            locationAddress: 'Jl. Audit Driver Route B, Surabaya',
                            qtyKoli: 4,
                            weightInputValue: 120,
                            weightInputUnit: 'KG',
                        },
                    ],
                }),
            })
        ), 'Route status DELIVERED request');
        await parseResponse(deliveredRequestResponse);

        const pendingDo = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: deliveryOrderId }
        );
        assert(pendingDo?.status === 'ARRIVED', 'Route DELIVERED driver harus menyimpan pending request, bukan langsung final.');
        assert(pendingDo?.pendingDriverStatus === 'DELIVERED', 'Route DELIVERED driver tidak menyimpan pendingDriverStatus.');
        assert(Array.isArray(pendingDo?.pendingDriverActualCargoItems) && pendingDo!.pendingDriverActualCargoItems!.length === 2, 'Route DELIVERED driver tidak menyimpan pending actual cargo.');
        assert(Array.isArray(pendingDo?.pendingDriverActualDropPoints) && pendingDo!.pendingDriverActualDropPoints!.length === 2, 'Route DELIVERED driver tidak menyimpan pending actual drop points.');

        console.log('Audit Runtime Driver Route Flow');
        console.log(`Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
        console.log('');
        console.log('Semua langkah runtime route: OK');
        console.log(`- Order audit: ${createdOrderId}`);
        console.log(`- DO audit: ${deliveryOrderId}`);
        console.log('- Route session mengembalikan driver bearer auth yang benar');
        console.log('- Route delivery-orders menampilkan planned trip lalu memindahkannya ke active DO setelah create');
        console.log('- Route create menyimpan multi-SJ dan cargo sesuai payload driver');
        console.log('- Route tracking start mengaktifkan tracking live sebelum progres perjalanan');
        console.log('- Route status ON_DELIVERY dan ARRIVED berjalan');
        console.log('- Route DELIVERED menyimpan pending approval cargo/drop sesuai payload driver');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
        await restoreCompanyNumbering(companySnapshot).catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime driver route flow gagal:', error);
    process.exitCode = 1;
});
