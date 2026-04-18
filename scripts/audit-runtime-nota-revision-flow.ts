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

type BankAccountSnapshot = {
    _id: string;
    currentBalance?: number;
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

async function parseResponse(response: Response) {
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
        const error = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
        throw new Error(error);
    }
    return payload;
}

async function expectResponseStatus(response: Response, expectedStatus: number, containsText?: string) {
    const payload = await parseJsonSafe(response);
    if (response.status !== expectedStatus) {
        throw new Error(
            `Expected HTTP ${expectedStatus}, got ${response.status}: ${typeof payload?.error === 'string' ? payload.error : 'Tanpa pesan error'}`
        );
    }
    if (containsText && typeof payload?.error === 'string' && !payload.error.includes(containsText)) {
        throw new Error(`Expected error to contain "${containsText}", got "${payload.error}"`);
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

async function restoreBankBalance(snapshot: BankAccountSnapshot | null) {
    if (!snapshot?._id) {
        return;
    }
    const current = await client.fetch<{ _id: string; _rev?: string } | null>(
        `*[_type == "bankAccount" && _id == $id][0]{ _id, _rev }`,
        { id: snapshot._id }
    );
    if (!current?._id || !current._rev) {
        return;
    }
    await client
        .patch(current._id)
        .ifRevisionId(current._rev)
        .set({ currentBalance: snapshot.currentBalance || 0 })
        .commit();
}

async function cleanupAuditArtifacts() {
    const doIds = await client.fetch<string[]>(
        `*[_type == "deliveryOrder" && doNumber match "DO-AUDIT-NOTA-*"]._id`
    );
    const doItemIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const notaIds = await client.fetch<string[]>(
        `*[_type == "freightNota" && notes match "AUDIT-RUNTIME-NOTA-*"]._id`
    );
    const notaItemIds = notaIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "freightNotaItem" && notaRef in $ids]._id`,
            { ids: notaIds }
        )
        : [];
    const paymentIds = notaIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "payment" && invoiceRef in $ids]._id`,
            { ids: notaIds }
        )
        : [];
    const incomeIds = paymentIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "income" && paymentRef in $ids]._id`,
            { ids: paymentIds }
        )
        : [];
    const bankTransactionIds = paymentIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "bankTransaction" && relatedPaymentRef in $ids]._id`,
            { ids: paymentIds }
        )
        : [];
    const refundIds = notaIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "customerOverpaymentRefund" && sourceType == "INVOICE_OVERPAID" && sourceInvoiceRef in $ids]._id`,
            { ids: notaIds }
        )
        : [];
    const adjustmentIds = notaIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "invoiceAdjustment" && invoiceRef in $ids]._id`,
            { ids: notaIds }
        )
        : [];

    await deleteDocumentsByIds([
        ...bankTransactionIds,
        ...incomeIds,
        ...paymentIds,
        ...refundIds,
        ...adjustmentIds,
        ...notaItemIds,
        ...notaIds,
        ...doItemIds,
        ...doIds,
    ]);
}

async function main() {
    const { getSanityClient } = await import('../src/lib/sanity');
    const { getBusinessDateValue } = await import('../src/lib/business-date');
    const { buildNotaRowsFromDeliveryOrder } = await import('../src/lib/invoice-create-page-support');
    const { handleFreightNotaCreate, handleFreightNotaDelete, handleFreightNotaUpdate, handlePaymentCreate } = await import('../src/lib/api/finance-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const issueDate = getBusinessDateValue();
    const doId = `audit-do-nota-${uniqueSeed.toLowerCase()}`;
    const doItemAId = `audit-doi-nota-a-${uniqueSeed.toLowerCase()}`;
    const doItemBId = `audit-doi-nota-b-${uniqueSeed.toLowerCase()}`;
    const shipperRefA = `AUDIT-NOTA-SJ-A-${uniqueSeed}`;
    const shipperRefB = `AUDIT-NOTA-SJ-B-${uniqueSeed}`;
    const notaAuditPrefix = `AUDIT-RUNTIME-NOTA-${uniqueSeed}`;

    const companySnapshot = await client.fetch<CompanyNumberingSnapshot | null>(
        `*[_type == "companyProfile"][0]{ _id, numberingSettings }`
    );
    const bankSnapshot = await client.fetch<BankAccountSnapshot | null>(
        `*[_type == "bankAccount" && _id == "bank-jatim-001"][0]{ _id, currentBalance }`
    );

    const createdNotaIds = new Set<string>();

    try {
        await client.create({
            _id: doId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-NOTA-${uniqueSeed}`,
            masterResi: `AUDIT-NOTA-RESI-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: issueDate,
            status: 'DELIVERED',
            pickupAddress: 'Gudang Audit Nota - Gresik',
            receiverCompany: 'Distribusi Audit Nota',
            receiverName: 'Penerima Audit Nota',
            receiverAddress: 'Jl. Header Audit Nota, Surabaya',
            vehicleRef: 'veh-002',
            vehiclePlate: 'L 9456 AB',
            driverRef: 'drv-002',
            driverName: 'Budi Hartono',
            customerDoNumber: shipperRefA,
            podReceiverName: 'Penerima Audit Nota',
            podReceivedDate: issueDate,
            actualDropPoints: [
                {
                    _key: `drop-${uniqueSeed.toLowerCase()}`,
                    stopType: 'DROP',
                    locationName: 'Distribusi Audit Nota A',
                    locationAddress: 'Jl. Audit Nota A, Surabaya',
                    qtyKoli: 7,
                    weightKg: 210,
                },
                {
                    _key: `drop2-${uniqueSeed.toLowerCase()}`,
                    stopType: 'DROP',
                    locationName: 'Distribusi Audit Nota B',
                    locationAddress: 'Jl. Audit Nota B, Sidoarjo',
                    qtyKoli: 5,
                    weightKg: 140,
                },
            ],
            shipperReferences: [
                {
                    _key: `shipref-a-${uniqueSeed.toLowerCase()}`,
                    sequence: 1,
                    referenceNumber: shipperRefA,
                    pickupAddress: 'Gudang Audit Nota - Gresik',
                    billingCustomerRef: 'cust-001',
                    billingCustomerName: 'PT Pangan Nusantara',
                    receiverCompany: 'Distribusi Audit Nota A',
                    receiverName: 'Penerima Audit Nota A',
                    receiverAddress: 'Jl. Audit Nota A, Surabaya',
                },
                {
                    _key: `shipref-b-${uniqueSeed.toLowerCase()}`,
                    sequence: 2,
                    referenceNumber: shipperRefB,
                    pickupAddress: 'Gudang Audit Nota - Gresik',
                    billingCustomerRef: 'cust-001',
                    billingCustomerName: 'PT Pangan Nusantara',
                    receiverCompany: 'Distribusi Audit Nota B',
                    receiverName: 'Penerima Audit Nota B',
                    receiverAddress: 'Jl. Audit Nota B, Sidoarjo',
                },
            ],
        });

        await client.create({
            _id: doItemAId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Keramik Audit A',
            orderItemQtyKoli: 7,
            orderItemWeight: 210,
            actualQtyKoli: 7,
            actualWeightKg: 210,
            shippedQtyKoli: 7,
            shippedWeight: 210,
            shipperReferenceNumber: shipperRefA,
        });
        await client.create({
            _id: doItemBId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Keramik Audit B',
            orderItemQtyKoli: 5,
            orderItemWeight: 140,
            actualQtyKoli: 5,
            actualWeightKg: 140,
            shippedQtyKoli: 5,
            shippedWeight: 140,
            shipperReferenceNumber: shipperRefB,
        });

        const deliveryOrder = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doId }
        );
        const deliveryOrderItems = await client.fetch<DeliveryOrderItem[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]`,
            { id: doId }
        );

        assert(deliveryOrder, 'DO audit nota tidak ditemukan setelah create.');
        const notaRows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder,
            orders: [],
            deliveryOrderItems,
        }).map(row => ({
            ...row,
            tarip: 132,
            ket: 'Audit runtime nota revision flow',
        }));

        assert(notaRows.length === 2, 'DO audit nota harus membentuk tepat 2 row SJ.');
        const rowA = notaRows.find(row => row.noSJ === shipperRefA);
        const rowB = notaRows.find(row => row.noSJ === shipperRefB);
        assert(rowA, 'Row SJ A tidak terbentuk.');
        assert(rowB, 'Row SJ B tidak terbentuk.');

        const mainCreate = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaAuditPrefix} MAIN`,
                rows: [rowA],
            },
            noopAuditLog
        );
        const mainCreateJson = await parseResponse(mainCreate);
        const mainNotaId = mainCreateJson?.id || mainCreateJson?.data?._id;
        assert(typeof mainNotaId === 'string' && mainNotaId.length > 0, 'Nota utama audit tidak berhasil dibuat.');
        createdNotaIds.add(mainNotaId);

        let mainNotaItems = await client.fetch<Array<{ noSJ?: string }>>(
            `*[_type == "freightNotaItem" && notaRef == $id]{ noSJ }`,
            { id: mainNotaId }
        );
        assert(mainNotaItems.length === 1 && mainNotaItems[0]?.noSJ === shipperRefA, 'Nota utama awal tidak mengunci SJ A dengan benar.');

        const reviseMain = await handleFreightNotaUpdate(
            ownerSession,
            {
                id: mainNotaId,
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaAuditPrefix} MAIN REVISED`,
                rows: [rowB],
            },
            noopAuditLog
        );
        await parseResponse(reviseMain);

        mainNotaItems = await client.fetch<Array<{ noSJ?: string }>>(
            `*[_type == "freightNotaItem" && notaRef == $id]{ noSJ }`,
            { id: mainNotaId }
        );
        assert(mainNotaItems.length === 1 && mainNotaItems[0]?.noSJ === shipperRefB, 'Revisi nota tidak mengganti coverage ke SJ B secara bersih.');

        const duplicateCreate = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaAuditPrefix} DUPLICATE`,
                rows: [rowB],
            },
            noopAuditLog
        );
        await expectResponseStatus(duplicateCreate, 409, 'sudah tertagih');

        const releasedCreate = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaAuditPrefix} RELEASED`,
                rows: [rowA],
            },
            noopAuditLog
        );
        const releasedCreateJson = await parseResponse(releasedCreate);
        const releasedNotaId = releasedCreateJson?.id || releasedCreateJson?.data?._id;
        assert(typeof releasedNotaId === 'string' && releasedNotaId.length > 0, 'SJ A tidak kembali available setelah revisi nota utama.');
        createdNotaIds.add(releasedNotaId);

        const deleteReleased = await handleFreightNotaDelete(
            ownerSession,
            { id: releasedNotaId },
            noopAuditLog
        );
        await parseResponse(deleteReleased);
        createdNotaIds.delete(releasedNotaId);

        const paymentCreate = await handlePaymentCreate(
            ownerSession,
            {
                invoiceRef: mainNotaId,
                date: issueDate,
                amount: 10_000,
                method: 'TRANSFER',
                bankAccountRef: 'bank-jatim-001',
                note: `${notaAuditPrefix} PAYMENT`,
            },
            noopAuditLog
        );
        assert(paymentCreate instanceof Response, 'Handler payment create tidak mengembalikan response.');
        await parseResponse(paymentCreate);

        const reviseAfterPayment = await handleFreightNotaUpdate(
            ownerSession,
            {
                id: mainNotaId,
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaAuditPrefix} MAIN AFTER PAYMENT`,
                rows: [rowA],
            },
            noopAuditLog
        );
        await expectResponseStatus(reviseAfterPayment, 409, 'tidak bisa direvisi');

        const deleteAfterPayment = await handleFreightNotaDelete(
            ownerSession,
            { id: mainNotaId },
            noopAuditLog
        );
        await expectResponseStatus(deleteAfterPayment, 409, 'tidak boleh dihapus');

        const refundCreate = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaAuditPrefix} REFUND`,
                rows: [rowA],
            },
            noopAuditLog
        );
        const refundCreateJson = await parseResponse(refundCreate);
        const refundNotaId = refundCreateJson?.id || refundCreateJson?.data?._id;
        assert(typeof refundNotaId === 'string' && refundNotaId.length > 0, 'Nota refund audit tidak berhasil dibuat.');
        createdNotaIds.add(refundNotaId);

        await client.create({
            _id: `audit-refund-${uniqueSeed.toLowerCase()}`,
            _type: 'customerOverpaymentRefund',
            sourceType: 'INVOICE_OVERPAID',
            sourceInvoiceRef: refundNotaId,
            sourceInvoiceNumber: 'AUDIT-RUNTIME-REFUND',
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: issueDate,
            amount: 5_000,
            bankAccountRef: 'bank-jatim-001',
            bankAccountName: 'Bank Jatim',
            bankAccountNumber: '0201200300400',
            note: `${notaAuditPrefix} REFUND DOC`,
            createdBy: ownerSession._id,
            createdByName: ownerSession.name,
        });

        const reviseAfterRefund = await handleFreightNotaUpdate(
            ownerSession,
            {
                id: refundNotaId,
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaAuditPrefix} REFUND REVISE`,
                rows: [rowB],
            },
            noopAuditLog
        );
        await expectResponseStatus(reviseAfterRefund, 409, 'tidak bisa direvisi');

        const deleteAfterRefund = await handleFreightNotaDelete(
            ownerSession,
            { id: refundNotaId },
            noopAuditLog
        );
        await expectResponseStatus(deleteAfterRefund, 409, 'tidak boleh dihapus');

        console.log('Audit Runtime Nota Revision / Delete / Finance Lock');
        console.log(`Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
        console.log('');
        console.log('Semua langkah runtime mutation: OK');
        console.log(`- DO audit: ${doId}`);
        console.log(`- SJ audit: ${shipperRefA}, ${shipperRefB}`);
        console.log('- Revisi nota memindahkan coverage dari SJ A ke SJ B');
        console.log('- SJ lama kembali available dan bisa ditagihkan ulang');
        console.log('- SJ aktif tetap terkunci dari duplikasi nota');
        console.log('- Nota terkunci untuk revisi/hapus setelah pembayaran');
        console.log('- Nota terkunci untuk revisi/hapus setelah refund invoice-overpaid');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
        await restoreBankBalance(bankSnapshot).catch(() => undefined);
        await restoreCompanyNumbering(companySnapshot).catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime nota revision flow gagal:', error);
    process.exitCode = 1;
});
