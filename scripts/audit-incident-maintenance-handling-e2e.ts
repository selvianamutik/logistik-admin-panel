import { loadScriptEnv } from './_env';

loadScriptEnv();
process.env.OPERATIONAL_ADMIN_WHATSAPP_DRY_RUN ??= 'true';
process.env.GREEN_API_DRY_RUN ??= 'true';
process.env.CALLMEBOT_DRY_RUN ??= 'true';

import { handleIncidentMaintenanceHandlingCreate } from '../src/lib/api/operations-workflows';
import {
    createDocument,
    deleteDocument,
    getDocumentById,
    listDocumentsByFilter,
} from '../src/lib/repositories/document-store';
import type {
    Incident,
    IncidentActionLog,
    IncidentSettlementLine,
    Expense,
    ExpenseCategory,
    JournalEntry,
    JournalLine,
    Maintenance,
    StockMovement,
    User,
    WarehouseItem,
} from '../src/lib/types';

type ApiPayload<T> = {
    data?: T;
    maintenanceRef?: string;
    stockMovementRefs?: string[];
    settlementLine?: IncidentSettlementLine;
    error?: string;
};

const AUDIT_DATE = '2026-06-03';
const suffix = Date.now().toString(36);
const incidentId = `audit-incident-maint-handling-${suffix}`;
const incidentNumber = `AUD-INC-MH-${suffix.toUpperCase()}`;
const vehicleId = `audit-vehicle-maint-handling-${suffix}`;
const vehiclePlate = `AUD MH ${suffix.toUpperCase()}`;
const expenseCategoryId = `audit-expense-category-maint-handling-${suffix}`;
const sourceNumber = `${incidentNumber} - ${vehiclePlate}`;
const createdDirectDocs: Array<[string, string]> = [];
const createdMaintenanceIds = new Set<string>();

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function log(message: string) {
    console.log(`[audit:incident-maintenance-handling-e2e] ${message}`);
}

async function addDoc<T extends { _id: string; _type: string }>(docType: string, doc: T) {
    const created = await createDocument<T>(doc as unknown as { _type: string; [key: string]: unknown });
    createdDirectDocs.push([docType, doc._id]);
    return created;
}

async function readResponse<T>(
    response: Response,
    options: { label: string; expectStatus?: number } = { label: 'response' },
) {
    const bodyText = await response.text();
    const parsed = bodyText ? JSON.parse(bodyText) as ApiPayload<T> : {};
    if (options.expectStatus !== undefined) {
        assert(
            response.status === options.expectStatus,
            `${options.label} expected ${options.expectStatus}, got ${response.status}: ${bodyText}`,
        );
        return parsed;
    }
    if (!response.ok) {
        throw new Error(`${options.label} failed ${response.status}: ${bodyText}`);
    }
    if (parsed.maintenanceRef) {
        createdMaintenanceIds.add(parsed.maintenanceRef);
    }
    return parsed;
}

async function noopAuditLog() {
    return undefined;
}

async function getOwnerSession() {
    const [owner] = await listDocumentsByFilter<Pick<User, '_id' | 'name' | 'role'>>('user', { role: 'OWNER' });
    assert(owner?._id, 'audit membutuhkan user OWNER');
    return {
        _id: owner._id,
        name: owner.name || 'Audit Owner',
        role: 'OWNER' as User['role'],
    };
}

async function loadIncident() {
    const incident = await getDocumentById<Incident>(incidentId, 'incident');
    assert(incident?._id, 'incident audit tidak ditemukan');
    return incident;
}

async function loadLine(lineId: string) {
    const line = await getDocumentById<IncidentSettlementLine>(lineId, 'incidentSettlementLine');
    assert(line?._id, `line ${lineId} tidak ditemukan`);
    return line;
}

async function loadWarehouseItem(itemId: string) {
    const item = await getDocumentById<WarehouseItem>(itemId, 'warehouseItem');
    assert(item?._id, `warehouse item ${itemId} tidak ditemukan`);
    return item;
}

function lineDoc(input: {
    id: string;
    category: IncidentSettlementLine['category'];
    amount: number;
    status?: IncidentSettlementLine['status'];
    linkedMaintenanceRef?: string;
}) {
    return {
        _id: input.id,
        _type: 'incidentSettlementLine',
        incidentRef: incidentId,
        incidentNumber,
        lineType: 'COST',
        category: input.category,
        date: AUDIT_DATE,
        amount: input.amount,
        description: `Audit ${input.category} ${suffix}`,
        payeeName: 'Audit Bengkel Lokal',
        status: input.status || 'POSTED',
        linkedExpenseRef: `audit-expense-${input.id}`,
        linkedExpenseAmount: input.amount,
        linkedExpenseRoute: 'COMPANY_EXPENSE',
        linkedMaintenanceRef: input.linkedMaintenanceRef,
    } satisfies IncidentSettlementLine;
}

async function createBaseDocs() {
    await addDoc('vehicle', {
        _id: vehicleId,
        _type: 'vehicle',
        unitCode: `AUD-MH-${suffix}`,
        plateNumber: vehiclePlate,
        vehicleType: 'Box',
        brandModel: 'Audit',
        active: true,
        status: 'ACTIVE',
        odometer: 50000,
    });
    await addDoc('expenseCategory', {
        _id: expenseCategoryId,
        _type: 'expenseCategory',
        name: `Audit Incident Maintenance Handling ${suffix}`,
        scope: 'INCIDENT',
        accountSystemKey: 'incident_expense',
        active: true,
    } satisfies ExpenseCategory);
    await addDoc('incident', {
        _id: incidentId,
        _type: 'incident',
        incidentNumber,
        dateTime: `${AUDIT_DATE}T10:00:00.000Z`,
        vehicleRef: vehicleId,
        vehiclePlate,
        incidentType: 'ENGINE_TROUBLE',
        urgency: 'HIGH',
        locationText: 'Audit lokasi remote',
        odometer: 51234,
        description: 'Audit kompleks maintenance handling',
        status: 'IN_PROGRESS',
        attachmentUrls: [],
    } satisfies Incident);
}

async function createWarehouseItem(input: {
    id: string;
    code: string;
    name: string;
    unit?: WarehouseItem['unit'];
    stock: number;
    price: number;
    trackingMode?: WarehouseItem['trackingMode'];
}) {
    return addDoc('warehouseItem', {
        _id: input.id,
        _type: 'warehouseItem',
        itemCode: input.code,
        name: input.name,
        category: 'AUDIT',
        unit: input.unit || 'PCS',
        trackingMode: input.trackingMode || 'STANDARD',
        currentStockQty: input.stock,
        defaultPurchasePrice: input.price,
        active: true,
    } satisfies WarehouseItem);
}

async function createLine(input: Parameters<typeof lineDoc>[0]) {
    const expenseId = `audit-expense-${input.id}`;
    await addDoc('expense', {
        _id: expenseId,
        _type: 'expense',
        categoryRef: expenseCategoryId,
        categoryName: 'Audit Incident Maintenance Handling',
        categoryScope: 'INCIDENT',
        accountSystemKey: 'incident_expense',
        date: AUDIT_DATE,
        amount: input.amount,
        description: `Audit expense ${input.category} ${suffix}`,
        privacyLevel: 'internal',
        relatedVehicleRef: vehicleId,
        relatedVehiclePlate: vehiclePlate,
        relatedIncidentRef: incidentId,
        incidentExpenseRoute: 'COMPANY_EXPENSE',
    } satisfies Expense);
    await addDoc('incidentSettlementLine', lineDoc(input));
    return loadLine(input.id);
}

async function callHandling(
    session: Awaited<ReturnType<typeof getOwnerSession>>,
    data: Record<string, unknown>,
    label: string,
    expectStatus?: number,
) {
    const response = await handleIncidentMaintenanceHandlingCreate(session, data, noopAuditLog);
    return readResponse<Maintenance>(response, { label, expectStatus });
}

async function deleteJournalEntriesForSource(sourceRef: string) {
    const entries = await listDocumentsByFilter<JournalEntry>('journalEntry', { sourceRef }).catch(() => []);
    for (const entry of entries) {
        const lines = await listDocumentsByFilter<JournalLine>('journalLine', { journalEntryRef: entry._id }).catch(() => []);
        for (const line of lines) {
            await deleteDocument(line._id, 'journalLine').catch(() => undefined);
        }
        await deleteDocument(entry._id, 'journalEntry').catch(() => undefined);
    }
}

async function cleanup() {
    const movements = await listDocumentsByFilter<StockMovement>('stockMovement', { sourceNumber }).catch(() => []);
    for (const movement of movements) {
        await deleteJournalEntriesForSource(movement._id);
        await deleteDocument(movement._id, 'stockMovement').catch(() => undefined);
    }
    for (const maintenanceId of createdMaintenanceIds) {
        const maintenanceMovements = await listDocumentsByFilter<StockMovement>('stockMovement', { sourceRef: maintenanceId }).catch(() => []);
        for (const movement of maintenanceMovements) {
            await deleteJournalEntriesForSource(movement._id);
            await deleteDocument(movement._id, 'stockMovement').catch(() => undefined);
        }
        await deleteDocument(maintenanceId, 'maintenance').catch(() => undefined);
    }
    const orphanAuditMaintenances = await listDocumentsByFilter<Maintenance>('maintenance', { relatedIncidentRef: incidentId }).catch(() => []);
    for (const maintenance of orphanAuditMaintenances) {
        await deleteDocument(maintenance._id, 'maintenance').catch(() => undefined);
    }
    const actionLogs = await listDocumentsByFilter<IncidentActionLog>('incidentActionLog', { incidentRef: incidentId }).catch(() => []);
    for (const logRow of actionLogs) {
        await deleteDocument(logRow._id, 'incidentActionLog').catch(() => undefined);
    }
    for (const [docType, id] of createdDirectDocs.reverse()) {
        if (docType === 'stockMovement') {
            await deleteJournalEntriesForSource(id);
        }
        await deleteDocument(id, docType).catch(() => undefined);
    }
}

async function runWarehouseSuccess(session: Awaited<ReturnType<typeof getOwnerSession>>) {
    log('warehouse success multi item');
    const itemA = `audit-wh-a-${suffix}`;
    const itemB = `audit-wh-b-${suffix}`;
    await createWarehouseItem({ id: itemA, code: `AUD-A-${suffix}`, name: 'Audit Oli Gudang', unit: 'LITER', stock: 10, price: 15000 });
    await createWarehouseItem({ id: itemB, code: `AUD-B-${suffix}`, name: 'Audit Filter Gudang', stock: 5, price: 25000 });

    const incident = await loadIncident();
    const payload = await callHandling(session, {
        incidentRef: incident._id,
        revision: incident._rev,
        sourceMode: 'WAREHOUSE_STOCK',
        completedDate: AUDIT_DATE,
        odometerAtService: 51300,
        vendor: 'Gudang Internal',
        maintenanceType: 'Audit Pemakaian Gudang',
        warehouseMaterials: [
            { warehouseItemRef: itemA, quantity: 2.5, attachToVehicle: false, note: 'oli habis pakai' },
            { warehouseItemRef: itemB, quantity: 1, attachToVehicle: true, componentLabel: 'Filter udara', note: 'dipasang di unit' },
        ],
    }, 'warehouse success');

    assert(payload.maintenanceRef, 'warehouse success tidak mengembalikan maintenanceRef');
    const [maintenance, afterA, afterB, movements] = await Promise.all([
        getDocumentById<Maintenance>(payload.maintenanceRef, 'maintenance'),
        loadWarehouseItem(itemA),
        loadWarehouseItem(itemB),
        listDocumentsByFilter<StockMovement>('stockMovement', { sourceRef: payload.maintenanceRef }),
    ]);
    assert(maintenance?.status === 'DONE', 'warehouse maintenance harus DONE');
    assert(maintenance.materialUsageCount === 2, 'warehouse materialUsageCount harus 2');
    assert(maintenance.materialCostTotal === 62500, `warehouse materialCostTotal salah: ${maintenance.materialCostTotal}`);
    assert(maintenance.totalCost === 62500 && maintenance.cost === 62500, 'warehouse totalCost/cost harus sama materialCostTotal');
    assert(afterA.currentStockQty === 7.5, `stok item A salah: ${afterA.currentStockQty}`);
    assert(afterB.currentStockQty === 4, `stok item B salah: ${afterB.currentStockQty}`);
    assert(movements.length === 2, `warehouse harus buat 2 movement, got ${movements.length}`);
    assert(movements.every(row => row.type === 'OUT' && row.sourceType === 'MAINTENANCE_USAGE'), 'warehouse movements harus MAINTENANCE_USAGE OUT');
    const installedUsage = maintenance.materialUsages?.find(row => row.warehouseItemRef === itemB);
    assert(installedUsage?.attachedToVehicle === true, 'attached material harus melekat ke unit');
}

async function runWarehouseRejections(session: Awaited<ReturnType<typeof getOwnerSession>>) {
    log('warehouse rejection duplicate, tire item, and backdated stock');
    const dupItem = `audit-wh-dup-${suffix}`;
    const tireItem = `audit-wh-tire-${suffix}`;
    const datedItem = `audit-wh-dated-${suffix}`;
    await createWarehouseItem({ id: dupItem, code: `AUD-DUP-${suffix}`, name: 'Audit Duplicate', stock: 8, price: 10000 });
    await createWarehouseItem({ id: tireItem, code: `AUD-TIRE-${suffix}`, name: 'Audit Ban Tertracking', stock: 2, price: 900000, trackingMode: 'TIRE_ASSET' });
    await createWarehouseItem({ id: datedItem, code: `AUD-DATED-${suffix}`, name: 'Audit Backdated', stock: 3, price: 10000 });
    await addDoc('stockMovement', {
        _id: `audit-latest-movement-${suffix}`,
        _type: 'stockMovement',
        warehouseItemRef: datedItem,
        itemCode: `AUD-DATED-${suffix}`,
        itemName: 'Audit Backdated',
        unit: 'PCS',
        movementDate: '2026-06-20',
        type: 'IN',
        sourceType: 'MANUAL_IN',
        sourceRef: `audit-latest-${suffix}`,
        sourceNumber,
        quantity: 1,
        balanceAfter: 3,
        unitCostSnapshot: 10000,
        subtotalCost: 10000,
        costMethod: 'MANUAL',
    } satisfies StockMovement);

    const incident = await loadIncident();
    const baselineDupStock = (await loadWarehouseItem(dupItem)).currentStockQty;
    await callHandling(session, {
        incidentRef: incident._id,
        revision: incident._rev,
        sourceMode: 'WAREHOUSE_STOCK',
        completedDate: AUDIT_DATE,
        warehouseMaterials: [
            { warehouseItemRef: dupItem, quantity: 1 },
            { warehouseItemRef: dupItem, quantity: 1 },
        ],
    }, 'warehouse duplicate reject', 400);
    assert((await loadWarehouseItem(dupItem)).currentStockQty === baselineDupStock, 'duplicate reject tidak boleh mengubah stok');

    await callHandling(session, {
        incidentRef: incident._id,
        revision: incident._rev,
        sourceMode: 'WAREHOUSE_STOCK',
        completedDate: AUDIT_DATE,
        warehouseMaterials: [{ warehouseItemRef: tireItem, quantity: 1 }],
    }, 'warehouse tire reject', 400);

    const baselineDatedStock = (await loadWarehouseItem(datedItem)).currentStockQty;
    await callHandling(session, {
        incidentRef: incident._id,
        revision: incident._rev,
        sourceMode: 'WAREHOUSE_STOCK',
        completedDate: AUDIT_DATE,
        warehouseMaterials: [{ warehouseItemRef: datedItem, quantity: 1 }],
    }, 'warehouse backdated reject', 400);
    assert((await loadWarehouseItem(datedItem)).currentStockQty === baselineDatedStock, 'backdated reject tidak boleh mengubah stok');
}

async function runDirectSuccessAndRejections(session: Awaited<ReturnType<typeof getOwnerSession>>) {
    log('direct purchase success with repeated leftover target');
    const linkedItem = `audit-direct-linked-${suffix}`;
    const leftoverItem = `audit-direct-leftover-${suffix}`;
    await createWarehouseItem({ id: linkedItem, code: `AUD-LINK-${suffix}`, name: 'Audit Sparepart Acuan', stock: 0, price: 12000 });
    await createWarehouseItem({ id: leftoverItem, code: `AUD-LEFT-${suffix}`, name: 'Audit Sisa Lokal', stock: 10, price: 0 });
    const directLine = await createLine({ id: `audit-line-direct-${suffix}`, category: 'SPAREPART', amount: 1000000 });
    const incident = await loadIncident();

    const payload = await callHandling(session, {
        incidentRef: incident._id,
        revision: incident._rev,
        sourceMode: 'DIRECT_PURCHASE',
        settlementLineRef: directLine._id,
        settlementLineRevision: directLine._rev,
        completedDate: AUDIT_DATE,
        odometerAtService: 51400,
        vendor: 'Toko Audit Lokal',
        maintenanceType: 'Audit Beli Lokal',
        directMaterials: [
            {
                linkedWarehouseItemRef: linkedItem,
                itemName: 'Audit Kopling Lokal',
                unit: 'PCS',
                quantity: 2,
                unitCost: 10000,
                attachToVehicle: true,
                componentLabel: 'Kopling',
                leftoverWarehouseItemRef: leftoverItem,
                leftoverQty: 3,
            },
            {
                itemName: 'Audit Baut Lokal',
                unit: 'PCS',
                quantity: 1,
                unitCost: 5000,
                attachToVehicle: false,
                leftoverWarehouseItemRef: leftoverItem,
                leftoverQty: 4,
            },
        ],
    }, 'direct success');

    assert(payload.maintenanceRef, 'direct success tidak mengembalikan maintenanceRef');
    const [maintenance, updatedLine, updatedLeftover, movements] = await Promise.all([
        getDocumentById<Maintenance>(payload.maintenanceRef, 'maintenance'),
        loadLine(directLine._id),
        loadWarehouseItem(leftoverItem),
        listDocumentsByFilter<StockMovement>('stockMovement', { sourceRef: payload.maintenanceRef }),
    ]);
    assert(maintenance?.status === 'DONE', 'direct maintenance harus DONE');
    assert(maintenance.materialCostTotal === 0 && maintenance.totalCost === 0 && maintenance.cost === 0, 'direct purchase tidak boleh menambah biaya maintenance');
    assert(maintenance.postedIncidentMaterialCostTotal === 25000, `postedIncidentMaterialCostTotal salah: ${maintenance.postedIncidentMaterialCostTotal}`);
    assert(maintenance.inventoryReceiptCostTotal === 50000, `inventoryReceiptCostTotal salah: ${maintenance.inventoryReceiptCostTotal}`);
    assert(maintenance.postedIncidentServiceCostTotal === 925000, `postedIncidentServiceCostTotal salah: ${maintenance.postedIncidentServiceCostTotal}`);
    assert(maintenance.materialUsages?.length === 2, 'direct harus mencatat 2 material usage dipakai');
    assert(maintenance.materialUsages.every(row => row.sourceType === 'DIRECT_PURCHASE' && row.costAlreadyPosted === true), 'direct usage harus costAlreadyPosted');
    assert(updatedLine.linkedMaintenanceRef === payload.maintenanceRef, 'direct line harus tertaut ke maintenance');
    assert(updatedLeftover.currentStockQty === 17, `stok leftover kumulatif salah: ${updatedLeftover.currentStockQty}`);
    assert(movements.length === 2, `direct leftover harus membuat 2 MANUAL_IN movement, got ${movements.length}`);
    const sortedBalances = movements.map(row => row.balanceAfter).sort((a, b) => Number(a || 0) - Number(b || 0));
    assert(sortedBalances[0] === 13 && sortedBalances[1] === 17, `balanceAfter leftover harus 13 dan 17, got ${sortedBalances.join(',')}`);

    log('direct purchase rejection over allocation, tire category, double link, empty sparepart, and service-only repair');
    const overLine = await createLine({ id: `audit-line-over-${suffix}`, category: 'SPAREPART', amount: 1000 });
    await callHandling(session, {
        incidentRef: incident._id,
        revision: incident._rev,
        sourceMode: 'DIRECT_PURCHASE',
        settlementLineRef: overLine._id,
        settlementLineRevision: overLine._rev,
        completedDate: AUDIT_DATE,
        directMaterials: [{ itemName: 'Audit Mahal', unit: 'PCS', quantity: 1, unitCost: 2000 }],
    }, 'direct over allocation reject', 400);
    assert(!(await loadLine(overLine._id)).linkedMaintenanceRef, 'over allocation reject tidak boleh link maintenance');

    const tireLine = await createLine({ id: `audit-line-tire-${suffix}`, category: 'TIRE', amount: 900000 });
    await callHandling(session, {
        incidentRef: incident._id,
        revision: incident._rev,
        sourceMode: 'DIRECT_PURCHASE',
        settlementLineRef: tireLine._id,
        settlementLineRevision: tireLine._rev,
        completedDate: AUDIT_DATE,
        directMaterials: [{ itemName: 'Audit Ban', unit: 'PCS', quantity: 1, unitCost: 900000 }],
    }, 'direct tire reject', 409);

    const linkedAgainLine = await loadLine(directLine._id);
    await callHandling(session, {
        incidentRef: incident._id,
        revision: incident._rev,
        sourceMode: 'DIRECT_PURCHASE',
        settlementLineRef: linkedAgainLine._id,
        settlementLineRevision: linkedAgainLine._rev,
        completedDate: AUDIT_DATE,
        directMaterials: [{ itemName: 'Audit Double', unit: 'PCS', quantity: 1, unitCost: 1000 }],
    }, 'direct double link reject', 409);

    const emptySparepartLine = await createLine({ id: `audit-line-empty-sparepart-${suffix}`, category: 'SPAREPART', amount: 100000 });
    await callHandling(session, {
        incidentRef: incident._id,
        revision: incident._rev,
        sourceMode: 'DIRECT_PURCHASE',
        settlementLineRef: emptySparepartLine._id,
        settlementLineRevision: emptySparepartLine._rev,
        completedDate: AUDIT_DATE,
        directMaterials: [],
    }, 'direct empty sparepart reject', 400);

    const repairOnlyLine = await createLine({ id: `audit-line-repair-only-${suffix}`, category: 'REPAIR', amount: 300000 });
    const repairPayload = await callHandling(session, {
        incidentRef: incident._id,
        revision: incident._rev,
        sourceMode: 'DIRECT_PURCHASE',
        settlementLineRef: repairOnlyLine._id,
        settlementLineRevision: repairOnlyLine._rev,
        completedDate: AUDIT_DATE,
        vendor: 'Audit Bengkel Jasa',
        maintenanceType: 'Audit Perbaikan Jasa Saja',
        directMaterials: [],
    }, 'direct repair service-only success');
    assert(repairPayload.maintenanceRef, 'repair service-only harus membuat maintenance');
    const repairMaintenance = await getDocumentById<Maintenance>(repairPayload.maintenanceRef, 'maintenance');
    assert(repairMaintenance?.materialUsageCount === 0, 'repair service-only material count harus 0');
    assert(repairMaintenance?.totalCost === 0, 'repair service-only totalCost maintenance harus 0');
    assert(repairMaintenance?.postedIncidentServiceCostTotal === 300000, 'repair service-only service cost harus sama line amount');
}

async function main() {
    const session = await getOwnerSession();
    try {
        await createBaseDocs();
        await runWarehouseSuccess(session);
        await runWarehouseRejections(session);
        await runDirectSuccessAndRejections(session);
        const maintenanceRows = await listDocumentsByFilter<Maintenance>('maintenance', { relatedIncidentRef: incidentId });
        assert(maintenanceRows.length === 3, `audit harus menghasilkan 3 maintenance sukses, got ${maintenanceRows.length}`);
        const actionLogs = await listDocumentsByFilter<IncidentActionLog>('incidentActionLog', { incidentRef: incidentId });
        assert(actionLogs.length >= 3, `audit harus mencatat action log untuk success workflow, got ${actionLogs.length}`);
        console.log(JSON.stringify({
            ok: true,
            incidentRef: incidentId,
            maintenanceCount: maintenanceRows.length,
            actionLogCount: actionLogs.length,
        }, null, 2));
    } finally {
        await cleanup();
    }
}

main().catch(async (error) => {
    console.error(error);
    await cleanup().catch(cleanupError => console.error('cleanup failed', cleanupError));
    process.exit(1);
});
