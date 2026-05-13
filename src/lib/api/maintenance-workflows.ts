import { NextResponse } from 'next/server';

import { getBusinessDateValue } from '@/lib/business-date';
import { isTireTrackedWarehouseItem, parseInventoryQuantity, parseWholeMoneyAmount } from '@/lib/inventory';
import {
    createDocument,
    getDocumentById,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import type {
    BankTransaction,
    Expense,
    ExpenseCategory,
    InventoryUnit,
    Maintenance,
    MaintenanceMaterialUsage,
    PurchaseItem,
    Service,
    StockMovement,
    TireHistoryLog,
    Vehicle,
    WarehouseItem,
} from '@/lib/types';

import {
    assertIsoDate,
    computeLedgerDebitBalance,
    getLedgerAccount,
    normalizeOptionalText,
    type ApiSession,
    type BankAccountSummary,
} from './data-helpers';
import { postExpenseJournal, postStockMovementJournal } from './accounting-posting';
import { getLatestWarehouseStockMovementDateMap } from './inventory-stock-support';

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

function isOilMaintenanceType(value: unknown) {
    const text = typeof value === 'string' ? value.toLowerCase() : '';
    return text.includes('oli') || text.includes('oil');
}

function resolveOilStatus(remainingKm: number | undefined) {
    if (typeof remainingKm !== 'number' || !Number.isFinite(remainingKm)) {
        return undefined;
    }
    if (remainingKm <= 0) return 'DUE';
    if (remainingKm <= 1000) return 'DUE_SOON';
    return 'OK';
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
    const maintenance = await getDocumentById<MaintenanceSnapshot>(maintenanceRef, 'maintenance');
    if (!maintenance || maintenance._type !== 'maintenance') {
        return null;
    }
    return maintenance;
}

async function loadWarehouseItemSnapshot(itemRef: string) {
    const item = await getDocumentById<WarehouseItemSnapshot>(itemRef, 'warehouseItem');
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
    return item;
}

async function resolveWarehouseItemUnitCost(item: Pick<WarehouseItem, '_id' | 'defaultPurchasePrice'>) {
    const receiptRows = (await listDocumentsByFilter<Pick<PurchaseItem, 'receivedQty' | 'unitPrice'>>(
        'purchaseItem',
        { warehouseItemRef: item._id }
    )).filter(row => parseInventoryQuantity(row.receivedQty) > 0);

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
    laborCost: number;
    totalCost: number;
}) {
    const label = `${input.maintenance.type || 'Maintenance'} ${input.maintenance.vehiclePlate || input.maintenance._id}`;
    const parts: string[] = [];
    if (input.materialUsageCount > 0) {
        parts.push(`${input.materialUsageCount} material gudang ${formatAuditMoney(input.materialCostTotal)}`);
    }
    if (input.laborCost > 0) {
        parts.push(`ongkos jasa ${formatAuditMoney(input.laborCost)}`);
    }
    if (parts.length === 0) {
        return `${label} diselesaikan tanpa biaya internal`;
    }
    return `${label} diselesaikan dengan ${parts.join(' dan ')} (total ${formatAuditMoney(input.totalCost)})`;
}

type MaintenanceLaborExpensePosting = {
    category: ExpenseCategory;
    bankAccount: BankAccountSummary | null;
    nextBankBalance?: number;
};

function resolveMaintenanceExpenseAccountKey(category: ExpenseCategory) {
    return category.accountSystemKey || 'maintenance_expense';
}

async function resolveMaintenanceExpenseCategory() {
    const rows = (await listDocumentsByFilter<ExpenseCategory>('expenseCategory', {}))
        .filter(row => row.active !== false);
    const exact = rows.find(row => row._id === 'expcat-003' && row.scope === 'MAINTENANCE');
    if (exact) return exact;
    const scopedNamed = rows.find(row => row.scope === 'MAINTENANCE' && /servis|service|maintenance|bengkel/i.test(row.name || ''));
    if (scopedNamed) return scopedNamed;
    const scoped = rows.find(row => row.scope === 'MAINTENANCE');
    if (scoped) return scoped;
    const named = rows.find(row => /servis|service|maintenance|bengkel/i.test(row.name || ''));
    if (named) return named;
    throw new Error('Kategori biaya maintenance belum tersedia');
}

export async function prepareMaintenanceLaborExpensePosting(
    laborCost: number,
    bankAccountRef?: string
): Promise<MaintenanceLaborExpensePosting | null> {
    if (laborCost <= 0) return null;
    const category = await resolveMaintenanceExpenseCategory();
    if (!bankAccountRef) {
        return { category, bankAccount: null };
    }
    const bankAccount = await getLedgerAccount(bankAccountRef);
    if (!bankAccount) {
        throw new Error('Rekening/kas pembayaran jasa tidak ditemukan');
    }
    const { startingBalance, nextBalance } = computeLedgerDebitBalance(bankAccount.currentBalance, laborCost);
    if (nextBalance < 0) {
        throw new Error(`Saldo ${bankAccount.bankName} tidak cukup untuk ongkos jasa. Saldo tersedia ${formatAuditMoney(startingBalance)}`);
    }
    return { category, bankAccount, nextBankBalance: nextBalance };
}

export async function createMaintenanceLaborExpense(input: {
    session: ApiSession;
    maintenance: Maintenance;
    category: ExpenseCategory;
    bankAccount: BankAccountSummary | null;
    nextBankBalance?: number;
    completedDate: string;
    laborCost: number;
    vendor?: string;
    completionNotes?: string;
}) {
    const expenseId = `expense-${crypto.randomUUID()}`;
    const vehicleLabel = input.maintenance.vehiclePlate || input.maintenance.vehicleRef || 'unit';
    const note = input.vendor
        ? `Ongkos jasa ${input.vendor}`
        : `Ongkos jasa maintenance ${vehicleLabel}`;
    const expenseDoc: Expense = {
        _id: expenseId,
        _type: 'expense',
        categoryRef: input.category._id,
        categoryName: input.category.name,
        categoryScope: input.category.scope || 'MAINTENANCE',
        accountSystemKey: resolveMaintenanceExpenseAccountKey(input.category),
        date: input.completedDate,
        amount: input.laborCost,
        note,
        description: [input.maintenance.type, vehicleLabel, input.completionNotes].filter(Boolean).join(' - '),
        privacyLevel: 'internal',
        relatedVehicleRef: input.maintenance.vehicleRef,
        relatedVehiclePlate: input.maintenance.vehiclePlate,
        relatedMaintenanceRef: input.maintenance._id,
        ...(input.bankAccount
            ? {
                bankAccountRef: input.bankAccount._id,
                bankAccountName: input.bankAccount.bankName,
                bankAccountNumber: input.bankAccount.accountNumber,
            }
            : {}),
    };

    await createDocument(expenseDoc as unknown as { _type: string; [key: string]: unknown });

    if (input.bankAccount && typeof input.nextBankBalance === 'number') {
        const bankTransactionDoc: BankTransaction = {
            _id: `bank-transaction-${crypto.randomUUID()}`,
            _type: 'bankTransaction',
            bankAccountRef: input.bankAccount._id,
            bankAccountName: input.bankAccount.bankName,
            bankAccountNumber: input.bankAccount.accountNumber,
            type: 'DEBIT',
            amount: input.laborCost,
            date: input.completedDate,
            description: note,
            balanceAfter: input.nextBankBalance,
            relatedExpenseRef: expenseDoc._id,
        };
        await createDocument(bankTransactionDoc as unknown as { _type: string; [key: string]: unknown });
        await updateDocument(input.bankAccount._id, { currentBalance: input.nextBankBalance }, 'bankAccount');
    }

    await postExpenseJournal(input.session, expenseDoc, input.bankAccount);
    return expenseId;
}

export async function getMaintenanceMaterialOptions(): Promise<MaintenanceMaterialOption[]> {
    const rows = (await listDocumentsByFilter<Pick<WarehouseItem, '_id' | 'itemCode' | 'name' | 'category' | 'unit' | 'currentStockQty' | 'trackingMode' | 'active'>>(
        'warehouseItem',
        {}
    ))
        .filter(row => row.active !== false && (row.trackingMode || 'STANDARD') === 'STANDARD' && Math.max(parseInventoryQuantity(row.currentStockQty), 0) > 0)
        .sort((left, right) => {
            const itemCodeCompare = String(left.itemCode || '').localeCompare(String(right.itemCode || ''));
            if (itemCodeCompare !== 0) return itemCodeCompare;
            return String(left.name || '').localeCompare(String(right.name || ''));
        });

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
        const rawLaborCost = data.laborCost;
        const laborBankAccountRef = normalizeOptionalText(data.laborBankAccountRef);

        if (!maintenanceRef) {
            return NextResponse.json({ error: 'Maintenance wajib dipilih' }, { status: 400 });
        }
        assertIsoDate(completedDate, 'Tanggal selesai maintenance');

        const maintenance = await loadMaintenanceSnapshot(maintenanceRef);
        if (!maintenance) {
            return NextResponse.json({ error: 'Maintenance tidak ditemukan' }, { status: 404 });
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

        const laborCost =
            rawLaborCost === undefined || rawLaborCost === null || rawLaborCost === ''
                ? 0
                : parseWholeMoneyAmount(rawLaborCost);
        if (!Number.isFinite(laborCost) || laborCost < 0) {
            return NextResponse.json({ error: 'Ongkos jasa maintenance tidak valid' }, { status: 400 });
        }
        const laborPosting = await prepareMaintenanceLaborExpensePosting(laborCost, laborBankAccountRef);

        const warehouseItems = await Promise.all(materialInputs.map((input) => loadWarehouseItemSnapshot(input.warehouseItemRef)));
        const unitCostSnapshots = await Promise.all(warehouseItems.map((item) => resolveWarehouseItemUnitCost(item)));
        const latestStockMovementDates = await getLatestWarehouseStockMovementDateMap(
            warehouseItems.map((item) => item._id)
        );

        const movementDocs: StockMovement[] = [];
        const materialUsages: MaintenanceMaterialUsage[] = [];

        for (const [index, item] of warehouseItems.entries()) {
            const materialInput = materialInputs[index];
            const latestStockMovementDate = latestStockMovementDates.get(item._id);
            if (latestStockMovementDate && completedDate < latestStockMovementDate) {
                return NextResponse.json(
                    { error: `Tanggal selesai maintenance tidak boleh lebih awal dari mutasi stok terakhir ${item.itemCode}` },
                    { status: 400 }
                );
            }
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

            await updateDocument(item._id, { currentStockQty: nextStockQty });

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
            await createDocument(movementDoc as unknown as { _type: string; [key: string]: unknown });
            await postStockMovementJournal(session, movementDoc, unitCostSnapshot);
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
        const laborExpenseRef = laborPosting
            ? await createMaintenanceLaborExpense({
                session,
                maintenance,
                category: laborPosting.category,
                bankAccount: laborPosting.bankAccount,
                nextBankBalance: laborPosting.nextBankBalance,
                completedDate,
                laborCost,
                vendor,
                completionNotes,
            })
            : undefined;
        const totalCost = materialCostTotal + laborCost;
        const setPayload: Record<string, unknown> = {
            status: 'DONE',
            completedDate,
            materialUsageCount: materialUsages.length,
            materialCostTotal,
            laborCost,
            totalCost,
            cost: totalCost,
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

        if (laborExpenseRef) {
            setPayload.laborExpenseRef = laborExpenseRef;
            setPayload.relatedExpenseRef = laborExpenseRef;
        } else {
            unsetFields.push('laborExpenseRef', 'relatedExpenseRef');
        }

        if (laborPosting?.bankAccount) {
            setPayload.laborBankAccountRef = laborPosting.bankAccount._id;
            setPayload.laborBankAccountName = laborPosting.bankAccount.bankName;
            setPayload.laborBankAccountNumber = laborPosting.bankAccount.accountNumber;
        } else {
            unsetFields.push('laborBankAccountRef', 'laborBankAccountName', 'laborBankAccountNumber');
        }

        if (laborCost <= 0) {
            unsetFields.push('laborCost');
        }

        const maintenanceUpdates = {
            ...setPayload,
            ...Object.fromEntries(unsetFields.map(field => [field, null])),
        };
        await updateDocument(maintenance._id, maintenanceUpdates);

        if (isOilMaintenanceType(maintenance.type)) {
            const vehicle = await getDocumentById<Vehicle>(maintenance.vehicleRef, 'vehicle');
            if (vehicle) {
                const service = vehicle.serviceRef
                    ? await getDocumentById<Service>(vehicle.serviceRef, 'service')
                    : null;
                const currentOdometer = typeof vehicle.lastOdometer === 'number' ? vehicle.lastOdometer : 0;
                const serviceOdometer = odometerParsed ?? currentOdometer;
                const oilIntervalKm = typeof service?.oilMaintenanceKm === 'number' && service.oilMaintenanceKm > 0
                    ? service.oilMaintenanceKm
                    : typeof vehicle.oilMaintenanceIntervalKm === 'number'
                        ? vehicle.oilMaintenanceIntervalKm
                        : 0;
                const nextOilServiceOdometer = oilIntervalKm > 0 ? serviceOdometer + oilIntervalKm : undefined;
                const oilServiceRemainingKm = typeof nextOilServiceOdometer === 'number'
                    ? nextOilServiceOdometer - currentOdometer
                    : undefined;
                const vehicleUpdates: Record<string, unknown> = {
                    oilMaintenanceIntervalKm: oilIntervalKm,
                    oilLastServiceOdometer: serviceOdometer,
                };
                if (typeof nextOilServiceOdometer === 'number') {
                    vehicleUpdates.oilNextServiceOdometer = nextOilServiceOdometer;
                    vehicleUpdates.oilServiceRemainingKm = oilServiceRemainingKm;
                }
                const oilMaintenanceStatus = resolveOilStatus(oilServiceRemainingKm);
                if (oilMaintenanceStatus) {
                    vehicleUpdates.oilMaintenanceStatus = oilMaintenanceStatus;
                }
                if (odometerParsed !== undefined && odometerParsed > currentOdometer) {
                    vehicleUpdates.lastOdometer = odometerParsed;
                    vehicleUpdates.lastOdometerAt = completedDate;
                }
                await updateDocument(vehicle._id, vehicleUpdates, 'vehicle');
            }
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
                laborCost,
                totalCost,
            })
        );

        return NextResponse.json({
            data: {
                maintenanceRef: maintenance._id,
                status: 'DONE',
                completedDate,
                materialUsageCount: materialUsages.length,
                materialCostTotal,
                laborCost,
                totalCost,
                laborExpenseRef,
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

export async function handleTireTechnicianCostCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    try {
        const vehicleRef = normalizeOptionalText(data.vehicleRef);
        const completedDate = normalizeOptionalText(data.completedDate) || getBusinessDateValue();
        const vendor = normalizeOptionalText(data.vendor);
        const completionNotes = normalizeOptionalText(data.completionNotes || data.note);
        const tireContext = normalizeOptionalText(data.tireContext);
        const tireHistoryLogRef = normalizeOptionalText(data.tireHistoryLogRef);
        const laborBankAccountRef = normalizeOptionalText(data.laborBankAccountRef);
        const laborCost = parseWholeMoneyAmount(data.laborCost ?? data.technicianCost ?? 0);
        const rawTireCostLines = Array.isArray(data.tireCostLines) ? data.tireCostLines : [];

        if (!vehicleRef) {
            return NextResponse.json({ error: 'Kendaraan wajib dipilih' }, { status: 400 });
        }
        assertIsoDate(completedDate, 'Tanggal biaya teknisi');
        if (!Number.isFinite(laborCost) || laborCost < 0) {
            return NextResponse.json({ error: 'Biaya teknisi tidak valid' }, { status: 400 });
        }

        const vehicle = await getDocumentById<Vehicle>(vehicleRef, 'vehicle');
        if (!vehicle) {
            return NextResponse.json({ error: 'Kendaraan tidak ditemukan' }, { status: 404 });
        }
        const tireHistory = tireHistoryLogRef
            ? await getDocumentById<TireHistoryLog>(tireHistoryLogRef, 'tireHistoryLog')
            : null;
        if (tireHistoryLogRef && !tireHistory) {
            return NextResponse.json({ error: 'Riwayat ban tidak ditemukan' }, { status: 404 });
        }
        if (tireHistory && tireHistory.costSourceVehicleRef && tireHistory.costSourceVehicleRef !== vehicleRef) {
            return NextResponse.json({ error: 'Riwayat ban tidak sesuai kendaraan' }, { status: 409 });
        }

        const laborPosting = await prepareMaintenanceLaborExpensePosting(laborCost, laborBankAccountRef);
        const maintenanceRef = `maintenance-${crypto.randomUUID()}`;
        const movementLine = tireHistory
            ? `Riwayat ban ${tireHistory.tireCode || tireHistory.tireEventRef}: ${tireHistory.fromPlacementLabel || '-'} -> ${tireHistory.toPlacementLabel || '-'}`
            : '';
        const materialUsages: MaintenanceMaterialUsage[] = rawTireCostLines
            .map((line, index): MaintenanceMaterialUsage | null => {
                if (!line || typeof line !== 'object') return null;
                const row = line as Record<string, unknown>;
                const itemCode = normalizeOptionalText(row.itemCode);
                const itemName = normalizeOptionalText(row.itemName);
                const note = normalizeOptionalText(row.note);
                const subtotalCost = parseWholeMoneyAmount(row.subtotalCost ?? row.unitCostSnapshot ?? 0);
                if (!itemCode && !itemName) return null;
                return {
                    warehouseItemRef: normalizeOptionalText(row.warehouseItemRef) || `tire-display:${maintenanceRef}:${index}`,
                    itemCode: itemCode || undefined,
                    itemName: itemName || itemCode || 'Biaya ban',
                    category: 'Ban',
                    unit: 'PCS',
                    quantity: 1,
                    unitCostSnapshot: Number.isFinite(subtotalCost) ? Math.max(subtotalCost, 0) : 0,
                    subtotalCost: Number.isFinite(subtotalCost) ? Math.max(subtotalCost, 0) : 0,
                    note: note || undefined,
                };
            })
            .filter((line): line is MaintenanceMaterialUsage => Boolean(line));
        if (materialUsages.length === 0 && tireContext) {
            materialUsages.push({
                warehouseItemRef: `tire-context:${maintenanceRef}`,
                itemName: tireContext,
                category: 'Ban',
                unit: 'PCS',
                quantity: 1,
                unitCostSnapshot: 0,
                subtotalCost: 0,
                note: 'Konteks ganti/pasang ban',
            });
        }
        const maintenanceDoc: Maintenance = {
            _id: maintenanceRef,
            _type: 'maintenance',
            vehicleRef,
            vehiclePlate: vehicle.plateNumber,
            type: normalizeOptionalText(data.maintenanceType) || 'Ganti / Pasang Ban',
            scheduleType: 'DATE',
            plannedDate: completedDate,
            status: 'DONE',
            completedDate,
            vendor: vendor || undefined,
            completionNotes: [movementLine, tireContext, completionNotes].filter(Boolean).join('\n'),
            attachmentUrls: [],
            materialUsages,
            materialUsageCount: materialUsages.length,
            materialCostTotal: 0,
            laborCost,
            totalCost: laborCost,
            cost: laborCost,
            source: 'TIRE_REPLACEMENT',
        };

        await createDocument(maintenanceDoc as unknown as { _type: string; [key: string]: unknown });

        const laborExpenseRef = laborPosting
            ? await createMaintenanceLaborExpense({
                session,
                maintenance: maintenanceDoc,
                category: laborPosting.category,
                bankAccount: laborPosting.bankAccount,
                nextBankBalance: laborPosting.nextBankBalance,
                completedDate,
                laborCost,
                vendor,
                completionNotes,
            })
            : undefined;

        if (laborExpenseRef || laborPosting?.bankAccount) {
            await updateDocument(maintenanceRef, {
                laborExpenseRef: laborExpenseRef || null,
                relatedExpenseRef: laborExpenseRef || null,
                laborBankAccountRef: laborPosting?.bankAccount?._id || null,
                laborBankAccountName: laborPosting?.bankAccount?.bankName || null,
                laborBankAccountNumber: laborPosting?.bankAccount?.accountNumber || null,
            }, 'maintenance');
        }

        if (tireHistory && !tireHistory.relatedMaintenanceRef) {
            await updateDocument(tireHistory._id, { relatedMaintenanceRef: maintenanceRef }, 'tireHistoryLog');
        }

        await addAuditLog(
            session,
            'CREATE',
            'maintenances',
            maintenanceRef,
            `Catat biaya teknisi ban ${vehicle.plateNumber || vehicleRef} ${formatAuditMoney(laborCost)}`
        );

        return NextResponse.json({
            data: {
                maintenanceRef,
                laborCost,
                laborExpenseRef,
            },
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Gagal mencatat biaya teknisi ban' },
            { status: 400 }
        );
    }
}
