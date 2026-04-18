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

async function parseJsonSafe(response: Response) {
    return response.json().catch(() => ({}));
}

async function parseResponse(response: Response | undefined) {
    assert(response instanceof Response, 'Handler tidak mengembalikan response.');
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
        const error = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
        throw new Error(error);
    }
    return payload;
}

async function expectStatus(response: Response | undefined, status: number, contains?: string) {
    assert(response instanceof Response, 'Handler tidak mengembalikan response.');
    const payload = await parseJsonSafe(response);
    if (response.status !== status) {
        throw new Error(`Expected HTTP ${status}, got ${response.status}: ${typeof payload?.error === 'string' ? payload.error : 'Tanpa pesan error'}`);
    }
    if (contains && typeof payload?.error === 'string' && !payload.error.includes(contains)) {
        throw new Error(`Expected error containing "${contains}", got "${payload.error}"`);
    }
}

async function deleteDocumentsByIds(ids: string[]) {
    if (ids.length === 0) return;
    const transaction = client.transaction();
    ids.forEach(id => transaction.delete(id));
    await transaction.commit();
}

async function cleanupAuditArtifacts() {
    const orderIds = await client.fetch<string[]>(
        `*[_type == "order" && masterResi match "AUDIT-HDR-*"]._id`
    );
    const doIds = orderIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrder" && orderRef in $ids]._id`,
            { ids: orderIds }
        )
        : [];

    await deleteDocumentsByIds([
        ...doIds,
        ...orderIds,
    ]);
}

async function main() {
    const { getSanityClient } = await import('../src/lib/sanity');
    const { handleOrderHeaderBookingUpdate } = await import('../src/lib/api/order-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const orderId = `audit-order-header-${uniqueSeed.toLowerCase()}`;
    const doId = `audit-do-header-${uniqueSeed.toLowerCase()}`;
    const initialPickupKey = `pickup-initial-${uniqueSeed.toLowerCase()}`;

    try {
        await client.create({
            _id: orderId,
            _type: 'order',
            masterResi: `AUDIT-HDR-${uniqueSeed}`,
            cargoEntryMode: 'DELIVERY_ORDER',
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            pickupAddress: 'Pickup Header Lama',
            pickupStops: [
                {
                    _key: initialPickupKey,
                    label: 'Pickup Header Lama',
                    pickupAddress: 'Pickup Header Lama',
                },
            ],
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            status: 'OPEN',
            notes: 'Catatan awal header booking',
            createdAt: new Date().toISOString(),
            createdBy: ownerSession._id,
        });

        await parseResponse(
            await handleOrderHeaderBookingUpdate(
                ownerSession,
                {
                    id: orderId,
                    customerRef: 'cust-001',
                    serviceRef: 'svc-002',
                    pickupStops: [
                        { pickupAddress: 'Pickup Header Baru' },
                    ],
                    notes: 'Header boleh berubah sebelum DO dibuat',
                },
                noopAuditLog
            )
        );

        let order = await client.fetch<{
            pickupAddress?: string;
            pickupStops?: Array<{ pickupAddress?: string }>;
            notes?: string;
        } | null>(
            `*[_type == "order" && _id == $id][0]{ pickupAddress, pickupStops[]{ pickupAddress }, notes }`,
            { id: orderId }
        );
        assert(order, 'Order audit header tidak ditemukan setelah update awal.');
        assert((order.pickupStops || []).length === 1, 'Update header awal tidak menyimpan pickup baru dengan benar.');
        assert(order.pickupStops?.[0]?.pickupAddress === 'Pickup Header Baru', 'Pickup baru tidak tersimpan sebelum DO dibuat.');
        assert(order.notes === 'Header boleh berubah sebelum DO dibuat', 'Notes order tidak berubah pada update header awal.');

        await client.create({
            _id: doId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-HDR-${uniqueSeed}`,
            orderRef: orderId,
            masterResi: `AUDIT-HDR-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            pickupAddress: 'Pickup Header Baru',
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            status: 'CREATED',
            date: '2026-04-19',
        });

        await expectStatus(
            await handleOrderHeaderBookingUpdate(
                ownerSession,
                {
                    id: orderId,
                    customerRef: 'cust-001',
                    serviceRef: 'svc-002',
                    pickupStops: [
                        { pickupAddress: 'Pickup Header Tidak Boleh Berubah' },
                    ],
                    notes: 'Should fail',
                },
                noopAuditLog
            ),
            409,
            'hanya boleh mengubah catatan umum'
        );

        await parseResponse(
            await handleOrderHeaderBookingUpdate(
                ownerSession,
                {
                    id: orderId,
                    customerRef: 'cust-001',
                    serviceRef: 'svc-002',
                    notes: 'Catatan umum sesudah DO terbit',
                },
                noopAuditLog
            )
        );

        order = await client.fetch<{
            pickupAddress?: string;
            pickupStops?: Array<{ pickupAddress?: string }>;
            notes?: string;
        } | null>(
            `*[_type == "order" && _id == $id][0]{ pickupAddress, pickupStops[]{ pickupAddress }, notes }`,
            { id: orderId }
        );
        assert(order, 'Order audit header tidak ditemukan setelah update notes.');
        assert(order.pickupStops?.[0]?.pickupAddress === 'Pickup Header Baru', 'Pickup berubah padahal sesudah DO seharusnya hanya notes yang boleh berubah.');
        assert(order.notes === 'Catatan umum sesudah DO terbit', 'Notes-only update setelah DO tidak tersimpan.');

        console.log('Audit Runtime Order Header Booking Flow');
        console.log(`Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
        console.log('');
        console.log('Semua langkah runtime mutation: OK');
        console.log(`- Order audit: ${orderId}`);
        console.log('- Header booking bisa edit pickup sebelum DO dibuat');
        console.log('- Setelah DO ada, perubahan header selain notes ditolak');
        console.log('- Notes-only update tetap diizinkan setelah DO terbit');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime order header booking flow gagal:', error);
    process.exitCode = 1;
});
