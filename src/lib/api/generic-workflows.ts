import { NextResponse } from 'next/server';

import { getBusinessDateValue } from '@/lib/business-date';
import { createSession, setSessionCookie } from '@/lib/auth';
import {
    getSanityClient,
    sanityCreate,
    sanityDelete,
    sanityGetById,
    sanityGetCompanyProfile,
    sanityGetNextNumber,
} from '@/lib/sanity';
import {
    buildDefaultTireLayoutConfig,
    normalizeTireLayoutConfig,
} from '@/lib/tire-slots';
import {
    buildTireHistoryLogDoc,
    buildTireHistorySnapshot,
} from '@/lib/tire-history';
import {
    buildTrackedTireStockMovementDoc,
    buildTrackedTireWarehouseNote,
    countsTowardTrackedTireWarehouseStock,
    resolveTrackedTirePlacementLabel,
} from '@/lib/tire-inventory';
import { isTireTrackedWarehouseItem } from '@/lib/inventory';
import type { BankTransaction, CompanyProfile, User, WarehouseItem } from '@/lib/types';

import {
    assertIsoDate,
    CASH_ACCOUNT_SYSTEM_KEY,
    extractRefId,
    isMutationConflictError,
    isPlainObject,
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
    readLedgerBalance,
    sanitizeUserForClient,
    type ApiSession,
    type BankAccountSummary,
} from './data-helpers';
import { applyDerivedBankAccountBalances } from './data-query-support';
import {
    normalizeBankAccountPayload,
    normalizeCustomerPayload,
    normalizeCustomerPickupPayload,
    normalizeCustomerProductPayload,
    normalizeCustomerRecipientPayload,
    normalizeSupplierPayload,
    normalizeTripRouteRatePayload,
    normalizeWarehouseItemPayload,
    resolveTripRouteRateSelection,
} from './generic-workflow-support';
import {
    handleDriverBoronganDelete,
    handleDriverVoucherDisbursementDelete,
    handleDriverVoucherItemDelete,
} from './driver-workflows';
import {
    handleDriverScoreCreate,
    handleDriverScoreUpdate,
} from './driver-score-workflows';
import {
    buildEmployeeAttendanceSummary,
    buildEmployeeSummary,
    normalizeEmployeeAttendanceCreatePayload,
    normalizeEmployeeAttendanceUpdates,
    normalizeEmployeePayload,
} from './employee-workflows';
import { handleFreightNotaDelete } from './finance-workflows';
import {
    handleDriverUpdate,
    handleDriverDelete,
    handleExpenseCategoryDelete,
    handleServiceDelete,
    handleVehicleDelete,
    normalizeDriverPayload,
    normalizeExpenseCategoryPayload,
    normalizeMaintenanceCreatePayload,
    normalizeServicePayload,
    normalizeTireEventPayload,
    normalizeVehiclePayload,
} from './operations-workflows';
import { handleOrderDelete, syncOrderStatusFromItems } from './order-workflows';
import {
    handleCustomerDelete,
    normalizeUserCreatePayload,
    normalizeUserUpdates,
} from './support-workflows';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

type SanityMutations = Parameters<ReturnType<typeof getSanityClient>['mutate']>[0];

const COMPANY_ASSET_DATA_URL_RE = /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i;
const COMPANY_ASSET_MAX_LENGTH = 1_500_000;

function sanitizeCompanyAssetUrl(value: unknown, label: string) {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        return undefined;
    }

    if (normalized.length > COMPANY_ASSET_MAX_LENGTH) {
        throw new Error(`${label} terlalu besar`);
    }

    if (normalized.startsWith('/')) {
        return normalized;
    }

    if (COMPANY_ASSET_DATA_URL_RE.test(normalized)) {
        return normalized;
    }

    try {
        const url = new URL(normalized);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
            return normalized;
        }
    } catch {
        // Ignore parse error and fall through to the validation error below.
    }

    throw new Error(`${label} harus berupa URL gambar http(s), path internal, atau data URL image base64 yang valid`);
}

function sanitizeCompanyCounter(value: unknown, fallback = 0) {
    const normalized = normalizeNumber(value);
    if (!Number.isFinite(normalized) || normalized < 0) {
        return fallback;
    }
    return Math.floor(normalized);
}

function parseCompanyWholeNumberInput(value: unknown) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
            return null;
        }
        return value;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed || !/[0-9]/.test(trimmed) || /[a-z]/i.test(trimmed)) {
            return null;
        }

        const groupedIntegerPattern = /^-?\d{1,3}(?:[.,]\d{3})*$/;
        const plainIntegerPattern = /^-?\d+$/;
        if (!groupedIntegerPattern.test(trimmed) && !plainIntegerPattern.test(trimmed)) {
            return null;
        }
    }

    const normalized = normalizeNumber(value, { allowDecimal: false, maxFractionDigits: 0 });
    if (!Number.isFinite(normalized) || normalized < 0 || !Number.isInteger(normalized)) {
        return null;
    }
    return Math.floor(normalized);
}

function normalizeCompanyDateFormatInput(value: unknown) {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        return undefined;
    }
    return normalized === 'DD/MM/YYYY' || normalized === 'dd/MM/yyyy' ? normalized : null;
}

function sanitizeCompanyThemeColor(value: unknown, fallback?: string) {
    const normalized = normalizeOptionalText(value);
    if (!normalized) {
        return fallback;
    }
    return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

async function sanitizeCompanyInvoiceSettings(
    input: Record<string, unknown>,
    existingCompany?: CompanyProfile | null,
): Promise<Record<string, unknown>> {
    const existingNumbering = isPlainObject(existingCompany?.numberingSettings)
        ? existingCompany.numberingSettings as Record<string, unknown>
        : {};
    const numberingInput = isPlainObject(input.numberingSettings) ? input.numberingSettings as Record<string, unknown> : {};
    const existingInvoiceSettings = isPlainObject(existingCompany?.invoiceSettings)
        ? existingCompany.invoiceSettings as Record<string, unknown>
        : {};
    const invoiceSettings = isPlainObject(input.invoiceSettings) ? input.invoiceSettings as Record<string, unknown> : {};
    const existingDocumentSettings = isPlainObject(existingCompany?.documentSettings)
        ? existingCompany.documentSettings as Record<string, unknown>
        : {};
    const documentSettingsInput = isPlainObject(input.documentSettings)
        ? input.documentSettings as Record<string, unknown>
        : {};
    const hasInvoiceBankAccountRefs = Object.prototype.hasOwnProperty.call(invoiceSettings, 'invoiceBankAccountRefs');
    if (hasInvoiceBankAccountRefs && !Array.isArray(invoiceSettings.invoiceBankAccountRefs)) {
        throw new Error('Daftar rekening instruksi nota tidak valid');
    }
    const rawSelectedRefs = hasInvoiceBankAccountRefs
        ? Array.isArray(invoiceSettings.invoiceBankAccountRefs)
            ? invoiceSettings.invoiceBankAccountRefs
            : []
        : Array.isArray(existingInvoiceSettings.invoiceBankAccountRefs)
            ? existingInvoiceSettings.invoiceBankAccountRefs
            : [];
    const selectedRefs = rawSelectedRefs.filter(
        (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
    );
    const uniqueRefs = Array.from(new Set(selectedRefs));
    const validRows = uniqueRefs.length > 0
        ? await getSanityClient().fetch<Array<{ _id: string }>>(
            `*[_type == "bankAccount" && _id in $refs && active != false && accountType != "CASH"]{ _id }`,
            { refs: uniqueRefs }
        )
        : [];
    const validRefSet = new Set(validRows.map(row => row._id));
    const invoiceBankAccountRefs = uniqueRefs.filter(ref => validRefSet.has(ref));
    const hasDefaultInvoiceBankAccountRef = Object.prototype.hasOwnProperty.call(invoiceSettings, 'defaultInvoiceBankAccountRef');
    if (
        hasDefaultInvoiceBankAccountRef
        && invoiceSettings.defaultInvoiceBankAccountRef !== undefined
        && typeof invoiceSettings.defaultInvoiceBankAccountRef !== 'string'
    ) {
        throw new Error('Rekening default instruksi nota tidak valid');
    }
    const requestedDefaultRef =
        typeof invoiceSettings.defaultInvoiceBankAccountRef === 'string'
            ? invoiceSettings.defaultInvoiceBankAccountRef
            : !hasDefaultInvoiceBankAccountRef && typeof existingInvoiceSettings.defaultInvoiceBankAccountRef === 'string'
                ? existingInvoiceSettings.defaultInvoiceBankAccountRef
            : undefined;
    const defaultInvoiceBankAccountRef =
        requestedDefaultRef && invoiceBankAccountRefs.includes(requestedDefaultRef)
            ? requestedDefaultRef
            : invoiceBankAccountRefs[0];
    const hasInvoiceMode = Object.prototype.hasOwnProperty.call(invoiceSettings, 'invoiceMode');
    const rawInvoiceMode = normalizeOptionalText(invoiceSettings.invoiceMode)?.toUpperCase();
    if (hasInvoiceMode && (!rawInvoiceMode || (rawInvoiceMode !== 'DO' && rawInvoiceMode !== 'ORDER'))) {
        throw new Error('Mode invoice/nota perusahaan tidak valid');
    }
    const hasDefaultTermDays = Object.prototype.hasOwnProperty.call(invoiceSettings, 'defaultTermDays');
    const rawDefaultTermDays = parseCompanyWholeNumberInput(invoiceSettings.defaultTermDays);
    if (hasDefaultTermDays && rawDefaultTermDays === null) {
        throw new Error('Termin default nota tidak valid');
    }
    const hasDueDateDays = Object.prototype.hasOwnProperty.call(invoiceSettings, 'dueDateDays');
    const rawDueDateDays = parseCompanyWholeNumberInput(invoiceSettings.dueDateDays);
    if (hasDueDateDays && rawDueDateDays === null) {
        throw new Error('Jatuh tempo default nota tidak valid');
    }
    const nextDefaultTermDays = hasDefaultTermDays
        ? rawDefaultTermDays ?? 0
        : sanitizeCompanyCounter(existingInvoiceSettings.defaultTermDays, 30);
    const nextDueDateDays = hasDueDateDays
        ? rawDueDateDays ?? 0
        : sanitizeCompanyCounter(existingInvoiceSettings.dueDateDays, 14);
    const counterConfigs = [
        ['resiCounter', 'Counter nomor resi tidak valid'],
        ['doCounter', 'Counter nomor surat jalan tidak valid'],
        ['invoiceCounter', 'Counter nomor invoice tidak valid'],
        ['notaCounter', 'Counter nomor nota tidak valid'],
        ['receiptCounter', 'Counter nomor receipt tidak valid'],
        ['boronganCounter', 'Counter nomor borongan tidak valid'],
        ['bonCounter', 'Counter nomor bon tidak valid'],
        ['incidentCounter', 'Counter nomor insiden tidak valid'],
    ] as const;
    for (const [field, errorMessage] of counterConfigs) {
        if (Object.prototype.hasOwnProperty.call(numberingInput, field) && parseCompanyWholeNumberInput(numberingInput[field]) === null) {
            throw new Error(errorMessage);
        }
    }
    if (
        Object.prototype.hasOwnProperty.call(documentSettingsInput, 'showContact')
        && typeof documentSettingsInput.showContact !== 'boolean'
    ) {
        throw new Error('Pengaturan tampilkan kontak dokumen tidak valid');
    }
    if (
        Object.prototype.hasOwnProperty.call(documentSettingsInput, 'dateFormat')
        && normalizeCompanyDateFormatInput(documentSettingsInput.dateFormat) === null
    ) {
        throw new Error('Format tanggal dokumen tidak valid');
    }

    return {
        name: normalizeOptionalText(input.name) || normalizeOptionalText(existingCompany?.name) || 'PT Gading Mas Surya',
        address: normalizeOptionalText(input.address) || normalizeOptionalText(existingCompany?.address) || '-',
        phone: normalizeOptionalText(input.phone) || normalizeOptionalText(existingCompany?.phone) || '-',
        email: normalizeOptionalText(input.email) || normalizeOptionalText(existingCompany?.email) || '-',
        npwp: normalizeOptionalText(input.npwp) || normalizeOptionalText(existingCompany?.npwp),
        bankName: normalizeOptionalText(input.bankName) || normalizeOptionalText(existingCompany?.bankName),
        bankAccount: normalizeOptionalText(input.bankAccount) || normalizeOptionalText(existingCompany?.bankAccount),
        bankHolder: normalizeOptionalText(input.bankHolder) || normalizeOptionalText(existingCompany?.bankHolder),
        themeColor: sanitizeCompanyThemeColor(input.themeColor, sanitizeCompanyThemeColor(existingCompany?.themeColor)),
        logoUrl: sanitizeCompanyAssetUrl(input.logoUrl, 'Logo perusahaan') ?? sanitizeCompanyAssetUrl(existingCompany?.logoUrl, 'Logo perusahaan'),
        headerStampUrl:
            sanitizeCompanyAssetUrl(input.headerStampUrl, 'Header stamp perusahaan')
            ?? sanitizeCompanyAssetUrl(existingCompany?.headerStampUrl, 'Header stamp perusahaan'),
        signatureStampUrl:
            sanitizeCompanyAssetUrl(input.signatureStampUrl, 'Stempel tanda tangan perusahaan')
            ?? sanitizeCompanyAssetUrl(existingCompany?.signatureStampUrl, 'Stempel tanda tangan perusahaan'),
        numberingSettings: {
            resiPrefix: normalizeOptionalText(numberingInput.resiPrefix) || normalizeOptionalText(existingNumbering.resiPrefix) || 'R-',
            resiCounter: sanitizeCompanyCounter(numberingInput.resiCounter, sanitizeCompanyCounter(existingNumbering.resiCounter)),
            resiPeriod: normalizeOptionalText(numberingInput.resiPeriod) || normalizeOptionalText(existingNumbering.resiPeriod),
            doPrefix: normalizeOptionalText(numberingInput.doPrefix) || normalizeOptionalText(existingNumbering.doPrefix) || 'DO-',
            doCounter: sanitizeCompanyCounter(numberingInput.doCounter, sanitizeCompanyCounter(existingNumbering.doCounter)),
            doPeriod: normalizeOptionalText(numberingInput.doPeriod) || normalizeOptionalText(existingNumbering.doPeriod),
            invoicePrefix: normalizeOptionalText(numberingInput.invoicePrefix) || normalizeOptionalText(existingNumbering.invoicePrefix) || 'INV-',
            invoiceCounter: sanitizeCompanyCounter(numberingInput.invoiceCounter, sanitizeCompanyCounter(existingNumbering.invoiceCounter)),
            invoicePeriod: normalizeOptionalText(numberingInput.invoicePeriod) || normalizeOptionalText(existingNumbering.invoicePeriod),
            notaPrefix: normalizeOptionalText(numberingInput.notaPrefix) || normalizeOptionalText(existingNumbering.notaPrefix) || 'NOTA-',
            notaCounter: sanitizeCompanyCounter(numberingInput.notaCounter, sanitizeCompanyCounter(existingNumbering.notaCounter)),
            notaPeriod: normalizeOptionalText(numberingInput.notaPeriod) || normalizeOptionalText(existingNumbering.notaPeriod),
            notaSeriesCode: normalizeOptionalText(numberingInput.notaSeriesCode) || normalizeOptionalText(existingNumbering.notaSeriesCode) || '3',
            receiptPrefix: normalizeOptionalText(numberingInput.receiptPrefix) || normalizeOptionalText(existingNumbering.receiptPrefix) || 'RCV-',
            receiptCounter: sanitizeCompanyCounter(numberingInput.receiptCounter, sanitizeCompanyCounter(existingNumbering.receiptCounter)),
            receiptPeriod: normalizeOptionalText(numberingInput.receiptPeriod) || normalizeOptionalText(existingNumbering.receiptPeriod),
            boronganPrefix: normalizeOptionalText(numberingInput.boronganPrefix) || normalizeOptionalText(existingNumbering.boronganPrefix) || 'BRG-',
            boronganCounter: sanitizeCompanyCounter(numberingInput.boronganCounter, sanitizeCompanyCounter(existingNumbering.boronganCounter)),
            boronganPeriod: normalizeOptionalText(numberingInput.boronganPeriod) || normalizeOptionalText(existingNumbering.boronganPeriod),
            bonPrefix: normalizeOptionalText(numberingInput.bonPrefix) || normalizeOptionalText(existingNumbering.bonPrefix) || 'BON-',
            bonCounter: sanitizeCompanyCounter(numberingInput.bonCounter, sanitizeCompanyCounter(existingNumbering.bonCounter)),
            bonPeriod: normalizeOptionalText(numberingInput.bonPeriod) || normalizeOptionalText(existingNumbering.bonPeriod),
            incidentPrefix: normalizeOptionalText(numberingInput.incidentPrefix) || normalizeOptionalText(existingNumbering.incidentPrefix) || 'INC-',
            incidentCounter: sanitizeCompanyCounter(numberingInput.incidentCounter, sanitizeCompanyCounter(existingNumbering.incidentCounter)),
            incidentPeriod: normalizeOptionalText(numberingInput.incidentPeriod) || normalizeOptionalText(existingNumbering.incidentPeriod),
        },
        invoiceSettings: {
            defaultTermDays: Math.floor(nextDefaultTermDays),
            dueDateDays: Math.floor(nextDueDateDays),
            footerNote: normalizeOptionalText(invoiceSettings.footerNote) || normalizeOptionalText(existingInvoiceSettings.footerNote) || '',
            invoiceMode:
                rawInvoiceMode === 'DO' || rawInvoiceMode === 'ORDER'
                    ? rawInvoiceMode
                    : existingInvoiceSettings.invoiceMode === 'DO'
                        ? 'DO'
                        : 'ORDER',
            invoiceBankAccountRefs,
            defaultInvoiceBankAccountRef,
        },
        documentSettings: {
            showContact:
                typeof documentSettingsInput.showContact === 'boolean'
                    ? documentSettingsInput.showContact
                    : typeof existingDocumentSettings.showContact === 'boolean'
                        ? existingDocumentSettings.showContact
                        : true,
            dateFormat:
                normalizeCompanyDateFormatInput(documentSettingsInput.dateFormat)
                || normalizeCompanyDateFormatInput(existingDocumentSettings.dateFormat)
                || 'DD/MM/YYYY',
        },
    };
}

async function buildInvoiceInstructionAccountRemoval(accountId: string) {
    const company = await sanityGetCompanyProfile() as (CompanyProfile & { _id?: string; _rev?: string }) | null;
    if (!company?._id) {
        return null;
    }

    const selectedRefs: string[] = Array.isArray(company.invoiceSettings?.invoiceBankAccountRefs)
        ? company.invoiceSettings.invoiceBankAccountRefs.filter(
            (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
        )
        : [];
    const hasSelectedRef = selectedRefs.includes(accountId);
    const isDefaultRef = company.invoiceSettings?.defaultInvoiceBankAccountRef === accountId;

    if (!hasSelectedRef && !isDefaultRef) {
        return null;
    }

    if (!company._rev) {
        throw new Error('Revisi profil perusahaan tidak tersedia. Refresh lalu coba lagi.');
    }

    const nextRefs = selectedRefs.filter((ref: string) => ref !== accountId);
    const nextDefaultRef =
        nextRefs.includes(company.invoiceSettings?.defaultInvoiceBankAccountRef || '')
            ? company.invoiceSettings?.defaultInvoiceBankAccountRef
            : nextRefs[0];

    return {
        companyId: company._id,
        companyRev: company._rev,
        invoiceSettings: {
            ...company.invoiceSettings,
            invoiceBankAccountRefs: nextRefs,
            defaultInvoiceBankAccountRef: nextDefaultRef,
        },
    };
}

async function clearOtherCustomerScopedDefaults(docType: 'customerRecipient' | 'customerPickupLocation', customerRef: string, keepId: string) {
    const otherDocIds = await getSanityClient().fetch<Array<{ _id: string }>>(
        `*[_type == $docType && customerRef == $customerRef && _id != $keepId && isDefault == true]{ _id }`,
        { docType, customerRef, keepId }
    );
    const transaction = getSanityClient().transaction().patch(keepId, patch => patch.set({ isDefault: true }));
    for (const doc of otherDocIds) {
        transaction.patch(doc._id, patch => patch.set({ isDefault: false }));
    }
    await transaction.commit();
}

function isProtectedLedgerEntity(entity: string) {
    return (
        entity === 'payments' ||
        entity === 'customer-receipts' ||
        entity === 'customer-overpayment-refunds' ||
        entity === 'invoice-adjustments' ||
        entity === 'incomes' ||
        entity === 'expenses' ||
        entity === 'bank-transactions' ||
        entity === 'purchase-payments'
    );
}

function isWorkflowManagedCreateEntity(entity: string) {
    return (
        entity === 'orders' ||
        entity === 'order-items' ||
        entity === 'delivery-orders' ||
        entity === 'delivery-order-items' ||
        entity === 'tracking-logs' ||
        entity === 'invoices' ||
        entity === 'invoice-items' ||
        entity === 'freight-notas' ||
        entity === 'freight-nota-items' ||
        entity === 'driver-borongans' ||
        entity === 'driver-borogan-items' ||
        entity === 'driver-borongan-items' ||
        entity === 'payments' ||
        entity === 'customer-receipts' ||
        entity === 'customer-overpayment-refunds' ||
        entity === 'purchases' ||
        entity === 'purchase-items' ||
        entity === 'purchase-payments' ||
        entity === 'stock-movements' ||
        entity === 'invoice-adjustments' ||
        entity === 'incomes' ||
        entity === 'expenses' ||
        entity === 'bank-transactions' ||
        entity === 'driver-vouchers' ||
        entity === 'driver-voucher-items' ||
        entity === 'driver-voucher-disbursements' ||
        entity === 'incidents' ||
        entity === 'incident-action-logs' ||
        entity === 'incident-settlement-lines' ||
        entity === 'tire-history-logs' ||
        entity === 'audit-logs'
    );
}

function isWorkflowManagedUpdateEntity(entity: string) {
    return (
        entity === 'orders' ||
        entity === 'order-items' ||
        entity === 'delivery-order-items' ||
        entity === 'tracking-logs' ||
        entity === 'customer-overpayment-refunds' ||
        entity === 'purchases' ||
        entity === 'purchase-items' ||
        entity === 'purchase-payments' ||
        entity === 'stock-movements' ||
        entity === 'driver-vouchers' ||
        entity === 'freight-notas' ||
        entity === 'freight-nota-items' ||
        entity === 'driver-borongans' ||
        entity === 'driver-borogan-items' ||
        entity === 'driver-borongan-items' ||
        entity === 'driver-voucher-items' ||
        entity === 'driver-voucher-disbursements' ||
        entity === 'incidents' ||
        entity === 'incident-action-logs' ||
        entity === 'incident-settlement-lines' ||
        entity === 'tire-history-logs' ||
        entity === 'audit-logs'
    );
}

function isWorkflowManagedDeleteEntity(entity: string) {
    return (
        entity === 'driver-vouchers' ||
        entity === 'incidents' ||
        entity === 'incident-action-logs' ||
        entity === 'incident-settlement-lines' ||
        entity === 'tire-history-logs' ||
        entity === 'delivery-orders' ||
        entity === 'delivery-order-items' ||
        entity === 'order-items' ||
        entity === 'invoice-items' ||
        entity === 'freight-nota-items' ||
        entity === 'driver-borogan-items' ||
        entity === 'driver-borongan-items' ||
        entity === 'tracking-logs'
        || entity === 'customer-overpayment-refunds'
        || entity === 'purchases'
        || entity === 'purchase-items'
        || entity === 'purchase-payments'
        || entity === 'stock-movements'
    );
}

function buildCreateSummary(newDoc: Record<string, unknown>, fallbackId: string) {
    if (newDoc._type === 'employee') {
        return buildEmployeeSummary(newDoc, fallbackId);
    }
    if (newDoc._type === 'employeeAttendanceRecord') {
        return buildEmployeeAttendanceSummary(newDoc, fallbackId);
    }
    return (
        (newDoc.originArea && newDoc.destinationArea
            ? `${newDoc.originArea} -> ${newDoc.destinationArea}${newDoc.serviceName ? ` (${newDoc.serviceName})` : ''}`
            : undefined) ||
        newDoc.masterResi ||
        newDoc.doNumber ||
        newDoc.purchaseNumber ||
        newDoc.invoiceNumber ||
        newDoc.notaNumber ||
        newDoc.boronganNumber ||
        newDoc.incidentNumber ||
        newDoc.itemCode ||
        newDoc.supplierCode ||
        newDoc.label ||
        newDoc.name ||
        fallbackId
    );
}

function buildCreateAuditSummary(entity: string, newDoc: Record<string, unknown>, fallbackId: string) {
    if (entity === 'employees') {
        return `Tambah karyawan ${buildEmployeeSummary(newDoc, fallbackId)}`;
    }
    if (entity === 'employee-attendance-records') {
        return `Catat absensi ${buildEmployeeAttendanceSummary(newDoc, fallbackId)}`;
    }
    if (entity === 'suppliers') {
        return `Tambah supplier ${buildCreateSummary(newDoc, fallbackId)}`;
    }
    if (entity === 'warehouse-items') {
        return `Tambah barang gudang ${buildCreateSummary(newDoc, fallbackId)}`;
    }
    if (entity === 'tire-events') {
        return `Tambah ban ${(newDoc as Record<string, unknown>).tireCode}: ${(newDoc as Record<string, unknown>).posisi} (${(newDoc as Record<string, unknown>).status})`;
    }
    return `Created ${entity}: ${buildCreateSummary(newDoc, fallbackId)}`;
}

async function resolveTrackedTireWarehouseItem(itemRef: string) {
    const item = await sanityGetById<WarehouseItem>(itemRef);
    if (!item || item._type !== 'warehouseItem') {
        throw new Error('Master barang gudang ban tidak ditemukan');
    }
    if (!isTireTrackedWarehouseItem(item)) {
        throw new Error('Master barang gudang terkait ban harus bertipe ban tertracking');
    }
    return item;
}

async function appendTrackedTireWarehouseSync(params: {
    transaction: ReturnType<ReturnType<typeof getSanityClient>['transaction']>;
    previousDoc: Record<string, unknown> | null;
    nextDoc: Record<string, unknown>;
    session: Pick<ApiSession, '_id' | 'name'>;
}) {
    const previousItemRef = normalizeOptionalText(params.previousDoc?.linkedWarehouseItemRef);
    const nextItemRef = normalizeOptionalText(params.nextDoc.linkedWarehouseItemRef);
    if (previousItemRef && nextItemRef && previousItemRef !== nextItemRef) {
        throw new Error('Master barang gudang ban yang sudah terhubung tidak boleh diganti');
    }
    const itemRef = nextItemRef || previousItemRef;
    if (!itemRef) {
        return;
    }

    const warehouseItem = await resolveTrackedTireWarehouseItem(itemRef);
    const countedBefore = countsTowardTrackedTireWarehouseStock(params.previousDoc || {});
    const countedAfter = countsTowardTrackedTireWarehouseStock(params.nextDoc);
    if (countedBefore === countedAfter) {
        return;
    }

    const currentStockQty = Math.max(normalizeNumber(warehouseItem.currentStockQty ?? 0), 0);
    const nextStockQty = countedAfter ? currentStockQty + 1 : currentStockQty - 1;
    if (nextStockQty < 0) {
        throw new Error('Stok gudang ban terkait tidak cukup untuk perpindahan ini');
    }

    const previousPlacement = params.previousDoc ? resolveTrackedTirePlacementLabel(params.previousDoc) : undefined;
    const nextPlacement = resolveTrackedTirePlacementLabel(params.nextDoc);
    const tireCode = normalizeOptionalText(params.nextDoc.tireCode) || normalizeOptionalText(params.previousDoc?.tireCode) || itemRef;

    params.transaction.patch(warehouseItem._id, patch => patch.set({ currentStockQty: nextStockQty }));
    params.transaction.create(buildTrackedTireStockMovementDoc({
        warehouseItem,
        quantity: 1,
        balanceAfter: nextStockQty,
        movementDate: getBusinessDateValue(),
        type: countedAfter ? 'IN' : 'OUT',
        sourceType: countedAfter ? 'TIRE_RETURN' : 'TIRE_DEPLOYMENT',
        sourceRef: typeof params.nextDoc._id === 'string' ? params.nextDoc._id : undefined,
        sourceNumber: tireCode,
        note: buildTrackedTireWarehouseNote({
            tireCode,
            fromPlacement: previousPlacement,
            toPlacement: nextPlacement,
        }),
        createdBy: params.session._id,
        createdByName: params.session.name,
    }));
}

export async function handleGenericUpdate(
    session: ApiSession,
    entity: string,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const updatesInput = isPlainObject(data.updates) ? data.updates : null;
    if (!id || !updatesInput) {
        return NextResponse.json({ error: 'Invalid update payload' }, { status: 400 });
    }
    const updates: Record<string, unknown> = { ...updatesInput };
    let sanitizedEntityUpdates: Record<string, unknown> | null = null;
    let selectedTripRouteRateRevision: { _id: string; _rev: string } | null = null;

    if (isProtectedLedgerEntity(entity)) {
        return NextResponse.json({ error: 'Entri keuangan yang sudah terposting tidak boleh diubah lewat API umum' }, { status: 409 });
    }

    if (entity === 'tire-history-logs') {
        return NextResponse.json({ error: 'Riwayat ban dibuat otomatis oleh sistem dan tidak boleh diubah manual' }, { status: 409 });
    }

    if (isWorkflowManagedUpdateEntity(entity)) {
        return NextResponse.json({ error: 'Dokumen workflow ini tidak boleh diubah lewat API umum' }, { status: 409 });
    }

    if (entity === 'incidents' && typeof updates.status === 'string') {
        return NextResponse.json({ error: 'Status insiden harus lewat workflow server' }, { status: 400 });
    }

    if (entity === 'delivery-orders' && typeof updates.status === 'string') {
        return NextResponse.json({ error: 'Status surat jalan harus lewat workflow server' }, { status: 400 });
    }

    if (entity === 'delivery-orders') {
        const allowedDeliveryOrderFields = new Set([
            'podReceiverName',
            'podReceivedDate',
            'podNote',
            'tripRouteRateRef',
            'tripOriginArea',
            'tripDestinationArea',
            'taripBorongan',
            'keteranganBorongan',
        ]);
        const updateKeys = Object.keys(updates);
        if (updateKeys.some(key => !allowedDeliveryOrderFields.has(key))) {
            return NextResponse.json({ error: 'Field surat jalan ini tidak boleh diubah lewat API umum' }, { status: 400 });
        }

        const existingDeliveryOrder = await sanityGetById<{
            status?: string;
            podReceiverName?: string;
            podReceivedDate?: string;
            serviceRef?: string;
            baseTaripBorongan?: number;
            overtonaseDriverAmount?: number;
        }>(id);
        if (!existingDeliveryOrder) {
            return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
        }

        const updatesPod = updateKeys.some(key => key === 'podReceiverName' || key === 'podReceivedDate' || key === 'podNote');
        const updatesBoronganTariff = updateKeys.some(key => key === 'taripBorongan' || key === 'keteranganBorongan');
        const updatesTripRouteSelection = updateKeys.some(key => key === 'tripRouteRateRef' || key === 'tripOriginArea' || key === 'tripDestinationArea');

        if (updatesPod) {
            if (existingDeliveryOrder.status !== 'DELIVERED') {
                return NextResponse.json({ error: 'POD hanya boleh disimpan untuk surat jalan yang sudah delivered' }, { status: 409 });
            }
            if (existingDeliveryOrder.podReceiverName || existingDeliveryOrder.podReceivedDate) {
                return NextResponse.json({ error: 'POD yang sudah tersimpan tidak boleh diubah lewat API umum' }, { status: 409 });
            }

            const podReceiverName = normalizeOptionalText(updates.podReceiverName);
            const podReceivedDate = normalizeOptionalText(updates.podReceivedDate);
            if (!podReceiverName || !podReceivedDate) {
                return NextResponse.json({ error: 'Nama penerima dan tanggal terima POD wajib diisi' }, { status: 400 });
            }
            try {
                assertIsoDate(podReceivedDate, 'Tanggal terima POD');
            } catch (error) {
                return NextResponse.json(
                    { error: error instanceof Error ? error.message : 'Tanggal terima POD tidak valid' },
                    { status: 400 }
                );
            }

            updates.podReceiverName = podReceiverName;
            updates.podReceivedDate = podReceivedDate;
            updates.podNote = normalizeOptionalText(updates.podNote);
        }

        if (updatesBoronganTariff || updatesTripRouteSelection) {
            if (existingDeliveryOrder.status === 'CANCELLED') {
                return NextResponse.json({ error: 'Tarip borongan tidak bisa diubah untuk surat jalan yang dibatalkan' }, { status: 409 });
            }

            const relatedBoronganItem = await getSanityClient().fetch<{ _id: string } | null>(
                `*[_type == "driverBoronganItem" && doRef == $ref][0]{ _id }`,
                { ref: id }
            );
            if (relatedBoronganItem) {
                return NextResponse.json({ error: 'Tarip borongan DO yang sudah masuk slip borongan tidak boleh diubah' }, { status: 409 });
            }

            const relatedVoucher = await getSanityClient().fetch<{ _id: string; bonNumber?: string } | null>(
                `*[_type == "driverVoucher" && (deliveryOrderRef == $ref || deliveryOrderRef._ref == $ref)][0]{ _id, bonNumber }`,
                { ref: id }
            );
            if (relatedVoucher) {
                return NextResponse.json(
                    {
                        error: `Upah trip DO yang sudah punya uang jalan trip ${relatedVoucher.bonNumber || ''} tidak boleh diubah`,
                    },
                    { status: 409 }
                );
            }

            if (updatesTripRouteSelection) {
                try {
                    const tripRouteSelection = await resolveTripRouteRateSelection(updates, {
                        serviceRef: normalizeOptionalText(existingDeliveryOrder.serviceRef),
                    });
                    const matchedTripRouteRateFee = normalizeCurrencyNumber(tripRouteSelection.matchedTripRouteRate?.rate ?? 0);
                    if (
                        Object.prototype.hasOwnProperty.call(updates, 'taripBorongan') &&
                        matchedTripRouteRateFee > 0
                    ) {
                        const requestedTaripBorongan = normalizeCurrencyNumber(updates.taripBorongan);
                        if (
                            Number.isFinite(requestedTaripBorongan) &&
                            requestedTaripBorongan > 0 &&
                            Math.abs(requestedTaripBorongan - matchedTripRouteRateFee) > 0.01
                        ) {
                            return NextResponse.json(
                                { error: 'Upah trip mengikuti master biaya rute trip yang dipilih. Ubah area trip jika ingin memakai master yang berbeda.' },
                                { status: 409 }
                            );
                        }
                    }
                    updates.tripRouteRateRef = tripRouteSelection.tripRouteRateRef;
                    updates.tripOriginArea = tripRouteSelection.tripOriginArea;
                    updates.tripDestinationArea = tripRouteSelection.tripDestinationArea;
                    if (tripRouteSelection.matchedTripRouteRate?._id) {
                        if (!tripRouteSelection.matchedTripRouteRate._rev) {
                            return NextResponse.json(
                                { error: 'Revisi master biaya rute trip tidak tersedia. Refresh lalu coba lagi.' },
                                { status: 409 }
                            );
                        }
                        selectedTripRouteRateRevision = {
                            _id: tripRouteSelection.matchedTripRouteRate._id,
                            _rev: tripRouteSelection.matchedTripRouteRate._rev,
                        };
                    } else {
                        selectedTripRouteRateRevision = null;
                    }
                    if (matchedTripRouteRateFee > 0) {
                        updates.taripBorongan = matchedTripRouteRateFee;
                    }
                } catch (error) {
                    return NextResponse.json(
                        { error: error instanceof Error ? error.message : 'Master biaya rute trip tidak valid' },
                        { status: 400 }
                    );
                }
            }

            if (Object.prototype.hasOwnProperty.call(updates, 'taripBorongan')) {
                const taripBorongan = normalizeCurrencyNumber(updates.taripBorongan);
                if (!Number.isFinite(taripBorongan) || taripBorongan <= 0) {
                    return NextResponse.json({ error: 'Tarip borongan harus lebih besar dari 0' }, { status: 400 });
                }
                const currentOvertonaseAmount = normalizeCurrencyNumber(existingDeliveryOrder.overtonaseDriverAmount ?? 0);
                updates.baseTaripBorongan = taripBorongan;
                updates.taripBorongan = taripBorongan + currentOvertonaseAmount;
            }
            if (Object.prototype.hasOwnProperty.call(updates, 'keteranganBorongan')) {
                updates.keteranganBorongan = normalizeOptionalText(updates.keteranganBorongan);
            }
        }
    }

    if (entity === 'orders') {
        const structuralOrderFields = new Set([
            'customerRef',
            'customerName',
            'customerRecipientRef',
            'customerPickupRef',
            'receiverName',
            'receiverPhone',
            'receiverAddress',
            'receiverCompany',
            'pickupAddress',
            'serviceRef',
            'serviceName',
        ]);
        const touchesStructuralFields = Object.keys(updates).some(key => structuralOrderFields.has(key));
        if (touchesStructuralFields) {
            const relatedDeliveryOrder = await getSanityClient().fetch<{ _id: string } | null>(
                `*[_type == "deliveryOrder" && orderRef == $ref][0]{ _id }`,
                { ref: id }
            );
            if (relatedDeliveryOrder) {
                return NextResponse.json(
                    { error: 'Order yang sudah punya surat jalan hanya boleh mengubah catatan. Field utama seperti pengirim, kategori armada, dan penerima dikunci agar dokumen turunan tetap konsisten.' },
                    { status: 409 }
                );
            }
        }

        if (Object.prototype.hasOwnProperty.call(updates, 'customerRef')) {
            const customerRef = normalizeOptionalText(updates.customerRef);
            if (!customerRef) {
                return NextResponse.json({ error: 'Customer order wajib dipilih' }, { status: 400 });
            }
            const customer = await sanityGetById<{ _id: string; name?: string; active?: boolean }>(customerRef);
            if (!customer) {
                return NextResponse.json({ error: 'Customer order tidak ditemukan' }, { status: 404 });
            }
            if (customer.active === false) {
                return NextResponse.json({ error: 'Customer order tidak aktif' }, { status: 409 });
            }
            updates.customerRef = customerRef;
            updates.customerName = customer.name || '';
        }

        if (Object.prototype.hasOwnProperty.call(updates, 'serviceRef')) {
            const serviceRef = normalizeOptionalText(updates.serviceRef);
            if (!serviceRef) {
                updates.serviceRef = '';
                updates.serviceName = undefined;
            } else {
                const service = await sanityGetById<{ _id: string; name?: string; active?: boolean }>(serviceRef);
                if (!service) {
                    return NextResponse.json({ error: 'Kategori armada order tidak ditemukan' }, { status: 404 });
                }
                if (service.active === false) {
                    return NextResponse.json({ error: 'Kategori armada order tidak aktif' }, { status: 409 });
                }
                updates.serviceRef = serviceRef;
                updates.serviceName = service.name || '';
            }
        }

        if (Object.prototype.hasOwnProperty.call(updates, 'notes')) {
            updates.notes = normalizeOptionalText(updates.notes);
        }
    }

    if (entity === 'employees') {
        const existingEmployee = await sanityGetById<Record<string, unknown>>(id);
        if (!existingEmployee) {
            return NextResponse.json({ error: 'Karyawan tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeEmployeePayload(updates, {
                partial: true,
                excludeId: id,
            });
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data karyawan tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'employee-attendance-records') {
        const existingAttendance = await sanityGetById<Record<string, unknown>>(id);
        if (!existingAttendance) {
            return NextResponse.json({ error: 'Absensi karyawan tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeEmployeeAttendanceUpdates(session, updates, id, existingAttendance);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data absensi karyawan tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customers') {
        const existingCustomer = await sanityGetById<Record<string, unknown>>(id);
        if (!existingCustomer) {
            return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = normalizeCustomerPayload(updates, existingCustomer);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data customer tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'suppliers') {
        const existingSupplier = await sanityGetById<Record<string, unknown>>(id);
        if (!existingSupplier) {
            return NextResponse.json({ error: 'Supplier tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeSupplierPayload(updates, existingSupplier);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data supplier tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'warehouse-items') {
        const existingWarehouseItem = await sanityGetById<Record<string, unknown>>(id);
        if (!existingWarehouseItem) {
            return NextResponse.json({ error: 'Barang gudang tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeWarehouseItemPayload(updates, existingWarehouseItem);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data barang gudang tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-products') {
        const existingCustomerProduct = await sanityGetById<Record<string, unknown>>(id);
        if (!existingCustomerProduct) {
            return NextResponse.json({ error: 'Barang customer tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeCustomerProductPayload(updates, existingCustomerProduct);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data barang customer tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-recipients') {
        const existingCustomerRecipient = await sanityGetById<Record<string, unknown>>(id);
        if (!existingCustomerRecipient) {
            return NextResponse.json({ error: 'Master penerima tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeCustomerRecipientPayload(updates, existingCustomerRecipient);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data master penerima tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-pickups') {
        const existingCustomerPickup = await sanityGetById<Record<string, unknown>>(id);
        if (!existingCustomerPickup) {
            return NextResponse.json({ error: 'Master pickup tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeCustomerPickupPayload(updates, existingCustomerPickup);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data master pickup tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'trip-route-rates') {
        const existingTripRouteRate = await sanityGetById<Record<string, unknown>>(id);
        if (!existingTripRouteRate) {
            return NextResponse.json({ error: 'Master biaya rute trip tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await normalizeTripRouteRatePayload(updates, existingTripRouteRate);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data biaya rute trip tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'order-items') {
        return NextResponse.json(
            { error: 'Item order harus diubah lewat workflow order/revisi resmi agar progres DO, hold, dan resi tetap sinkron' },
            { status: 409 }
        );
    }

    if (entity === 'maintenances' && typeof updates.status === 'string') {
        const allowedMaintenanceFields = new Set(['status', 'completedDate']);
        const updateKeys = Object.keys(updates);
        if (updateKeys.some(key => !allowedMaintenanceFields.has(key))) {
            return NextResponse.json({ error: 'Field maintenance ini tidak boleh diubah lewat API umum' }, { status: 400 });
        }

        const existingMaintenance = await sanityGetById<{ status?: string }>(id);
        if (!existingMaintenance) {
            return NextResponse.json({ error: 'Maintenance tidak ditemukan' }, { status: 404 });
        }

        if (existingMaintenance.status !== 'SCHEDULED') {
            return NextResponse.json({ error: 'Maintenance yang sudah diproses tidak bisa diubah lagi' }, { status: 409 });
        }

        if (!['DONE', 'SKIPPED'].includes(updates.status)) {
            return NextResponse.json({ error: 'Status maintenance tidak valid' }, { status: 400 });
        }

        if (updates.status === 'DONE') {
            return NextResponse.json(
                { error: 'Maintenance selesai harus diproses lewat workflow resmi agar material gudang dan biaya unit tetap sinkron' },
                { status: 409 }
            );
        }

        if (typeof updates.completedDate !== 'string' || !updates.completedDate) {
            updates.completedDate = getBusinessDateValue();
        }

        sanitizedEntityUpdates = {
            status: updates.status,
            completedDate: updates.completedDate,
        };
    }

    if (entity === 'maintenances' && typeof updates.status !== 'string') {
        return NextResponse.json({ error: 'Maintenance hanya boleh diubah lewat update status resmi' }, { status: 409 });
    }

    if (entity === 'tire-events') {
        const existingTire = await sanityGetById<Record<string, unknown>>(id);
        if (!existingTire) {
            return NextResponse.json({ error: 'Catatan ban tidak ditemukan' }, { status: 404 });
        }
        const normalizedTireUpdates = await normalizeTireEventPayload({ ...existingTire, ...updates }, id);
        const nextTireDoc: Record<string, unknown> = { ...existingTire, ...normalizedTireUpdates };
        if (Object.prototype.hasOwnProperty.call(updates, 'linkedWarehouseItemRef')) {
            nextTireDoc.linkedWarehouseItemRef = normalizeOptionalText(updates.linkedWarehouseItemRef);
        }
        if (nextTireDoc.linkedWarehouseItemRef) {
            const linkedItem = await resolveTrackedTireWarehouseItem(String(nextTireDoc.linkedWarehouseItemRef));
            nextTireDoc.linkedWarehouseItemCode = linkedItem.itemCode;
            nextTireDoc.linkedWarehouseItemName = linkedItem.name;
        } else {
            nextTireDoc.linkedWarehouseItemCode = undefined;
            nextTireDoc.linkedWarehouseItemName = undefined;
        }
        const tirePatchPayload = {
            ...normalizedTireUpdates,
            linkedWarehouseItemRef: nextTireDoc.linkedWarehouseItemRef,
            linkedWarehouseItemCode: nextTireDoc.linkedWarehouseItemCode,
            linkedWarehouseItemName: nextTireDoc.linkedWarehouseItemName,
        };
        const tireSetPayload = Object.fromEntries(
            Object.entries(tirePatchPayload).filter(([, value]) => value !== undefined)
        );
        const tireUnsetFields = Object.entries(tirePatchPayload)
            .filter(([field, value]) => value === undefined && Object.prototype.hasOwnProperty.call(existingTire, field))
            .map(([field]) => field);
        const historyLogDoc = buildTireHistoryLogDoc({
            tireEventRef: id,
            tireCode: normalizeOptionalText(nextTireDoc.tireCode) || id,
            tireBrand: normalizeOptionalText(nextTireDoc.tireBrand),
            tireSize: normalizeOptionalText(nextTireDoc.tireSize),
            previous: buildTireHistorySnapshot(existingTire),
            next: buildTireHistorySnapshot(nextTireDoc),
            session,
            note: normalizeOptionalText(normalizedTireUpdates.notes),
        });
        const transaction = getSanityClient()
            .transaction()
            .patch(id, {
                set: tireSetPayload,
                ...(tireUnsetFields.length > 0 ? { unset: tireUnsetFields } : {}),
            })
            .create(historyLogDoc);
        await appendTrackedTireWarehouseSync({
            transaction,
            previousDoc: existingTire,
            nextDoc: { ...nextTireDoc, _id: id },
            session,
        });
        await transaction.commit();
        const updated = await sanityGetById<Record<string, unknown>>(id);
        await addAuditLog(
            session,
            'UPDATE',
            entity,
            id,
            `Perbarui ban ${normalizedTireUpdates.tireCode}: ${normalizedTireUpdates.posisi} (${normalizedTireUpdates.status})`
        );
        return NextResponse.json({ data: updated });
    }

    if (entity === 'drivers') {
        return handleDriverUpdate(session, id, updates, addAuditLog);
    }

    if (entity === 'driver-scores') {
        return handleDriverScoreUpdate(session, id, updates, addAuditLog);
    }

    if (entity === 'bank-accounts') {
        if ('currentBalance' in updates || 'initialBalance' in updates) {
            return NextResponse.json({ error: 'Saldo rekening tidak boleh diubah manual lewat API umum' }, { status: 409 });
        }
        if ('active' in updates) {
            return NextResponse.json({ error: 'Status rekening hanya boleh diubah lewat aksi nonaktifkan resmi' }, { status: 409 });
        }
        if ('accountType' in updates || 'systemKey' in updates) {
            return NextResponse.json({ error: 'Tipe dan kunci sistem rekening tidak boleh diubah manual' }, { status: 409 });
        }

        const existingAccount = await sanityGetById<BankAccountSummary>(id);
        if (!existingAccount) {
            return NextResponse.json({ error: 'Rekening tidak ditemukan' }, { status: 404 });
        }
        if (existingAccount.systemKey === CASH_ACCOUNT_SYSTEM_KEY) {
            if ('bankName' in updates || 'accountNumber' in updates || 'accountHolder' in updates || 'accountType' in updates || 'systemKey' in updates) {
                return NextResponse.json({ error: 'Identitas akun Kas Tunai sistem tidak boleh diubah manual' }, { status: 409 });
            }
        }

        try {
            sanitizedEntityUpdates = normalizeBankAccountPayload(updates, existingAccount as unknown as Record<string, unknown>);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data rekening / kas tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'company') {
        const existingCompany = await sanityGetCompanyProfile();
        if (!existingCompany?._id || existingCompany._id !== id) {
            return NextResponse.json({ error: 'Profil perusahaan tidak ditemukan' }, { status: 404 });
        }

        try {
            sanitizedEntityUpdates = await sanitizeCompanyInvoiceSettings(updates, existingCompany);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data perusahaan tidak valid' },
                { status: 400 }
            );
        }
    }

    const normalizedUpdates =
        entity === 'users'
            ? await normalizeUserUpdates(session, id, updates, data.currentPassword)
            : entity === 'services'
                ? await normalizeServicePayload(updates, { partial: true, excludeId: id })
                : entity === 'expense-categories'
                    ? await normalizeExpenseCategoryPayload(updates, { partial: true, excludeId: id })
                    : entity === 'vehicles'
                            ? await normalizeVehiclePayload(session, updates, { partial: true, excludeId: id })
                            : sanitizedEntityUpdates ?? updates;
    const userDriverRevision =
        entity === 'users' &&
        typeof normalizedUpdates.driverRef === 'string' &&
        typeof normalizedUpdates.driverRevision === 'string'
            ? {
                _id: normalizedUpdates.driverRef,
                _rev: normalizedUpdates.driverRevision,
            }
            : null;
    const persistedNormalizedUpdates =
        entity === 'users'
            ? Object.fromEntries(
                Object.entries(normalizedUpdates).filter(([key]) => key !== 'driverRevision')
            )
            : normalizedUpdates;

    const currentDoc = await sanityGetById<Record<string, unknown> & { _id: string; _rev?: string }>(id);
    if (!currentDoc) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (!currentDoc._rev) {
        return NextResponse.json({ error: 'Revisi dokumen tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    let updated: unknown;
    try {
        if (entity === 'services') {
            const currentServiceName = normalizeOptionalText(currentDoc.name) || '';
            const nextServiceName =
                typeof normalizedUpdates.name === 'string'
                    ? normalizeOptionalText(normalizedUpdates.name) || ''
                    : currentServiceName;
            const nextServiceTireLayoutConfig =
                Object.prototype.hasOwnProperty.call(normalizedUpdates, 'tireLayoutConfig')
                    ? (normalizedUpdates.tireLayoutConfig as Record<string, unknown> | undefined)
                    : (isPlainObject(currentDoc.tireLayoutConfig) ? currentDoc.tireLayoutConfig as Record<string, unknown> : undefined);
            const relatedVehicles = await getSanityClient().fetch<Array<{ _id: string; _rev?: string; vehicleType?: string }>>(
                `*[_type == "vehicle" && (serviceRef == $ref || serviceRef._ref == $ref)]{
                    _id,
                    _rev,
                    vehicleType
                }`,
                { ref: id }
            );
            if (relatedVehicles.some(vehicle => !vehicle._rev)) {
                return NextResponse.json(
                    { error: 'Revisi kendaraan turunan tidak tersedia. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }

            const transaction = getSanityClient().transaction().patch(id, {
                ifRevisionID: currentDoc._rev,
                set: normalizedUpdates,
            });
            for (const vehicle of relatedVehicles) {
                transaction.patch(vehicle._id, {
                    ifRevisionID: vehicle._rev as string,
                    set: {
                        serviceName: nextServiceName,
                        tireLayoutConfig: normalizeTireLayoutConfig(
                            nextServiceTireLayoutConfig,
                            buildDefaultTireLayoutConfig(vehicle.vehicleType || '', nextServiceName)
                        ),
                    },
                });
            }
            await transaction.commit();
            updated = await sanityGetById(id);
        } else if (entity === 'delivery-orders' && selectedTripRouteRateRevision) {
            const transaction = getSanityClient()
                .transaction()
                .patch(selectedTripRouteRateRevision._id, {
                    ifRevisionID: selectedTripRouteRateRevision._rev,
                    set: { updatedAt: new Date().toISOString() },
                })
                .patch(id, {
                    ifRevisionID: currentDoc._rev,
                    set: normalizedUpdates,
            });
            await transaction.commit();
            updated = await sanityGetById(id);
        } else if (entity === 'users') {
            const mutationTimestamp = new Date().toISOString();
            const userUnsetFields = Object.entries(persistedNormalizedUpdates)
                .filter(([, value]) => value === undefined)
                .map(([key]) => key);
            const userSetUpdates = Object.fromEntries(
                Object.entries(persistedNormalizedUpdates).filter(([, value]) => value !== undefined)
            );
            const transaction = getSanityClient().transaction();
            if (userDriverRevision) {
                transaction.patch(userDriverRevision._id, {
                    ifRevisionID: userDriverRevision._rev,
                    set: { updatedAt: mutationTimestamp },
                });
            }
            transaction.patch(id, patch => {
                let nextPatch = patch.ifRevisionId(currentDoc._rev as string);
                if (userUnsetFields.length > 0) {
                    nextPatch = nextPatch.unset(userUnsetFields);
                }
                if (Object.keys(userSetUpdates).length > 0) {
                    nextPatch = nextPatch.set(userSetUpdates);
                }
                return nextPatch;
            });
            await transaction.commit();
            updated = await sanityGetById(id);
        } else {
            updated = await getSanityClient()
                .patch(id)
                .ifRevisionId(currentDoc._rev)
                .set(persistedNormalizedUpdates)
                .commit();
        }
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Dokumen berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }
    if (!updated) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (entity === 'customer-recipients' && normalizedUpdates.isDefault === true) {
        const updatedRecipient = updated as { customerRef?: string; _id?: string };
        if (typeof updatedRecipient.customerRef === 'string' && typeof updatedRecipient._id === 'string') {
            await clearOtherCustomerScopedDefaults('customerRecipient', updatedRecipient.customerRef, updatedRecipient._id);
        }
    }

    if (entity === 'customer-pickups' && normalizedUpdates.isDefault === true) {
        const updatedPickup = updated as { customerRef?: string; _id?: string };
        if (typeof updatedPickup.customerRef === 'string' && typeof updatedPickup._id === 'string') {
            await clearOtherCustomerScopedDefaults('customerPickupLocation', updatedPickup.customerRef, updatedPickup._id);
        }
    }

    if (entity === 'users' && id === session._id) {
        const nextSessionToken = await createSession(updated as unknown as User);
        await setSessionCookie(nextSessionToken);
    }

    const updateSummary =
        entity === 'employees'
            ? `Perbarui karyawan ${buildEmployeeSummary(updated as Record<string, unknown>, id)}`
            : entity === 'employee-attendance-records'
                ? `Perbarui absensi ${buildEmployeeAttendanceSummary(updated as Record<string, unknown>, id)}`
                : entity === 'suppliers'
                    ? `Perbarui supplier ${buildCreateSummary(updated as Record<string, unknown>, id)}`
                : entity === 'warehouse-items'
                    ? `Perbarui barang gudang ${buildCreateSummary(updated as Record<string, unknown>, id)}`
                : `Updated ${entity}: ${JSON.stringify(persistedNormalizedUpdates).slice(0, 200)}`;
    await addAuditLog(session, 'UPDATE', entity, id, updateSummary);

    if (entity === 'order-items' && typeof normalizedUpdates.status === 'string') {
        const orderItem = updated as { orderRef?: unknown };
        const orderRef = extractRefId(orderItem.orderRef);
        if (orderRef) {
            await syncOrderStatusFromItems(orderRef, session, addAuditLog);
        }
    }

    if (entity === 'delivery-orders' && typeof normalizedUpdates.status === 'string') {
        const doDoc = updated as { orderRef?: unknown };
        const orderRef = extractRefId(doDoc.orderRef);
        if (orderRef) {
            await syncOrderStatusFromItems(orderRef, session, addAuditLog);
        }
    }

    return NextResponse.json({
        data: entity === 'users'
            ? sanitizeUserForClient(updated as unknown as User)
            : updated,
    });
}

export async function handleGenericDelete(
    session: ApiSession,
    entity: string,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    if (entity === 'driver-voucher-disbursements') {
        return handleDriverVoucherDisbursementDelete(session, data, addAuditLog);
    }

    if (entity === 'driver-voucher-items') {
        return handleDriverVoucherItemDelete(session, data, addAuditLog);
    }

    if (isProtectedLedgerEntity(entity)) {
        return NextResponse.json({ error: 'Entri keuangan yang sudah terposting tidak boleh dihapus lewat API umum' }, { status: 409 });
    }

    if (entity === 'tire-history-logs') {
        return NextResponse.json({ error: 'Riwayat ban tidak boleh dihapus langsung karena histori aset harus tetap utuh' }, { status: 409 });
    }

    if (isWorkflowManagedDeleteEntity(entity)) {
        return NextResponse.json({ error: 'Dokumen turunan workflow tidak boleh dihapus langsung lewat API umum' }, { status: 409 });
    }

    if (entity === 'orders') {
        return handleOrderDelete(session, data, addAuditLog);
    }

    if (entity === 'customers') {
        return handleCustomerDelete(session, data, addAuditLog);
    }

    if (entity === 'customer-products') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Barang customer tidak valid' }, { status: 400 });
        }

        const customerProduct = await sanityGetById<{ _id: string; _rev?: string; code?: string; name?: string }>(id);
        if (!customerProduct) {
            return NextResponse.json({ error: 'Barang customer tidak ditemukan' }, { status: 404 });
        }
        if (!customerProduct._rev) {
            return NextResponse.json({ error: 'Revisi barang customer tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const relatedOrderItem = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "orderItem" && customerProductRef == $ref][0]{ _id }`,
            { ref: id }
        );
        if (relatedOrderItem) {
            return NextResponse.json({ error: 'Barang customer yang sudah dipakai order tidak boleh dihapus' }, { status: 409 });
        }

        try {
            await getSanityClient().mutate([
                {
                    delete: {
                        id,
                        ifRevisionID: customerProduct._rev,
                    },
                },
            ] as unknown as SanityMutations);
            await addAuditLog(
                session,
                'DELETE',
                entity,
                id,
                `Deleted customer product ${customerProduct.code || customerProduct.name || id}`
            );
            return NextResponse.json({ success: true });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Barang customer berubah atau baru dipakai pada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    if (entity === 'suppliers') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Supplier tidak valid' }, { status: 400 });
        }

        const supplier = await sanityGetById<{ _id: string; _rev?: string; name?: string }>(id);
        if (!supplier) {
            return NextResponse.json({ error: 'Supplier tidak ditemukan' }, { status: 404 });
        }
        if (!supplier._rev) {
            return NextResponse.json({ error: 'Revisi supplier tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const [relatedPurchase, defaultWarehouseItem] = await Promise.all([
            getSanityClient().fetch<{ _id: string } | null>(
                `*[_type == "purchase" && supplierRef == $ref][0]{ _id }`,
                { ref: id }
            ),
            getSanityClient().fetch<{ _id: string } | null>(
                `*[_type == "warehouseItem" && defaultSupplierRef == $ref][0]{ _id }`,
                { ref: id }
            ),
        ]);
        if (relatedPurchase || defaultWarehouseItem) {
            return NextResponse.json({ error: 'Supplier yang sudah dipakai pembelian atau default barang tidak boleh dihapus' }, { status: 409 });
        }

        try {
            await getSanityClient().mutate([
                {
                    delete: {
                        id,
                        ifRevisionID: supplier._rev,
                    },
                },
            ] as unknown as SanityMutations);
            await addAuditLog(session, 'DELETE', entity, id, `Deleted supplier ${supplier.name || id}`);
            return NextResponse.json({ success: true });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Supplier berubah atau baru dipakai pada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    if (entity === 'warehouse-items') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Barang gudang tidak valid' }, { status: 400 });
        }

        const warehouseItem = await sanityGetById<{ _id: string; _rev?: string; itemCode?: string; name?: string }>(id);
        if (!warehouseItem) {
            return NextResponse.json({ error: 'Barang gudang tidak ditemukan' }, { status: 404 });
        }
        if (!warehouseItem._rev) {
            return NextResponse.json({ error: 'Revisi barang gudang tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const [relatedPurchaseItem, relatedMovement] = await Promise.all([
            getSanityClient().fetch<{ _id: string } | null>(
                `*[_type == "purchaseItem" && warehouseItemRef == $ref][0]{ _id }`,
                { ref: id }
            ),
            getSanityClient().fetch<{ _id: string } | null>(
                `*[_type == "stockMovement" && warehouseItemRef == $ref][0]{ _id }`,
                { ref: id }
            ),
        ]);
        if (relatedPurchaseItem || relatedMovement) {
            return NextResponse.json({ error: 'Barang gudang yang sudah punya histori pembelian atau stok tidak boleh dihapus' }, { status: 409 });
        }

        try {
            await getSanityClient().mutate([
                {
                    delete: {
                        id,
                        ifRevisionID: warehouseItem._rev,
                    },
                },
            ] as unknown as SanityMutations);
            await addAuditLog(
                session,
                'DELETE',
                entity,
                id,
                `Deleted warehouse item ${warehouseItem.itemCode || warehouseItem.name || id}`
            );
            return NextResponse.json({ success: true });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Barang gudang berubah atau baru dipakai pada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    if (entity === 'customer-recipients') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Master penerima tidak valid' }, { status: 400 });
        }

        const recipient = await sanityGetById<{ _id: string; _rev?: string; label?: string; receiverName?: string }>(id);
        if (!recipient) {
            return NextResponse.json({ error: 'Master penerima tidak ditemukan' }, { status: 404 });
        }
        if (!recipient._rev) {
            return NextResponse.json({ error: 'Revisi master penerima tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const relatedOrder = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "order" && customerRecipientRef == $ref][0]{ _id }`,
            { ref: id }
        );
        if (relatedOrder) {
            return NextResponse.json({ error: 'Master penerima yang sudah dipakai order tidak boleh dihapus' }, { status: 409 });
        }

        try {
            await getSanityClient().mutate([
                {
                    delete: {
                        id,
                        ifRevisionID: recipient._rev,
                    },
                },
            ] as unknown as SanityMutations);
            await addAuditLog(
                session,
                'DELETE',
                entity,
                id,
                `Deleted customer recipient ${recipient.label || recipient.receiverName || id}`
            );
            return NextResponse.json({ success: true });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Master penerima berubah atau baru dipakai pada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    if (entity === 'customer-pickups') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Master pickup tidak valid' }, { status: 400 });
        }

        const pickup = await sanityGetById<{ _id: string; _rev?: string; label?: string; pickupAddress?: string }>(id);
        if (!pickup) {
            return NextResponse.json({ error: 'Master pickup tidak ditemukan' }, { status: 404 });
        }
        if (!pickup._rev) {
            return NextResponse.json({ error: 'Revisi master pickup tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const relatedOrder = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "order" && customerPickupRef == $ref][0]{ _id }`,
            { ref: id }
        );
        if (relatedOrder) {
            return NextResponse.json({ error: 'Master pickup yang sudah dipakai order tidak boleh dihapus' }, { status: 409 });
        }

        try {
            await getSanityClient().mutate([
                {
                    delete: {
                        id,
                        ifRevisionID: pickup._rev,
                    },
                },
            ] as unknown as SanityMutations);
            await addAuditLog(
                session,
                'DELETE',
                entity,
                id,
                `Deleted customer pickup ${pickup.label || pickup.pickupAddress || id}`
            );
            return NextResponse.json({ success: true });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Master pickup berubah atau baru dipakai pada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    if (entity === 'trip-route-rates') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Master biaya rute trip tidak valid' }, { status: 400 });
        }

        const tripRouteRate = await sanityGetById<{ _id: string; _rev?: string; originArea?: string; destinationArea?: string }>(id);
        if (!tripRouteRate) {
            return NextResponse.json({ error: 'Master biaya rute trip tidak ditemukan' }, { status: 404 });
        }
        if (!tripRouteRate._rev) {
            return NextResponse.json({ error: 'Revisi master biaya rute trip tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const relatedDeliveryOrder = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "deliveryOrder" && tripRouteRateRef == $ref][0]{ _id }`,
            { ref: id }
        );
        if (relatedDeliveryOrder) {
            return NextResponse.json({ error: 'Master biaya rute trip yang sudah dipakai surat jalan tidak boleh dihapus' }, { status: 409 });
        }

        try {
            await getSanityClient().mutate([
                {
                    delete: {
                        id,
                        ifRevisionID: tripRouteRate._rev,
                    },
                },
            ] as unknown as SanityMutations);
            await addAuditLog(
                session,
                'DELETE',
                entity,
                id,
                `Deleted trip route rate ${tripRouteRate.originArea || '-'} -> ${tripRouteRate.destinationArea || '-'}`
            );
            return NextResponse.json({ success: true });
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Master biaya rute trip berubah atau baru dipakai pada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
    }

    if (entity === 'maintenances') {
        return NextResponse.json(
            {
                error: 'Maintenance tidak boleh dihapus langsung karena histori servis harus tetap utuh. Ubah status maintenance bila jadwal tidak jadi dijalankan.',
            },
            { status: 409 }
        );
    }

    if (entity === 'tire-events') {
        return NextResponse.json(
            {
                error: 'Ban tidak boleh dihapus langsung karena histori aset harus tetap utuh. Edit lokasi atau status ban untuk memindahkan ke slot lain, gudang, pinjam keluar, atau afkir.',
            },
            { status: 409 }
        );
    }

    if (entity === 'tire-history-logs') {
        return NextResponse.json(
            {
                error: 'Riwayat ban tidak boleh dihapus langsung karena histori aset harus tetap utuh.',
            },
            { status: 409 }
        );
    }

    if (entity === 'services') {
        return handleServiceDelete(session, data, addAuditLog);
    }

    if (entity === 'expense-categories') {
        return handleExpenseCategoryDelete(session, data, addAuditLog);
    }

    if (entity === 'drivers') {
        return handleDriverDelete(session, data, addAuditLog);
    }

    if (entity === 'vehicles') {
        return handleVehicleDelete(session, data, addAuditLog);
    }

    if (entity === 'freight-notas') {
        return handleFreightNotaDelete(session, data, addAuditLog);
    }

    if (entity === 'driver-borongans') {
        return handleDriverBoronganDelete(session, data, addAuditLog);
    }

    if (entity === 'employees') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Karyawan tidak valid' }, { status: 400 });
        }

        const linkedAttendance = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "employeeAttendanceRecord" && employeeRef == $ref][0]{ _id }`,
            { ref: id }
        );
        if (linkedAttendance) {
            return NextResponse.json(
                { error: 'Karyawan yang sudah punya riwayat absensi tidak boleh dihapus. Nonaktifkan saja bila sudah tidak bekerja.' },
                { status: 409 }
            );
        }
    }

    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Invalid delete payload' }, { status: 400 });
    }

    if (entity === 'bank-accounts') {
        const existingAccount = await sanityGetById<BankAccountSummary & { active?: boolean }>(id);
        if (!existingAccount) {
            return NextResponse.json({ error: 'Rekening tidak ditemukan' }, { status: 404 });
        }

        if (existingAccount.active === false) {
            return NextResponse.json({ success: true });
        }

        const transactionRows = await getSanityClient().fetch<Array<Pick<BankTransaction, 'bankAccountRef' | 'type' | 'amount'>>>(
            `*[_type == "bankTransaction" && bankAccountRef == $ref]{
                bankAccountRef,
                type,
                amount
            }`,
            { ref: id }
        );
        const [derivedAccount] = applyDerivedBankAccountBalances([existingAccount], transactionRows);
        const currentBalance = readLedgerBalance(derivedAccount?.currentBalance);
        if (currentBalance !== 0) {
            return NextResponse.json(
                { error: 'Rekening dengan saldo berjalan tidak boleh dinonaktifkan. Kosongkan atau transfer dulu saldonya.' },
                { status: 409 }
            );
        }

        if (existingAccount.systemKey === CASH_ACCOUNT_SYSTEM_KEY) {
            return NextResponse.json({ error: 'Akun Kas Tunai sistem tidak boleh dinonaktifkan' }, { status: 409 });
        }

        const companyInvoiceCleanup = await buildInvoiceInstructionAccountRemoval(id);
        if (!existingAccount._rev) {
            return NextResponse.json({ error: 'Revisi rekening tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        const transaction = getSanityClient().transaction().patch(id, {
            ifRevisionID: existingAccount._rev,
            set: { active: false },
        });
        if (companyInvoiceCleanup) {
            transaction.patch(companyInvoiceCleanup.companyId, {
                ifRevisionID: companyInvoiceCleanup.companyRev,
                set: {
                    invoiceSettings: companyInvoiceCleanup.invoiceSettings,
                },
            });
        }

        try {
            await transaction.commit();
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Rekening atau profil perusahaan berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
        await addAuditLog(
            session,
            'DELETE',
            entity,
            id,
            `Nonaktifkan rekening ${existingAccount.bankName || id}`
        );
        return NextResponse.json({ success: true });
    }

    await sanityDelete(id);
    await addAuditLog(session, 'DELETE', entity, id, `Deleted ${entity} ${id}`);
    return NextResponse.json({ success: true });
}

export async function handleGenericCreate(
    session: ApiSession,
    entity: string,
    docType: string,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    if (entity === 'company') {
        const existing = await sanityGetCompanyProfile() as (CompanyProfile & { _id?: string; _rev?: string }) | null;
        let sanitizedCompanyData: Record<string, unknown>;
        try {
            sanitizedCompanyData = await sanitizeCompanyInvoiceSettings(data, existing);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data perusahaan tidak valid' },
                { status: 400 }
            );
        }
        if (existing?._id) {
            if (!existing._rev) {
                return NextResponse.json(
                    { error: 'Revisi profil perusahaan tidak tersedia. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }

            let updated: unknown;
            try {
                updated = await getSanityClient()
                    .patch(existing._id)
                    .ifRevisionId(existing._rev)
                    .set(sanitizedCompanyData)
                    .commit();
            } catch (error) {
                if (isMutationConflictError(error)) {
                    return NextResponse.json(
                        { error: 'Profil perusahaan berubah karena ada update lain. Refresh lalu coba lagi.' },
                        { status: 409 }
                    );
                }
                throw error;
            }
            await addAuditLog(session, 'UPDATE', 'companyProfile', existing._id, 'Company profile updated');
            return NextResponse.json({ data: updated });
        }

        const created = await sanityCreate({ _type: 'companyProfile', ...sanitizedCompanyData });
        const createdId = (created as Record<string, unknown>)._id as string;
        await addAuditLog(session, 'CREATE', 'companyProfile', createdId, 'Company profile created');
        return NextResponse.json({ data: created });
    }

    if (isWorkflowManagedCreateEntity(entity)) {
        return NextResponse.json({ error: 'Dokumen ini harus dibuat lewat workflow server yang sesuai' }, { status: 409 });
    }

    if (entity === 'tire-history-logs') {
        return NextResponse.json({ error: 'Riwayat ban dibuat otomatis oleh sistem dan tidak boleh dibuat manual' }, { status: 409 });
    }

    const newDoc: { _type: string; [key: string]: unknown } = { _type: docType };
    let userDriverRevision: string | undefined;
    let shouldMergeRawCreatePayload = true;

    if (entity === 'delivery-order-items') {
        const deliveryOrderRef = typeof data.deliveryOrderRef === 'string' ? data.deliveryOrderRef : '';
        const orderItemRef = typeof data.orderItemRef === 'string' ? data.orderItemRef : '';
        if (!deliveryOrderRef || !orderItemRef) {
            return NextResponse.json({ error: 'Relasi DO item tidak valid' }, { status: 400 });
        }

        const deliveryOrder = await sanityGetById<{ _id: string; status?: string }>(deliveryOrderRef);
        if (!deliveryOrder) {
            return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
        }
        if (deliveryOrder.status === 'CANCELLED') {
            return NextResponse.json({ error: 'Tidak bisa menambah item ke surat jalan yang dibatalkan' }, { status: 409 });
        }

        const orderItem = await sanityGetById<{ _id: string }>(orderItemRef);
        if (!orderItem) {
            return NextResponse.json({ error: 'Item order tidak ditemukan' }, { status: 404 });
        }

        const activeAssignment = await getSanityClient().fetch<{ _id: string } | null>(
            `*[
                _type == "deliveryOrderItem" &&
                orderItemRef == $orderItemRef &&
                deliveryOrderRef != $deliveryOrderRef &&
                defined(*[_type == "deliveryOrder" && _id == ^.deliveryOrderRef && status != "CANCELLED"][0]._id)
            ][0]{ _id }`,
            { orderItemRef, deliveryOrderRef }
        );
        if (activeAssignment) {
            return NextResponse.json({ error: 'Item order sudah terikat ke surat jalan aktif lain' }, { status: 409 });
        }
    }

    if (entity === 'orders') {
        shouldMergeRawCreatePayload = false;
        newDoc.masterResi = await sanityGetNextNumber('resi');
        newDoc.status = 'OPEN';
        newDoc.createdAt = new Date().toISOString();
        newDoc.createdBy = session._id;
    }

    if (entity === 'delivery-orders') {
        shouldMergeRawCreatePayload = false;
        newDoc.doNumber = await sanityGetNextNumber('do');
        newDoc.status = 'CREATED';
    }

    if (entity === 'invoices') {
        shouldMergeRawCreatePayload = false;
        newDoc.invoiceNumber = await sanityGetNextNumber('invoice');
        newDoc.status = 'UNPAID';
    }

    if (entity === 'freight-notas') {
        shouldMergeRawCreatePayload = false;
        newDoc.notaNumber = await sanityGetNextNumber('nota');
        newDoc.status = 'UNPAID';
    }

    if (entity === 'driver-borongans') {
        shouldMergeRawCreatePayload = false;
        newDoc.boronganNumber = await sanityGetNextNumber('borong');
        newDoc.status = 'UNPAID';
    }

    if (entity === 'maintenances') {
        shouldMergeRawCreatePayload = false;
        const normalizedMaintenance = await normalizeMaintenanceCreatePayload(data);
        Object.assign(newDoc, normalizedMaintenance);
        newDoc.status = 'SCHEDULED';
    }

    if (entity === 'services') {
        shouldMergeRawCreatePayload = false;
        Object.assign(newDoc, await normalizeServicePayload(data));
    }

    if (entity === 'customers') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, normalizeCustomerPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data customer tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'suppliers') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeSupplierPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data supplier tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'warehouse-items') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeWarehouseItemPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data barang gudang tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-products') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeCustomerProductPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data barang customer tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-recipients') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeCustomerRecipientPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data master penerima tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'customer-pickups') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeCustomerPickupPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data master pickup tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'trip-route-rates') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeTripRouteRatePayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data biaya rute trip tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'expense-categories') {
        shouldMergeRawCreatePayload = false;
        Object.assign(newDoc, await normalizeExpenseCategoryPayload(data));
    }

    if (entity === 'drivers') {
        shouldMergeRawCreatePayload = false;
        Object.assign(newDoc, await normalizeDriverPayload(data));
    }

    if (entity === 'driver-scores') {
        return handleDriverScoreCreate(session, data, addAuditLog);
    }

    if (entity === 'vehicles') {
        shouldMergeRawCreatePayload = false;
        Object.assign(newDoc, await normalizeVehiclePayload(session, data));
    }

    if (entity === 'users') {
        shouldMergeRawCreatePayload = false;
        const normalizedUser = await normalizeUserCreatePayload(data);
        newDoc.name = normalizedUser.name;
        newDoc.email = normalizedUser.email;
        newDoc.role = normalizedUser.role;
        newDoc.driverRef = normalizedUser.driverRef;
        newDoc.driverName = normalizedUser.driverName;
        newDoc.passwordHash = normalizedUser.passwordHash;
        newDoc.active = normalizedUser.active;
        newDoc.createdAt = normalizedUser.createdAt;
        userDriverRevision = typeof normalizedUser.driverRevision === 'string' ? normalizedUser.driverRevision : undefined;
        delete newDoc.password;
    }

    if (entity === 'employees') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeEmployeePayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data karyawan tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'employee-attendance-records') {
        shouldMergeRawCreatePayload = false;
        try {
            Object.assign(newDoc, await normalizeEmployeeAttendanceCreatePayload(session, data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data absensi karyawan tidak valid' },
                { status: 400 }
            );
        }
    }

    if (entity === 'tire-events') {
        shouldMergeRawCreatePayload = false;
        const normalizedTireEvent: Record<string, unknown> = { ...(await normalizeTireEventPayload(data)) };
        if (typeof data.linkedWarehouseItemRef === 'string' && data.linkedWarehouseItemRef.trim()) {
            const linkedItem = await resolveTrackedTireWarehouseItem(data.linkedWarehouseItemRef.trim());
            normalizedTireEvent.linkedWarehouseItemRef = linkedItem._id;
            normalizedTireEvent.linkedWarehouseItemCode = linkedItem.itemCode;
            normalizedTireEvent.linkedWarehouseItemName = linkedItem.name;
        }
        Object.assign(newDoc, normalizedTireEvent);
    }

    if (entity === 'bank-accounts') {
        shouldMergeRawCreatePayload = false;
        if (data.accountType === 'CASH' || typeof data.systemKey === 'string') {
            return NextResponse.json({ error: 'Akun sistem tidak boleh dibuat manual' }, { status: 409 });
        }
        try {
            Object.assign(newDoc, normalizeBankAccountPayload(data));
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Data rekening / kas tidak valid' },
                { status: 400 }
            );
        }
        newDoc.accountType = 'BANK';
        const initialBalance =
            typeof newDoc.initialBalance === 'number' && Number.isFinite(newDoc.initialBalance)
                ? newDoc.initialBalance
                : normalizeCurrencyNumber(data.initialBalance || 0);
        newDoc.currentBalance = Number.isFinite(initialBalance) ? initialBalance : 0;
    }

    if (shouldMergeRawCreatePayload) {
        Object.assign(newDoc, data);
    }

    if (entity === 'tire-events') {
        const newId = crypto.randomUUID();
        const createdTireDoc: { _id: string; _type: string; [key: string]: unknown } = { _id: newId, ...newDoc };
        const historyLogDoc = buildTireHistoryLogDoc({
            tireEventRef: newId,
            tireCode: normalizeOptionalText(createdTireDoc.tireCode) || newId,
            tireBrand: normalizeOptionalText(createdTireDoc.tireBrand),
            tireSize: normalizeOptionalText(createdTireDoc.tireSize),
            previous: null,
            next: buildTireHistorySnapshot(createdTireDoc),
            session,
            note: normalizeOptionalText(createdTireDoc.notes),
        });
        const transaction = getSanityClient()
            .transaction()
            .create(createdTireDoc)
            .create(historyLogDoc);
        await appendTrackedTireWarehouseSync({
            transaction,
            previousDoc: null,
            nextDoc: createdTireDoc,
            session,
        });
        await transaction.commit();

        await addAuditLog(
            session,
            'CREATE',
            entity,
            newId,
            `Tambah ban ${(newDoc as Record<string, unknown>).tireCode}: ${(newDoc as Record<string, unknown>).posisi} (${(newDoc as Record<string, unknown>).status})`
        );

        return NextResponse.json({
            data: createdTireDoc,
            id: newId,
        });
    }

    const newId = crypto.randomUUID();
    newDoc._id = newId;
    let created: Record<string, unknown> | null;
    if (entity === 'users' && typeof newDoc.driverRef === 'string') {
        if (!userDriverRevision) {
            return NextResponse.json(
                { error: 'Revisi supir untuk akun mobile tidak tersedia. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        try {
            await getSanityClient()
                .transaction()
                .create(newDoc)
                .patch(newDoc.driverRef, {
                    ifRevisionID: userDriverRevision,
                    set: { updatedAt: new Date().toISOString() },
                })
                .commit();
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'User atau supir untuk akun mobile berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
        created = await sanityGetById<Record<string, unknown> & { _id: string }>(newId);
    } else {
        created = await sanityCreate(newDoc);
    }
    if (!created) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (entity === 'customer-recipients' && newDoc.isDefault === true && typeof newDoc.customerRef === 'string') {
        await clearOtherCustomerScopedDefaults('customerRecipient', newDoc.customerRef, newId);
    }

    if (entity === 'customer-pickups' && newDoc.isDefault === true && typeof newDoc.customerRef === 'string') {
        await clearOtherCustomerScopedDefaults('customerPickupLocation', newDoc.customerRef, newId);
    }

    await addAuditLog(
        session,
        'CREATE',
        entity,
        newId,
        buildCreateAuditSummary(entity, newDoc, newId)
    );

    return NextResponse.json({
        data: entity === 'users'
            ? sanitizeUserForClient(created as unknown as User)
            : created,
        id: newId,
    });
}
