import { loadScriptEnv } from './_env';
import type { DeliveryOrder, DeliveryOrderItem, User } from '../src/lib/types';

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

async function parseResponse(response: Response) {
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
        const error = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
        throw new Error(error);
    }
    return payload;
}

async function expectResponseStatus(response: Response, expectedStatus: number, containsText: string) {
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
        `*[_type == "user" && email match "audit.driver.cargo.route.*@company.local"]._id`
    );
    const driverIds = await client.fetch<string[]>(
        `*[_type == "driver" && licenseNumber match "AUDIT-DRIVER-CARGO-ROUTE-*"]._id`
    );
    const vehicleIds = await client.fetch<string[]>(
        `*[_type == "vehicle" && unitCode match "AUDIT-DRIVER-CARGO-ROUTE-*"]._id`
    );
    const orderIds = await client.fetch<string[]>(
        `*[_type == "order" && masterResi match "AUDIT-DRIVER-CARGO-ROUTE-*"]._id`
    );
    const doIds = orderIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrder" && orderRef in $ids]._id`,
            { ids: orderIds }
        )
        : [];
    const orderItemIds = orderIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "orderItem" && orderRef in $ids]._id`,
            { ids: orderIds }
        )
        : [];
    const doItemIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const constraintIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "uniqueConstraint" && ownerRef in $ids]._id`,
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
        ...auditLogIds,
        ...constraintIds,
        ...doItemIds,
        ...orderItemIds,
        ...doIds,
        ...orderIds,
        ...userIds,
        ...driverIds,
        ...vehicleIds,
    ]);
}

async function main() {
    const { getSanityClient } = await import('../src/lib/sanity');
    const { createSession } = await import('../src/lib/auth');
    const { POST: updateDriverCargoRoute } = await import('../src/app/api/driver/delivery-orders/cargo/route');
    const { GET: getDriverDeliveryOrdersRoute } = await import('../src/app/api/driver/delivery-orders/route');
    const { getBusinessDateValue } = await import('../src/lib/business-date');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const issueDate = getBusinessDateValue();
    const orderId = `audit-order-driver-cargo-route-${uniqueSeed.toLowerCase()}`;
    const doId = `audit-do-driver-cargo-route-${uniqueSeed.toLowerCase()}`;
    const userId = `audit-user-driver-cargo-route-${uniqueSeed.toLowerCase()}`;
    const driverId = `audit-drv-driver-cargo-route-${uniqueSeed.toLowerCase()}`;
    const vehicleId = `audit-veh-driver-cargo-route-${uniqueSeed.toLowerCase()}`;
    const pickupStopKey = `pickup-${uniqueSeed.toLowerCase()}`;
    const sjA = `AUDIT-DRIVER-CARGO-SJ-A-${uniqueSeed}`;
    const sjB = `AUDIT-DRIVER-CARGO-SJ-B-${uniqueSeed}`;
    const sjC = `AUDIT-DRIVER-CARGO-SJ-C-${uniqueSeed}`;
    const sjD = `AUDIT-DRIVER-CARGO-SJ-D-${uniqueSeed}`;

    try {
        await client.create({
            _id: driverId,
            _type: 'driver',
            name: `Audit Driver Cargo Route ${uniqueSeed}`,
            phone: '081299992222',
            licenseNumber: `AUDIT-DRIVER-CARGO-ROUTE-${uniqueSeed}`,
            active: true,
        });
        await client.create({
            _id: userId,
            _type: 'user',
            name: `Audit Driver Cargo Route User ${uniqueSeed}`,
            email: `audit.driver.cargo.route.${uniqueSeed.toLowerCase()}@company.local`,
            role: 'DRIVER',
            active: true,
            driverRef: driverId,
            driverName: `Audit Driver Cargo Route ${uniqueSeed}`,
            passwordHash: 'unused-for-token',
        });
        const driverUser = await client.fetch<User | null>(
            `*[_type == "user" && _id == $id][0]`,
            { id: userId }
        );
        assert(driverUser, 'User driver cargo route tidak ditemukan.');

        await client.create({
            _id: vehicleId,
            _type: 'vehicle',
            unitCode: `AUDIT-DRIVER-CARGO-ROUTE-${uniqueSeed}`,
            plateNumber: `W 8${uniqueSeed.slice(-4)} CR`,
            vehicleType: 'FUSO',
            brandModel: 'Audit Driver Cargo Route Vehicle',
            year: 2025,
            capacityKg: 8000,
            serviceRef: 'svc-003',
            serviceName: 'Fuso Bak',
            status: 'ACTIVE',
        });
        await client.create({
            _id: orderId,
            _type: 'order',
            masterResi: `AUDIT-DRIVER-CARGO-ROUTE-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            serviceRef: 'svc-003',
            serviceName: 'Fuso Bak',
            cargoEntryMode: 'DELIVERY_ORDER',
            pickupAddress: 'Gudang Audit Driver Cargo Route, Gresik',
            receiverAddress: 'Jl. Audit Driver Cargo Route, Surabaya',
            createdAt: issueDate,
            pickupStops: [
                {
                    _key: pickupStopKey,
                    sequence: 1,
                    pickupLabel: 'Pickup Audit Cargo 1',
                    pickupAddress: 'Gudang Audit Driver Cargo Route, Gresik',
                },
            ],
        });
        await client.create({
            _id: doId,
            _type: 'deliveryOrder',
            orderRef: orderId,
            doNumber: `DO-AUDIT-DRIVER-CARGO-${uniqueSeed}`,
            masterResi: `AUDIT-DRIVER-CARGO-ROUTE-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: issueDate,
            status: 'CREATED',
            vehicleRef: vehicleId,
            vehiclePlate: `W 8${uniqueSeed.slice(-4)} CR`,
            driverRef: driverId,
            driverName: `Audit Driver Cargo Route ${uniqueSeed}`,
            pickupAddress: 'Gudang Audit Driver Cargo Route, Gresik',
            receiverAddress: 'Jl. Audit Driver Cargo Route, Surabaya',
            pickupStops: [
                {
                    _key: pickupStopKey,
                    sequence: 1,
                    pickupLabel: 'Pickup Audit Cargo 1',
                    pickupAddress: 'Gudang Audit Driver Cargo Route, Gresik',
                },
            ],
            customerDoNumber: sjA,
            shipperReferences: [
                {
                    _key: `shipref-a-${uniqueSeed.toLowerCase()}`,
                    sequence: 1,
                    referenceNumber: sjA,
                    pickupStopKey,
                    pickupAddress: 'Gudang Audit Driver Cargo Route, Gresik',
                },
            ],
        });

        const bearerToken = await createSession(driverUser);
        const authHeaders = {
            authorization: `Bearer ${bearerToken}`,
            'content-type': 'application/json',
        };

        const appendSjOnlyResponse = assertResponse(await updateDriverCargoRoute(
            new Request('http://localhost/api/driver/delivery-orders/cargo', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    id: doId,
                    shipperReferences: [
                        { referenceNumber: sjA, pickupStopKey },
                        { referenceNumber: sjB, pickupStopKey },
                    ],
                    cargoItems: [],
                }),
            })
        ), 'Route cargo append SJ-only');
        const appendSjOnlyPayload = await parseResponse(appendSjOnlyResponse);
        assert(appendSjOnlyPayload?.data?.appendedCount === 0, 'SJ-only append tidak boleh menambah item barang.');
        assert(appendSjOnlyPayload?.data?.shipperReferenceCount === 2, 'SJ-only append harus menghasilkan 2 shipper references.');

        let deliveryOrder = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doId }
        );
        assert((deliveryOrder?.shipperReferences || []).length === 2, 'Route cargo SJ-only tidak menyimpan header SJ kedua.');

        const appendCargoResponse = assertResponse(await updateDriverCargoRoute(
            new Request('http://localhost/api/driver/delivery-orders/cargo', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    id: doId,
                    shipperReferences: [
                        { referenceNumber: sjA, pickupStopKey },
                        { referenceNumber: sjB, pickupStopKey },
                        { referenceNumber: sjC, pickupStopKey },
                    ],
                    cargoItems: [
                        {
                            description: 'Barang Audit Driver Cargo Route C',
                            qtyKoli: 8,
                            weightInputValue: 240,
                            weightInputUnit: 'KG',
                            shipperReferenceNumber: sjC,
                            pickupStopKey,
                        },
                    ],
                }),
            })
        ), 'Route cargo append cargo');
        const appendCargoPayload = await parseResponse(appendCargoResponse);
        assert(appendCargoPayload?.data?.appendedCount === 1, 'Append cargo route harus menambah 1 item.');
        assert(appendCargoPayload?.data?.shipperReferenceCount === 3, 'Append cargo route harus menghasilkan 3 shipper references.');

        deliveryOrder = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doId }
        );
        const doItems = await client.fetch<DeliveryOrderItem[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]`,
            { id: doId }
        );
        assert((deliveryOrder?.shipperReferences || []).map(item => item.referenceNumber).join('|') === `${sjA}|${sjB}|${sjC}`, 'Header SJ setelah append cargo tidak sinkron.');
        assert(doItems.length === 1, 'Append cargo route tidak menyimpan deliveryOrderItem.');
        assert(doItems[0]?.shipperReferenceNumber === sjC, 'DeliveryOrderItem hasil append tidak menempel ke SJ C.');

        const driverListResponse = await getDriverDeliveryOrdersRoute(
            new Request('http://localhost/api/driver/delivery-orders', {
                method: 'GET',
                headers: authHeaders,
            })
        );
        const driverListPayload = await parseResponse(driverListResponse);
        const activeDos = Array.isArray(driverListPayload?.data) ? driverListPayload.data : [];
        const visibleDo = activeDos.find((item: { _id?: string }) => item._id === doId);
        assert(visibleDo, 'DO audit cargo route tidak muncul di route GET driver.');
        assert(Array.isArray(visibleDo.driverCargoItems) && visibleDo.driverCargoItems.length === 1, 'Route GET driver tidak memuat item cargo hasil append.');

        await client
            .patch(doId)
            .set({
                pendingDriverStatus: 'DELIVERED',
                pendingDriverStatusRequestedAt: new Date().toISOString(),
                pendingDriverStatusRequestedBy: userId,
                pendingDriverStatusRequestedByName: driverUser.name,
            })
            .commit();

        const appendWhilePendingResponse = assertResponse(await updateDriverCargoRoute(
            new Request('http://localhost/api/driver/delivery-orders/cargo', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    id: doId,
                    shipperReferences: [
                        { referenceNumber: sjA, pickupStopKey },
                        { referenceNumber: sjB, pickupStopKey },
                        { referenceNumber: sjC, pickupStopKey },
                        { referenceNumber: sjD, pickupStopKey },
                    ],
                    cargoItems: [],
                }),
            })
        ), 'Route cargo pending lock');
        await expectResponseStatus(appendWhilePendingResponse, 409, 'Permintaan selesai sudah diajukan');

        console.log('Audit Runtime Driver Cargo Route Flow');
        console.log(`Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
        console.log('');
        console.log('Semua langkah runtime route: OK');
        console.log(`- DO audit: ${doId}`);
        console.log(`- SJ audit: ${sjA}, ${sjB}, ${sjC}`);
        console.log('- Route cargo bisa simpan SJ-only tanpa item');
        console.log('- Route cargo bisa append SJ + barang ke DO aktif');
        console.log('- Route GET driver membaca item cargo hasil append');
        console.log('- Route cargo terkunci setelah driver mengajukan selesai');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime driver cargo route flow gagal:', error);
    process.exitCode = 1;
});
