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

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

const ownerSession: ApiSession = {
    _id: 'user-audit-owner-mixed-revision',
    name: 'Audit Owner Mixed Revision',
    email: 'audit.mixed.revision@company.local',
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

async function expectConflict(response: Response, containsText: string) {
    const payload = await parseJsonSafe(response);
    if (response.status !== 409) {
        throw new Error(
            `Expected HTTP 409, got ${response.status}: ${typeof payload?.error === 'string' ? payload.error : 'Tanpa pesan error'}`
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
    for (const id of ids) {
        transaction.delete(id);
    }
    await transaction.commit();
}

async function cleanupAuditArtifacts() {
    const doIds = await client.fetch<string[]>(
        `*[_type == "deliveryOrder" && doNumber match "DO-AUDIT-MIX-REV-*"]._id`
    );
    const doItemIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const notaIds = await client.fetch<string[]>(
        `*[_type == "freightNota" && notes match "AUDIT-MIX-REVISION-*"]._id`
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
    const { handleFreightNotaCreate, handleFreightNotaDelete, handleFreightNotaUpdate } = await import('../src/lib/api/finance-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const issueDate = getBusinessDateValue();
    const doId = `audit-do-mix-rev-${uniqueSeed.toLowerCase()}`;
    const doItemAId = `audit-doi-mix-rev-a-${uniqueSeed.toLowerCase()}`;
    const doItemBId = `audit-doi-mix-rev-b-${uniqueSeed.toLowerCase()}`;
    const doItemCId = `audit-doi-mix-rev-c-${uniqueSeed.toLowerCase()}`;
    const sjA = `AUDIT-MIX-REV-SJ-A-${uniqueSeed}`;
    const sjB = `AUDIT-MIX-REV-SJ-B-${uniqueSeed}`;
    const sjC = `AUDIT-MIX-REV-SJ-C-${uniqueSeed}`;
    const tujuanA = `Jl. Audit Mix Rev A ${uniqueSeed.slice(-4)}, Surabaya`;
    const tujuanB = `Jl. Audit Mix Rev B ${uniqueSeed.slice(-4)}, Sidoarjo`;
    const tujuanC = `Jl. Audit Mix Rev C ${uniqueSeed.slice(-4)}, Gresik`;
    const notaPrefix = `AUDIT-MIX-REVISION-${uniqueSeed}`;

    const companySnapshot = await client.fetch<CompanyNumberingSnapshot | null>(
        `*[_type == "companyProfile"][0]{ _id, numberingSettings }`
    );

    const createdNotaIds = new Set<string>();

    try {
        await client.create({
            _id: doId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-MIX-REV-${uniqueSeed}`,
            masterResi: `AUDIT-MIX-REV-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: issueDate,
            status: 'DELIVERED',
            pickupAddress: 'Gudang Audit Mixed Revision',
            receiverCompany: 'Header Mixed Revision',
            receiverName: 'Header Mixed Revision',
            receiverAddress: 'Jl. Header Mixed Revision, Gresik',
            customerDoNumber: sjA,
            podReceiverName: 'Penerima Mixed Revision',
            podReceivedDate: issueDate,
            shipperReferences: [
                {
                    _key: `shipref-a-${uniqueSeed.toLowerCase()}`,
                    sequence: 1,
                    referenceNumber: sjA,
                    pickupAddress: 'Gudang Audit Mixed Revision',
                    billingCustomerRef: 'cust-001',
                    billingCustomerName: 'PT Pangan Nusantara',
                    receiverCompany: 'Distribusi Mixed Rev A',
                    receiverName: 'Penerima Mixed Rev A',
                    receiverAddress: tujuanA,
                },
                {
                    _key: `shipref-b-${uniqueSeed.toLowerCase()}`,
                    sequence: 2,
                    referenceNumber: sjB,
                    pickupAddress: 'Gudang Audit Mixed Revision',
                    billingCustomerRef: 'cust-002',
                    billingCustomerName: 'CV Sinar Logam',
                    receiverCompany: 'Distribusi Mixed Rev B',
                    receiverName: 'Penerima Mixed Rev B',
                    receiverAddress: tujuanB,
                },
                {
                    _key: `shipref-c-${uniqueSeed.toLowerCase()}`,
                    sequence: 3,
                    referenceNumber: sjC,
                    pickupAddress: 'Gudang Audit Mixed Revision',
                    billingCustomerRef: 'cust-001',
                    billingCustomerName: 'PT Pangan Nusantara',
                    receiverCompany: 'Distribusi Mixed Rev C',
                    receiverName: 'Penerima Mixed Rev C',
                    receiverAddress: tujuanC,
                },
            ],
        });

        await client.create({
            _id: doItemAId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Barang Mixed Revision A',
            orderItemQtyKoli: 6,
            orderItemWeight: 180,
            actualQtyKoli: 6,
            actualWeightKg: 180,
            shipperReferenceNumber: sjA,
        });
        await client.create({
            _id: doItemBId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Barang Mixed Revision B',
            orderItemQtyKoli: 4,
            orderItemWeight: 120,
            actualQtyKoli: 4,
            actualWeightKg: 120,
            shipperReferenceNumber: sjB,
        });
        await client.create({
            _id: doItemCId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Barang Mixed Revision C',
            orderItemQtyKoli: 5,
            orderItemWeight: 150,
            actualQtyKoli: 5,
            actualWeightKg: 150,
            shipperReferenceNumber: sjC,
        });

        const deliveryOrder = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doId }
        );
        const deliveryOrderItems = await client.fetch<DeliveryOrderItem[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]`,
            { id: doId }
        );
        assert(deliveryOrder, 'DO audit mixed revision tidak ditemukan.');

        const notaRows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder,
            orders: [],
            deliveryOrderItems,
        }).map(row => ({
            ...row,
            tarip: 132,
            ket: `Audit mixed revision ${row.noSJ}`,
        }));

        assert(notaRows.length === 3, 'DO audit mixed revision harus membentuk tepat 3 row nota per SJ.');
        const rowA = notaRows.find(row => row.noSJ === sjA);
        const rowB = notaRows.find(row => row.noSJ === sjB);
        const rowC = notaRows.find(row => row.noSJ === sjC);
        assert(rowA && rowB && rowC, 'Row nota mixed revision tidak lengkap per SJ.');
        assert(rowA.customerRef === 'cust-001', 'Row SJ A tidak membaca billing customer cust-001.');
        assert(rowB.customerRef === 'cust-002', 'Row SJ B tidak membaca billing customer cust-002.');
        assert(rowC.customerRef === 'cust-001', 'Row SJ C tidak membaca billing customer cust-001.');

        const notaCust1Create = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-CUST1`,
                rows: [rowA],
            },
            noopAuditLog
        );
        const notaCust1Json = await parseResponse(notaCust1Create);
        const notaCust1Id = notaCust1Json?.id || notaCust1Json?.data?._id;
        assert(typeof notaCust1Id === 'string' && notaCust1Id.length > 0, 'Nota cust-001 awal tidak berhasil dibuat.');
        createdNotaIds.add(notaCust1Id);

        const notaCust2Create = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-002',
                customerName: 'CV Sinar Logam',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-CUST2`,
                rows: [rowB],
            },
            noopAuditLog
        );
        const notaCust2Json = await parseResponse(notaCust2Create);
        const notaCust2Id = notaCust2Json?.id || notaCust2Json?.data?._id;
        assert(typeof notaCust2Id === 'string' && notaCust2Id.length > 0, 'Nota cust-002 tidak berhasil dibuat.');
        createdNotaIds.add(notaCust2Id);

        const duplicateB = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-002',
                customerName: 'CV Sinar Logam',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-CUST2-DUP`,
                rows: [rowB],
            },
            noopAuditLog
        );
        await expectConflict(duplicateB, 'sudah tertagih');

        const reviseCust1 = await handleFreightNotaUpdate(
            ownerSession,
            {
                id: notaCust1Id,
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-CUST1-REVISED`,
                rows: [rowC],
            },
            noopAuditLog
        );
        await parseResponse(reviseCust1);

        const notaCust1Items = await client.fetch<Array<{ noSJ?: string }>>(
            `*[_type == "freightNotaItem" && notaRef == $id]{ noSJ }`,
            { id: notaCust1Id }
        );
        assert(
            notaCust1Items.length === 1 && notaCust1Items[0]?.noSJ === sjC,
            'Revisi nota cust-001 tidak memindahkan coverage dari SJ A ke SJ C secara bersih.'
        );

        const releasedACreate = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-A-RELEASED`,
                rows: [rowA],
            },
            noopAuditLog
        );
        const releasedAJson = await parseResponse(releasedACreate);
        const releasedAId = releasedAJson?.id || releasedAJson?.data?._id;
        assert(typeof releasedAId === 'string' && releasedAId.length > 0, 'SJ A tidak kembali available setelah revisi nota cust-001.');
        createdNotaIds.add(releasedAId);

        const duplicateCAfterRevise = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-C-DUP`,
                rows: [rowC],
            },
            noopAuditLog
        );
        await expectConflict(duplicateCAfterRevise, 'sudah tertagih');

        const duplicateBAfterRevise = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-002',
                customerName: 'CV Sinar Logam',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-B-DUP-AFTER-REVISE`,
                rows: [rowB],
            },
            noopAuditLog
        );
        await expectConflict(duplicateBAfterRevise, 'sudah tertagih');

        const deleteCust1 = await handleFreightNotaDelete(
            ownerSession,
            { id: notaCust1Id },
            noopAuditLog
        );
        await parseResponse(deleteCust1);
        createdNotaIds.delete(notaCust1Id);

        const releasedCCreate = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-C-RELEASED`,
                rows: [rowC],
            },
            noopAuditLog
        );
        const releasedCJson = await parseResponse(releasedCCreate);
        const releasedCId = releasedCJson?.id || releasedCJson?.data?._id;
        assert(typeof releasedCId === 'string' && releasedCId.length > 0, 'SJ C tidak kembali available setelah delete nota cust-001.');
        createdNotaIds.add(releasedCId);

        const duplicateBWhileCust1Deleted = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-002',
                customerName: 'CV Sinar Logam',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-B-STILL-LOCKED`,
                rows: [rowB],
            },
            noopAuditLog
        );
        await expectConflict(duplicateBWhileCust1Deleted, 'sudah tertagih');

        const deleteCust2 = await handleFreightNotaDelete(
            ownerSession,
            { id: notaCust2Id },
            noopAuditLog
        );
        await parseResponse(deleteCust2);
        createdNotaIds.delete(notaCust2Id);

        const releasedBCreate = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-002',
                customerName: 'CV Sinar Logam',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-B-RELEASED`,
                rows: [rowB],
            },
            noopAuditLog
        );
        const releasedBJson = await parseResponse(releasedBCreate);
        const releasedBId = releasedBJson?.id || releasedBJson?.data?._id;
        assert(typeof releasedBId === 'string' && releasedBId.length > 0, 'SJ B tidak kembali available setelah delete nota cust-002.');
        createdNotaIds.add(releasedBId);

        console.log('Audit Runtime Mixed Billing Nota Revision / Delete');
        console.log(`Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
        console.log('');
        console.log('Semua langkah runtime mutation: OK');
        console.log(`- DO audit: ${doId}`);
        console.log(`- SJ audit: ${sjA}, ${sjB}, ${sjC}`);
        console.log('- Revisi nota customer A memindahkan coverage dari SJ A ke SJ C');
        console.log('- SJ A kembali available tanpa mempengaruhi lock SJ B milik customer lain');
        console.log('- Delete nota customer A melepas SJ C tanpa mempengaruhi lock SJ B');
        console.log('- Delete nota customer B melepas SJ B secara independen');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
        await restoreCompanyNumbering(companySnapshot).catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime mixed billing nota revision flow gagal:', error);
    process.exitCode = 1;
});
