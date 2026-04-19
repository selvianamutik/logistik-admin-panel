import { loadScriptEnv } from './_env';
import type { DeliveryOrder, DeliveryOrderItem } from '../src/lib/types';

loadScriptEnv(process.cwd());

type ApiSession = {
    _id: string;
    name: string;
    email?: string;
    role: 'OWNER' | 'OPERASIONAL' | 'FINANCE' | 'ARMADA' | 'DRIVER';
};

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

const ownerSession: ApiSession = {
    _id: 'user-audit-owner-nota-drop-destination',
    name: 'Audit Owner Nota Drop Destination',
    email: 'audit.nota.drop.destination@company.local',
    role: 'OWNER',
};

const noopAuditLog = async () => undefined;

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function parseResponse(response: Response) {
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
    for (const id of ids) {
        transaction.delete(id);
    }
    await transaction.commit();
}

async function cleanupAuditArtifacts() {
    const doIds = await client.fetch<string[]>(
        `*[_type == "deliveryOrder" && doNumber match "DO-AUDIT-NOTA-DROP-*"]._id`
    );
    const notaIds = await client.fetch<string[]>(
        `*[_type == "freightNota" && notes match "AUDIT-NOTA-DROP-DEST-*"]._id`
    );
    const doItemIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const notaItemIds = notaIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "freightNotaItem" && notaRef in $ids]._id`,
            { ids: notaIds }
        )
        : [];
    await deleteDocumentsByIds([...notaItemIds, ...notaIds, ...doItemIds, ...doIds]);
}

async function main() {
    const { getSanityClient } = await import('../src/lib/sanity');
    const { getBusinessDateValue } = await import('../src/lib/business-date');
    const { buildNotaRowsFromDeliveryOrder } = await import('../src/lib/invoice-create-page-support');
    const { handleFreightNotaCreate } = await import('../src/lib/api/finance-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const issueDate = getBusinessDateValue();
    const doId = `audit-do-nota-drop-${uniqueSeed.toLowerCase()}`;
    const doItemId = `audit-doi-nota-drop-${uniqueSeed.toLowerCase()}`;
    const sjNumber = `AUDIT-NOTA-DROP-SJ-${uniqueSeed}`;
    const actualDropDestination = `Gudang Penerima Aktual ${uniqueSeed}`;
    const headerDestination = `Header DO Tidak Dipakai ${uniqueSeed}`;

    try {
        await client.create({
            _id: doId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-NOTA-DROP-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: issueDate,
            status: 'DELIVERED',
            pickupAddress: 'Gudang Audit Nota Drop',
            receiverAddress: headerDestination,
            customerDoNumber: sjNumber,
            vehiclePlate: 'W 9090 ND',
            podReceiverName: 'Penerima Audit Nota Drop',
            podReceivedDate: issueDate,
            shipperReferences: [
                {
                    _key: `shipref-nota-drop-${uniqueSeed.toLowerCase()}`,
                    sequence: 1,
                    referenceNumber: sjNumber,
                    pickupAddress: 'Gudang Audit Nota Drop',
                    billingCustomerRef: 'cust-001',
                    billingCustomerName: 'PT Pangan Nusantara',
                },
            ],
            actualDropPoints: [
                {
                    _key: `drop-nota-${uniqueSeed.toLowerCase()}`,
                    sequence: 1,
                    stopType: 'DROP',
                    shipperReferenceNumber: sjNumber,
                    locationName: actualDropDestination,
                    locationAddress: actualDropDestination,
                    qtyKoli: 3,
                    weightKg: 90,
                    weightInputValue: 90,
                    weightInputUnit: 'KG',
                    note: 'Tujuan dari realisasi drop audit',
                },
            ],
        });
        await client.create({
            _id: doItemId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Barang Audit Nota Drop',
            orderItemQtyKoli: 3,
            orderItemWeight: 90,
            actualQtyKoli: 3,
            actualWeightKg: 90,
            shipperReferenceNumber: sjNumber,
        });

        const deliveryOrder = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doId }
        );
        const deliveryOrderItems = await client.fetch<DeliveryOrderItem[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]`,
            { id: doId }
        );
        assert(deliveryOrder, 'DO audit nota drop tidak ditemukan.');

        const rows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder,
            orders: [],
            deliveryOrderItems,
        }).map(row => ({
            ...row,
            tarip: 132,
            ket: 'Audit tujuan dari actual drop',
        }));
        assert(rows.length === 1, 'Audit nota drop harus membentuk satu row nota.');
        assert(rows[0]?.tujuan === actualDropDestination, 'Row nota tidak mengambil tujuan dari actual drop SJ.');
        assert(rows[0]?.tujuan !== headerDestination, 'Row nota masih memakai tujuan header DO, bukan actual drop SJ.');

        const createNotaResponse = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `AUDIT-NOTA-DROP-DEST-${uniqueSeed}`,
                rows,
            },
            noopAuditLog
        );
        const createNotaPayload = await parseResponse(createNotaResponse);
        const notaId = createNotaPayload?.id || createNotaPayload?.data?._id;
        assert(typeof notaId === 'string' && notaId.length > 0, 'Nota audit drop destination tidak berhasil dibuat.');

        const notaItems = await client.fetch<Array<{ tujuan?: string }>>(
            `*[_type == "freightNotaItem" && notaRef == $notaId]{ tujuan }`,
            { notaId }
        );
        assert(notaItems.length === 1, 'Nota audit drop destination harus punya satu item.');
        assert(notaItems[0]?.tujuan === actualDropDestination, 'Backend create nota tidak mempertahankan tujuan dari actual drop SJ.');
        assert(notaItems[0]?.tujuan !== headerDestination, 'Backend create nota masih memakai tujuan header DO.');

        console.log('Audit Runtime Nota Drop Destination Flow');
        console.log(`Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
        console.log('');
        console.log('Semua langkah runtime mutation: OK');
        console.log(`- SJ audit: ${sjNumber}`);
        console.log('- Tujuan nota fallback ke actualDropPoints[shipperReferenceNumber] saat header SJ belum punya tujuan.');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime nota drop destination flow gagal:', error);
    process.exitCode = 1;
});
