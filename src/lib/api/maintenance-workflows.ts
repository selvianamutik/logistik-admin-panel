import { NextResponse } from 'next/server';

import { getBusinessDateValue } from '@/lib/business-date';
import { isTireTrackedWarehouseItem, parseInventoryQuantity, parseWholeMoneyAmount } from '@/lib/inventory';
import { getSanityClient, sanityGetById } from '@/lib/sanity';
import type {
    InventoryUnit,
    Maintenance,
    MaintenanceMaterialUsage,
    PurchaseItem,
    StockMovement,
    WarehouseItem,
} from '@/lib/types';

import {
    assertIsoDate,
    isMutationConflictError,
    normalizeOptionalText,
    type ApiSession,
} from './data-helpers';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

type MaintenanceMaterialOption = {
    _id: string;
    itemCode: string;
    name: string;
    category?: string;
    unit: InventoryUnit;
    currentStockQty: number;
};

type WarehouseItemSnapshot = WarehouseItem & {
    _rev?: string;
};

type MaintenanceSnapshot = Maintenance & {
    _rev?: string;
};

type MaterialUsageInput = {
    warehouseItemRef: string;
    quantity: number;
    note?: string;
};

function formatAuditMoney(amount: number) {
    return `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
}

function normalizeMaterialUsageInputs(value: unknown) {
    if (value === undefined || value === null) {
        return [] as MaterialUsageInput[];
    }
    if (!Array.isArray(value)) {
        throw new Error('Daftar material maintenance tidak valid');
    }
    const normalized = value.map((entry, index) => {
        if (typeof entry !== 'object' || entry === null) {
            throw new Error(`Baris material maintenance #${index + 1} tidak valid`);
        }
        const row = entry as Record<string, unknown>;
        const warehouseItemRef = normalizeOptionalText(row.warehouseItemRef);
        const quantity = parseInventoryQuantity(row.quantity);
        const note = normalizeOptionalText(row.note);
        if (!warehouseItemRef) {
            throw new Error(`Barang gudang pada baris material #${index + 1} wajib dipilih`);
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error(`Qty material pada baris #${index + 1} tidak valid`);
        }
        return {
            warehouseItemRef,
            quantity,
            note,
        } satisfies MaterialUsageInput;
    });

    const uniqueRefs = new Set(normalized.map((entry) => entry.warehouseItemRef));
    if (uniqueRefs.size !== normalized.length) {
        throw new Error('Barang gudang pada maintenance tidak boleh duplikat');
    }

    return normalized;
}

async function loadMaintenanceSnapshot(maintenanceRef: string) {
    const maintenance = await sanityGetById<MaintenanceSnapshot>(maintenanceRef);
    if (!maintenance || maintenance._type !== 'maintenance') {
        return null;
    }
    return maintenance;
}

async function loadWarehouseItemSnapshot(itemRef: string) {
    const item = await sanityGetById<WarehouseItemSnapshot>(itemRef);
    if (!item || item._type !== 'warehouseItem') {
        throw new Error('Barang gudang tidak ditemukan');
    }
    if (item.active === false) {
        throw new Error('Barang gudang tidak aktif');
    }
    if (!item.itemCode || !item.name || !item.unit) {
        throw new Error('Master barang gudang maintenance tidak valid');
    }
    if (isTireTrackedWarehouseItem(item)) {
        throw new Error('Ban tertracking dikelola lewat modul Ban, bukan lewat material maintenance');
    }
    if (!item._rev) {
        throw new Error(`Barang gudang ${item.itemCode} belum siap dikunci revisinya`);
    }
    return item;
}

async function resolveWarehouseItemUnitCost(item: Pick<WarehouseItem, '_id' | 'defaultPurchasePrice'>) {
    const receiptRows = await getSanityClient().fetch<Array<Pick<PurchaseItem, 'receivedQty' | 'unitPrice'>>>(
        `*[_type == "purchaseItem" && warehouseItemRef == $ref && defined(receivedQty) && receivedQty > 0]{
            receivedQty,
            unitPrice
        }`,
        { ref: item._id }
    );

    const aggregate = receiptRows.reduce(
        (accumulator, row) => {
            const quantity = Math.max(parseInventoryQuantity(row.receivedQty), 0);
            const unitPrice = Math.max(parseWholeMoneyAmount(row.unitPrice), 0);
            if (quantity <= 0 || unitPrice < 0) {
                return accumulator;
            }
            return {
                totalQty: accumulator.totalQty + quantity,
                totalValue: accumulator.totalValue + (quantity * unitPrice),
            };
        },
        { totalQty: 0, totalValue: 0 }
    );

    if (aggregate.totalQty > 0) {
        return Math.round(aggregate.totalValue / aggregate.totalQty);
    }
    return Math.max(parseWholeMoneyAmount(item.defaultPurchasePrice), 0);
}

function buildMaintenanceSourceNumber(maintenance: Pick<Maintenance, 'vehiclePlate' | 'type'>) {
    const plate = maintenance.vehiclePlate?.trim() || 'Unit';
    const type = maintenance.type?.trim() || 'Maintenance';
    return `${plate} - ${type}`;
}

function buildMaintenanceCompletionAuditSummary(input: {
    maintenance: Pick<Maintenance, '_id' | 'vehiclePlate' | 'type'>;
    materialUsageCount: number;
    materialCostTotal: number;
}) {
    const label = `${input.maintenance.type || 'Maintenance'} ${input.maintenance.vehiclePlate || input.maintenance._id}`;
    if (input.materialUsageCount <= 0) {
        return `${label} diselesaikan tanpa material gudang`;
    }
    return `${label} diselesaikan dengan ${input.materialUsageCount} material gudang senilai ${formatAuditMoney(input.materialCostTotal)}`;
}

export async function getMaintenanceMaterialOptions(): Promise<MaintenanceMaterialOption[]> {
    const rows = await getSanityClient().fetch<Array<Pick<WarehouseItem, '_id' | 'itemCode' | 'name' | 'category' | 'unit' | 'currentStockQty' | 'trackingMode' | 'active'>>>(
        `*[_type == "warehouseItem" && active != false && coalesce(trackingMode, "STANDARD") == "STANDARD" && coalesce(currentStockQty, 0) > 0]
        | order(itemCode asc, name asc){
            _id,
            itemCode,
            name,
            category,
            unit,
            currentStockQty,
            trackingMode,
            active
        }`
    );

    return rows.map((row) => ({
        _id: row._id,
        itemCode: row.itemCode || row._id,
        name: row.name || row._id,
        category: row.category,
        unit: row.unit as InventoryUnit,
        currentStockQty: Math.max(parseInventoryQuantity(row.currentStockQty), 0),
    }));
}

export async function handleMaintenanceComplete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    try {
        const maintenanceRef = normalizeOptionalText(data.maintenanceRef) || normalizeOptionalText(data.id);
        const completedDate = normalizeOptionalText(data.completedDate) || getBusinessDateValue();
        const vendor = normalizeOptionalText(data.vendor);
        const completionNotes = normalizeOptionalText(data.completionNotes);
        const materialInputs = normalizeMaterialUsageInputs(data.materials);
        const rawOdometerAtService = data.odometerAtService;

        if (!maintenanceRef) {
            return NextResponse.json({ error: 'Maintenance wajib dipilih' }, { status: 400 });
        }
        assertIsoDate(completedDate, 'Tanggal selesai maintenance');

        const maintenance = await loadMaintenanceSnapshot(maintenanceRef);
        if (!maintenance) {
            return NextResponse.json({ error: 'Maintenance tidak ditemukan' }, { status: 404 });
        }
        if (!maintenance._rev) {
            return NextResponse.json({ error: 'Maintenance belum siap diproses, coba muat ulang halaman' }, { status: 409 });
        }
        if (maintenance.status !== 'SCHEDULED') {
            return NextResponse.json({ error: 'Maintenance yang sudah diproses tidak bisa diselesaikan lagi' }, { status: 409 });
        }

        const odometerParsed =
            rawOdometerAtService === undefined || rawOdometerAtService === null || rawOdometerAtService === ''
                ? undefined
                : parseWholeMoneyAmount(rawOdometerAtService);
        if (odometerParsed !== undefined && (!Number.isFinite(odometerParsed) || odometerParsed <= 0)) {
            return NextResponse.json({ error: 'Odometer servis tidak valid' }, { status: 400 });
        }

        const warehouseItems = await Promise.all(materialInputs.map((input) => loadWarehouseItemSnapshot(input.warehouseItemRef)));
        const unitCostSnapshots = await Promise.all(warehouseItems.map((item) => resolveWarehouseItemUnitCost(item)));

        const movementDocs: StockMovement[] = [];
        const materialUsages: MaintenanceMaterialUsage[] = [];
        const transaction = getSanityClient().transaction();

        for (const [index, item] of warehouseItems.entries()) {
            const materialInput = materialInputs[index];
            const currentStockQty = Math.max(parseInventoryQuantity(item.currentStockQty ?? 0), 0);
            if (currentStockQty < materialInput.quantity) {
                return NextResponse.json(
                    { error: `Stok ${item.itemCode} tidak cukup untuk dipakai maintenance` },
                    { status: 409 }
                );
            }
            const nextStockQty = currentStockQty - materialInput.quantity;
            const unitCostSnapshot = unitCostSnapshots[index];
            const subtotalCost = Math.round(materialInput.quantity * unitCostSnapshot);

            transaction.patch(item._id, (patch) => patch.ifRevisionId(item._rev!).set({ currentStockQty: nextStockQty }));

            const movementDoc: StockMovement = {
                _id: `stock-movement-${crypto.randomUUID()}`,
                _type: 'stockMovement',
                warehouseItemRef: item._id,
                itemCode: item.itemCode,
                itemName: item.name,
                unit: item.unit,
                movementDate: completedDate,
                type: 'OUT',
                sourceType: 'MAINTENANCE_USAGE',
                sourceRef: maintenance._id,
                sourceNumber: buildMaintenanceSourceNumber(maintenance),
                quantity: materialInput.quantity,
                balanceAfter: nextStockQty,
                note: materialInput.note || `Dipakai untuk ${maintenance.type} ${maintenance.vehiclePlate || ''}`.trim(),
                createdBy: session._id,
                createdByName: session.name,
            };
            transaction.create(movementDoc);
            movementDocs.push(movementDoc);

            materialUsages.push({
                warehouseItemRef: item._id,
                itemCode: item.itemCode,
                itemName: item.name,
                category: item.category,
                unit: item.unit,
                quantity: materialInput.quantity,
                unitCostSnapshot,
                subtotalCost,
                note: materialInput.note,
            });
        }

        const materialCostTotal = materialUsages.reduce((sum, usage) => sum + Math.max(parseWholeMoneyAmount(usage.subtotalCost), 0), 0);
        const setPayload: Record<string, unknown> = {
            status: 'DONE',
            completedDate,
            materialUsageCount: materialUsages.length,
            materialCostTotal,
            totalCost: materialCostTotal,
            cost: materialCostTotal,
        };
        const unsetFields: string[] = [];

        if (vendor) {
            setPayload.vendor = vendor;
        } else {
            unsetFields.push('vendor');
        }

        if (completionNotes) {
            setPayload.completionNotes = completionNotes;
        } else {
            unsetFields.push('completionNotes');
        }

        if (typeof odometerParsed === 'number') {
            setPayload.odometerAtService = odometerParsed;
        } else {
            unsetFields.push('odometerAtService');
        }

        if (materialUsages.length > 0) {
            setPayload.materialUsages = materialUsages;
        } else {
            unsetFields.push('materialUsages');
        }

        transaction.patch(maintenance._id, (patch) => {
            let nextPatch = patch.ifRevisionId(maintenance._rev!).set(setPayload);
            if (unsetFields.length > 0) {
                nextPatch = nextPatch.unset(unsetFields);
            }
            return nextPatch;
        });

        try {
            await transaction.commit();
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Stok atau maintenance berubah saat diproses. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }

        await addAuditLog(
            session,
            'UPDATE',
            'maintenances',
            maintenance._id,
            buildMaintenanceCompletionAuditSummary({
                maintenance,
                materialUsageCount: materialUsages.length,
                materialCostTotal,
            })
        );

        return NextResponse.json({
            data: {
                maintenanceRef: maintenance._id,
                status: 'DONE',
                completedDate,
                materialUsageCount: materialUsages.length,
                materialCostTotal,
                stockMovements: movementDocs,
            },
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Penyelesaian maintenance tidak valid' },
            { status: 400 }
        );
    }
}
