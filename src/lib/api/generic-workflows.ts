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
    sanityUpdate,
} from '@/lib/sanity';
import {
    resolveTireAssetStatus,
    resolveTireHolderType,
    resolveTirePlacementLabel,
    resolveTireSlotCode,
} from '@/lib/tire-slots';
import type { CompanyProfile, User } from '@/lib/types';

import {
    assertIsoDate,
    CASH_ACCOUNT_SYSTEM_KEY,
    extractRefId,
    isPlainObject,
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
    readLedgerBalance,
    sanitizeUserForClient,
    type ApiSession,
    type BankAccountSummary,
} from './data-helpers';
import {
    normalizeBankAccountPayload,
    normalizeCustomerPayload,
    normalizeCustomerPickupPayload,
    normalizeCustomerProductPayload,
    normalizeCustomerRecipientPayload,
    normalizeTripRouteRatePayload,
    resolveTripRouteRateSelection,
} from './generic-workflow-support';
import {
    handleDriverBoronganDelete,
    handleDriverVoucherDisbursementDelete,
    handleDriverVoucherItemDelete,
} from './driver-workflows';
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

    const rawSelectedRefs = Array.isArray(invoiceSettings.invoiceBankAccountRefs)
        ? invoiceSettings.invoiceBankAccountRefs
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
    const requestedDefaultRef =
        typeof invoiceSettings.defaultInvoiceBankAccountRef === 'string'
            ? invoiceSettings.defaultInvoiceBankAccountRef
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
    const rawDefaultTermDays = normalizeNumber(invoiceSettings.defaultTermDays);
    if (hasDefaultTermDays && (!Number.isFinite(rawDefaultTermDays) || rawDefaultTermDays < 0)) {
        throw new Error('Termin default nota tidak valid');
    }
    const hasDueDateDays = Object.prototype.hasOwnProperty.call(invoiceSettings, 'dueDateDays');
    const rawDueDateDays = normalizeNumber(invoiceSettings.dueDateDays);
    if (hasDueDateDays && (!Number.isFinite(rawDueDateDays) || rawDueDateDays < 0)) {
        throw new Error('Jatuh tempo default nota tidak valid');
    }
    if (
        Object.prototype.hasOwnProperty.call(documentSettingsInput, 'showContact')
        && typeof documentSettingsInput.showContact !== 'boolean'
    ) {
        throw new Error('Pengaturan tampilkan kontak dokumen tidak valid');
    }

    return {
        name: normalizeOptionalText(input.name) || normalizeOptionalText(existingCompany?.name) || 'Gading Mas Surya',
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
            defaultTermDays: hasDefaultTermDays
                ? Math.floor(rawDefaultTermDays)
                : sanitizeCompanyCounter(existingInvoiceSettings.defaultTermDays, 30),
            dueDateDays: hasDueDateDays
                ? Math.floor(rawDueDateDays)
                : sanitizeCompanyCounter(existingInvoiceSettings.dueDateDays, 14),
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
                normalizeOptionalText(documentSettingsInput.dateFormat)
                || normalizeOptionalText(existingDocumentSettings.dateFormat)
                || 'DD/MM/YYYY',
        },
    };
}

async function removeInvoiceInstructionAccountFromCompany(accountId: string) {
    const company = await sanityGetCompanyProfile();
    if (!company?._id) {
        return;
    }

    const selectedRefs: string[] = Array.isArray(company.invoiceSettings?.invoiceBankAccountRefs)
        ? company.invoiceSettings.invoiceBankAccountRefs.filter(
            (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
        )
        : [];
    const hasSelectedRef = selectedRefs.includes(accountId);
    const isDefaultRef = company.invoiceSettings?.defaultInvoiceBankAccountRef === accountId;

    if (!hasSelectedRef && !isDefaultRef) {
        return;
    }

    const nextRefs = selectedRefs.filter((ref: string) => ref !== accountId);
    const nextDefaultRef =
        nextRefs.includes(company.invoiceSettings?.defaultInvoiceBankAccountRef || '')
            ? company.invoiceSettings?.defaultInvoiceBankAccountRef
            : nextRefs[0];

    const updatedCompany: CompanyProfile = {
        ...company,
        invoiceSettings: {
            ...company.invoiceSettings,
            invoiceBankAccountRefs: nextRefs,
            defaultInvoiceBankAccountRef: nextDefaultRef,
        },
    };

    await sanityUpdate(company._id, updatedCompany as unknown as Record<string, unknown>);
}

async function clearOtherCustomerScopedDefaults(docType: 'customerRecipient' | 'customerPickupLocation', customerRef: string, keepId: string) {
    const otherDocIds = await getSanityClient().fetch<Array<{ _id: string }>>(
        `*[_type == $docType && customerRef == $customerRef && _id != $keepId && isDefault == true]{ _id }`,
        { docType, customerRef, keepId }
    );
    if (otherDocIds.length === 0) {
        return;
    }

    const transaction = getSanityClient().transaction();
    for (const doc of otherDocIds) {
        transaction.patch(doc._id, patch => patch.set({ isDefault: false }));
    }
    await transaction.commit();
}

function isProtectedLedgerEntity(entity: string) {
    return (
        entity === 'payments' ||
        entity === 'customer-receipts' ||
        entity === 'invoice-adjustments' ||
        entity === 'incomes' ||
        entity === 'expenses' ||
        entity === 'bank-transactions'
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
        entity === 'invoice-adjustments' ||
        entity === 'incomes' ||
        entity === 'expenses' ||
        entity === 'bank-transactions' ||
        entity === 'driver-vouchers' ||
        entity === 'driver-voucher-items' ||
        entity === 'driver-voucher-disbursements' ||
        entity === 'incidents' ||
        entity === 'incident-action-logs' ||
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
        entity === 'tire-history-logs' ||
        entity === 'audit-logs'
    );
}

function isWorkflowManagedDeleteEntity(entity: string) {
    return (
        entity === 'driver-vouchers' ||
        entity === 'incidents' ||
        entity === 'incident-action-logs' ||
        entity === 'tire-history-logs' ||
        entity === 'delivery-orders' ||
        entity === 'delivery-order-items' ||
        entity === 'order-items' ||
        entity === 'invoice-items' ||
        entity === 'freight-nota-items' ||
        entity === 'driver-borogan-items' ||
        entity === 'driver-borongan-items' ||
        entity === 'tracking-logs'
    );
}

function buildCreateSummary(newDoc: Record<string, unknown>, fallbackId: string) {
    return (
        (newDoc.originArea && newDoc.destinationArea
            ? `${newDoc.originArea} -> ${newDoc.destinationArea}${newDoc.serviceName ? ` (${newDoc.serviceName})` : ''}`
            : undefined) ||
        newDoc.masterResi ||
        newDoc.doNumber ||
        newDoc.invoiceNumber ||
        newDoc.notaNumber ||
        newDoc.boronganNumber ||
        newDoc.incidentNumber ||
        newDoc.label ||
        newDoc.name ||
        fallbackId
    );
}

type TireHistorySnapshot = {
    holderType?: string;
    status?: string;
    vehicleRef?: string;
    vehiclePlate?: string;
    slotCode?: string;
    placementLabel?: string;
};

function buildTireHistorySnapshot(doc: Record<string, unknown>): TireHistorySnapshot {
    return {
        holderType: resolveTireHolderType(doc),
        status: resolveTireAssetStatus(doc),
        vehicleRef: extractRefId(doc.vehicleRef) || undefined,
        vehiclePlate: normalizeOptionalText(doc.vehiclePlate),
        slotCode: resolveTireSlotCode({
            slotCode: normalizeOptionalText(doc.slotCode),
            posisi: normalizeOptionalText(doc.posisi),
        }),
        placementLabel: resolveTirePlacementLabel(doc),
    };
}

function deriveTireHistoryAction(previous: TireHistorySnapshot | null, next: TireHistorySnapshot) {
    if (!previous) return 'CREATED';
    if (previous.status !== 'SCRAPPED' && next.status === 'SCRAPPED') return 'SCRAPPED';
    if (previous.placementLabel !== next.placementLabel) return 'MOVED';
    if (previous.status !== next.status) return 'STATUS_CHANGED';
    return 'UPDATED';
}

function buildTireHistoryNote(actionType: string, previous: TireHistorySnapshot | null, next: TireHistorySnapshot) {
    if (actionType === 'CREATED') {
        return `Ban dicatat dengan lokasi awal ${next.placementLabel || '-'}`;
    }
    if (actionType === 'SCRAPPED') {
        return `Ban diafkirkan dari ${previous?.placementLabel || '-'} ke ${next.placementLabel || '-'}`;
    }
    if (actionType === 'MOVED') {
        return `Ban dipindahkan dari ${previous?.placementLabel || '-'} ke ${next.placementLabel || '-'}`;
    }
    if (actionType === 'STATUS_CHANGED') {
        return `Status ban berubah dari ${previous?.status || '-'} ke ${next.status || '-'}`;
    }
    return `Data ban diperbarui di ${next.placementLabel || '-'}`;
}

function buildTireHistoryLogDoc(params: {
    tireEventRef: string;
    tireCode: string;
    tireBrand?: string;
    tireSize?: string;
    previous: TireHistorySnapshot | null;
    next: TireHistorySnapshot;
    session: Pick<ApiSession, '_id' | 'name'>;
    note?: string;
}) {
    const actionType = deriveTireHistoryAction(params.previous, params.next);
    return {
        _id: crypto.randomUUID(),
        _type: 'tireHistoryLog',
        tireEventRef: params.tireEventRef,
        tireCode: params.tireCode,
        tireBrand: params.tireBrand,
        tireSize: params.tireSize,
        actionType,
        timestamp: new Date().toISOString(),
        actorUserRef: params.session._id,
        actorUserName: params.session.name,
        note: params.note || buildTireHistoryNote(actionType, params.previous, params.next),
        fromHolderType: params.previous?.holderType,
        fromStatus: params.previous?.status,
        fromVehicleRef: params.previous?.vehicleRef,
        fromVehiclePlate: params.previous?.vehiclePlate,
        fromSlotCode: params.previous?.slotCode,
        fromPlacementLabel: params.previous?.placementLabel,
        toHolderType: params.next.holderType,
        toStatus: params.next.status,
        toVehicleRef: params.next.vehicleRef,
        toVehiclePlate: params.next.vehiclePlate,
        toSlotCode: params.next.slotCode,
        toPlacementLabel: params.next.placementLabel,
    };
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
            assertIsoDate(podReceivedDate, 'Tanggal terima POD');

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
                        serviceRef: normalizeOptionalText((existingDeliveryOrder as Record<string, unknown>).serviceRef),
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
                updates.taripBorongan = taripBorongan;
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
        const nextTireDoc = { ...existingTire, ...normalizedTireUpdates };
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
        await getSanityClient()
            .transaction()
            .patch(id, { set: normalizedTireUpdates })
            .create(historyLogDoc)
            .commit();
        const updated = await sanityGetById<Record<string, unknown>>(id);
        await addAuditLog(
            session,
            'UPDATE',
            entity,
            id,
            `Update ban ${normalizedTireUpdates.tireCode}: ${normalizedTireUpdates.posisi} (${normalizedTireUpdates.status})`
        );
        return NextResponse.json({ data: updated });
    }

    if (entity === 'drivers') {
        return handleDriverUpdate(session, id, updates, addAuditLog);
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

    const updated = await sanityUpdate(id, normalizedUpdates);
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

    await addAuditLog(session, 'UPDATE', entity, id, `Updated ${entity}: ${JSON.stringify(normalizedUpdates).slice(0, 200)}`);

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

        const relatedOrderItem = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "orderItem" && customerProductRef == $ref][0]{ _id }`,
            { ref: id }
        );
        if (relatedOrderItem) {
            return NextResponse.json({ error: 'Barang customer yang sudah dipakai order tidak boleh dihapus' }, { status: 409 });
        }
    }

    if (entity === 'customer-recipients') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Master penerima tidak valid' }, { status: 400 });
        }

        const relatedOrder = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "order" && customerRecipientRef == $ref][0]{ _id }`,
            { ref: id }
        );
        if (relatedOrder) {
            return NextResponse.json({ error: 'Master penerima yang sudah dipakai order tidak boleh dihapus' }, { status: 409 });
        }
    }

    if (entity === 'customer-pickups') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Master pickup tidak valid' }, { status: 400 });
        }

        const relatedOrder = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "order" && customerPickupRef == $ref][0]{ _id }`,
            { ref: id }
        );
        if (relatedOrder) {
            return NextResponse.json({ error: 'Master pickup yang sudah dipakai order tidak boleh dihapus' }, { status: 409 });
        }
    }

    if (entity === 'trip-route-rates') {
        const id = typeof data.id === 'string' ? data.id : '';
        if (!id) {
            return NextResponse.json({ error: 'Master biaya rute trip tidak valid' }, { status: 400 });
        }

        const relatedDeliveryOrder = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "deliveryOrder" && tripRouteRateRef == $ref][0]{ _id }`,
            { ref: id }
        );
        if (relatedDeliveryOrder) {
            return NextResponse.json({ error: 'Master biaya rute trip yang sudah dipakai surat jalan tidak boleh dihapus' }, { status: 409 });
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

        const currentBalance = readLedgerBalance(existingAccount.currentBalance);
        if (currentBalance !== 0) {
            return NextResponse.json(
                { error: 'Rekening dengan saldo berjalan tidak boleh dinonaktifkan. Kosongkan atau transfer dulu saldonya.' },
                { status: 409 }
            );
        }

        if (existingAccount.systemKey === CASH_ACCOUNT_SYSTEM_KEY) {
            return NextResponse.json({ error: 'Akun Kas Tunai sistem tidak boleh dinonaktifkan' }, { status: 409 });
        }

        await sanityUpdate(id, { active: false });
        await removeInvoiceInstructionAccountFromCompany(id);
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
        const existing = await sanityGetCompanyProfile();
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
            const updated = await sanityUpdate(existing._id, sanitizedCompanyData);
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
        newDoc.passwordHash = normalizedUser.passwordHash;
        newDoc.active = normalizedUser.active;
        newDoc.createdAt = normalizedUser.createdAt;
        delete newDoc.password;
    }

    if (entity === 'tire-events') {
        shouldMergeRawCreatePayload = false;
        const normalizedTireEvent = await normalizeTireEventPayload(data);
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

        await getSanityClient()
            .transaction()
            .create(createdTireDoc)
            .create(historyLogDoc)
            .commit();

        await addAuditLog(
            session,
            'CREATE',
            entity,
            newId,
            `Create ban ${(newDoc as Record<string, unknown>).tireCode}: ${(newDoc as Record<string, unknown>).posisi} (${(newDoc as Record<string, unknown>).status})`
        );

        return NextResponse.json({
            data: createdTireDoc,
            id: newId,
        });
    }

    const created = await sanityCreate(newDoc);
    const newId = (created as Record<string, unknown>)._id as string;

    if (entity === 'customer-recipients' && newDoc.isDefault === true && typeof newDoc.customerRef === 'string') {
        await clearOtherCustomerScopedDefaults('customerRecipient', newDoc.customerRef, newId);
    }

    if (entity === 'customer-pickups' && newDoc.isDefault === true && typeof newDoc.customerRef === 'string') {
        await clearOtherCustomerScopedDefaults('customerPickupLocation', newDoc.customerRef, newId);
    }

    if (entity === 'bank-accounts') {
        const initialBalance =
            typeof newDoc.initialBalance === 'number' && Number.isFinite(newDoc.initialBalance)
                ? newDoc.initialBalance
                : normalizeCurrencyNumber(data.initialBalance || 0);
        await sanityUpdate(newId, { currentBalance: Number.isFinite(initialBalance) ? initialBalance : 0 });
    }

    await addAuditLog(
        session,
        'CREATE',
        entity,
        newId,
        entity === 'tire-events'
            ? `Create ban ${(newDoc as Record<string, unknown>).tireCode}: ${(newDoc as Record<string, unknown>).posisi} (${(newDoc as Record<string, unknown>).status})`
            : `Created ${entity}: ${buildCreateSummary(newDoc, newId)}`
    );

    return NextResponse.json({
        data: entity === 'users'
            ? sanitizeUserForClient(created as unknown as User)
            : created,
        id: newId,
    });
}
