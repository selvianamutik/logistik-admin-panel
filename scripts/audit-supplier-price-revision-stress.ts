import { loadScriptEnv } from './_env';

loadScriptEnv();

import {
    handleGenericCreate,
    handleGenericDelete,
    handleGenericUpdate,
    handleSupplierItemPriceRevise,
} from '../src/lib/api/generic-workflows';
import { handlePurchaseCreate, handlePurchaseReceive } from '../src/lib/api/inventory-workflows';
import type { ApiSession } from '../src/lib/api/data-helpers';
import { getSupabaseClient } from '../src/lib/supabase';
import {
    deleteDocument,
    listDocumentsByFilter,
} from '../src/lib/repositories/document-store';
import type {
    JournalEntry,
    JournalLine,
    PurchaseItem,
    StockMovement,
    SupplierItemPrice,
} from '../src/lib/types';

type JsonPayload = {
    data?: Record<string, unknown>;
    id?: string;
    previousId?: string;
    error?: string;
    success?: boolean;
};

type PurchaseAuditResult = {
    purchaseId: string;
    purchaseItem: PurchaseItem;
    movement: StockMovement;
    receiptBatchRef: string;
};

const session: ApiSession = {
    _id: 'user-owner-001',
    name: 'Raka Prasetya',
    email: 'owner@company.local',
    role: 'OWNER',
};

const noopAuditLog = async () => undefined;
const state = {
    supplierId: '',
    warehouseItemId: '',
    supplierPriceIds: [] as string[],
    purchaseIds: [] as string[],
    receiptBatchRefs: [] as string[],
};

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function money(value: unknown) {
    const amount = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function assertMoney(value: unknown, expected: number, label: string) {
    assert(money(value) === expected, `${label}: expected ${expected}, got ${String(value)}`);
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error || '');
}

async function assertRuntimeSchemaAvailable() {
    const checks = [
        {
            label: 'supplier_item_prices',
            path: 'supplier_item_prices?select=source_document_id,default_purchase_price,effective_from,effective_to,active&limit=1',
        },
        {
            label: 'purchase_items supplier price snapshot columns',
            path: 'purchase_items?select=source_document_id,supplier_item_price_ref,price_source,price_effective_date,original_unit_price,price_overridden,price_override_reason&limit=1',
        },
        {
            label: 'stock_movements cost snapshot columns',
            path: 'stock_movements?select=source_document_id,unit_cost_snapshot,subtotal_cost,cost_method&limit=1',
        },
    ];

    for (const check of checks) {
        try {
            await getSupabaseClient().fetch(check.path);
        } catch (error) {
            throw new Error(
                `Runtime Supabase schema belum siap untuk audit supplier price stress (${check.label}). ` +
                `Jalankan migration supabase/migrations/20260603000100_supplier_item_price_and_stock_cost_snapshots.sql dulu. ` +
                `Detail: ${getErrorMessage(error)}`
            );
        }
    }
}

async function readResponse(response: Response, label: string): Promise<JsonPayload> {
    const text = await response.text();
    const parsed = text ? JSON.parse(text) as JsonPayload : {};
    if (!response.ok) {
        throw new Error(`${label} failed ${response.status}: ${text}`);
    }
    return parsed;
}

function requireResponse(response: Response | undefined, label: string) {
    assert(response, `${label} tidak mengembalikan response`);
    return response;
}

async function expectResponseStatus(response: Response, label: string, expectedStatus: number, expectedText?: string) {
    const text = await response.text();
    const parsed = text ? JSON.parse(text) as JsonPayload : {};
    if (response.status !== expectedStatus) {
        throw new Error(`${label} expected ${expectedStatus}, got ${response.status}: ${text}`);
    }
    if (expectedText) {
        assert(String(parsed.error || '').includes(expectedText), `${label} error must include "${expectedText}", got: ${String(parsed.error || '')}`);
    }
}

async function createGeneric(entity: string, docType: string, data: Record<string, unknown>) {
    const payload = await readResponse(
        await handleGenericCreate(session, entity, docType, data, noopAuditLog),
        `create ${entity}`
    );
    const id = payload.id || (typeof payload.data?._id === 'string' ? payload.data._id : '');
    assert(id, `create ${entity} must return id`);
    return id;
}

async function revisePrice(id: string, defaultPurchasePrice: number, effectiveFrom: string) {
    const payload = await readResponse(
        await handleSupplierItemPriceRevise(session, {
            id,
            updates: {
                defaultPurchasePrice,
                effectiveFrom,
                notes: `Audit stress price ${defaultPurchasePrice} from ${effectiveFrom}`,
            },
        }, noopAuditLog),
        `revise supplier price ${id}`
    );
    assert(payload.id, `revisi harga ${id} harus mengembalikan id baru`);
    state.supplierPriceIds.push(payload.id);
    return payload.id;
}

async function deleteJournalEntriesBySourceRef(sourceRef: string) {
    if (!sourceRef) return;
    const entries = await listDocumentsByFilter<JournalEntry>('journalEntry', { sourceRef }).catch(() => []);
    for (const entry of entries) {
        const lines = await listDocumentsByFilter<JournalLine>('journalLine', { journalRef: entry._id }).catch(() => []);
        for (const line of lines) {
            await deleteDocument(line._id, 'journalLine').catch(() => undefined);
        }
        await deleteDocument(entry._id, 'journalEntry').catch(() => undefined);
    }
}

async function cleanup() {
    for (const batchRef of [...state.receiptBatchRefs].reverse()) {
        await deleteJournalEntriesBySourceRef(batchRef);
    }

    for (const purchaseId of [...state.purchaseIds].reverse()) {
        const movements = await listDocumentsByFilter<StockMovement>('stockMovement', { sourceRef: purchaseId }).catch(() => []);
        const batchRef = movements.map((movement) => movement._id).join('|');
        await deleteJournalEntriesBySourceRef(batchRef);
        for (const movement of movements) {
            await deleteDocument(movement._id, 'stockMovement').catch(() => undefined);
        }

        const items = await listDocumentsByFilter<PurchaseItem>('purchaseItem', { purchaseRef: purchaseId }).catch(() => []);
        for (const item of items) {
            await deleteDocument(item._id, 'purchaseItem').catch(() => undefined);
        }
        await deleteDocument(purchaseId, 'purchase').catch(() => undefined);
    }

    const supplierPrices = state.supplierId && state.warehouseItemId
        ? await listDocumentsByFilter<SupplierItemPrice>('supplierItemPrice', {
            supplierRef: state.supplierId,
            warehouseItemRef: state.warehouseItemId,
        }).catch(() => [])
        : [];
    const priceIds = new Set([...state.supplierPriceIds, ...supplierPrices.map((price) => price._id)]);
    for (const priceId of [...priceIds].reverse()) {
        await deleteDocument(priceId, 'supplierItemPrice').catch(() => undefined);
    }

    if (state.warehouseItemId) {
        await deleteDocument(state.warehouseItemId, 'warehouseItem').catch(() => undefined);
    }
    if (state.supplierId) {
        await deleteDocument(state.supplierId, 'supplier').catch(() => undefined);
    }
}

async function createAndReceivePurchase(params: {
    label: string;
    orderDate: string;
    receiveDate: string;
    expectedPrice: number;
    expectedPriceId: string;
    expectedPriceEffectiveDate: string;
    quantity: number;
}): Promise<PurchaseAuditResult> {
    const purchasePayload = await readResponse(
        await handlePurchaseCreate(session, {
            supplierRef: state.supplierId,
            orderDate: params.orderDate,
            dueDate: params.orderDate,
            notes: `Audit supplier price stress ${params.label}`,
            items: [
                {
                    warehouseItemRef: state.warehouseItemId,
                    orderedQty: params.quantity,
                    unitPrice: params.expectedPrice,
                    notes: params.label,
                },
            ],
        }, noopAuditLog),
        `create purchase ${params.label}`
    );
    const purchaseId = purchasePayload.id || (typeof purchasePayload.data?._id === 'string' ? purchasePayload.data._id : '');
    assert(purchaseId, `purchase ${params.label} must return id`);
    state.purchaseIds.push(purchaseId);

    const purchaseItems = await listDocumentsByFilter<PurchaseItem>('purchaseItem', { purchaseRef: purchaseId });
    assert(purchaseItems.length === 1, `purchase ${params.label} must have exactly one item`);
    const purchaseItem = purchaseItems[0];
    assert(purchaseItem.supplierItemPriceRef === params.expectedPriceId, `purchase ${params.label} harus melekat ke versi harga yang benar`);
    assert(purchaseItem.priceSource === 'SUPPLIER_PRICE', `purchase ${params.label} harus memakai harga supplier, dapat ${String(purchaseItem.priceSource)}`);
    assert(purchaseItem.priceOverridden !== true, `purchase ${params.label} tidak boleh terdeteksi manual override`);
    assert(purchaseItem.priceEffectiveDate === params.expectedPriceEffectiveDate, `purchase ${params.label} priceEffectiveDate salah`);
    assertMoney(purchaseItem.unitPrice, params.expectedPrice, `purchase ${params.label} unitPrice`);
    assertMoney(purchaseItem.subtotal, params.expectedPrice * params.quantity, `purchase ${params.label} subtotal`);

    const receiptPayload = await readResponse(
        await handlePurchaseReceive(session, {
            purchaseRef: purchaseId,
            receiveDate: params.receiveDate,
            items: [
                {
                    purchaseItemRef: purchaseItem._id,
                    receivedQty: params.quantity,
                    note: params.label,
                },
            ],
        }, noopAuditLog),
        `receive purchase ${params.label}`
    );

    const stockMovements = Array.isArray(receiptPayload.data?.stockMovements)
        ? receiptPayload.data.stockMovements as unknown as StockMovement[]
        : await listDocumentsByFilter<StockMovement>('stockMovement', { sourceRef: purchaseId });
    assert(stockMovements.length === 1, `purchase ${params.label} must create exactly one stock movement`);
    const movement = stockMovements[0];
    const receiptBatchRef = movement._id;
    state.receiptBatchRefs.push(receiptBatchRef);
    assert(movement.sourceType === 'PURCHASE_RECEIPT', `movement ${params.label} harus PURCHASE_RECEIPT`);
    assert(movement.costMethod === 'PURCHASE_PRICE', `movement ${params.label} harus pakai costMethod PURCHASE_PRICE`);
    assertMoney(movement.unitCostSnapshot, params.expectedPrice, `movement ${params.label} unitCostSnapshot`);
    assertMoney(movement.subtotalCost, params.expectedPrice * params.quantity, `movement ${params.label} subtotalCost`);

    return { purchaseId, purchaseItem, movement, receiptBatchRef };
}

async function assertPriceChain(expected: Array<{ id: string; amount: number; from: string; to?: string; active: boolean }>) {
    const rows = await listDocumentsByFilter<SupplierItemPrice>('supplierItemPrice', {
        supplierRef: state.supplierId,
        warehouseItemRef: state.warehouseItemId,
    });
    assert(rows.length === expected.length, `harus ada ${expected.length} versi harga, dapat ${rows.length}`);
    const activeRows = rows.filter((row) => row.active !== false);
    assert(activeRows.length === 1, `harus tepat satu harga aktif, dapat ${activeRows.length}`);

    for (const item of expected) {
        const row = rows.find((candidate) => candidate._id === item.id);
        assert(row, `versi harga ${item.id} tidak ditemukan`);
        assertMoney(row.defaultPurchasePrice, item.amount, `harga versi ${item.from}`);
        assert(row.effectiveFrom === item.from, `effectiveFrom versi ${item.from} salah`);
        assert((row.effectiveTo || undefined) === item.to, `effectiveTo versi ${item.from} salah: ${String(row.effectiveTo || '')}`);
        assert((row.active !== false) === item.active, `active versi ${item.from} salah`);
    }
}

async function run() {
    await assertRuntimeSchemaAvailable();

    const suffix = Date.now().toString(36).slice(-8).toUpperCase();
    const supplierCode = `SUP-${suffix}`.slice(0, 20);
    const itemCode = `ITM-${suffix}`.slice(0, 30);

    state.supplierId = await createGeneric('suppliers', 'supplier', {
        supplierCode,
        name: `Audit Supplier Price Stress ${suffix}`,
        defaultTermDays: 7,
        active: true,
        notes: 'Temporary audit row: supplier price revision stress',
    });

    state.warehouseItemId = await createGeneric('warehouse-items', 'warehouseItem', {
        itemCode,
        name: `Audit Oli Stress ${suffix}`,
        category: 'SPAREPART',
        unit: 'PCS',
        trackingMode: 'STANDARD',
        minStockQty: 0,
        defaultSupplierRef: state.supplierId,
        defaultPurchasePrice: 5000,
        active: true,
        notes: 'Temporary audit row: supplier price revision stress',
    });

    const price1 = await createGeneric('supplier-item-prices', 'supplierItemPrice', {
        supplierRef: state.supplierId,
        warehouseItemRef: state.warehouseItemId,
        defaultPurchasePrice: 10000,
        minOrderQty: 1,
        leadTimeDays: 0,
        effectiveFrom: '2026-06-01',
        active: true,
        notes: 'Audit stress initial price',
    });
    state.supplierPriceIds.push(price1);

    await createAndReceivePurchase({
        label: 'v1-10000',
        orderDate: '2026-06-01',
        receiveDate: '2026-06-01',
        expectedPrice: 10000,
        expectedPriceId: price1,
        expectedPriceEffectiveDate: '2026-06-01',
        quantity: 2,
    });

    const price2 = await revisePrice(price1, 20000, '2026-06-02');
    await createAndReceivePurchase({
        label: 'v2-20000',
        orderDate: '2026-06-02',
        receiveDate: '2026-06-02',
        expectedPrice: 20000,
        expectedPriceId: price2,
        expectedPriceEffectiveDate: '2026-06-02',
        quantity: 3,
    });

    const price3 = await revisePrice(price2, 30000, '2026-06-03');
    await createAndReceivePurchase({
        label: 'v3-30000',
        orderDate: '2026-06-03',
        receiveDate: '2026-06-03',
        expectedPrice: 30000,
        expectedPriceId: price3,
        expectedPriceEffectiveDate: '2026-06-03',
        quantity: 4,
    });

    const price4 = await revisePrice(price3, 40000, '2026-06-04');
    await createAndReceivePurchase({
        label: 'v4-40000',
        orderDate: '2026-06-04',
        receiveDate: '2026-06-04',
        expectedPrice: 40000,
        expectedPriceId: price4,
        expectedPriceEffectiveDate: '2026-06-04',
        quantity: 5,
    });

    await assertPriceChain([
        { id: price1, amount: 10000, from: '2026-06-01', to: '2026-06-01', active: false },
        { id: price2, amount: 20000, from: '2026-06-02', to: '2026-06-02', active: false },
        { id: price3, amount: 30000, from: '2026-06-03', to: '2026-06-03', active: false },
        { id: price4, amount: 40000, from: '2026-06-04', active: true },
    ]);

    await createAndReceivePurchase({
        label: 'backdate-after-current-40000-still-uses-20000',
        orderDate: '2026-06-02',
        receiveDate: '2026-06-05',
        expectedPrice: 20000,
        expectedPriceId: price2,
        expectedPriceEffectiveDate: '2026-06-02',
        quantity: 6,
    });

    await expectResponseStatus(
        await handleGenericUpdate(session, 'supplier-item-prices', {
            id: price1,
            updates: { defaultPurchasePrice: 99999 },
        }, noopAuditLog),
        'generic update historical used price',
        409,
        'tidak boleh ditimpa'
    );

    await expectResponseStatus(
        await handleSupplierItemPriceRevise(session, {
            id: price1,
            updates: { defaultPurchasePrice: 99999 },
        }, noopAuditLog),
        'revise inactive historical used price',
        409,
        'tidak boleh ditimpa'
    );

    await expectResponseStatus(
        await handleSupplierItemPriceRevise(session, {
            id: price4,
            updates: {
                defaultPurchasePrice: 50000,
                effectiveFrom: '2026-06-03',
            },
        }, noopAuditLog),
        'revise active price with earlier effective date',
        400,
        'tidak boleh lebih awal'
    );

    await expectResponseStatus(
        requireResponse(
            await handleGenericDelete(session, 'supplier-item-prices', { id: price1 }, noopAuditLog),
            'delete historical used price'
        ),
        'delete historical used price',
        409,
        'tidak boleh dihapus'
    );

    console.log(JSON.stringify({
        ok: true,
        scenario: 'supplier price revisions 10000 -> 20000 -> 30000 -> 40000 plus backdated purchase',
        checked: {
            supplierPriceVersions: 4,
            purchasesCreatedAndReceived: state.purchaseIds.length,
            genericHistoricalOverwriteBlocked: true,
            reviseInactiveHistoricalOverwriteBlocked: true,
            earlierEffectiveDateBlocked: true,
            deleteUsedHistoricalPriceBlocked: true,
        },
    }, null, 2));
}

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await cleanup();
    });
