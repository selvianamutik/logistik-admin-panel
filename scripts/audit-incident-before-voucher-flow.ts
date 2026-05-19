import { loadScriptEnv } from './_env';

loadScriptEnv();

import { handleDriverVoucherCreate } from '../src/lib/api/driver-workflows';
import { handleExpenseCreate } from '../src/lib/api/finance-workflows';
import { syncPostedIncidentSettlementLinesToDriverVoucher } from '../src/lib/api/incident-voucher-linking';
import {
    createDocument,
    deleteDocument,
    getDocumentById,
    listDocumentsByFilter,
} from '../src/lib/repositories/document-store';
import type {
    DriverVoucher,
    DriverVoucherItem,
    Expense,
    IncidentSettlementLine,
    JournalEntry,
    JournalLine,
} from '../src/lib/types';

const AUDIT_DATE = '2026-05-19';
const suffix = Date.now().toString(36);
const createdDirectDocs: Array<[string, string]> = [];

type ApiPayload<T> = {
    data?: T;
    id?: string;
    error?: string;
};

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

async function auditStep(label: string) {
    console.log(`[audit-incident-before-voucher] ${label}`);
}

async function addDoc(docType: string, doc: { _id: string; _type: string; [key: string]: unknown }) {
    await createDocument(doc);
    createdDirectDocs.push([docType, doc._id]);
}

async function readResponse<T>(
    response: Response | undefined,
    options: { expectStatus?: number; label: string }
): Promise<ApiPayload<T>> {
    assert(response, `${options.label} tidak mengembalikan response`);
    const body = await response.text();
    const parsed = body ? JSON.parse(body) as ApiPayload<T> : {};
    if (options.expectStatus !== undefined) {
        assert(
            response.status === options.expectStatus,
            `${options.label} expected ${options.expectStatus}, got ${response.status}: ${body}`
        );
        return parsed;
    }
    if (!response.ok) {
        throw new Error(`${options.label} ${response.status}: ${body}`);
    }
    return parsed;
}

async function deleteRows(docType: string, rows: Array<{ _id: string }>) {
    for (const row of rows) {
        await deleteDocument(row._id, docType).catch(() => undefined);
    }
}

async function cleanupWorkflow(voucherId?: string, expenseId?: string, incidentId?: string) {
    if (voucherId) {
        const [items, disbursements, transactions, journalEntries] = await Promise.all([
            listDocumentsByFilter<DriverVoucherItem>('driverVoucherItem', { voucherRef: voucherId }).catch(() => []),
            listDocumentsByFilter<{ _id: string }>('driverVoucherDisbursement', { voucherRef: voucherId }).catch(() => []),
            listDocumentsByFilter<{ _id: string }>('bankTransaction', { relatedVoucherRef: voucherId }).catch(() => []),
            listDocumentsByFilter<JournalEntry>('journalEntry', { sourceRef: voucherId }).catch(() => []),
        ]);
        const journalLines = (await Promise.all(journalEntries.map(entry =>
            listDocumentsByFilter<JournalLine>('journalLine', { journalEntryRef: entry._id }).catch(() => [])
        ))).flat();
        await deleteRows('journalLine', journalLines);
        await deleteRows('journalEntry', journalEntries);
        await deleteRows('bankTransaction', transactions);
        await deleteRows('driverVoucherDisbursement', disbursements);
        await deleteRows('driverVoucherItem', items);
        await deleteDocument(voucherId, 'driverVoucher').catch(() => undefined);
    }
    if (expenseId) {
        const journalEntries = await listDocumentsByFilter<JournalEntry>('journalEntry', { sourceRef: expenseId }).catch(() => []);
        const journalLines = (await Promise.all(journalEntries.map(entry =>
            listDocumentsByFilter<JournalLine>('journalLine', { journalEntryRef: entry._id }).catch(() => [])
        ))).flat();
        await deleteRows('journalLine', journalLines);
        await deleteRows('journalEntry', journalEntries);
        await deleteDocument(expenseId, 'expense').catch(() => undefined);
    }
    if (incidentId) {
        const logs = await listDocumentsByFilter<{ _id: string }>('incidentActionLog', { incidentRef: incidentId }).catch(() => []);
        await deleteRows('incidentActionLog', logs);
    }
    for (const [docType, id] of createdDirectDocs.reverse()) {
        await deleteDocument(id, docType).catch(() => undefined);
    }
}

async function main() {
    let voucherId: string | undefined;
    let expenseId: string | undefined;
    const driverId = `audit-driver-before-voucher-${suffix}`;
    const vehicleId = `audit-vehicle-before-voucher-${suffix}`;
    const bankId = `audit-bank-before-voucher-${suffix}`;
    const categoryId = `audit-expense-category-before-voucher-${suffix}`;
    const orderId = `audit-order-before-voucher-${suffix}`;
    const deliveryOrderId = `audit-do-before-voucher-${suffix}`;
    const incidentId = `audit-incident-before-voucher-${suffix}`;
    const lineId = `audit-line-before-voucher-${suffix}`;

    try {
        await auditStep('menyiapkan DO tanpa bon, incident, dan biaya APPROVED');
        const [customer] = await listDocumentsByFilter<{
            _id: string;
            name?: string;
            active?: boolean;
        }>('customer', { active: true });
        const [service] = await listDocumentsByFilter<{
            _id: string;
            name?: string;
            active?: boolean;
        }>('service', { active: true });
        const [ownerUser] = await listDocumentsByFilter<{
            _id: string;
            name?: string;
            role?: string;
        }>('user', { role: 'OWNER' });
        assert(customer?._id, 'audit membutuhkan minimal satu customer aktif');
        assert(service?._id, 'audit membutuhkan minimal satu service aktif');
        assert(ownerUser?._id, 'audit membutuhkan minimal satu user OWNER untuk foreign key approval/posting');
        const session = {
            _id: ownerUser._id,
            name: ownerUser.name || 'Audit Incident Voucher',
            role: 'OWNER',
        };
        await addDoc('driver', {
            _id: driverId,
            _type: 'driver',
            name: 'Audit Driver Before Voucher',
            phone: '0800000000',
            licenseNumber: `SIM-${suffix}`,
            active: true,
        });
        await addDoc('vehicle', {
            _id: vehicleId,
            _type: 'vehicle',
            unitCode: `AUD-${suffix}`,
            plateNumber: `AUD ${suffix.toUpperCase()}`,
            vehicleType: 'Box',
            brandModel: 'Audit',
            active: true,
            status: 'ACTIVE',
        });
        await addDoc('bankAccount', {
            _id: bankId,
            _type: 'bankAccount',
            bankName: 'Audit Bank',
            accountNumber: `100${suffix}`,
            accountHolder: 'Audit',
            accountType: 'BANK',
            initialBalance: 10000000,
            currentBalance: 10000000,
            active: true,
        });
        await addDoc('expenseCategory', {
            _id: categoryId,
            _type: 'expenseCategory',
            name: `Audit Incident Trip ${suffix}`,
            scope: 'INCIDENT',
            accountSystemKey: 'incident_expense',
            active: true,
        });
        await addDoc('order', {
            _id: orderId,
            _type: 'order',
            masterResi: `AUD-RESI-${suffix}`,
            cargoEntryMode: 'DELIVERY_ORDER',
            customerRef: customer._id,
            customerName: customer.name || 'Audit Customer',
            receiverName: 'Audit Receiver',
            receiverPhone: '0800000001',
            receiverAddress: 'Audit Drop',
            pickupAddress: 'Audit Pickup',
            serviceRef: service._id,
            serviceName: service.name || 'Audit Service',
            status: 'OPEN',
            createdAt: AUDIT_DATE,
        });
        await addDoc('deliveryOrder', {
            _id: deliveryOrderId,
            _type: 'deliveryOrder',
            doNumber: `AUD-DO-${suffix}`,
            orderRef: orderId,
            masterResi: `AUD-RESI-${suffix}`,
            customerRef: customer._id,
            customerName: customer.name || 'Audit Customer',
            date: AUDIT_DATE,
            status: 'CREATED',
            driverRef: driverId,
            driverName: 'Audit Driver Before Voucher',
            vehicleRef: vehicleId,
            vehiclePlate: `AUD ${suffix.toUpperCase()}`,
            pickupAddress: 'Audit Pickup',
            receiverName: 'Audit Receiver',
            receiverPhone: '0800000001',
            receiverAddress: 'Audit Drop',
            serviceRef: service._id,
            serviceName: service.name || 'Audit Service',
            taripBorongan: 150000,
        });
        await addDoc('incident', {
            _id: incidentId,
            _type: 'incident',
            incidentNumber: `AUD-INC-${suffix}`,
            status: 'IN_PROGRESS',
            incidentType: 'ENGINE_TROUBLE',
            urgency: 'MEDIUM',
            dateTime: `${AUDIT_DATE}T08:00:00.000Z`,
            vehicleRef: vehicleId,
            vehiclePlate: `AUD ${suffix.toUpperCase()}`,
            driverRef: driverId,
            driverName: 'Audit Driver Before Voucher',
            relatedDeliveryOrderRef: deliveryOrderId,
            relatedDONumber: `AUD-DO-${suffix}`,
            locationText: 'Audit incident location',
            odometer: 12345,
            description: 'Audit incident sebelum bon',
            attachmentUrls: [],
        });
        await addDoc('incidentSettlementLine', {
            _id: lineId,
            _type: 'incidentSettlementLine',
            incidentRef: incidentId,
            incidentNumber: `AUD-INC-${suffix}`,
            lineType: 'COST',
            category: 'TOWING',
            date: AUDIT_DATE,
            amount: 125000,
            description: 'Audit towing sebelum bon',
            status: 'APPROVED',
            note: 'Diajukan driver, perlu review admin',
        });

        await auditStep('posting biaya incident dengan rekening sebelum bon harus ditolak');
        const blockedExpense = await readResponse<Expense>(
            await handleExpenseCreate(session as never, {
                date: AUDIT_DATE,
                categoryRef: categoryId,
                amount: 125000,
                relatedIncidentRef: incidentId,
                relatedIncidentSettlementLineRef: lineId,
                relatedIncidentSettlementLineRevision: 'audit-revision',
                bankAccountRef: bankId,
                description: 'Audit biaya bank sebelum bon',
                privacyLevel: 'internal',
            }, async () => undefined),
            { expectStatus: 409, label: 'blocked pre-voucher bank expense' }
        );
        assert(/Bon trip belum terbit/i.test(blockedExpense.error || ''), 'posting bank sebelum bon tidak memberi guard yang jelas');

        await auditStep('posting biaya incident tanpa rekening menjadi deferred expense');
        const expensePayload = await readResponse<Expense>(
            await handleExpenseCreate(session as never, {
                date: AUDIT_DATE,
                categoryRef: categoryId,
                amount: 125000,
                relatedIncidentRef: incidentId,
                relatedIncidentSettlementLineRef: lineId,
                relatedIncidentSettlementLineRevision: 'audit-revision',
                description: 'Audit biaya deferred sebelum bon',
                privacyLevel: 'internal',
            }, async () => undefined),
            { label: 'deferred incident expense' }
        );
        expenseId = expensePayload.data?._id || expensePayload.id;
        assert(expenseId, 'expense deferred tidak dibuat');
        assert(!expensePayload.data?.bankAccountRef, 'expense deferred tidak boleh punya rekening bank');

        const postedLine = await getDocumentById<IncidentSettlementLine>(lineId, 'incidentSettlementLine');
        assert(postedLine?.status === 'POSTED', 'settlement line tidak menjadi POSTED');
        assert(postedLine.linkedExpenseRef === expenseId, 'settlement line tidak link ke expense deferred');
        assert(!postedLine.linkedDriverVoucherItemRef, 'settlement line tidak boleh punya voucher item sebelum bon dibuat');
        const deferredExpenseJournals = await listDocumentsByFilter<JournalEntry>('journalEntry', { sourceRef: expenseId });
        assert(deferredExpenseJournals.length === 0, 'deferred incident expense tidak boleh membuat jurnal expense mandiri');

        await auditStep('menerbitkan bon harus otomatis menarik biaya incident ke biaya lain-lain');
        const voucherPayload = await readResponse<DriverVoucher>(
            await handleDriverVoucherCreate(session, {
                deliveryOrderRef: deliveryOrderId,
                issueBankRef: bankId,
                issuedDate: AUDIT_DATE,
                cashGiven: 500000,
            }, async () => undefined),
            { label: 'driver voucher create with deferred incident expense' }
        );
        voucherId = voucherPayload.data?._id || voucherPayload.id;
        assert(voucherId, 'bon tidak dibuat');

        const lineAfterVoucher = await getDocumentById<IncidentSettlementLine>(lineId, 'incidentSettlementLine');
        assert(lineAfterVoucher?.linkedDriverVoucherItemRef, 'settlement line POSTED tidak otomatis link ke item uang jalan');
        const voucherItem = await getDocumentById<DriverVoucherItem>(lineAfterVoucher.linkedDriverVoucherItemRef, 'driverVoucherItem');
        assert(voucherItem?.voucherRef === voucherId, 'voucher item incident tidak mengarah ke bon baru');
        assert(voucherItem.amount === 125000, 'nominal voucher item incident mismatch');
        assert(voucherItem.relatedIncidentSettlementLineRef === lineId, 'voucher item tidak link settlement line');
        assert(voucherItem.linkedExpenseRef === expenseId, 'voucher item tidak link expense deferred');

        const expenseAfterVoucher = await getDocumentById<Expense>(expenseId, 'expense');
        assert(expenseAfterVoucher?.voucherRef === voucherId, 'expense deferred tidak ikut tertaut ke voucher');
        const voucherAfterSync = await getDocumentById<DriverVoucher>(voucherId, 'driverVoucher');
        assert(voucherAfterSync?.totalSpent === 125000, 'totalSpent bon tidak memasukkan biaya incident');
        assert(voucherAfterSync.totalClaimAmount === 275000, 'totalClaimAmount bon tidak sesuai biaya incident + upah driver');
        assert(voucherAfterSync.balance === 225000, 'balance bon tidak sesuai setelah biaya incident masuk');

        await auditStep('sync ulang harus idempotent dan tidak membuat item dobel');
        const itemsBefore = await listDocumentsByFilter<DriverVoucherItem>('driverVoucherItem', { voucherRef: voucherId });
        await syncPostedIncidentSettlementLinesToDriverVoucher({
            voucher: voucherAfterSync,
            deliveryOrderRef: deliveryOrderId,
            issueDate: AUDIT_DATE,
        });
        const itemsAfter = await listDocumentsByFilter<DriverVoucherItem>('driverVoucherItem', { voucherRef: voucherId });
        assert(itemsAfter.length === itemsBefore.length, 'sync ulang membuat voucher item dobel');

        console.log('[audit-incident-before-voucher] PASS');
    } finally {
        await cleanupWorkflow(voucherId, expenseId, incidentId);
    }
}

main().catch(error => {
    console.error('[audit-incident-before-voucher] FAIL');
    console.error(error);
    process.exit(1);
});
