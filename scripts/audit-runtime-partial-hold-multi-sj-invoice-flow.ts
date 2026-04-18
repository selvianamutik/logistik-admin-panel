import { loadScriptEnv } from './_env';
import type { DeliveryOrder, DeliveryOrderItem } from '../src/lib/types';

loadScriptEnv(process.cwd());

type ApiSession = {
    _id: string;
    name: string;
    email?: string;
    role: 'OWNER' | 'OPERASIONAL' | 'FINANCE' | 'ARMADA' | 'DRIVER';
};

type CompanyNumberingSnapshot = {
    _id: string;
    numberingSettings?: Record<string, unknown>;
};

type RuntimeAuditFreightNotaItem = {
    _id: string;
    notaRef?: string;
    noSJ?: string;
    tujuan?: string;
    customerRef?: string;
    customerName?: string;
};

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

const ownerSession: ApiSession = {
    _id: 'user-audit-owner-partial-hold',
    name: 'Audit Owner Partial Hold',
    email: 'audit.partial.hold@company.local',
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

async function parseResponse(response: Response) {
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
        const error = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
        throw new Error(error);
    }
    return payload;
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
    const doIds = await client.fetch<string[]>(
        `*[_type == "deliveryOrder" && doNumber match "DO-AUDIT-PH-*"]._id`
    );
    const doItemIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const notaIds = await client.fetch<string[]>(
        `*[_type == "freightNota" && notes match "AUDIT-PH-MULTI-SJ-*"]._id`
    );
    const notaItemIds = notaIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "freightNotaItem" && notaRef in $ids]._id`,
            { ids: notaIds }
        )
        : [];

    await deleteDocumentsByIds([
        ...notaItemIds,
        ...notaIds,
        ...doItemIds,
        ...doIds,
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
    const { getBusinessDateValue } = await import('../src/lib/business-date');
    const { buildNotaRowsFromDeliveryOrder } = await import('../src/lib/invoice-create-page-support');
    const { handleFreightNotaCreate, handleFreightNotaDelete } = await import('../src/lib/api/finance-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const issueDate = getBusinessDateValue();
    const doId = `audit-do-ph-${uniqueSeed.toLowerCase()}`;
    const doItemAId = `audit-doi-ph-a-${uniqueSeed.toLowerCase()}`;
    const doItemBId = `audit-doi-ph-b-${uniqueSeed.toLowerCase()}`;
    const sjA = `AUDIT-PH-SJ-A-${uniqueSeed}`;
    const sjB = `AUDIT-PH-SJ-B-${uniqueSeed}`;
    const tujuanA = `Jl. Audit Partial Hold A ${uniqueSeed.slice(-4)}, Surabaya`;
    const tujuanB = `Jl. Audit Partial Hold B ${uniqueSeed.slice(-4)}, Pasuruan`;
    const holdAddress = `Gudang Hold Audit ${uniqueSeed.slice(-4)}, Sidoarjo`;
    const notaPrefix = `AUDIT-PH-MULTI-SJ-${uniqueSeed}`;

    const companySnapshot = await client.fetch<CompanyNumberingSnapshot | null>(
        `*[_type == "companyProfile"][0]{ _id, numberingSettings }`
    );

    const createdNotaIds = new Set<string>();

    try {
        await client.create({
            _id: doId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-PH-${uniqueSeed}`,
            masterResi: `AUDIT-PH-RESI-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: issueDate,
            status: 'DELIVERED',
            pickupAddress: 'Gudang Audit Partial Hold',
            receiverCompany: 'Header Partial Hold',
            receiverName: 'Header Partial Hold',
            receiverAddress: 'Jl. Header Partial Hold, Gresik',
            customerDoNumber: sjA,
            podReceiverName: 'Penerima Audit Partial Hold',
            podReceivedDate: issueDate,
            actualDropPoints: [
                {
                    _key: `drop-a-${uniqueSeed.toLowerCase()}`,
                    stopType: 'DROP',
                    locationName: 'Tujuan SJ A',
                    locationAddress: tujuanA,
                    qtyKoli: 3,
                    weightKg: 90,
                },
                {
                    _key: `hold-${uniqueSeed.toLowerCase()}`,
                    stopType: 'HOLD',
                    locationName: 'Gudang Hold Audit',
                    locationAddress: holdAddress,
                    qtyKoli: 1,
                    weightKg: 30,
                },
                {
                    _key: `drop-b-${uniqueSeed.toLowerCase()}`,
                    stopType: 'DROP',
                    locationName: 'Tujuan SJ B',
                    locationAddress: tujuanB,
                    qtyKoli: 4,
                    weightKg: 120,
                },
            ],
            shipperReferences: [
                {
                    _key: `shipref-a-${uniqueSeed.toLowerCase()}`,
                    sequence: 1,
                    referenceNumber: sjA,
                    pickupAddress: 'Gudang Audit Partial Hold',
                    billingCustomerRef: 'cust-001',
                    billingCustomerName: 'PT Pangan Nusantara',
                    receiverCompany: 'Distribusi A',
                    receiverName: 'Penerima A',
                    receiverAddress: tujuanA,
                },
                {
                    _key: `shipref-b-${uniqueSeed.toLowerCase()}`,
                    sequence: 2,
                    referenceNumber: sjB,
                    pickupAddress: 'Gudang Audit Partial Hold',
                    billingCustomerRef: 'cust-002',
                    billingCustomerName: 'CV Sinar Logam',
                    receiverCompany: 'Distribusi B',
                    receiverName: 'Penerima B',
                    receiverAddress: tujuanB,
                },
            ],
        });

        await client.create({
            _id: doItemAId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Barang Partial Hold A',
            orderItemQtyKoli: 4,
            orderItemWeight: 120,
            actualQtyKoli: 4,
            actualWeightKg: 120,
            shipperReferenceNumber: sjA,
        });

        await client.create({
            _id: doItemBId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Barang Partial Hold B',
            orderItemQtyKoli: 4,
            orderItemWeight: 120,
            actualQtyKoli: 4,
            actualWeightKg: 120,
            shipperReferenceNumber: sjB,
        });

        const deliveryOrder = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doId }
        );
        const deliveryOrderItems = await client.fetch<DeliveryOrderItem[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]`,
            { id: doId }
        );
        assert(deliveryOrder, 'DO audit partial hold tidak ditemukan.');

        const notaRows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder,
            orders: [],
            deliveryOrderItems,
        }).map(row => ({
            ...row,
            tarip: 132,
            ket: `Audit partial hold ${row.noSJ}`,
        }));

        assert(notaRows.length === 2, 'DO partial hold multi-SJ harus membentuk 2 row nota.');
        const rowA = notaRows.find(row => row.noSJ === sjA);
        const rowB = notaRows.find(row => row.noSJ === sjB);
        assert(rowA && rowB, 'Row nota partial hold multi-SJ tidak lengkap.');
        assert(rowA.customerRef === 'cust-001', 'SJ A tidak membaca billing customer yang benar.');
        assert(rowB.customerRef === 'cust-002', 'SJ B tidak membaca billing customer yang benar.');
        assert(rowA.tujuan === tujuanA, 'SJ A salah mengambil tujuan; harus dari SJ, bukan actual hold/header.');
        assert(rowB.tujuan === tujuanB, 'SJ B salah mengambil tujuan; harus dari SJ.');
        assert(rowA.tujuan !== holdAddress, 'SJ A salah jatuh ke lokasi HOLD sebagai tujuan nota.');
        assert(rowB.tujuan !== holdAddress, 'SJ B salah jatuh ke lokasi HOLD sebagai tujuan nota.');
        assert(rowA.beratKg === 120, 'Berat nota SJ A harus ikut actual item SJ A penuh, bukan drop sebagian.');
        assert(rowB.beratKg === 120, 'Berat nota SJ B harus ikut actual item SJ B.');

        const notaAResponse = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-A`,
                rows: [rowA],
            },
            noopAuditLog
        );
        const notaAJson = await parseResponse(notaAResponse);
        const notaAId = notaAJson?.id || notaAJson?.data?._id;
        assert(notaAId, 'Nota partial hold SJ A gagal dibuat.');
        createdNotaIds.add(notaAId);

        const notaBResponse = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-002',
                customerName: 'CV Sinar Logam',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-B`,
                rows: [rowB],
            },
            noopAuditLog
        );
        const notaBJson = await parseResponse(notaBResponse);
        const notaBId = notaBJson?.id || notaBJson?.data?._id;
        assert(notaBId, 'Nota partial hold SJ B gagal dibuat.');
        createdNotaIds.add(notaBId);

        const notaItems = await client.fetch<RuntimeAuditFreightNotaItem[]>(
            `*[_type == "freightNotaItem" && notaRef in $ids]{
                _id,
                notaRef,
                noSJ,
                tujuan,
                customerRef,
                customerName
            }`,
            { ids: Array.from(createdNotaIds) }
        );

        const notaItemA = notaItems.find(item => item.notaRef === notaAId);
        const notaItemB = notaItems.find(item => item.notaRef === notaBId);
        assert(notaItemA?.noSJ === sjA, 'Nota item A tidak menunjuk SJ A.');
        assert(notaItemA?.customerRef === 'cust-001', 'Nota item A tidak menunjuk customer A.');
        assert(notaItemA?.tujuan === tujuanA, 'Nota item A tidak menyimpan tujuan SJ A.');
        assert(notaItemB?.noSJ === sjB, 'Nota item B tidak menunjuk SJ B.');
        assert(notaItemB?.customerRef === 'cust-002', 'Nota item B tidak menunjuk customer B.');
        assert(notaItemB?.tujuan === tujuanB, 'Nota item B tidak menyimpan tujuan SJ B.');

        console.log('Audit runtime partial/hold multi-SJ invoice flow: OK');
    } finally {
        for (const notaId of createdNotaIds) {
            try {
                await handleFreightNotaDelete(ownerSession, { id: notaId }, noopAuditLog);
            } catch {}
        }
        await cleanupAuditArtifacts().catch(() => undefined);
        await restoreCompanyNumbering(companySnapshot).catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime partial/hold multi-SJ invoice flow failed.');
    console.error(error);
    process.exitCode = 1;
});
