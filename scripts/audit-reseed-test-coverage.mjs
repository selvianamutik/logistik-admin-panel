import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { deriveTripSuratJalanDocs } from './_trip-surat-jalan-seed-utils.mjs';

function byType(docs, type) {
    return docs.filter(doc => doc && doc._type === type);
}

function mapById(docs) {
    return new Map(docs.map(doc => [doc._id, doc]));
}

function fail(message, details) {
    const error = new Error(message);
    error.details = details;
    throw error;
}

function requireCondition(condition, message, details) {
    if (!condition) fail(message, details);
}

function unique(values) {
    return [...new Set(values.filter(Boolean))].sort();
}

async function main() {
    const seedPath = path.resolve(process.cwd(), 'artifacts', 'default-supabase-seed.json');
    const docs = JSON.parse(await readFile(seedPath, 'utf8'));
    requireCondition(Array.isArray(docs), 'Seed input must be a JSON array');

    const ids = new Set();
    const duplicateIds = [];
    for (const doc of docs) {
        if (!doc?._id) continue;
        if (ids.has(doc._id)) duplicateIds.push(doc._id);
        ids.add(doc._id);
    }
    requireCondition(duplicateIds.length === 0, 'Duplicate seed ids found', duplicateIds);

    const warehouseItems = byType(docs, 'warehouseItem');
    const tireItems = warehouseItems.filter(item => item.trackingMode === 'TIRE_ASSET');
    const tireEvents = byType(docs, 'tireEvent');
    const tireHistories = byType(docs, 'tireHistoryLog');
    const tireItemIds = new Set(tireItems.map(item => item._id));
    const tireIds = new Set(tireEvents.map(item => item._id));
    const standaloneTires = tireEvents.filter(tire => !tire.linkedWarehouseItemRef || !tireItemIds.has(tire.linkedWarehouseItemRef));
    const orphanTireHistories = tireHistories.filter(log => !tireIds.has(log.tireEventRef));
    const nonTrackedBanItems = warehouseItems.filter(item =>
        `${item.name || ''} ${item.category || ''}`.toLowerCase().includes('ban') &&
        item.trackingMode !== 'TIRE_ASSET'
    );

    requireCondition(tireItems.length === 1, 'Seed must contain exactly one tracked tire inventory item', tireItems.map(item => item._id));
    requireCondition(tireEvents.length > 0, 'Seed must contain tracked tire event rows');
    requireCondition(standaloneTires.length === 0, 'Standalone tire events are not allowed', standaloneTires.map(tire => tire._id));
    requireCondition(orphanTireHistories.length === 0, 'Orphan tire history rows are not allowed', orphanTireHistories.map(log => log._id));
    requireCondition(nonTrackedBanItems.length === 0, 'Non-tracked tire inventory items are not allowed', nonTrackedBanItems.map(item => item._id));

    for (const item of tireItems) {
        const inWarehouseCount = tireEvents.filter(tire =>
            tire.linkedWarehouseItemRef === item._id &&
            tire.holderType === 'WAREHOUSE' &&
            tire.status === 'IN_WAREHOUSE'
        ).length;
        requireCondition(
            Number(item.currentStockQty || 0) === inWarehouseCount,
            `Tracked tire stock mismatch for ${item._id}`,
            { currentStockQty: item.currentStockQty, inWarehouseCount }
        );
    }

    const deliveryOrders = byType(docs, 'deliveryOrder');
    const deliveryOrderItems = byType(docs, 'deliveryOrderItem');
    const doStatuses = new Set(deliveryOrders.map(item => item.status));
    const requiredDoStatuses = ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED', 'PARTIAL_HOLD', 'DELIVERED', 'CANCELLED'];
    const missingStatuses = requiredDoStatuses.filter(status => !doStatuses.has(status));
    requireCondition(missingStatuses.length === 0, 'Missing delivery order status coverage', missingStatuses);

    const { suratJalanDocs } = deriveTripSuratJalanDocs(docs);
    const partialHoldDo = deliveryOrders.find(order =>
        order.status === 'PARTIAL_HOLD' &&
        Array.isArray(order.actualDropPoints) &&
        order.actualDropPoints.some(point => point.stopType === 'DROP') &&
        order.actualDropPoints.some(point => ['HOLD', 'TRANSIT'].includes(point.stopType))
    );
    requireCondition(Boolean(partialHoldDo), 'Missing partial-hold DO with DROP and HOLD points');
    const partialHoldSj = partialHoldDo
        ? suratJalanDocs.find(doc =>
            doc.deliveryOrderRef === partialHoldDo._id &&
            Number(doc.billableCargo?.qtyKoli || 0) > 0 &&
            Number(doc.holdCargo?.qtyKoli || 0) > 0
        )
        : null;
    requireCondition(Boolean(partialHoldSj), 'Derived SJ must expose billable and hold cargo for partial-hold DO');

    const multiSjDo = deliveryOrders.find(order => Array.isArray(order.shipperReferences) && order.shipperReferences.length > 0);
    requireCondition(Boolean(multiSjDo), 'Missing DO with shipper reference / SJ split coverage');
    requireCondition(deliveryOrderItems.some(item => item.actualQtyKoli !== undefined && Number(item.actualQtyKoli) !== Number(item.orderItemQtyKoli)), 'Missing actual cargo different from planned coverage');

    const incidents = byType(docs, 'incident');
    const lines = byType(docs, 'incidentSettlementLine');
    const expenses = byType(docs, 'expense');
    const voucherItems = byType(docs, 'driverVoucherItem');
    const incidentIds = new Set(incidents.map(item => item._id));
    const expenseIds = new Set(expenses.map(item => item._id));
    const voucherItemIds = new Set(voucherItems.map(item => item._id));
    requireCondition(lines.every(line => incidentIds.has(line.incidentRef)), 'Incident settlement line with missing incident ref');

    const driverPendingLine = lines.find(line => line.status === 'DRAFT' && /Diajukan driver/i.test(line.note || ''));
    requireCondition(Boolean(driverPendingLine), 'Missing driver-submitted incident approval fixture');
    requireCondition(
        incidents.some(incident => incident._id === driverPendingLine?.incidentRef && incident.pendingDriverResolutionRequestedAt),
        'Driver-submitted incident fixture must set pending approval fields'
    );

    const voucherLinkedLine = lines.find(line =>
        line.status === 'POSTED' &&
        line.linkedExpenseRef &&
        line.linkedDriverVoucherItemRef &&
        expenseIds.has(line.linkedExpenseRef) &&
        voucherItemIds.has(line.linkedDriverVoucherItemRef)
    );
    requireCondition(Boolean(voucherLinkedLine), 'Missing posted incident line linked into driver voucher other costs');

    const companyExpenseLine = lines.find(line =>
        line.status === 'POSTED' &&
        line.linkedExpenseRef &&
        expenseIds.has(line.linkedExpenseRef) &&
        !line.linkedDriverVoucherItemRef
    );
    requireCondition(Boolean(companyExpenseLine), 'Missing posted incident line paid as company expense');

    const vouchers = byType(docs, 'driverVoucher');
    requireCondition(vouchers.some(voucher => voucher.status === 'ISSUED' && voucher.topUpCount > 0), 'Missing issued voucher with top-up coverage');
    requireCondition(vouchers.some(voucher => voucher.status === 'SETTLED'), 'Missing settled voucher coverage');

    const freightNotas = byType(docs, 'freightNota');
    requireCondition(freightNotas.some(nota => nota.status === 'PARTIAL'), 'Missing partial freight nota coverage');
    requireCondition(freightNotas.some(nota => nota.status === 'PAID'), 'Missing paid freight nota coverage');

    console.log(JSON.stringify({
        ok: true,
        summary: {
            docs: docs.length,
            deliveryOrderStatuses: unique([...doStatuses]),
            partialHoldDo: partialHoldDo?._id,
            partialHoldSj: partialHoldSj?._id,
            incidents: incidents.length,
            incidentSettlementLines: lines.length,
            trackedTireItems: tireItems.map(item => item._id),
            tireEvents: tireEvents.length,
            vouchers: vouchers.length,
            freightNotas: freightNotas.length,
        },
    }, null, 2));
}

main().catch(error => {
    console.error(error.message || error);
    if (error.details) {
        console.error(JSON.stringify(error.details, null, 2));
    }
    process.exitCode = 1;
});
