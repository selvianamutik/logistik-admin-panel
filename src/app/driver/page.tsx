'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    AlertCircle,
    AlertTriangle,
    Loader2,
    LogOut,
    MapPin,
    Pencil,
    Plus,
    PlayCircle,
    Printer,
    RefreshCw,
    Smartphone,
    Trash2,
    Truck,
    Wallet,
    X,
} from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import {
    buildActualCargoDrafts,
    buildDefaultActualDropDrafts,
    buildDeliveryOrderDetailState,
    createEmptyActualDropDraft,
    applyActualCargoAutoWeightFromQty,
    applyActualDropAutoWeightFromQty,
    shouldOpenAdvancedDropEditor,
    updateActualCargoDraftVolumeUnit,
    updateActualCargoDraftWeightUnit,
    updateActualDropDraftWeightUnit,
    type ActualCargoDraft,
    type ActualDropDraft,
} from '@/lib/delivery-order-detail-support';
import {
    buildInitialDeliveryOrderCargoDraftGroups,
    createDefaultDeliveryOrderCargoDraftGroup,
    createDefaultDeliveryOrderCargoDraftItem,
    flattenDeliveryOrderCargoDraftGroups,
    getDraftDeliveryOrderCargoGroups,
    getDeliveryOrderCargoDraftItems,
    toDeliveryOrderCargoDraftItem,
    type DeliveryOrderCargoDraftGroup,
    type DeliveryOrderCargoDraftItem,
} from '@/lib/delivery-order-cargo-draft-support';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import {
    VOLUME_INPUT_UNIT_OPTIONS,
    WEIGHT_INPUT_UNIT_OPTIONS,
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
    formatCargoSummary,
    getWeightInputFractionDigits,
} from '@/lib/measurement';
import {
    applyCustomerProductToOrderItem,
    applyOrderItemAutoWeightFromQty,
    shouldLockOrderItemWeight,
    summarizeDraftOrderCargo,
    updateOrderItemVolumeUnit,
    updateOrderItemWeightUnit,
} from '@/lib/order-create-page-support';
import { getDeliveryOrderDisplayStatusMeta } from '@/lib/delivery-order-completion';
import { isDeliveryOrderResourceLocked } from '@/lib/trip-resource-lock-support';
import { getBusinessDateValue } from '@/lib/business-date';
import { DO_ACTUAL_DROP_TYPE_MAP, DO_STATUS_MAP, formatCurrency, formatDate, formatDateTime, formatShipperDeliveryOrderNumber, getShipperReferenceCount } from '@/lib/utils';
import type { Customer, CustomerProduct, CustomerRecipient, Driver, Incident, IncidentSettlementCategory, IncidentSettlementLine, PendingDriverStatusRequest, SessionUser } from '@/lib/types';
import type { DriverAssignedDeliveryOrder, DriverAssignedTripPlan, DriverAssignedTripPlanPickupStop, DriverPortalVoucher } from '@/lib/api/driver-portal';
import {
    buildDriverVoucherCashBreakdown,
    buildDriverVoucherDetailSummary,
    buildDriverVoucherPrintHtml,
    buildDriverVoucherSettlementDisplay,
    DRIVER_VOUCHER_STATUS_MAP,
    getDriverVoucherDisbursementLabel,
    inferDriverVoucherDisbursementCount,
} from '@/lib/driver-voucher-detail-support';
import { openBrandedPrint, openPrintWindow, resolveDocumentIssuerProfile, type PrintableCompanyProfile } from '@/lib/print';

type DriverSessionResponse = {
    user: SessionUser;
    driver: Driver;
    company: { _id: string; name: string; phone?: string; themeColor?: string } | null;
};

type DriverDeliveryOrdersResponse = {
    data?: DriverAssignedDeliveryOrder[];
    plannedTrips?: DriverAssignedTripPlan[];
    billingCustomers?: Array<Pick<Customer, '_id' | 'name' | 'active'>>;
    customerProducts?: CustomerProduct[];
    customerRecipients?: CustomerRecipient[];
    driverVouchers?: DriverPortalVoucher[];
    error?: string;
};

type DriverIncidentRecord = Incident & {
    settlementLines?: IncidentSettlementLine[];
};

type DriverIncidentsResponse = {
    data?: DriverIncidentRecord[];
    error?: string;
};

type DriverIncidentCostDraft = {
    draftId: string;
    category: IncidentSettlementCategory;
    amount: number;
    description: string;
    payeeName: string;
    note: string;
};

type DriverPortalError = Error & { status?: number };
type DriverPortalSection = 'TRIPS' | 'VOUCHERS';
type DriverProgressStatus = Extract<DriverAssignedDeliveryOrder['status'], 'ON_DELIVERY' | 'ARRIVED' | 'DELIVERED'>;
type DriverBatchStatus = 'ON_DELIVERY' | 'ARRIVED' | 'DELIVERED';
type DriverBatchStatusSelection = DriverBatchStatus | '';
type CargoInputMode = 'SJ_ADD' | 'SJ_EDIT' | 'CARGO';
type CompletionStep = 'SETUP' | 'ACTUAL';
type CompletionMode = 'BATCH_STATUS' | 'TRIP_CLOSE';
type CompletionDropItemValueDraft = Pick<
    ActualDropDraft,
    'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit'
>;

const DRIVER_TRACKING_HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;
const COMPLETION_DROP_ITEM_VALUE_SEPARATOR = '::item::';

const DRIVER_INCIDENT_COST_CATEGORY_OPTIONS: Array<{ value: IncidentSettlementCategory; label: string }> = [
    { value: 'REPAIR', label: 'Perbaikan' },
    { value: 'SPAREPART', label: 'Sparepart' },
    { value: 'TIRE', label: 'Ban' },
    { value: 'TOWING', label: 'Derek / Evakuasi' },
    { value: 'MEDICAL', label: 'Medis' },
    { value: 'POLICE_ADMIN', label: 'Polisi / Administrasi' },
    { value: 'ACCOMMODATION', label: 'Akomodasi' },
    { value: 'CARGO_HANDLING', label: 'Bongkar / Handling' },
    { value: 'THIRD_PARTY_DAMAGE', label: 'Kerusakan Pihak Ketiga' },
    { value: 'OTHER', label: 'Lainnya' },
];

function createDriverIncidentCostDraft(): DriverIncidentCostDraft {
    return {
        draftId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        category: 'REPAIR',
        amount: 0,
        description: '',
        payeeName: '',
        note: '',
    };
}

function getDriverIncidentStatusLabel(status: Incident['status']) {
    if (status === 'OPEN') return 'Dilaporkan';
    if (status === 'IN_PROGRESS') return 'Ditangani';
    if (status === 'RESOLVED') return 'Selesai, menunggu admin tutup';
    return 'Ditutup';
}

function isDriverIncidentActiveForReport(incident: DriverIncidentRecord) {
    return incident.status !== 'CLOSED';
}

function hasDriverIncidentSubmittedResolution(incident: DriverIncidentRecord) {
    return Boolean(incident.pendingDriverResolutionRequestedAt?.trim()) ||
        (incident.settlementLines || []).some(line => line.status !== 'VOID');
}

function hasDriverIncidentReviewedResolution(incident: DriverIncidentRecord) {
    return (incident.settlementLines || []).some(line => line.status !== 'VOID' && line.status !== 'DRAFT');
}

function hasDriverIncidentPostedResolution(incident: DriverIncidentRecord) {
    return (incident.settlementLines || []).some(line => line.status === 'POSTED');
}

function isDriverIncidentWaitingResolutionReview(incident: DriverIncidentRecord) {
    return hasDriverIncidentSubmittedResolution(incident) && !hasDriverIncidentReviewedResolution(incident);
}

function getDriverIncidentResolutionHint(incident: DriverIncidentRecord) {
    if (isDriverIncidentWaitingResolutionReview(incident)) {
        return 'Penyelesaian sudah diajukan. Menunggu review admin.';
    }
    if (incident.status === 'RESOLVED' || incident.status === 'CLOSED') {
        return 'Penyelesaian sudah disetujui admin.';
    }
    if (hasDriverIncidentPostedResolution(incident)) {
        return 'Biaya insiden sudah masuk uang jalan. Tunggu admin menyelesaikan status insiden.';
    }
    return 'Pengajuan penyelesaian sudah direview admin. Tunggu admin menyelesaikan status insiden.';
}

function canDriverSubmitIncidentResolution(incident: DriverIncidentRecord) {
    return incident.status !== 'RESOLVED' &&
        incident.status !== 'CLOSED' &&
        !hasDriverIncidentSubmittedResolution(incident);
}

function buildCompletionDropItemValueKey(draftKey: string, deliveryOrderItemRef: string) {
    return `${draftKey}${COMPLETION_DROP_ITEM_VALUE_SEPARATOR}${deliveryOrderItemRef}`;
}

function pickCompletionDropItemValues(drop: ActualDropDraft): CompletionDropItemValueDraft {
    return {
        qtyKoli: drop.qtyKoli,
        weightInputValue: drop.weightInputValue,
        weightInputUnit: drop.weightInputUnit,
        volumeInputValue: drop.volumeInputValue,
        volumeInputUnit: drop.volumeInputUnit,
    };
}

function hasCompletionDropItemValues(values: CompletionDropItemValueDraft) {
    return (
        parseFormattedNumberish(values.qtyKoli || 0, { maxFractionDigits: 2 }) > 0 ||
        parseFormattedNumberish(values.weightInputValue || 0, {
            maxFractionDigits: getWeightInputFractionDigits(values.weightInputUnit),
        }) > 0 ||
        parseFormattedNumberish(values.volumeInputValue || 0, {
            maxFractionDigits: values.volumeInputUnit === 'LITER' ? 0 : 3,
        }) > 0
    );
}

function getDriverTripPlanId(plan: Pick<DriverAssignedTripPlan, 'orderRef' | 'tripPlanKey'>) {
    return `${plan.orderRef}::${plan.tripPlanKey}`;
}

function createDriverPortalError(status: number, message: string) {
    const error = new Error(message) as DriverPortalError;
    error.status = status;
    return error;
}

function getDriverPortalErrorStatus(error: unknown) {
    if (
        error instanceof Error &&
        'status' in error &&
        typeof (error as DriverPortalError).status === 'number'
    ) {
        return (error as DriverPortalError).status as number;
    }
    return null;
}

function isDriverUnauthorizedError(error: unknown) {
    return getDriverPortalErrorStatus(error) === 401;
}

function formatTrackingState(state?: DriverAssignedDeliveryOrder['trackingState']) {
    switch (state) {
        case 'ACTIVE':
            return { label: 'Tracking Aktif', color: 'badge-info' };
        case 'PAUSED':
            return { label: 'Tracking Dijeda', color: 'badge-warning' };
        case 'STOPPED':
            return { label: 'Tracking Selesai', color: 'badge-gray' };
        default:
            return { label: 'Belum Tracking', color: 'badge-gray' };
    }
}

function canDriverStartTracking(status: DriverAssignedDeliveryOrder['status']) {
    return ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(status);
}

function isDriverDashboardDeliveryOrderVisible(order: DriverAssignedDeliveryOrder) {
    return isDeliveryOrderResourceLocked(order);
}

function isDriverDashboardTripPlanVisible(plan: DriverAssignedTripPlan) {
    if (plan.linkedDeliveryOrderRef) {
        return plan.linkedDeliveryOrderStatus !== 'CANCELLED' && plan.linkedDeliveryOrderStatus !== 'UNKNOWN';
    }
    return true;
}

function getDriverProgressSuccessMessage(nextStatus: DriverProgressStatus) {
    switch (nextStatus) {
        case 'ON_DELIVERY':
            return 'Status DO diperbarui menjadi dalam pengiriman.';
        case 'ARRIVED':
            return 'Status DO diperbarui menjadi sudah tiba.';
        case 'DELIVERED':
            return 'Update batch SJ dikirim. Menunggu approval admin.';
        default:
            return 'Status DO berhasil diperbarui.';
    }
}

function areActualCargoDraftsReady(items: ActualCargoDraft[]) {
    return items.every(item => {
        const qty = parseFormattedNumberish(item.actualQtyKoli || 0);
        const weight = parseFormattedNumberish(item.actualWeightInputValue || 0, {
            maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
        });
        const volume = parseFormattedNumberish(item.actualVolumeInputValue || 0, {
            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
        });

        return (
            (!item.requireQty || qty > 0) &&
            (!item.requireWeight || weight > 0) &&
            (!item.requireVolume || volume > 0) &&
            ((item.requireQty && qty > 0) || weight > 0 || volume > 0)
        );
    });
}

function isActualCargoDraftReady(item: ActualCargoDraft) {
    return areActualCargoDraftsReady([item]);
}

function summarizeActualCargoDraft(item: ActualCargoDraft) {
    const actualWeightInputValue = parseFormattedNumberish(item.actualWeightInputValue || 0, {
        maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
    });
    const actualVolumeInputValue = parseFormattedNumberish(item.actualVolumeInputValue || 0, {
        maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
    });
    return formatCargoSummary({
        qtyKoli: parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }),
        weightKg: convertWeightToKg(actualWeightInputValue, item.actualWeightInputUnit),
        weightInputValue: item.actualWeightInputValue,
        weightInputUnit: item.actualWeightInputUnit,
        volumeM3: convertVolumeToM3(actualVolumeInputValue, item.actualVolumeInputUnit),
        volumeInputValue: item.actualVolumeInputValue,
        volumeInputUnit: item.actualVolumeInputUnit,
    });
}

function getActualCargoDraftTotals(items: ActualCargoDraft[]) {
    return items.reduce((sum, item) => ({
        qtyKoli: sum.qtyKoli + parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }),
        weightKg: sum.weightKg + convertWeightToKg(
            parseFormattedNumberish(item.actualWeightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
            }),
            item.actualWeightInputUnit
        ),
        volumeM3: sum.volumeM3 + convertVolumeToM3(
            parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
            }),
            item.actualVolumeInputUnit
        ),
    }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
}

function summarizeActualCargoDraftList(items: ActualCargoDraft[]) {
    return formatCargoSummary(getActualCargoDraftTotals(items));
}

function summarizeDriverOrderCargo(order: DriverAssignedDeliveryOrder) {
    return formatCargoSummary({
        qtyKoli: (order.driverCargoItems || []).reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0), 0),
        weightKg: (order.driverCargoItems || []).reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemWeight ?? item.shippedWeight ?? 0, { maxFractionDigits: 2 }), 0),
        volumeM3: (order.driverCargoItems || []).reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 }), 0),
    });
}

function formatDriverTripRoute(origin?: string, destination?: string) {
    const normalizedOrigin = (origin || '').trim();
    const normalizedDestination = (destination || '').trim();
    if (normalizedOrigin && normalizedDestination) {
        return `${normalizedOrigin} -> ${normalizedDestination}`;
    }
    return normalizedDestination || normalizedOrigin || '-';
}

function formatCustomerRecipientOptionLabel(recipient: CustomerRecipient) {
    const label = recipient.label?.trim();
    const target = (recipient.receiverCompany || recipient.receiverName || recipient.receiverAddress || '').trim();
    if (label && target && label.toLowerCase() !== target.toLowerCase()) {
        return `${label} - ${target}`;
    }
    return label || target || 'Tujuan customer';
}

function getCustomerRecipientDropName(recipient: CustomerRecipient) {
    return (recipient.receiverCompany || recipient.receiverName || recipient.label || '').trim();
}

function formatDriverPickupStopName(stop: Pick<DriverAssignedTripPlanPickupStop, 'sequence' | 'pickupLabel' | 'pickupAddress'>) {
    return stop.pickupLabel?.trim() || stop.pickupAddress?.trim() || `Pickup ${stop.sequence}`;
}

function getNextDriverBatchStatus(status?: string): DriverBatchStatus | null {
    switch (status) {
        case 'PARTIAL_HOLD':
        case 'CREATED':
        case 'HEADING_TO_PICKUP':
            return 'ON_DELIVERY';
        case 'ON_DELIVERY':
            return 'ARRIVED';
        case 'ARRIVED':
            return 'DELIVERED';
        default:
            return null;
    }
}

function hasActualCargoDraftValues(item: ActualCargoDraft) {
    return (
        parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }) > 0 ||
        parseFormattedNumberish(item.actualWeightInputValue || 0, {
            maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
        }) > 0 ||
        parseFormattedNumberish(item.actualVolumeInputValue || 0, {
            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
        }) > 0
    );
}

function completionDropMatchesCargoItem(drop: ActualDropDraft, cargoItem: ActualCargoDraft) {
    const dropReferenceNumber = drop.shipperReferenceNumber.trim().toUpperCase();
    const itemReferenceNumber = cargoItem.shipperReferenceNumber.trim().toUpperCase();
    return (
        drop.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef ||
        (drop.shipperReferenceKey && drop.shipperReferenceKey === cargoItem.shipperReferenceKey) ||
        (dropReferenceNumber && itemReferenceNumber && dropReferenceNumber === itemReferenceNumber) ||
        !drop.deliveryOrderItemRef && !drop.shipperReferenceKey && !dropReferenceNumber
    );
}

function hasDriverCargoSummaryValue(summary?: { qtyKoli?: number; weightKg?: number; volumeM3?: number }) {
    return Boolean(
        (summary?.qtyKoli || 0) > 0 ||
        (summary?.weightKg || 0) > 0 ||
        (summary?.volumeM3 || 0) > 0
    );
}

function getDriverPendingRequests(order: DriverAssignedDeliveryOrder): PendingDriverStatusRequest[] {
    const requests = Array.isArray(order.pendingDriverRequests)
        ? order.pendingDriverRequests.filter(request => request && request.requestId && request.status)
        : [];
    if (requests.length > 0 || !order.pendingDriverStatus) {
        return requests;
    }
    return [{
        requestId: `${order._id}:legacy-pending-driver-request`,
        status: order.pendingDriverStatus,
        requestedAt: order.pendingDriverStatusRequestedAt,
        requestedBy: order.pendingDriverStatusRequestedBy,
        requestedByName: order.pendingDriverStatusRequestedByName,
        note: order.pendingDriverStatusNote,
        targetSuratJalanRefs: order.pendingDriverStatusSuratJalanRefs || [],
        podReceiverName: order.pendingDriverPodReceiverName,
        podReceivedDate: order.pendingDriverPodReceivedDate,
        podNote: order.pendingDriverPodNote,
        actualCargoItems: order.pendingDriverActualCargoItems || [],
        actualDropPoints: order.pendingDriverActualDropPoints || [],
        tripEndOdometerKm: order.tripEndOdometerKm,
        closeTripOnly: Boolean(order.tripEndOdometerKm && !(order.pendingDriverActualCargoItems || []).length),
    }];
}

function getDriverPendingRequestForSj(order: DriverAssignedDeliveryOrder, documentId: string) {
    return getDriverPendingRequests(order).find(request => (request.targetSuratJalanRefs || []).includes(documentId)) || null;
}

function getDriverOrderSjRows(order: DriverAssignedDeliveryOrder) {
    const references = (order.shipperReferences || [])
        .map((reference, index) => ({
            key: reference._key || reference.referenceNumber || `sj-${index + 1}`,
            referenceKey: reference._key || '',
            referenceNumber: (reference.referenceNumber || '').trim().toUpperCase(),
            pickupStopKey: reference.pickupStopKey || '',
            pickupAddress: reference.pickupAddress || '',
        }))
        .filter(reference => Boolean(reference.referenceNumber));
    const fallbackReferenceNumber = (order.customerDoNumber || '').trim().toUpperCase();
    const normalizedReferences = references.length > 0
        ? references
        : fallbackReferenceNumber
            ? [{
                key: fallbackReferenceNumber,
                referenceKey: '',
                referenceNumber: fallbackReferenceNumber,
                pickupStopKey: '',
                pickupAddress: order.pickupAddress || '',
            }]
            : [];

    const rows = normalizedReferences.map(reference => {
        const suratJalanRecord = getDriverOrderSjRecord(order, reference);
        const hasHoldCargo = hasDriverCargoSummaryValue(suratJalanRecord?.holdCargo);
        const documentId = getDriverOrderSjDocumentId(order._id, reference);
        const pendingRequest = getDriverPendingRequestForSj(order, documentId);
        const rawTripStatus = suratJalanRecord?.tripStatus || 'CREATED';
        const tripStatus = hasHoldCargo && rawTripStatus === 'DELIVERED' ? 'PARTIAL_HOLD' : rawTripStatus;
        const items = (order.driverCargoItems || []).filter(item => {
            const itemReferenceNumber = (item.shipperReferenceNumber || order.customerDoNumber || '').trim().toUpperCase();
            return (
                (reference.referenceKey && item.shipperReferenceKey === reference.referenceKey) ||
                (reference.referenceNumber && itemReferenceNumber === reference.referenceNumber)
            );
        });
        const finalizedCount = items.filter(item =>
            item.actualQtyKoli !== undefined ||
            item.actualWeightKg !== undefined ||
            item.actualVolumeM3 !== undefined
        ).length;
        const plannedSummary = {
            qtyKoli: items.reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0), 0),
            weightKg: items.reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemWeight ?? item.shippedWeight ?? 0, { maxFractionDigits: 2 }), 0),
            volumeM3: items.reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 }), 0),
        };
        const totalSummary = hasDriverCargoSummaryValue(suratJalanRecord?.cargoSummary)
            ? suratJalanRecord?.cargoSummary
            : plannedSummary;
        const holdSummary = suratJalanRecord?.holdCargo;
        const billableSummary = suratJalanRecord?.billableCargo;
        const effectivePickupAddress = suratJalanRecord?.pickupAddress || reference.pickupAddress || '';

        return {
            ...reference,
            pickupAddress: effectivePickupAddress,
            documentId,
            tripStatus,
            hasHoldCargo,
            pendingRequest,
            nextStatus: getNextDriverBatchStatus(tripStatus),
            itemCount: items.length,
            finalizedCount,
            summary: items.length > 0 ? formatCargoSummary(totalSummary || plannedSummary) : '-',
            summaryItems: [
                {
                    label: 'Total',
                    value: items.length > 0 ? formatCargoSummary(totalSummary || plannedSummary) : '-',
                },
                {
                    label: 'Hold',
                    value: holdSummary && hasDriverCargoSummaryValue(holdSummary) ? formatCargoSummary(holdSummary) : '-',
                },
                {
                    label: 'Drop',
                    value: billableSummary && hasDriverCargoSummaryValue(billableSummary) ? formatCargoSummary(billableSummary) : '-',
                },
            ],
        };
    });

    return rows.length > 0 ? rows : [{
        key: 'empty',
        referenceKey: '',
        referenceNumber: '',
        pickupStopKey: '',
        pickupAddress: order.pickupAddress || '',
        documentId: `${order._id}:primary`,
        tripStatus: order.status || 'CREATED',
        hasHoldCargo: false,
        pendingRequest: getDriverPendingRequestForSj(order, `${order._id}:primary`),
        nextStatus: getNextDriverBatchStatus(order.status),
        itemCount: 0,
        finalizedCount: 0,
        summary: '-',
        summaryItems: [
            { label: 'Total', value: '-' },
            { label: 'Hold', value: '-' },
            { label: 'Drop', value: '-' },
        ],
    }];
}

function getDriverOrderItemsForSj(
    order: DriverAssignedDeliveryOrder,
    reference: { referenceKey?: string; referenceNumber?: string }
) {
    const referenceKey = reference.referenceKey || '';
    const referenceNumber = (reference.referenceNumber || '').trim().toUpperCase();
    return (order.driverCargoItems || []).filter(item => {
        const itemReferenceNumber = (item.shipperReferenceNumber || order.customerDoNumber || '').trim().toUpperCase();
        return (
            (referenceKey && item.shipperReferenceKey === referenceKey) ||
            (referenceNumber && itemReferenceNumber === referenceNumber)
        );
    });
}

function getDriverOrderSjDocumentId(orderId: string, reference: { referenceKey?: string; referenceNumber?: string }) {
    return `${orderId}:${reference.referenceKey || reference.referenceNumber || 'primary'}`;
}

function getDriverOrderSjRecord(
    order: DriverAssignedDeliveryOrder,
    reference: { referenceKey?: string; referenceNumber?: string }
) {
    const documentId = getDriverOrderSjDocumentId(order._id, reference);
    const referenceKey = reference.referenceKey || '';
    const referenceNumber = (reference.referenceNumber || '').trim().toUpperCase();
    return (order.driverSuratJalanRecords || []).find(record => {
        const recordNumber = (record.suratJalanNumber || '').trim().toUpperCase();
        return (
            record._id === documentId ||
            (referenceKey && record.referenceKey === referenceKey) ||
            (referenceNumber && recordNumber === referenceNumber)
        );
    }) || null;
}

function areAllDriverTripSuratJalanDelivered(rows: ReturnType<typeof getDriverOrderSjRows>) {
    const rowsWithCargo = rows.filter(row => row.referenceNumber && row.itemCount > 0);
    return rowsWithCargo.length > 0 && rowsWithCargo.every(row => row.tripStatus === 'DELIVERED');
}

function formatDriverSjReferenceLabel(row: Pick<ReturnType<typeof getDriverOrderSjRows>[number], 'referenceNumber' | 'hasHoldCargo'>) {
    const referenceNumber = row.referenceNumber || 'Belum ada SJ';
    return row.hasHoldCargo ? `${referenceNumber} (HOLD)` : referenceNumber;
}

function buildDriverPartialHoldContinuationDrafts(
    order: DriverAssignedDeliveryOrder,
    baseCargoItems: ActualCargoDraft[],
    selectedRows: ReturnType<typeof getDriverOrderSjRows>
) {
    const selectedRowIds = new Set(selectedRows.map(row => row.documentId));
    const selectedReferenceKeys = new Set(selectedRows.map(row => row.referenceKey).filter(Boolean));
    const selectedReferenceNumbers = new Set(selectedRows.map(row => row.referenceNumber).filter(Boolean));
    const selectedHoldRows = selectedRows.filter(row => row.hasHoldCargo || row.tripStatus === 'PARTIAL_HOLD');
    if (selectedHoldRows.length === 0) {
        return { actualCargoItems: baseCargoItems, itemRefs: [] as string[], sourceDropPoints: [] as DriverAssignedDeliveryOrder['actualDropPoints'] };
    }

    const itemsById = new Map(baseCargoItems.map(item => [item.deliveryOrderItemRef, item]));
    const getPointItemIds = (point: NonNullable<DriverAssignedDeliveryOrder['actualDropPoints']>[number]) => {
        const explicitRefs = [
            point.deliveryOrderItemRef,
            ...((Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []) as string[]),
        ].filter((value): value is string => Boolean(value));
        if (explicitRefs.length > 0) {
            return explicitRefs.filter(itemId => itemsById.has(itemId));
        }

        const pointReferenceKey = (point.shipperReferenceKey || '').trim();
        const pointReferenceNumber = (point.shipperReferenceNumber || '').trim().toUpperCase();
        return baseCargoItems
            .filter(item =>
                (pointReferenceKey && item.shipperReferenceKey === pointReferenceKey) ||
                (pointReferenceNumber && item.shipperReferenceNumber.trim().toUpperCase() === pointReferenceNumber) ||
                (!pointReferenceKey && !pointReferenceNumber && selectedRowIds.has(getDriverOrderSjDocumentId(order._id, {
                    referenceKey: item.shipperReferenceKey,
                    referenceNumber: item.shipperReferenceNumber || order.customerDoNumber || '',
                })))
            )
            .map(item => item.deliveryOrderItemRef);
    };

    const holdDraftByItemId = new Map<string, Pick<ActualCargoDraft, 'actualQtyKoli' | 'actualWeightInputValue' | 'actualWeightInputUnit' | 'actualVolumeInputValue' | 'actualVolumeInputUnit'>>();
    const sourceDropPoints = (order.actualDropPoints || [])
        .filter(point => point.stopType === 'HOLD' || point.stopType === 'TRANSIT')
        .filter(point => {
            const pointItemIds = getPointItemIds(point);
            return pointItemIds.some(itemId => {
                const sourceItem = itemsById.get(itemId);
                if (!sourceItem) {
                    return false;
                }
                return (
                    selectedReferenceKeys.has(sourceItem.shipperReferenceKey) ||
                    selectedReferenceNumbers.has(sourceItem.shipperReferenceNumber.trim().toUpperCase()) ||
                    selectedRowIds.has(getDriverOrderSjDocumentId(order._id, {
                        referenceKey: sourceItem.shipperReferenceKey,
                        referenceNumber: sourceItem.shipperReferenceNumber || order.customerDoNumber || '',
                    }))
                );
            });
        });
    sourceDropPoints.forEach(point => {
        getPointItemIds(point).forEach(itemId => {
            const sourceItem = itemsById.get(itemId);
            if (!sourceItem) {
                return;
            }
            const current = holdDraftByItemId.get(itemId);
            const weightInputUnit = point.weightInputUnit || sourceItem.actualWeightInputUnit || 'KG';
            const volumeInputUnit = point.volumeInputUnit || sourceItem.actualVolumeInputUnit || 'M3';
            const currentWeightKg = current
                ? convertWeightToKg(parseFormattedNumberish(current.actualWeightInputValue || 0), current.actualWeightInputUnit)
                : 0;
            const currentVolumeM3 = current
                ? convertVolumeToM3(parseFormattedNumberish(current.actualVolumeInputValue || 0), current.actualVolumeInputUnit)
                : 0;
            const nextWeightKg = currentWeightKg + convertWeightToKg(parseFormattedNumberish(point.weightInputValue ?? point.weightKg ?? 0), weightInputUnit);
            const nextVolumeM3 = currentVolumeM3 + convertVolumeToM3(parseFormattedNumberish(point.volumeInputValue ?? point.volumeM3 ?? 0), volumeInputUnit);
            holdDraftByItemId.set(itemId, {
                actualQtyKoli: String(parseFormattedNumberish(current?.actualQtyKoli || 0) + parseFormattedNumberish(point.qtyKoli || 0)),
                actualWeightInputValue: nextWeightKg > 0 ? String(convertKgToWeightInputValue(nextWeightKg, weightInputUnit)) : '',
                actualWeightInputUnit: weightInputUnit,
                actualVolumeInputValue: nextVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(nextVolumeM3, volumeInputUnit)) : '',
                actualVolumeInputUnit: volumeInputUnit,
            });
        });
    });

    const fallbackHoldItemRefs = baseCargoItems
        .filter(item =>
            selectedReferenceKeys.has(item.shipperReferenceKey) ||
            selectedReferenceNumbers.has(item.shipperReferenceNumber.trim().toUpperCase()) ||
            selectedRowIds.has(getDriverOrderSjDocumentId(order._id, {
                referenceKey: item.shipperReferenceKey,
                referenceNumber: item.shipperReferenceNumber || order.customerDoNumber || '',
            }))
        )
        .map(item => item.deliveryOrderItemRef);
    if (holdDraftByItemId.size === 0) {
        fallbackHoldItemRefs.forEach(itemId => {
            const sourceItem = itemsById.get(itemId);
            if (!sourceItem) {
                return;
            }
            holdDraftByItemId.set(itemId, {
                actualQtyKoli: sourceItem.actualQtyKoli || (sourceItem.plannedQtyKoli ? String(sourceItem.plannedQtyKoli) : ''),
                actualWeightInputValue: sourceItem.actualWeightInputValue || (sourceItem.plannedWeightInputValue ? String(sourceItem.plannedWeightInputValue) : ''),
                actualWeightInputUnit: sourceItem.actualWeightInputUnit || sourceItem.plannedWeightInputUnit || 'KG',
                actualVolumeInputValue: sourceItem.actualVolumeInputValue || (sourceItem.plannedVolumeInputValue ? String(sourceItem.plannedVolumeInputValue) : ''),
                actualVolumeInputUnit: sourceItem.actualVolumeInputUnit || sourceItem.plannedVolumeInputUnit || 'M3',
            });
        });
    }

    return {
        actualCargoItems: baseCargoItems.map(item => {
            const holdDraft = holdDraftByItemId.get(item.deliveryOrderItemRef);
            return holdDraft
                ? {
                    ...item,
                    ...holdDraft,
                    plannedQtyKoli: parseFormattedNumberish(holdDraft.actualQtyKoli || 0, { maxFractionDigits: 2 }),
                    plannedWeightKg: convertWeightToKg(
                        parseFormattedNumberish(holdDraft.actualWeightInputValue || 0, {
                            maxFractionDigits: getWeightInputFractionDigits(holdDraft.actualWeightInputUnit),
                        }),
                        holdDraft.actualWeightInputUnit
                    ),
                    plannedWeightInputValue: parseFormattedNumberish(holdDraft.actualWeightInputValue || 0, {
                        maxFractionDigits: getWeightInputFractionDigits(holdDraft.actualWeightInputUnit),
                    }),
                    plannedWeightInputUnit: holdDraft.actualWeightInputUnit,
                    plannedVolumeM3: convertVolumeToM3(
                        parseFormattedNumberish(holdDraft.actualVolumeInputValue || 0, {
                            maxFractionDigits: holdDraft.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                        }),
                        holdDraft.actualVolumeInputUnit
                    ),
                    plannedVolumeInputValue: parseFormattedNumberish(holdDraft.actualVolumeInputValue || 0, {
                        maxFractionDigits: holdDraft.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                    }),
                    plannedVolumeInputUnit: holdDraft.actualVolumeInputUnit,
                }
                : item;
        }),
        itemRefs: Array.from(holdDraftByItemId.keys()),
        sourceDropPoints: sourceDropPoints.map(point => ({
            ...point,
            stopType: 'DROP' as const,
        })),
    };
}

function buildDriverHoldContinuationDefaultDropDraft(
    order: DriverAssignedDeliveryOrder,
    cargoItems: ActualCargoDraft[]
): ActualDropDraft {
    const totals = cargoItems.reduce((sum, item) => ({
        qtyKoli: sum.qtyKoli + parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }),
        weightKg: sum.weightKg + convertWeightToKg(
            parseFormattedNumberish(item.actualWeightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
            }),
            item.actualWeightInputUnit
        ),
        volumeM3: sum.volumeM3 + convertVolumeToM3(
            parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
            }),
            item.actualVolumeInputUnit
        ),
    }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
    const singleReference = order.shipperReferences?.length === 1 ? order.shipperReferences[0] : null;
    return {
        ...createEmptyActualDropDraft(),
        draftKey: 'hold-continuation-default-drop',
        shipperReferenceKey: singleReference?._key || cargoItems[0]?.shipperReferenceKey || '',
        shipperReferenceNumber: singleReference?.referenceNumber || cargoItems[0]?.shipperReferenceNumber || '',
        qtyKoli: totals.qtyKoli > 0 ? String(totals.qtyKoli) : '',
        weightInputValue: totals.weightKg > 0 ? String(totals.weightKg) : '',
        volumeInputValue: totals.volumeM3 > 0 ? String(totals.volumeM3) : '',
    };
}

function buildDriverHoldContinuationDefaultAllocationMap(
    drop: ActualDropDraft,
    cargoItems: ActualCargoDraft[]
) {
    return cargoItems.reduce<Record<string, CompletionDropItemValueDraft>>((map, item) => {
        map[buildCompletionDropItemValueKey(drop.draftKey, item.deliveryOrderItemRef)] = {
            qtyKoli: item.actualQtyKoli,
            weightInputValue: item.actualWeightInputValue,
            weightInputUnit: item.actualWeightInputUnit,
            volumeInputValue: item.actualVolumeInputValue,
            volumeInputUnit: item.actualVolumeInputUnit,
        };
        return map;
    }, {});
}

function sortCompletionDropDraftsBySequence(drops: ActualDropDraft[]) {
    return drops
        .map((drop, index) => ({ drop, index }))
        .sort((left, right) => {
            const leftIsHoldDefault = left.drop.draftKey === 'hold-continuation-default-drop';
            const rightIsHoldDefault = right.drop.draftKey === 'hold-continuation-default-drop';
            if (leftIsHoldDefault !== rightIsHoldDefault) {
                return leftIsHoldDefault ? -1 : 1;
            }
            return left.index - right.index;
        })
        .map(item => item.drop);
}

function toCargoDraftItemFromDriverOrderItem(item: NonNullable<DriverAssignedDeliveryOrder['driverCargoItems']>[number]): DeliveryOrderCargoDraftItem {
    return {
        deliveryOrderItemId: item._id,
        customerProductRef: '',
        description: item.orderItemDescription || '',
        qtyKoli: parseFormattedNumberish(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0),
        weightInputValue: parseFormattedNumberish(item.orderItemWeightInputValue ?? item.orderItemWeight ?? item.shippedWeight ?? 0),
        weightInputUnit: item.orderItemWeightInputUnit || 'KG',
        volumeInputValue: parseFormattedNumberish(item.orderItemVolumeInputValue ?? item.orderItemVolumeM3 ?? 0),
        volumeInputUnit: item.orderItemVolumeInputUnit || 'M3',
        value: 0,
    };
}

function isModalKeyboardTarget(element: Element | null): element is HTMLElement {
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

function scrollModalKeyboardTargetIntoView(target: HTMLElement) {
    if (!target.closest('.modal')) return;
    window.setTimeout(() => {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }, 80);
}

export default function DriverPortalPage() {
    const router = useRouter();
    const intervalRef = useRef<number | null>(null);
    const heartbeatInFlightRef = useRef(false);

    const [user, setUser] = useState<SessionUser | null>(null);
    const [driver, setDriver] = useState<Driver | null>(null);
    const [companyName, setCompanyName] = useState('PT Gading Mas Surya');
    const [driverPrintCompany, setDriverPrintCompany] = useState<PrintableCompanyProfile | null>(null);
    const [orders, setOrders] = useState<DriverAssignedDeliveryOrder[]>([]);
    const [plannedTrips, setPlannedTrips] = useState<DriverAssignedTripPlan[]>([]);
    const [driverVouchers, setDriverVouchers] = useState<DriverPortalVoucher[]>([]);
    const [driverIncidents, setDriverIncidents] = useState<DriverIncidentRecord[]>([]);
    const [activeSection, setActiveSection] = useState<DriverPortalSection>('TRIPS');
    const [billingCustomers, setBillingCustomers] = useState<Array<Pick<Customer, '_id' | 'name' | 'active'>>>([]);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    const [customerRecipients, setCustomerRecipients] = useState<CustomerRecipient[]>([]);
    const [loading, setLoading] = useState(true);
    const [portalLoadError, setPortalLoadError] = useState<string | null>(null);
    const [loggingOut, setLoggingOut] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'error' | 'success' | 'info'; message: string } | null>(null);
    const [showDeliveredRequestModal, setShowDeliveredRequestModal] = useState(false);
    const [completionOrderId, setCompletionOrderId] = useState<string | null>(null);
    const [completionMode, setCompletionMode] = useState<CompletionMode>('BATCH_STATUS');
    const [completionTargetStatus, setCompletionTargetStatus] = useState<DriverBatchStatusSelection>('');
    const [completionNote, setCompletionNote] = useState('');
    const [completionOdometerKm, setCompletionOdometerKm] = useState(0);
    const [completionInvoiceCustomerRef, setCompletionInvoiceCustomerRef] = useState('');
    const [completionInvoiceCustomerName, setCompletionInvoiceCustomerName] = useState('');
    const [completionPodReceiverName, setCompletionPodReceiverName] = useState('');
    const [completionPodReceivedDate, setCompletionPodReceivedDate] = useState('');
    const [completionPodNote, setCompletionPodNote] = useState('');
    const [selectedCompletionSjRefs, setSelectedCompletionSjRefs] = useState<string[]>([]);
    const [completionCargoItems, setCompletionCargoItems] = useState<ActualCargoDraft[]>([]);
    const [completionPartialHoldItemRefs, setCompletionPartialHoldItemRefs] = useState<string[]>([]);
    const [completionDropPoints, setCompletionDropPoints] = useState<ActualDropDraft[]>([]);
    const [completionFrozenDropPoints, setCompletionFrozenDropPoints] = useState<ActualDropDraft[]>([]);
    const [showCompletionAdvancedDropEditor, setShowCompletionAdvancedDropEditor] = useState(false);
    const [completionStep, setCompletionStep] = useState<CompletionStep>('SETUP');
    const [activeCompletionCargoItemRef, setActiveCompletionCargoItemRef] = useState('');
    const [activeCompletionDropKey, setActiveCompletionDropKey] = useState('');
    const [completionDropItemValueMap, setCompletionDropItemValueMap] = useState<Record<string, CompletionDropItemValueDraft>>({});
    const [showCargoInputModal, setShowCargoInputModal] = useState(false);
    const [cargoInputOrderId, setCargoInputOrderId] = useState<string | null>(null);
    const [cargoInputMode, setCargoInputMode] = useState<CargoInputMode>('CARGO');
    const [cargoInputEditingReferenceKey, setCargoInputEditingReferenceKey] = useState('');
    const [cargoInputEditingReferenceNumber, setCargoInputEditingReferenceNumber] = useState('');
    const [cargoInputGroups, setCargoInputGroups] = useState<DeliveryOrderCargoDraftGroup[]>([createDefaultDeliveryOrderCargoDraftGroup()]);
    const [showTripCreateModal, setShowTripCreateModal] = useState(false);
    const [tripCreateTargetId, setTripCreateTargetId] = useState<string | null>(null);
    const [tripCreateGroups, setTripCreateGroups] = useState<DeliveryOrderCargoDraftGroup[]>([createDefaultDeliveryOrderCargoDraftGroup()]);
    const [showIncidentModal, setShowIncidentModal] = useState(false);
    const [incidentOrderId, setIncidentOrderId] = useState<string | null>(null);
    const [incidentForm, setIncidentForm] = useState<{
        incidentType: Incident['incidentType'];
        urgency: Incident['urgency'];
        locationText: string;
        odometer: number;
        description: string;
    }>({
        incidentType: 'OTHER',
        urgency: 'MEDIUM',
        locationText: '',
        odometer: 0,
        description: '',
    });
    const [showIncidentCompletionModal, setShowIncidentCompletionModal] = useState(false);
    const [incidentCompletionIncidentId, setIncidentCompletionIncidentId] = useState<string | null>(null);
    const [incidentCompletionForm, setIncidentCompletionForm] = useState<{
        resolutionNote: string;
        resolutionLocationText: string;
        resolutionOdometer: number;
        costs: DriverIncidentCostDraft[];
    }>({
        resolutionNote: '',
        resolutionLocationText: '',
        resolutionOdometer: 0,
        costs: [],
    });

    const handleDriverAuthFailure = useCallback((message = 'Sesi driver berakhir. Silakan login ulang.') => {
        setPortalLoadError(null);
        setFeedback({ type: 'error', message });
        router.replace('/driver/login');
    }, [router]);

    const activeTrackingDo = useMemo(
        () => orders.find(item => item.trackingState === 'ACTIVE') || null,
        [orders]
    );
    const lockedTrackingDo = useMemo(
        () => orders.find(item => item.trackingState === 'ACTIVE' || item.trackingState === 'PAUSED') || null,
        [orders]
    );
    const visibleOrders = useMemo(
        () => orders.filter(isDriverDashboardDeliveryOrderVisible),
        [orders]
    );
    const isActionInFlight = Boolean(actionLoadingId);
    const completionOrder = useMemo(
        () => orders.find(item => item._id === completionOrderId) || null,
        [completionOrderId, orders]
    );
    const completionBatchStatusOptions = useMemo(
        () => completionOrder
            ? Array.from(new Set(
                getDriverOrderSjRows(completionOrder)
                    .filter(row => row.referenceNumber && row.itemCount > 0 && row.tripStatus !== 'DELIVERED' && !row.pendingRequest && row.nextStatus)
                    .map(row => row.nextStatus as DriverBatchStatus)
            ))
            : [],
        [completionOrder]
    );
    const completionSjOptions = useMemo(
        () => completionOrder
            ? getDriverOrderSjRows(completionOrder)
                .filter(row => row.referenceNumber && row.itemCount > 0 && row.tripStatus !== 'DELIVERED' && !row.pendingRequest && row.nextStatus === completionTargetStatus)
                .map(row => ({
                    ...row,
                    documentId: row.documentId,
                }))
            : [],
        [completionOrder, completionTargetStatus]
    );
    const selectedCompletionSjSet = useMemo(
        () => new Set(selectedCompletionSjRefs),
        [selectedCompletionSjRefs]
    );
    const selectedCompletionCargoItems = useMemo(() => {
        if (!completionOrder || selectedCompletionSjSet.size === 0) {
            return [];
        }
        const selectedRows = completionSjOptions.filter(row => selectedCompletionSjSet.has(row.documentId));
        const partialHoldItemRefSet = new Set(completionPartialHoldItemRefs);
        const selectedPartialHoldRowIds = new Set(
            selectedRows
                .filter(row => row.tripStatus === 'PARTIAL_HOLD' || row.hasHoldCargo)
                .map(row => row.documentId)
        );
        return completionCargoItems.filter(item =>
            selectedRows.some(row =>
                (row.referenceKey && item.shipperReferenceKey === row.referenceKey) ||
                (row.referenceNumber && (item.shipperReferenceNumber || completionOrder.customerDoNumber || '').trim().toUpperCase() === row.referenceNumber)
            ) &&
            (
                completionTargetStatus !== 'DELIVERED' ||
                selectedPartialHoldRowIds.size === 0 ||
                !selectedPartialHoldRowIds.has(getDriverOrderSjDocumentId(completionOrder._id, {
                    referenceKey: item.shipperReferenceKey,
                    referenceNumber: item.shipperReferenceNumber || completionOrder.customerDoNumber || '',
                })) ||
                partialHoldItemRefSet.has(item.deliveryOrderItemRef)
            )
        );
    }, [completionCargoItems, completionOrder, completionPartialHoldItemRefs, completionSjOptions, completionTargetStatus, selectedCompletionSjSet]);
    const selectedCompletionHoldCargoItems = useMemo(() => {
        const holdItemRefSet = new Set(completionPartialHoldItemRefs);
        return selectedCompletionCargoItems.filter(item => holdItemRefSet.has(item.deliveryOrderItemRef));
    }, [completionPartialHoldItemRefs, selectedCompletionCargoItems]);
    const selectedCompletionCargoTotalSummary = useMemo(
        () => summarizeActualCargoDraftList(selectedCompletionCargoItems),
        [selectedCompletionCargoItems]
    );
    const selectedCompletionHoldCargoTotalSummary = useMemo(
        () => selectedCompletionHoldCargoItems.length > 0
            ? summarizeActualCargoDraftList(selectedCompletionHoldCargoItems)
            : '-',
        [selectedCompletionHoldCargoItems]
    );
    const orderedCompletionDropPoints = useMemo(
        () => sortCompletionDropDraftsBySequence(completionDropPoints),
        [completionDropPoints]
    );
    const selectedCompletionDropPoints = useMemo(() => {
        if (selectedCompletionCargoItems.length === 0) {
            return [];
        }
        const selectedItemRefs = new Set(selectedCompletionCargoItems.map(item => item.deliveryOrderItemRef));
        const selectedReferenceKeys = new Set(selectedCompletionCargoItems.map(item => item.shipperReferenceKey).filter(Boolean));
        const selectedReferenceNumbers = new Set(selectedCompletionCargoItems.map(item => item.shipperReferenceNumber.trim().toUpperCase()).filter(Boolean));
        return orderedCompletionDropPoints.filter(drop => {
            const hasSpecificTarget = Boolean(drop.deliveryOrderItemRef || drop.shipperReferenceKey || drop.shipperReferenceNumber);
            return (
                selectedItemRefs.has(drop.deliveryOrderItemRef) ||
                selectedReferenceKeys.has(drop.shipperReferenceKey) ||
                selectedReferenceNumbers.has(drop.shipperReferenceNumber.trim().toUpperCase()) ||
                !hasSpecificTarget
            );
        });
    }, [orderedCompletionDropPoints, selectedCompletionCargoItems]);
    const getRemainingCompletionDropValuesForCargoItem = useCallback((
        cargoItem: ActualCargoDraft,
        fallback: Pick<ActualDropDraft, 'weightInputUnit' | 'volumeInputUnit'>,
        excludeDraftKey = ''
    ): CompletionDropItemValueDraft => {
        const weightInputUnit = cargoItem.actualWeightInputUnit || fallback.weightInputUnit;
        const volumeInputUnit = cargoItem.actualVolumeInputUnit || fallback.volumeInputUnit;
        const baseQtyKoli = parseFormattedNumberish(cargoItem.actualQtyKoli || 0, { maxFractionDigits: 2 });
        const baseWeightKg = convertWeightToKg(
            parseFormattedNumberish(cargoItem.actualWeightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(cargoItem.actualWeightInputUnit),
            }),
            cargoItem.actualWeightInputUnit
        );
        const baseVolumeM3 = convertVolumeToM3(
            parseFormattedNumberish(cargoItem.actualVolumeInputValue || 0, {
                maxFractionDigits: cargoItem.actualVolumeInputUnit === 'LITER' ? 0 : 3,
            }),
            cargoItem.actualVolumeInputUnit
        );
        const usedAllocationByKey = new Map<string, CompletionDropItemValueDraft>();
        for (const drop of orderedCompletionDropPoints) {
            if (drop.draftKey === excludeDraftKey) {
                break;
            }
            if (!completionDropMatchesCargoItem(drop, cargoItem)) {
                continue;
            }
            const valueKey = buildCompletionDropItemValueKey(drop.draftKey, cargoItem.deliveryOrderItemRef);
            const hasCachedValues = Object.prototype.hasOwnProperty.call(completionDropItemValueMap, valueKey);
            const values = hasCachedValues
                ? completionDropItemValueMap[valueKey]
                : drop.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef
                    ? pickCompletionDropItemValues(drop)
                    : (() => {
                        const used = Array.from(usedAllocationByKey.values()).reduce((sum, item) => ({
                            qtyKoli: sum.qtyKoli + parseFormattedNumberish(item.qtyKoli || 0, { maxFractionDigits: 2 }),
                            weightKg: sum.weightKg + convertWeightToKg(
                                parseFormattedNumberish(item.weightInputValue || 0, {
                                    maxFractionDigits: getWeightInputFractionDigits(item.weightInputUnit),
                                }),
                                item.weightInputUnit
                            ),
                            volumeM3: sum.volumeM3 + convertVolumeToM3(
                                parseFormattedNumberish(item.volumeInputValue || 0, {
                                    maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
                                }),
                                item.volumeInputUnit
                            ),
                        }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
                        const remainingQtyKoli = Math.max(baseQtyKoli - used.qtyKoli, 0);
                        const remainingWeightKg = Math.max(baseWeightKg - used.weightKg, 0);
                        const remainingVolumeM3 = Math.max(baseVolumeM3 - used.volumeM3, 0);
                        return {
                            qtyKoli: remainingQtyKoli > 0 ? String(remainingQtyKoli) : '',
                            weightInputValue: remainingWeightKg > 0 ? String(convertKgToWeightInputValue(remainingWeightKg, weightInputUnit)) : '',
                            weightInputUnit,
                            volumeInputValue: remainingVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(remainingVolumeM3, volumeInputUnit)) : '',
                            volumeInputUnit,
                        };
                    })();
            if (hasCompletionDropItemValues(values)) {
                usedAllocationByKey.set(valueKey, values);
            }
        }
        const used = Array.from(usedAllocationByKey.values()).reduce((sum, values) => ({
            qtyKoli: sum.qtyKoli + parseFormattedNumberish(values.qtyKoli || 0, { maxFractionDigits: 2 }),
            weightKg: sum.weightKg + convertWeightToKg(
                parseFormattedNumberish(values.weightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(values.weightInputUnit),
                }),
                values.weightInputUnit
            ),
            volumeM3: sum.volumeM3 + convertVolumeToM3(
                parseFormattedNumberish(values.volumeInputValue || 0, {
                    maxFractionDigits: values.volumeInputUnit === 'LITER' ? 0 : 3,
                }),
                values.volumeInputUnit
            ),
        }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        const remainingQtyKoli = Math.max(baseQtyKoli - used.qtyKoli, 0);
        const remainingWeightKg = Math.max(baseWeightKg - used.weightKg, 0);
        const remainingVolumeM3 = Math.max(baseVolumeM3 - used.volumeM3, 0);

        return {
            qtyKoli: remainingQtyKoli > 0 ? String(remainingQtyKoli) : '',
            weightInputValue: remainingWeightKg > 0 ? String(convertKgToWeightInputValue(remainingWeightKg, weightInputUnit)) : '',
            weightInputUnit,
            volumeInputValue: remainingVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(remainingVolumeM3, volumeInputUnit)) : '',
            volumeInputUnit,
        };
    }, [completionDropItemValueMap, orderedCompletionDropPoints]);
    const getCompletionDropAllocationForItem = useCallback((
        drop: ActualDropDraft,
        cargoItem: ActualCargoDraft
    ): ActualDropDraft => {
        const valueKey = buildCompletionDropItemValueKey(drop.draftKey, cargoItem.deliveryOrderItemRef);
        const cachedValues = completionDropItemValueMap[valueKey];
        const hasCachedValues = Object.prototype.hasOwnProperty.call(completionDropItemValueMap, valueKey);
        const baseDrop = {
            ...drop,
            deliveryOrderItemRef: cargoItem.deliveryOrderItemRef,
            shipperReferenceKey: cargoItem.shipperReferenceKey || drop.shipperReferenceKey,
            shipperReferenceNumber: cargoItem.shipperReferenceNumber || drop.shipperReferenceNumber,
        };
        if (hasCachedValues && cachedValues) {
            return { ...baseDrop, ...cachedValues };
        }
        if (drop.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef) {
            return baseDrop;
        }
        return {
            ...baseDrop,
            ...getRemainingCompletionDropValuesForCargoItem(cargoItem, drop, drop.draftKey),
        };
    }, [completionDropItemValueMap, getRemainingCompletionDropValuesForCargoItem]);
    const summarizeCompletionDropAllocationForItems = useCallback((
        drop: ActualDropDraft,
        cargoItems: ActualCargoDraft[]
    ) => formatCargoSummary(cargoItems.reduce((sum, cargoItem) => {
        const allocation = getCompletionDropAllocationForItem(drop, cargoItem);
        return {
            qtyKoli: sum.qtyKoli + parseFormattedNumberish(allocation.qtyKoli || 0, { maxFractionDigits: 2 }),
            weightKg: sum.weightKg + convertWeightToKg(
                parseFormattedNumberish(allocation.weightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(allocation.weightInputUnit),
                }),
                allocation.weightInputUnit
            ),
            volumeM3: sum.volumeM3 + convertVolumeToM3(
                parseFormattedNumberish(allocation.volumeInputValue || 0, {
                    maxFractionDigits: allocation.volumeInputUnit === 'LITER' ? 0 : 3,
                }),
                allocation.volumeInputUnit
            ),
        };
    }, { qtyKoli: 0, weightKg: 0, volumeM3: 0 })), [getCompletionDropAllocationForItem]);
    const summarizeCompletionDropAllocationsForItemByType = useCallback((
        cargoItem: ActualCargoDraft,
        stopTypes: string[]
    ) => {
        const stopTypeSet = new Set(stopTypes);
        const matchingDrops = selectedCompletionDropPoints.filter(drop => stopTypeSet.has(drop.stopType));
        if (matchingDrops.length === 0) {
            return '-';
        }
        const totals = matchingDrops.reduce((sum, drop) => {
            const allocation = getCompletionDropAllocationForItem(drop, cargoItem);
            return {
                qtyKoli: sum.qtyKoli + parseFormattedNumberish(allocation.qtyKoli || 0, { maxFractionDigits: 2 }),
                weightKg: sum.weightKg + convertWeightToKg(
                    parseFormattedNumberish(allocation.weightInputValue || 0, {
                        maxFractionDigits: getWeightInputFractionDigits(allocation.weightInputUnit),
                    }),
                    allocation.weightInputUnit
                ),
                volumeM3: sum.volumeM3 + convertVolumeToM3(
                    parseFormattedNumberish(allocation.volumeInputValue || 0, {
                        maxFractionDigits: allocation.volumeInputUnit === 'LITER' ? 0 : 3,
                    }),
                    allocation.volumeInputUnit
                ),
            };
        }, { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        if (totals.qtyKoli <= 0 && totals.weightKg <= 0 && totals.volumeM3 <= 0) {
            return '-';
        }
        return formatCargoSummary(totals);
    }, [getCompletionDropAllocationForItem, selectedCompletionDropPoints]);
    const summarizeCompletionRemainingUnallocatedForItem = useCallback((cargoItem: ActualCargoDraft) => {
        const allocatedTotals = selectedCompletionDropPoints.reduce((sum, drop) => {
            const allocation = getCompletionDropAllocationForItem(drop, cargoItem);
            return {
                qtyKoli: sum.qtyKoli + parseFormattedNumberish(allocation.qtyKoli || 0, { maxFractionDigits: 2 }),
                weightKg: sum.weightKg + convertWeightToKg(
                    parseFormattedNumberish(allocation.weightInputValue || 0, {
                        maxFractionDigits: getWeightInputFractionDigits(allocation.weightInputUnit),
                    }),
                    allocation.weightInputUnit
                ),
                volumeM3: sum.volumeM3 + convertVolumeToM3(
                    parseFormattedNumberish(allocation.volumeInputValue || 0, {
                        maxFractionDigits: allocation.volumeInputUnit === 'LITER' ? 0 : 3,
                    }),
                    allocation.volumeInputUnit
                ),
            };
        }, { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        const actualTotals = {
            qtyKoli: parseFormattedNumberish(cargoItem.actualQtyKoli || 0, { maxFractionDigits: 2 }),
            weightKg: convertWeightToKg(
                parseFormattedNumberish(cargoItem.actualWeightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(cargoItem.actualWeightInputUnit),
                }),
                cargoItem.actualWeightInputUnit
            ),
            volumeM3: convertVolumeToM3(
                parseFormattedNumberish(cargoItem.actualVolumeInputValue || 0, {
                    maxFractionDigits: cargoItem.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                }),
                cargoItem.actualVolumeInputUnit
            ),
        };
        const remaining = {
            qtyKoli: Math.max(actualTotals.qtyKoli - allocatedTotals.qtyKoli, 0),
            weightKg: Math.max(actualTotals.weightKg - allocatedTotals.weightKg, 0),
            volumeM3: Math.max(actualTotals.volumeM3 - allocatedTotals.volumeM3, 0),
        };
        if (remaining.qtyKoli <= 0 && remaining.weightKg <= 0 && remaining.volumeM3 <= 0) {
            return '-';
        }
        return formatCargoSummary(remaining);
    }, [getCompletionDropAllocationForItem, selectedCompletionDropPoints]);
    const expandCompletionDropPointAllocations = useCallback((
        drop: ActualDropDraft,
        cargoItems: ActualCargoDraft[]
    ) => cargoItems
        .map(cargoItem => {
            const allocation = getCompletionDropAllocationForItem(drop, cargoItem);
            const values = pickCompletionDropItemValues(allocation);
            if (!hasCompletionDropItemValues(values)) {
                return null;
            }
            return {
                ...drop,
                ...values,
                draftKey: `${drop.draftKey}${COMPLETION_DROP_ITEM_VALUE_SEPARATOR}${cargoItem.deliveryOrderItemRef}`,
                deliveryOrderItemRef: cargoItem.deliveryOrderItemRef,
                shipperReferenceKey: cargoItem.shipperReferenceKey || drop.shipperReferenceKey,
                shipperReferenceNumber: cargoItem.shipperReferenceNumber || drop.shipperReferenceNumber,
            };
        })
        .filter((drop): drop is ActualDropDraft => Boolean(drop)), [getCompletionDropAllocationForItem]);
    const selectedCompletionWorkingDropPoints = useMemo(
        () => showCompletionAdvancedDropEditor
            ? selectedCompletionDropPoints.flatMap(drop => expandCompletionDropPointAllocations(drop, selectedCompletionCargoItems))
            : selectedCompletionDropPoints,
        [expandCompletionDropPointAllocations, selectedCompletionCargoItems, selectedCompletionDropPoints, showCompletionAdvancedDropEditor]
    );
    const completionActualSummaryDropPoints = useMemo(
        () => completionStep === 'ACTUAL' && completionFrozenDropPoints.length > 0
            ? completionFrozenDropPoints
            : selectedCompletionWorkingDropPoints,
        [completionFrozenDropPoints, completionStep, selectedCompletionWorkingDropPoints]
    );
    const summarizeActualStepDropPointsForItemByType = useCallback((
        cargoItem: ActualCargoDraft,
        stopTypes: string[]
    ) => {
        const stopTypeSet = new Set(stopTypes);
        const itemReferenceNumber = cargoItem.shipperReferenceNumber.trim().toUpperCase();
        const totals = completionActualSummaryDropPoints
            .filter(point => stopTypeSet.has(point.stopType))
            .filter(point => {
                if (point.deliveryOrderItemRef) {
                    return point.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef;
                }
                if (point.shipperReferenceKey) {
                    return point.shipperReferenceKey === cargoItem.shipperReferenceKey;
                }
                return Boolean(point.shipperReferenceNumber && point.shipperReferenceNumber.trim().toUpperCase() === itemReferenceNumber);
            })
            .reduce((sum, point) => ({
                qtyKoli: sum.qtyKoli + parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }),
                weightKg: sum.weightKg + convertWeightToKg(
                    parseFormattedNumberish(point.weightInputValue || 0, {
                        maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit),
                    }),
                    point.weightInputUnit
                ),
                volumeM3: sum.volumeM3 + convertVolumeToM3(
                    parseFormattedNumberish(point.volumeInputValue || 0, {
                        maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
                    }),
                    point.volumeInputUnit
                ),
            }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        if (totals.qtyKoli <= 0 && totals.weightKg <= 0 && totals.volumeM3 <= 0) {
            return '-';
        }
        return formatCargoSummary(totals);
    }, [completionActualSummaryDropPoints]);
    const completionDetailState = useMemo(
        () => buildDeliveryOrderDetailState({
            doData: completionOrder,
            actualCargoItems: selectedCompletionCargoItems,
            actualDropPoints: selectedCompletionWorkingDropPoints,
            showAdvancedDropEditor: showCompletionAdvancedDropEditor,
        }),
        [completionOrder, selectedCompletionCargoItems, selectedCompletionWorkingDropPoints, showCompletionAdvancedDropEditor]
    );
    const selectedCompletionBillableCargoItems = useMemo(() => {
        if (!showCompletionAdvancedDropEditor) {
            return selectedCompletionCargoItems;
        }
        return selectedCompletionCargoItems.map(item => {
            const billableAllocations = selectedCompletionWorkingDropPoints
                .filter(point => point.deliveryOrderItemRef === item.deliveryOrderItemRef)
                .filter(point => point.stopType === 'DROP' || point.stopType === 'EXTRA_DROP')
                .map(point => pickCompletionDropItemValues(point))
                .filter(values => hasCompletionDropItemValues(values));
            const actualQtyKoli = billableAllocations.reduce(
                (sum, values) => sum + parseFormattedNumberish(values.qtyKoli || 0, { maxFractionDigits: 2 }),
                0
            );
            const actualWeightKg = billableAllocations.reduce(
                (sum, values) => sum + convertWeightToKg(
                    parseFormattedNumberish(values.weightInputValue || 0, {
                        maxFractionDigits: getWeightInputFractionDigits(values.weightInputUnit),
                    }),
                    values.weightInputUnit
                ),
                0
            );
            const actualVolumeM3 = billableAllocations.reduce(
                (sum, values) => sum + convertVolumeToM3(
                    parseFormattedNumberish(values.volumeInputValue || 0, {
                        maxFractionDigits: values.volumeInputUnit === 'LITER' ? 0 : 3,
                    }),
                    values.volumeInputUnit
                ),
                0
            );
            return {
                ...item,
                actualQtyKoli: actualQtyKoli > 0 ? String(actualQtyKoli) : '',
                actualWeightInputValue: actualWeightKg > 0 ? String(convertKgToWeightInputValue(actualWeightKg, item.actualWeightInputUnit)) : '',
                actualVolumeInputValue: actualVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(actualVolumeM3, item.actualVolumeInputUnit)) : '',
            };
        });
    }, [selectedCompletionCargoItems, selectedCompletionWorkingDropPoints, showCompletionAdvancedDropEditor]);
    const selectedCompletionDerivedActualCargoItems = useMemo(() => {
        if (!showCompletionAdvancedDropEditor) {
            return selectedCompletionCargoItems;
        }
        return selectedCompletionCargoItems;
    }, [selectedCompletionCargoItems, showCompletionAdvancedDropEditor]);
    const selectedCompletionActualCargoTabItems = useMemo(
        () => selectedCompletionDerivedActualCargoItems.filter(hasActualCargoDraftValues),
        [selectedCompletionDerivedActualCargoItems]
    );
    const cargoInputOrder = useMemo(
        () => orders.find(item => item._id === cargoInputOrderId) || null,
        [cargoInputOrderId, orders]
    );
    const cargoInputCustomerProducts = useMemo(
        () => customerProducts.filter(product => product.customerRef === cargoInputOrder?.customerRef),
        [cargoInputOrder?.customerRef, customerProducts]
    );
    const cargoInputAllowsDirectCargoInput = cargoInputOrder?.allowsDirectCargoInput !== false;
    const tripCreateTarget = useMemo(
        () => plannedTrips.find(item => getDriverTripPlanId(item) === tripCreateTargetId) || null,
        [plannedTrips, tripCreateTargetId]
    );
    const incidentOrder = useMemo(
        () => orders.find(item => item._id === incidentOrderId) || null,
        [incidentOrderId, orders]
    );
    const driverIncidentsByOrder = useMemo(() => {
        const grouped = new Map<string, DriverIncidentRecord[]>();
        for (const incident of driverIncidents) {
            const orderRef = incident.relatedDeliveryOrderRef || '';
            if (!orderRef) {
                continue;
            }
            const current = grouped.get(orderRef) || [];
            current.push(incident);
            grouped.set(orderRef, current);
        }
        return grouped;
    }, [driverIncidents]);
    const incidentCompletionIncident = useMemo(
        () => driverIncidents.find(item => item._id === incidentCompletionIncidentId) || null,
        [driverIncidents, incidentCompletionIncidentId]
    );
    const incidentCompletionOrder = useMemo(
        () => incidentCompletionIncident
            ? orders.find(item => item._id === incidentCompletionIncident.relatedDeliveryOrderRef) || null
            : null,
        [incidentCompletionIncident, orders]
    );
    const tripCreateAllowsDirectCargoInput = tripCreateTarget?.allowsDirectCargoInput !== false;
    const tripCreateCustomerProducts = useMemo(
        () => customerProducts.filter(product => product.customerRef === tripCreateTarget?.customerRef),
        [customerProducts, tripCreateTarget?.customerRef]
    );
    const completionCargoReady = useMemo(
        () => selectedCompletionActualCargoTabItems.length === 0 || areActualCargoDraftsReady(selectedCompletionActualCargoTabItems),
        [selectedCompletionActualCargoTabItems]
    );
    const activeCompletionCargoItem = useMemo(
        () => (
            selectedCompletionActualCargoTabItems.find(item => item.deliveryOrderItemRef === activeCompletionCargoItemRef) ||
            selectedCompletionActualCargoTabItems[0] ||
            null
        ),
        [activeCompletionCargoItemRef, selectedCompletionActualCargoTabItems]
    );
    const activeCompletionDropCargoItem = useMemo(
        () => (
            selectedCompletionCargoItems.find(item => item.deliveryOrderItemRef === activeCompletionCargoItemRef) ||
            selectedCompletionCargoItems[0] ||
            null
        ),
        [activeCompletionCargoItemRef, selectedCompletionCargoItems]
    );
    const activeCompletionDrop = useMemo(
        () => activeCompletionDropKey
            ? selectedCompletionDropPoints.find(drop => drop.draftKey === activeCompletionDropKey) || null
            : null,
        [activeCompletionDropKey, selectedCompletionDropPoints]
    );
    const activeCompletionDropAllocationSummary = useMemo(() => {
        if (!activeCompletionDrop) {
            return '';
        }
        return formatCargoSummary(selectedCompletionCargoItems.reduce((sum, cargoItem) => {
            const allocation = getCompletionDropAllocationForItem(activeCompletionDrop, cargoItem);
            return {
                qtyKoli: sum.qtyKoli + parseFormattedNumberish(allocation.qtyKoli || 0, { maxFractionDigits: 2 }),
                weightKg: sum.weightKg + convertWeightToKg(
                    parseFormattedNumberish(allocation.weightInputValue || 0, {
                        maxFractionDigits: getWeightInputFractionDigits(allocation.weightInputUnit),
                    }),
                    allocation.weightInputUnit
                ),
                volumeM3: sum.volumeM3 + convertVolumeToM3(
                    parseFormattedNumberish(allocation.volumeInputValue || 0, {
                        maxFractionDigits: allocation.volumeInputUnit === 'LITER' ? 0 : 3,
                    }),
                    allocation.volumeInputUnit
                ),
            };
        }, { qtyKoli: 0, weightKg: 0, volumeM3: 0 }));
    }, [activeCompletionDrop, getCompletionDropAllocationForItem, selectedCompletionCargoItems]);
    const selectedCompletionDropModeLabel = useMemo(() => {
        if (!showCompletionAdvancedDropEditor) {
            return completionDetailState.autoActualDropDraft.locationName || 'Tujuan default';
        }
        const holdCount = selectedCompletionDropPoints.filter(point => point.stopType === 'HOLD').length;
        return [
            `${selectedCompletionDropPoints.length} titik`,
            holdCount > 0 ? `${holdCount} hold` : null,
        ].filter(Boolean).join(' | ');
    }, [completionDetailState.autoActualDropDraft.locationName, selectedCompletionDropPoints, showCompletionAdvancedDropEditor]);
    const flattenedCargoInputItems = useMemo(
        () => flattenDeliveryOrderCargoDraftGroups(cargoInputGroups),
        [cargoInputGroups]
    );
    const cargoInputDraftGroups = useMemo(
        () => getDraftDeliveryOrderCargoGroups(cargoInputGroups),
        [cargoInputGroups]
    );
    const cargoInputDraftItems = useMemo(
        () => cargoInputDraftGroups.flatMap(group =>
            group.draftItems.map(item => ({
                ...item,
                pickupStopKey: group.pickupStopKey,
                shipperReferenceNumber: group.shipperReferenceNumber,
            }))
        ),
        [cargoInputDraftGroups]
    );
    const cargoInputSummary = useMemo(
        () => summarizeDraftOrderCargo(flattenedCargoInputItems),
        [flattenedCargoInputItems]
    );
    const cargoInputExistingSummary = useMemo(
        () => (cargoInputOrder ? summarizeDriverOrderCargo(cargoInputOrder) : ''),
        [cargoInputOrder]
    );
    const flattenedTripCreateItems = useMemo(
        () => flattenDeliveryOrderCargoDraftGroups(tripCreateGroups),
        [tripCreateGroups]
    );
    const tripCreateDraftGroups = useMemo(
        () => getDraftDeliveryOrderCargoGroups(tripCreateGroups),
        [tripCreateGroups]
    );
    const tripCreateDraftItems = useMemo(
        () => tripCreateDraftGroups.flatMap(group =>
            group.draftItems.map(item => ({
                ...item,
                pickupStopKey: group.pickupStopKey,
                shipperReferenceNumber: group.shipperReferenceNumber,
            }))
        ),
        [tripCreateDraftGroups]
    );
    const tripCreateSummary = useMemo(
        () => summarizeDraftOrderCargo(flattenedTripCreateItems),
        [flattenedTripCreateItems]
    );
    const completionBatchSjCargoSummary = useMemo(
        () => formatCargoSummary({
            qtyKoli: selectedCompletionCargoItems.reduce((sum, item) => sum + parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }), 0),
            weightKg: selectedCompletionCargoItems.reduce((sum, item) => {
                const value = parseFormattedNumberish(item.actualWeightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
                });
                return sum + convertWeightToKg(value, item.actualWeightInputUnit);
            }, 0),
            volumeM3: selectedCompletionCargoItems.reduce((sum, item) => {
                const value = parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                    maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                });
                return sum + convertVolumeToM3(value, item.actualVolumeInputUnit);
            }, 0),
        }),
        [selectedCompletionCargoItems]
    );
    const completionBillingCustomerOptions = useMemo(() => {
        const activeCustomers = billingCustomers.filter(customer => customer.active !== false);
        if (!completionOrder?.customerRef) {
            return activeCustomers;
        }
        const hasOrderCustomer = activeCustomers.some(customer => customer._id === completionOrder.customerRef);
        return hasOrderCustomer
            ? activeCustomers
            : [
                {
                    _id: completionOrder.customerRef,
                    name: completionOrder.customerName || 'Customer order',
                    active: true,
                },
                ...activeCustomers,
            ];
    }, [billingCustomers, completionOrder?.customerName, completionOrder?.customerRef]);
    const completionCustomerRecipients = useMemo(
        () => customerRecipients.filter(recipient => recipient.customerRef === (completionInvoiceCustomerRef || completionOrder?.customerRef)),
        [completionInvoiceCustomerRef, completionOrder?.customerRef, customerRecipients]
    );
    const completionVehicleCurrentOdometer = useMemo(
        () => Math.max(completionOrder?.vehicleLastOdometer || 0, 0),
        [completionOrder?.vehicleLastOdometer]
    );
    const completionOdometerTooLow = completionMode === 'TRIP_CLOSE' &&
        completionOdometerKm > 0 &&
        completionOdometerKm < completionVehicleCurrentOdometer;
    const applyOrderUpdate = useCallback((updated: DriverAssignedDeliveryOrder) => {
        setOrders(prev => {
            const nextOrder = isDriverDashboardDeliveryOrderVisible(updated) ? updated : null;
            const hasExistingOrder = prev.some(item => item._id === updated._id);
            if (!nextOrder) {
                return prev.filter(item => item._id !== updated._id);
            }
            return hasExistingOrder
                ? prev.map(item => (item._id === updated._id ? { ...item, ...updated } : item))
                : [...prev, nextOrder];
        });
    }, []);

    const loadOrders = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
        if (mode === 'refresh') {
            setRefreshing(true);
        }

        try {
            const res = await fetch('/api/driver/delivery-orders');
            const payload = await res.json() as DriverDeliveryOrdersResponse;
            if (!res.ok) {
                throw createDriverPortalError(res.status, payload.error || 'Gagal memuat surat jalan driver');
            }

            let incidents: DriverIncidentRecord[] = [];
            try {
                const incidentsRes = await fetch('/api/driver/incidents');
                const incidentPayload = await incidentsRes.json().catch(() => null) as DriverIncidentsResponse | null;
                if (!incidentsRes.ok) {
                    if (incidentsRes.status === 401 || incidentsRes.status === 403) {
                        throw createDriverPortalError(incidentsRes.status, incidentPayload?.error || 'Gagal memuat insiden driver');
                    }
                } else {
                    incidents = incidentPayload?.data || [];
                }
            } catch (incidentError) {
                if (isDriverUnauthorizedError(incidentError)) {
                    throw incidentError;
                }
                incidents = [];
            }
            setOrders((payload.data || []).filter(isDriverDashboardDeliveryOrderVisible));
            setPlannedTrips((payload.plannedTrips || []).filter(isDriverDashboardTripPlanVisible));
            setDriverVouchers(payload.driverVouchers || []);
            setDriverIncidents(incidents.filter(incident => incident.status !== 'CLOSED'));
            setBillingCustomers((payload.billingCustomers || []).filter(customer => customer.active !== false));
            setCustomerProducts((payload.customerProducts || []).filter(product => product.active !== false));
            setCustomerRecipients((payload.customerRecipients || []).filter(recipient => recipient.active !== false));
        } catch (error) {
            if (isDriverUnauthorizedError(error)) {
                handleDriverAuthFailure(error instanceof Error ? error.message : undefined);
                return;
            }
            setFeedback({
                type: 'error',
                message: error instanceof Error ? error.message : 'Gagal memuat surat jalan driver',
            });
        } finally {
            if (mode === 'refresh') {
                setRefreshing(false);
            }
        }
    }, [handleDriverAuthFailure]);

    const loadDriverPortal = useCallback(async () => {
        setLoading(true);
        setPortalLoadError(null);
        try {
            const sessionRes = await fetch('/api/driver/session');
            const sessionPayload = await sessionRes.json() as DriverSessionResponse & { error?: string };
            if (!sessionRes.ok || !sessionPayload.user || !sessionPayload.driver) {
                throw createDriverPortalError(sessionRes.status, sessionPayload.error || 'Akun driver tidak valid');
            }

            setUser(sessionPayload.user);
            setDriver(sessionPayload.driver);
            setCompanyName(sessionPayload.company?.name || 'PT Gading Mas Surya');
            setDriverPrintCompany(sessionPayload.company
                ? {
                    name: sessionPayload.company.name,
                    address: '',
                    phone: sessionPayload.company.phone || '',
                    email: '',
                }
                : null
            );
            await loadOrders('initial');
        } catch (error) {
            if (isDriverUnauthorizedError(error)) {
                handleDriverAuthFailure(error instanceof Error ? error.message : undefined);
                return;
            }
            setPortalLoadError(error instanceof Error ? error.message : 'Gagal memuat aplikasi driver');
        } finally {
            setLoading(false);
        }
    }, [handleDriverAuthFailure, loadOrders]);

    const handlePreviewDriverVoucher = useCallback(async (voucher: DriverPortalVoucher) => {
        const targetWindow = openPrintWindow(`Menyiapkan uang jalan ${voucher.bonNumber}...`);
        if (!targetWindow) {
            setFeedback({
                type: 'error',
                message: 'Popup preview diblokir browser. Izinkan popup untuk membuka preview uang jalan.',
            });
            return;
        }

        try {
            const linkedDeliveryOrder = voucher.deliveryOrderRef
                ? orders.find(order => order._id === voucher.deliveryOrderRef) || null
                : null;
            const items = voucher.items || [];
            const disbursements = voucher.disbursements || [];
            const summary = buildDriverVoucherDetailSummary(voucher, items);
            const bodyHtml = buildDriverVoucherPrintHtml({
                voucher,
                deliveryOrder: linkedDeliveryOrder,
                items,
                disbursements,
                summary,
            });

            openBrandedPrint({
                title: 'Uang Jalan Trip',
                subtitle: voucher.bonNumber,
                company: resolveDocumentIssuerProfile(voucher, driverPrintCompany),
                bodyHtml,
                targetWindow,
                autoPrint: false,
            });
        } catch (error) {
            targetWindow.close();
            setFeedback({
                type: 'error',
                message: error instanceof Error ? error.message : 'Gagal membuka preview uang jalan',
            });
        }
    }, [driverPrintCompany, orders]);

    useEffect(() => {
        void loadDriverPortal();
    }, [loadDriverPortal]);

    useEffect(() => {
        const scrollActiveModalField = () => {
            const activeElement = document.activeElement;
            if (isModalKeyboardTarget(activeElement)) {
                scrollModalKeyboardTargetIntoView(activeElement);
            }
        };

        const handleFocusIn = (event: FocusEvent) => {
            const target = event.target as Element | null;
            if (isModalKeyboardTarget(target)) {
                scrollModalKeyboardTargetIntoView(target);
            }
        };

        document.addEventListener('focusin', handleFocusIn);
        window.addEventListener('resize', scrollActiveModalField);
        window.visualViewport?.addEventListener('resize', scrollActiveModalField);
        window.visualViewport?.addEventListener('scroll', scrollActiveModalField);

        return () => {
            document.removeEventListener('focusin', handleFocusIn);
            window.removeEventListener('resize', scrollActiveModalField);
            window.visualViewport?.removeEventListener('resize', scrollActiveModalField);
            window.visualViewport?.removeEventListener('scroll', scrollActiveModalField);
        };
    }, []);

    const postTrackingAction = useCallback(
        async (
            action: 'start' | 'heartbeat' | 'resume' | 'stop' | 'rollback-start',
            deliveryOrderRef: string,
            coords?: GeolocationCoordinates
        ) => {
            const res = await fetch('/api/driver/tracking', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    deliveryOrderRef,
                    latitude: coords?.latitude,
                    longitude: coords?.longitude,
                    accuracyM: coords?.accuracy,
                    speedMps: typeof coords?.speed === 'number' ? coords.speed : undefined,
                }),
            });

            const payload = await res.json();
            if (!res.ok) {
                throw createDriverPortalError(res.status, payload.error || 'Gagal mengirim tracking');
            }

            if (payload.data) {
                applyOrderUpdate(payload.data as DriverAssignedDeliveryOrder);
            }

            return payload.data as DriverAssignedDeliveryOrder | undefined;
        },
        [applyOrderUpdate]
    );

    const postDeliveryProgress = useCallback(
        async (
            deliveryOrderRef: string,
            status: DriverProgressStatus,
            options?: {
                note?: string;
                tripEndOdometerKm?: number;
                selectedSuratJalanRefs?: string[];
                podReceiverName?: string;
                podReceivedDate?: string;
                podNote?: string;
                actualItems?: Array<{
                    deliveryOrderItemRef: string;
                    actualQtyKoli: number;
                    actualWeightInputValue: number;
                    actualWeightInputUnit: ActualCargoDraft['actualWeightInputUnit'];
                    actualVolumeInputValue: number;
                    actualVolumeInputUnit: ActualCargoDraft['actualVolumeInputUnit'];
                }>;
                actualDropPoints?: Array<{
                    stopType: ActualDropDraft['stopType'];
                    deliveryOrderItemRef?: string;
                    shipperReferenceKey?: string;
                    shipperReferenceNumber?: string;
                    billingCustomerRef?: string;
                    billingCustomerName?: string;
                    locationName: string;
                    locationAddress: string;
                    qtyKoli: number;
                    weightInputValue: number;
                    weightInputUnit: ActualDropDraft['weightInputUnit'];
                    volumeInputValue: number;
                    volumeInputUnit: ActualDropDraft['volumeInputUnit'];
                    note?: string;
                }>;
                closeTripOnly?: boolean;
            }
        ) => {
            const res = await fetch('/api/driver/delivery-orders/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: deliveryOrderRef,
                    status,
                    note: options?.note,
                    tripEndOdometerKm: options?.tripEndOdometerKm,
                    selectedSuratJalanRefs: options?.selectedSuratJalanRefs,
                    podReceiverName: options?.podReceiverName,
                    podReceivedDate: options?.podReceivedDate,
                    podNote: options?.podNote,
                    actualItems: options?.actualItems,
                    actualDropPoints: options?.actualDropPoints,
                    closeTripOnly: options?.closeTripOnly,
                }),
            });

            const payload = await res.json();
            if (!res.ok) {
                throw createDriverPortalError(payload.status || res.status, payload.error || 'Gagal memperbarui progres perjalanan');
            }

            if (payload.data) {
                applyOrderUpdate(payload.data as DriverAssignedDeliveryOrder);
            }

            return payload.data as DriverAssignedDeliveryOrder | undefined;
        },
        [applyOrderUpdate]
    );

    const withCurrentPosition = useCallback(
        (onSuccess: (coords: GeolocationCoordinates) => Promise<void>) => {
            if (!navigator.geolocation) {
                setFeedback({ type: 'error', message: 'Browser HP ini tidak mendukung lokasi GPS.' });
                setActionLoadingId(null);
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    void onSuccess(position.coords);
                },
                (error) => {
                    const message =
                        error.code === error.PERMISSION_DENIED
                            ? 'Izin lokasi ditolak. Aktifkan GPS agar tracking live berjalan.'
                            : 'Gagal mengambil posisi GPS saat ini.';
                    setFeedback({ type: 'error', message });
                    setActionLoadingId(null);
                },
                { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
            );
        },
        []
    );

    const startTracking = useCallback(
        (deliveryOrderRef: string, resume = false) => {
            setActionLoadingId(deliveryOrderRef);
            withCurrentPosition(async coords => {
                try {
                    await postTrackingAction(resume ? 'resume' : 'start', deliveryOrderRef, coords);
                    setFeedback({
                        type: 'success',
                        message: resume
                            ? 'Tracking dipulihkan lagi. Biarkan GPS menyala sampai admin menyelesaikan DO.'
                            : 'Tracking live dimulai. Driver tidak bisa menghentikannya sendiri sebelum admin menyelesaikan DO.',
                    });
                    await loadOrders();
                } catch (error) {
                    if (isDriverUnauthorizedError(error)) {
                        handleDriverAuthFailure(error instanceof Error ? error.message : undefined);
                        return;
                    }
                    setFeedback({
                        type: 'error',
                        message: error instanceof Error ? error.message : 'Gagal memulai tracking',
                    });
                } finally {
                    setActionLoadingId(null);
                }
            });
        },
        [handleDriverAuthFailure, loadOrders, postTrackingAction, withCurrentPosition]
    );

    useEffect(() => {
        if (intervalRef.current) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        if (!activeTrackingDo) {
            heartbeatInFlightRef.current = false;
            return;
        }

        const sendHeartbeat = () => {
            if (document.hidden || heartbeatInFlightRef.current || !navigator.geolocation) {
                return;
            }

            heartbeatInFlightRef.current = true;
            navigator.geolocation.getCurrentPosition(
                async position => {
                    try {
                        await postTrackingAction('heartbeat', activeTrackingDo._id, position.coords);
                    } catch (error) {
                        const errorStatus = getDriverPortalErrorStatus(error);
                        if (typeof errorStatus === 'number') {
                            if (errorStatus === 401) {
                                handleDriverAuthFailure(error instanceof Error ? error.message : undefined);
                                return;
                            }
                            if (errorStatus === 409) {
                                setFeedback({
                                    type: 'info',
                                    message: error instanceof Error ? error.message : 'Status tracking berubah di server.',
                                });
                                await loadOrders();
                                return;
                            }
                        }
                        setFeedback({
                            type: 'error',
                            message: error instanceof Error ? error.message : 'Gagal mengirim lokasi live',
                        });
                    } finally {
                        heartbeatInFlightRef.current = false;
                    }
                },
                error => {
                    heartbeatInFlightRef.current = false;
                    if (error.code === error.PERMISSION_DENIED) {
                        setFeedback({ type: 'error', message: 'Izin lokasi dicabut. Tracking live berhenti akurat sampai GPS diaktifkan lagi.' });
                    }
                },
                { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
            );
        };

        sendHeartbeat();
        intervalRef.current = window.setInterval(sendHeartbeat, DRIVER_TRACKING_HEARTBEAT_INTERVAL_MS);

        return () => {
            if (intervalRef.current) {
                window.clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [activeTrackingDo, handleDriverAuthFailure, loadOrders, postTrackingAction]);

    const handleLogout = async () => {
        if (loggingOut) {
            return;
        }
        if (lockedTrackingDo) {
            const confirmed = window.confirm(
                `Kamu masih terikat ke ${lockedTrackingDo.doNumber}. Keluar sekarang akan menghentikan tracking live di browser ini sampai kamu login lagi. Lanjut keluar?`
            );
            if (!confirmed) {
                return;
            }
        }

        setLoggingOut(true);
        try {
            const res = await fetch('/api/driver/logout', { method: 'POST' });
            if (!res.ok && res.status !== 401) {
                const payload = await res.json().catch(() => null);
                throw createDriverPortalError(res.status, payload?.error || 'Gagal keluar dari portal driver');
            }
            router.push('/driver/login');
            router.refresh();
        } catch (error) {
            setFeedback({
                type: 'error',
                message: error instanceof Error ? error.message : 'Gagal keluar dari portal driver',
            });
        } finally {
            setLoggingOut(false);
        }
    };

    const openDeliveredRequestModal = useCallback((
        order: DriverAssignedDeliveryOrder,
        options?: { targetStatus?: DriverBatchStatus; selectedSuratJalanRefs?: string[]; mode?: CompletionMode }
    ) => {
        const mode = options?.mode || 'BATCH_STATUS';
        const baseCargoItems = buildActualCargoDrafts(order.driverCargoItems || [], order.pendingDriverActualCargoItems);
        const sjRows = getDriverOrderSjRows(order);
        const availableStatuses = Array.from(new Set(
            sjRows
                .filter(row => row.referenceNumber && row.itemCount > 0 && row.tripStatus !== 'DELIVERED' && row.nextStatus)
                .map(row => row.nextStatus as DriverBatchStatus)
        ));
        const requestedStatus = options?.targetStatus;
        const targetStatus: DriverBatchStatusSelection = mode === 'TRIP_CLOSE'
            ? 'DELIVERED'
            : requestedStatus && availableStatuses.includes(requestedStatus)
            ? requestedStatus
            : '';
        const defaultSelectedRefs = sjRows
            .filter(row => mode === 'TRIP_CLOSE'
                ? row.referenceNumber && row.itemCount > 0 && row.tripStatus === 'DELIVERED'
                : targetStatus && row.referenceNumber && row.itemCount > 0 && row.tripStatus !== 'DELIVERED' && row.nextStatus === targetStatus)
            .map(row => row.documentId);
        const requestedSelectedRefs = options?.selectedSuratJalanRefs?.filter(ref => defaultSelectedRefs.includes(ref)) || [];
        const nextSelectedRefs = requestedSelectedRefs.length > 0 ? requestedSelectedRefs : defaultSelectedRefs;
        const selectedRowsForHold = sjRows.filter(row => nextSelectedRefs.includes(row.documentId));
        const holdContinuation = mode !== 'TRIP_CLOSE' && targetStatus === 'DELIVERED'
            ? buildDriverPartialHoldContinuationDrafts(order, baseCargoItems, selectedRowsForHold)
            : { actualCargoItems: baseCargoItems, itemRefs: [] as string[], sourceDropPoints: [] as DriverAssignedDeliveryOrder['actualDropPoints'] };
        const nextCargoItems = holdContinuation.actualCargoItems;
        const holdContinuationCargoItems = nextCargoItems.filter(item => holdContinuation.itemRefs.includes(item.deliveryOrderItemRef));
        const holdContinuationDefaultDrop = holdContinuation.itemRefs.length > 0
            ? buildDriverHoldContinuationDefaultDropDraft(order, holdContinuationCargoItems)
            : null;
        const nextDropPoints = holdContinuation.itemRefs.length > 0
            ? [holdContinuationDefaultDrop as ActualDropDraft]
            : buildDefaultActualDropDrafts(
                order,
                nextCargoItems,
                holdContinuation.sourceDropPoints && holdContinuation.sourceDropPoints.length > 0
                    ? holdContinuation.sourceDropPoints
                    : order.pendingDriverActualDropPoints
            );
        setCompletionOrderId(order._id);
        setCompletionMode(mode);
        setCompletionTargetStatus(targetStatus);
        setCompletionNote(order.pendingDriverStatusNote || '');
        const vehicleCurrentOdometer = Math.max(order.vehicleLastOdometer || 0, 0);
        setCompletionOdometerKm(Math.max(order.tripEndOdometerKm || 0, vehicleCurrentOdometer));
        setCompletionInvoiceCustomerRef(order.customerRef || '');
        setCompletionInvoiceCustomerName(order.customerName || '');
        setCompletionPodReceiverName(order.receiverName || order.receiverCompany || '');
        setCompletionPodReceivedDate(getBusinessDateValue());
        setCompletionPodNote('');
        setSelectedCompletionSjRefs(nextSelectedRefs);
        setCompletionCargoItems(nextCargoItems);
        setCompletionPartialHoldItemRefs(holdContinuation.itemRefs);
        setCompletionDropPoints(nextDropPoints);
        setCompletionFrozenDropPoints([]);
        setCompletionDropItemValueMap(holdContinuationDefaultDrop
            ? buildDriverHoldContinuationDefaultAllocationMap(holdContinuationDefaultDrop, holdContinuationCargoItems)
            : {}
        );
        setShowCompletionAdvancedDropEditor(
            holdContinuation.itemRefs.length > 0
                ? false
                : shouldOpenAdvancedDropEditor(order, nextDropPoints)
        );
        setCompletionStep('SETUP');
        setActiveCompletionCargoItemRef('');
        setActiveCompletionDropKey('');
        setShowDeliveredRequestModal(true);
    }, []);

    const prepareCompletionDraftsForSelection = useCallback((
        order: DriverAssignedDeliveryOrder,
        targetStatus: DriverBatchStatusSelection,
        selectedRefs: string[]
    ) => {
        const baseCargoItems = buildActualCargoDrafts(order.driverCargoItems || [], order.pendingDriverActualCargoItems);
        if (targetStatus !== 'DELIVERED') {
            setCompletionCargoItems(baseCargoItems);
            setCompletionPartialHoldItemRefs([]);
            setCompletionDropPoints(buildDefaultActualDropDrafts(order, baseCargoItems, order.pendingDriverActualDropPoints));
            setCompletionDropItemValueMap({});
            setShowCompletionAdvancedDropEditor(false);
            return;
        }

        const sjRows = getDriverOrderSjRows(order);
        const selectedRows = sjRows.filter(row => selectedRefs.includes(row.documentId));
        const holdContinuation = buildDriverPartialHoldContinuationDrafts(order, baseCargoItems, selectedRows);
        const nextCargoItems = holdContinuation.actualCargoItems;
        const holdContinuationCargoItems = nextCargoItems.filter(item => holdContinuation.itemRefs.includes(item.deliveryOrderItemRef));
        const holdContinuationDefaultDrop = holdContinuation.itemRefs.length > 0
            ? buildDriverHoldContinuationDefaultDropDraft(order, holdContinuationCargoItems)
            : null;
        const nextDropPoints = holdContinuation.itemRefs.length > 0
            ? [holdContinuationDefaultDrop as ActualDropDraft]
            : buildDefaultActualDropDrafts(
                order,
                nextCargoItems,
                holdContinuation.sourceDropPoints && holdContinuation.sourceDropPoints.length > 0
                    ? holdContinuation.sourceDropPoints
                    : order.pendingDriverActualDropPoints
            );
        setCompletionCargoItems(nextCargoItems);
        setCompletionPartialHoldItemRefs(holdContinuation.itemRefs);
        setCompletionDropPoints(nextDropPoints);
        setCompletionDropItemValueMap(holdContinuationDefaultDrop
            ? buildDriverHoldContinuationDefaultAllocationMap(holdContinuationDefaultDrop, holdContinuationCargoItems)
            : {}
        );
        setShowCompletionAdvancedDropEditor(
            holdContinuation.itemRefs.length > 0
                ? false
                : shouldOpenAdvancedDropEditor(order, nextDropPoints)
        );
    }, []);

    const closeDeliveredRequestModal = useCallback(() => {
        if (actionLoadingId) {
            return;
        }
        setShowDeliveredRequestModal(false);
        setCompletionOrderId(null);
        setCompletionMode('BATCH_STATUS');
        setCompletionTargetStatus('');
        setCompletionNote('');
        setCompletionOdometerKm(0);
        setCompletionInvoiceCustomerRef('');
        setCompletionInvoiceCustomerName('');
        setCompletionPodReceiverName('');
        setCompletionPodReceivedDate('');
        setCompletionPodNote('');
        setSelectedCompletionSjRefs([]);
        setCompletionCargoItems([]);
        setCompletionPartialHoldItemRefs([]);
        setCompletionDropPoints([]);
        setCompletionFrozenDropPoints([]);
        setCompletionDropItemValueMap({});
        setShowCompletionAdvancedDropEditor(false);
        setCompletionStep('SETUP');
        setActiveCompletionCargoItemRef('');
        setActiveCompletionDropKey('');
    }, [actionLoadingId]);

    const openCargoInputModal = useCallback((
        order: DriverAssignedDeliveryOrder,
        mode: CargoInputMode = 'CARGO',
        targetReference?: { referenceKey?: string; referenceNumber?: string }
    ) => {
        setCargoInputOrderId(order._id);
        const initialGroups = buildInitialDeliveryOrderCargoDraftGroups({
            pickupStops: order.pickupStops,
            shipperReferences: (order.shipperReferences && order.shipperReferences.length > 0)
                ? order.shipperReferences
                : order.customerDoNumber
                    ? [{ referenceNumber: order.customerDoNumber, pickupStopKey: order.pickupStops?.[0]?._key }]
                    : undefined,
        });
        const targetReferenceKey = targetReference?.referenceKey || '';
        const targetReferenceNumber = (targetReference?.referenceNumber || '').trim().toUpperCase();
        const targetGroups = initialGroups.filter(group =>
            (targetReferenceKey && group.shipperReferenceKey === targetReferenceKey) ||
            (targetReferenceNumber && group.shipperReferenceNumber.trim().toUpperCase() === targetReferenceNumber)
        );
        const focusedEditGroups = targetGroups.map(group => {
            const existingItems = getDriverOrderItemsForSj(order, {
                referenceKey: group.shipperReferenceKey,
                referenceNumber: group.shipperReferenceNumber,
            });
            return {
                ...group,
                items: existingItems.length > 0
                    ? existingItems.map(toCargoDraftItemFromDriverOrderItem)
                    : [createDefaultDeliveryOrderCargoDraftItem()],
            };
        });
        setCargoInputMode(mode);
        setCargoInputEditingReferenceKey(targetReferenceKey);
        setCargoInputEditingReferenceNumber(targetReferenceNumber);
        setCargoInputGroups(
            mode === 'SJ_ADD'
                ? [createDefaultDeliveryOrderCargoDraftGroup(order.pickupStops?.[0]?._key || '')]
                : mode === 'SJ_EDIT' && (targetReferenceKey || targetReferenceNumber)
                    ? focusedEditGroups.length > 0
                        ? focusedEditGroups
                        : [createDefaultDeliveryOrderCargoDraftGroup(order.pickupStops?.[0]?._key || '')]
                    : initialGroups
        );
        setShowCargoInputModal(true);
    }, []);

    const closeCargoInputModal = useCallback(() => {
        if (actionLoadingId) {
            return;
        }
        setShowCargoInputModal(false);
        setCargoInputOrderId(null);
        setCargoInputMode('CARGO');
        setCargoInputEditingReferenceKey('');
        setCargoInputEditingReferenceNumber('');
        setCargoInputGroups([createDefaultDeliveryOrderCargoDraftGroup()]);
    }, [actionLoadingId]);

    const openTripCreateModal = useCallback((tripPlan: DriverAssignedTripPlan) => {
        setTripCreateTargetId(getDriverTripPlanId(tripPlan));
        setTripCreateGroups(buildInitialDeliveryOrderCargoDraftGroups({
            pickupStops: tripPlan.pickupStops,
        }));
        setShowTripCreateModal(true);
    }, []);

    const closeTripCreateModal = useCallback(() => {
        if (actionLoadingId) {
            return;
        }
        setShowTripCreateModal(false);
        setTripCreateTargetId(null);
        setTripCreateGroups([createDefaultDeliveryOrderCargoDraftGroup()]);
    }, [actionLoadingId]);

    const openIncidentModal = useCallback((order: DriverAssignedDeliveryOrder) => {
        setIncidentOrderId(order._id);
        setIncidentForm({
            incidentType: 'OTHER',
            urgency: 'MEDIUM',
            locationText: typeof order.trackingLastLat === 'number' && typeof order.trackingLastLng === 'number'
                ? `${order.trackingLastLat.toFixed(6)}, ${order.trackingLastLng.toFixed(6)}`
                : '',
            odometer: order.tripEndOdometerKm || 0,
            description: '',
        });
        setShowIncidentModal(true);
    }, []);

    const closeIncidentModal = useCallback(() => {
        if (actionLoadingId) {
            return;
        }
        setShowIncidentModal(false);
        setIncidentOrderId(null);
        setIncidentForm({
            incidentType: 'OTHER',
            urgency: 'MEDIUM',
            locationText: '',
            odometer: 0,
            description: '',
        });
    }, [actionLoadingId]);

    const openIncidentCompletionModal = useCallback((incident: DriverIncidentRecord) => {
        const relatedOrder = orders.find(order => order._id === incident.relatedDeliveryOrderRef);
        setIncidentCompletionIncidentId(incident._id);
        setIncidentCompletionForm({
            resolutionNote: '',
            resolutionLocationText: incident.locationText || '',
            resolutionOdometer: relatedOrder?.tripEndOdometerKm || incident.odometer || 0,
            costs: [],
        });
        setShowIncidentCompletionModal(true);
    }, [orders]);

    const closeIncidentCompletionModal = useCallback(() => {
        if (actionLoadingId) {
            return;
        }
        setShowIncidentCompletionModal(false);
        setIncidentCompletionIncidentId(null);
        setIncidentCompletionForm({
            resolutionNote: '',
            resolutionLocationText: '',
            resolutionOdometer: 0,
            costs: [],
        });
    }, [actionLoadingId]);

    const updateIncidentCompletionCost = useCallback((
        draftId: string,
        field: keyof Omit<DriverIncidentCostDraft, 'draftId'>,
        value: string | number | IncidentSettlementCategory
    ) => {
        setIncidentCompletionForm(previous => ({
            ...previous,
            costs: previous.costs.map(cost => (
                cost.draftId === draftId
                    ? { ...cost, [field]: value }
                    : cost
            )),
        }));
    }, []);

    const addIncidentCompletionCost = useCallback(() => {
        setIncidentCompletionForm(previous => ({
            ...previous,
            costs: [...previous.costs, createDriverIncidentCostDraft()],
        }));
    }, []);

    const removeIncidentCompletionCost = useCallback((draftId: string) => {
        setIncidentCompletionForm(previous => ({
            ...previous,
            costs: previous.costs.filter(cost => cost.draftId !== draftId),
        }));
    }, []);

    const updateCargoInputGroup = useCallback((
        groupId: string,
        field: keyof Pick<DeliveryOrderCargoDraftGroup, 'pickupStopKey' | 'shipperReferenceNumber'>,
        value: string
    ) => {
        setCargoInputGroups(previous => previous.map(group => (
            group.id === groupId
                ? { ...group, [field]: value }
                : group
        )));
    }, []);

    const updateCargoInputItem = useCallback((
        groupId: string,
        itemIndex: number,
        field: keyof DeliveryOrderCargoDraftItem,
        value: string | number
    ) => {
        setCargoInputGroups(previous => previous.map(group => (
            group.id === groupId
                ? {
                    ...group,
                    items: group.items.map((item, currentIndex) => (
                        currentIndex === itemIndex
                            ? (
                                field === 'qtyKoli'
                                    ? toDeliveryOrderCargoDraftItem(applyOrderItemAutoWeightFromQty({
                                        ...item,
                                        pickupStopKey: group.pickupStopKey,
                                        shipperReferenceNumber: group.shipperReferenceNumber,
                                    }, value))
                                    : field === 'weightInputValue' && shouldLockOrderItemWeight(item)
                                        ? item
                                        : { ...item, [field]: value }
                            )
                            : item
                    )),
                }
                : group
        )));
    }, []);

    const addCargoInputGroup = useCallback(() => {
        setCargoInputGroups(previous => [
            ...previous,
            createDefaultDeliveryOrderCargoDraftGroup(cargoInputOrder?.pickupStops?.[0]?._key || ''),
        ]);
    }, [cargoInputOrder]);

    const removeCargoInputGroup = useCallback((groupId: string) => {
        setCargoInputGroups(previous => {
            const nextGroups = previous.filter(group => group.id !== groupId);
            return nextGroups.length > 0
                ? nextGroups
                : [createDefaultDeliveryOrderCargoDraftGroup(cargoInputOrder?.pickupStops?.[0]?._key || '')];
        });
    }, [cargoInputOrder]);

    const addCargoInputItem = useCallback((groupId: string) => {
        setCargoInputGroups(previous => previous.map(group => (
            group.id === groupId
                ? { ...group, items: [...group.items, createDefaultDeliveryOrderCargoDraftItem()] }
                : group
        )));
    }, []);

    const removeCargoInputItem = useCallback((groupId: string, itemIndex: number) => {
        setCargoInputGroups(previous => previous.map(group => {
            if (group.id !== groupId) {
                return group;
            }
            const nextItems = group.items.filter((_, currentIndex) => currentIndex !== itemIndex);
            return {
                ...group,
                items: nextItems.length > 0 ? nextItems : [createDefaultDeliveryOrderCargoDraftItem()],
            };
        }));
    }, []);

    const applyCargoInputProductSelection = useCallback((groupId: string, itemIndex: number, nextProductRef: string) => {
        const selectedProduct = cargoInputCustomerProducts.find(product => product._id === nextProductRef);
        setCargoInputGroups(previous =>
            previous.map(group => (
                group.id === groupId
                    ? {
                        ...group,
                        items: group.items.map((item, index) => (
                            index === itemIndex
                                ? toDeliveryOrderCargoDraftItem(applyCustomerProductToOrderItem({
                                    ...item,
                                    pickupStopKey: group.pickupStopKey,
                                    shipperReferenceNumber: group.shipperReferenceNumber,
                                }, selectedProduct))
                                : item
                        )),
                    }
                    : group
            ))
        );
    }, [cargoInputCustomerProducts]);

    const updateTripCreateGroup = useCallback((
        groupId: string,
        field: keyof Pick<DeliveryOrderCargoDraftGroup, 'pickupStopKey' | 'shipperReferenceNumber'>,
        value: string
    ) => {
        setTripCreateGroups(previous => previous.map(group => (
            group.id === groupId
                ? { ...group, [field]: value }
                : group
        )));
    }, []);

    const updateTripCreateItem = useCallback((
        groupId: string,
        itemIndex: number,
        field: keyof DeliveryOrderCargoDraftItem,
        value: string | number
    ) => {
        setTripCreateGroups(previous => previous.map(group => (
            group.id === groupId
                ? {
                    ...group,
                    items: group.items.map((item, currentIndex) => (
                        currentIndex === itemIndex
                            ? (
                                field === 'qtyKoli'
                                    ? toDeliveryOrderCargoDraftItem(applyOrderItemAutoWeightFromQty({
                                        ...item,
                                        pickupStopKey: group.pickupStopKey,
                                        shipperReferenceNumber: group.shipperReferenceNumber,
                                    }, value))
                                    : field === 'weightInputValue' && shouldLockOrderItemWeight(item)
                                        ? item
                                        : { ...item, [field]: value }
                            )
                            : item
                    )),
                }
                : group
        )));
    }, []);

    const addTripCreateGroup = useCallback(() => {
        setTripCreateGroups(previous => [
            ...previous,
            createDefaultDeliveryOrderCargoDraftGroup(tripCreateTarget?.pickupStops?.[0]?._key || ''),
        ]);
    }, [tripCreateTarget]);

    const removeTripCreateGroup = useCallback((groupId: string) => {
        setTripCreateGroups(previous => {
            const nextGroups = previous.filter(group => group.id !== groupId);
            return nextGroups.length > 0
                ? nextGroups
                : [createDefaultDeliveryOrderCargoDraftGroup(tripCreateTarget?.pickupStops?.[0]?._key || '')];
        });
    }, [tripCreateTarget]);

    const addTripCreateItem = useCallback((groupId: string) => {
        setTripCreateGroups(previous => previous.map(group => (
            group.id === groupId
                ? { ...group, items: [...group.items, createDefaultDeliveryOrderCargoDraftItem()] }
                : group
        )));
    }, []);

    const removeTripCreateItem = useCallback((groupId: string, itemIndex: number) => {
        setTripCreateGroups(previous => previous.map(group => {
            if (group.id !== groupId) {
                return group;
            }
            const nextItems = group.items.filter((_, currentIndex) => currentIndex !== itemIndex);
            return {
                ...group,
                items: nextItems.length > 0 ? nextItems : [createDefaultDeliveryOrderCargoDraftItem()],
            };
        }));
    }, []);

    const applyTripCreateProductSelection = useCallback((groupId: string, itemIndex: number, nextProductRef: string) => {
        const selectedProduct = tripCreateCustomerProducts.find(product => product._id === nextProductRef);
        setTripCreateGroups(previous =>
            previous.map(group => (
                group.id === groupId
                    ? {
                        ...group,
                        items: group.items.map((item, index) => (
                            index === itemIndex
                                ? toDeliveryOrderCargoDraftItem(applyCustomerProductToOrderItem({
                                    ...item,
                                    pickupStopKey: group.pickupStopKey,
                                    shipperReferenceNumber: group.shipperReferenceNumber,
                                }, selectedProduct))
                                : item
                        )),
                    }
                    : group
            ))
        );
    }, [tripCreateCustomerProducts]);

    const updateCompletionCargoDraft = useCallback((
        deliveryOrderItemRef: string,
        field: keyof Pick<
            ActualCargoDraft,
            'actualQtyKoli' | 'actualWeightInputValue' | 'actualVolumeInputValue'
        >,
        value: string
    ) => {
        setCompletionCargoItems(previous =>
            previous.map(item =>
                item.deliveryOrderItemRef === deliveryOrderItemRef
                    ? field === 'actualQtyKoli'
                        ? applyActualCargoAutoWeightFromQty(item, value)
                        : { ...item, [field]: value }
                    : item
            )
        );
    }, []);

    const updateCompletionCargoWeightUnit = useCallback((
        deliveryOrderItemRef: string,
        nextUnit: ActualCargoDraft['actualWeightInputUnit']
    ) => {
        setCompletionCargoItems(previous =>
            previous.map(item =>
                item.deliveryOrderItemRef === deliveryOrderItemRef
                    ? updateActualCargoDraftWeightUnit(item, nextUnit)
                    : item
            )
        );
    }, []);

    const updateCompletionCargoVolumeUnit = useCallback((
        deliveryOrderItemRef: string,
        nextUnit: ActualCargoDraft['actualVolumeInputUnit']
    ) => {
        setCompletionCargoItems(previous =>
            previous.map(item =>
                item.deliveryOrderItemRef === deliveryOrderItemRef
                    ? updateActualCargoDraftVolumeUnit(item, nextUnit)
                    : item
            )
        );
    }, []);

    const updateCompletionDropDraft = useCallback((
        draftKey: string,
        field: keyof Pick<ActualDropDraft, 'stopType' | 'locationName' | 'locationAddress' | 'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit' | 'note'>,
        value: string
    ) => {
        setCompletionDropPoints(previous =>
            previous.map(item => {
                if (item.draftKey !== draftKey) {
                    return item;
                }
                if (field === 'weightInputUnit') {
                    return updateActualDropDraftWeightUnit(item, value as ActualDropDraft['weightInputUnit']);
                }
                return { ...item, [field]: value };
            })
        );
    }, []);

    const updateCompletionDropAllocationForItem = useCallback((
        drop: ActualDropDraft,
        cargoItem: ActualCargoDraft,
        field: keyof CompletionDropItemValueDraft,
        value: string
    ) => {
        const currentAllocation = getCompletionDropAllocationForItem(drop, cargoItem);
        const nextAllocation = field === 'qtyKoli'
            ? applyActualDropAutoWeightFromQty(currentAllocation, cargoItem, value)
            : field === 'weightInputUnit'
                ? updateActualDropDraftWeightUnit(currentAllocation, value as ActualDropDraft['weightInputUnit'])
                : { ...currentAllocation, [field]: value };
        const valueKey = buildCompletionDropItemValueKey(drop.draftKey, cargoItem.deliveryOrderItemRef);
        setCompletionDropItemValueMap(previous => ({
            ...previous,
            [valueKey]: pickCompletionDropItemValues(nextAllocation),
        }));
    }, [getCompletionDropAllocationForItem]);

    const updateCompletionActualCargoValue = useCallback((
        cargoItem: ActualCargoDraft,
        field: keyof Pick<ActualCargoDraft, 'actualQtyKoli' | 'actualWeightInputValue' | 'actualVolumeInputValue'>,
        value: string
    ) => {
        updateCompletionCargoDraft(cargoItem.deliveryOrderItemRef, field, value);
    }, [updateCompletionCargoDraft]);

    const updateCompletionActualCargoUnit = useCallback((
        cargoItem: ActualCargoDraft,
        field: 'actualWeightInputUnit' | 'actualVolumeInputUnit',
        value: string
    ) => {
        if (field === 'actualWeightInputUnit') {
            updateCompletionCargoWeightUnit(cargoItem.deliveryOrderItemRef, value as ActualCargoDraft['actualWeightInputUnit']);
            return;
        }
        updateCompletionCargoVolumeUnit(cargoItem.deliveryOrderItemRef, value as ActualCargoDraft['actualVolumeInputUnit']);
    }, [updateCompletionCargoVolumeUnit, updateCompletionCargoWeightUnit]);

    const returnToCompletionDropSetup = useCallback(() => {
        if (completionFrozenDropPoints.length > 0) {
            const frozenTotalsByItemRef = completionFrozenDropPoints.reduce<Record<string, { qtyKoli: number; weightKg: number; volumeM3: number }>>((map, point) => {
                if (!point.deliveryOrderItemRef) {
                    return map;
                }
                const current = map[point.deliveryOrderItemRef] || { qtyKoli: 0, weightKg: 0, volumeM3: 0 };
                map[point.deliveryOrderItemRef] = {
                    qtyKoli: current.qtyKoli + parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }),
                    weightKg: current.weightKg + convertWeightToKg(
                        parseFormattedNumberish(point.weightInputValue || 0, {
                            maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit),
                        }),
                        point.weightInputUnit
                    ),
                    volumeM3: current.volumeM3 + convertVolumeToM3(
                        parseFormattedNumberish(point.volumeInputValue || 0, {
                            maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
                        }),
                        point.volumeInputUnit
                    ),
                };
                return map;
            }, {});

            setCompletionCargoItems(previous => previous.map(item => {
                const frozenTotals = frozenTotalsByItemRef[item.deliveryOrderItemRef];
                if (!frozenTotals) {
                    return item;
                }
                return {
                    ...item,
                    actualQtyKoli: frozenTotals.qtyKoli > 0 ? String(frozenTotals.qtyKoli) : '',
                    actualWeightInputValue: frozenTotals.weightKg > 0
                        ? String(convertKgToWeightInputValue(frozenTotals.weightKg, item.actualWeightInputUnit))
                        : '',
                    actualVolumeInputValue: frozenTotals.volumeM3 > 0
                        ? String(convertM3ToVolumeInputValue(frozenTotals.volumeM3, item.actualVolumeInputUnit))
                        : '',
                };
            }));
        }
        setCompletionStep('SETUP');
        setCompletionFrozenDropPoints([]);
        setActiveCompletionCargoItemRef('');
    }, [completionFrozenDropPoints]);

    const resolveCompletionDropRecipientValue = useCallback((drop: Pick<ActualDropDraft, 'locationName' | 'locationAddress'>) => {
        const dropLocationName = drop.locationName.trim().toLowerCase();
        const dropLocationAddress = drop.locationAddress.trim().toLowerCase();
        if (!dropLocationName && !dropLocationAddress) {
            return '';
        }
        const matchedRecipient = completionCustomerRecipients.find(recipient => {
            const recipientName = getCustomerRecipientDropName(recipient).toLowerCase();
            const recipientAddress = (recipient.receiverAddress || '').trim().toLowerCase();
            return (
                (dropLocationAddress && recipientAddress === dropLocationAddress) ||
                (dropLocationName && recipientName === dropLocationName)
            );
        });
        return matchedRecipient?._id || '';
    }, [completionCustomerRecipients]);

    const applyCompletionDropRecipient = useCallback((draftKey: string, recipientId: string) => {
        const selectedRecipient = completionCustomerRecipients.find(recipient => recipient._id === recipientId);
        setCompletionDropPoints(previous => previous.map(item => {
            if (item.draftKey !== draftKey) {
                return item;
            }
            if (!selectedRecipient) {
                return item;
            }
            return {
                ...item,
                locationName: getCustomerRecipientDropName(selectedRecipient),
                locationAddress: selectedRecipient.receiverAddress || '',
            };
        }));
    }, [completionCustomerRecipients]);

    const addCompletionDropDraft = useCallback(() => {
        const firstDrop = completionDropPoints[0];
        if (firstDrop && selectedCompletionCargoItems.length > 0) {
            setCompletionDropItemValueMap(previous => {
                const firstDropAlreadyAllocated = selectedCompletionCargoItems.some(cargoItem => {
                    const valueKey = buildCompletionDropItemValueKey(firstDrop.draftKey, cargoItem.deliveryOrderItemRef);
                    if (Object.prototype.hasOwnProperty.call(previous, valueKey)) {
                        return hasCompletionDropItemValues(previous[valueKey]);
                    }
                    return (
                        firstDrop.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef &&
                        hasCompletionDropItemValues(pickCompletionDropItemValues(firstDrop))
                    );
                });
                if (firstDropAlreadyAllocated) {
                    return previous;
                }
                return selectedCompletionCargoItems.reduce<Record<string, CompletionDropItemValueDraft>>((next, cargoItem) => {
                    next[buildCompletionDropItemValueKey(firstDrop.draftKey, cargoItem.deliveryOrderItemRef)] = {
                        qtyKoli: cargoItem.actualQtyKoli,
                        weightInputValue: cargoItem.actualWeightInputValue,
                        weightInputUnit: cargoItem.actualWeightInputUnit,
                        volumeInputValue: cargoItem.actualVolumeInputValue,
                        volumeInputUnit: cargoItem.actualVolumeInputUnit,
                    };
                    return next;
                }, { ...previous });
            });
        }
        setCompletionDropPoints(previous => [...sortCompletionDropDraftsBySequence(previous), createEmptyActualDropDraft()]);
    }, [completionDropPoints, selectedCompletionCargoItems]);

    const removeCompletionDropDraft = useCallback((draftKey: string) => {
        setCompletionDropPoints(previous => previous.filter(item => item.draftKey !== draftKey));
        setCompletionDropItemValueMap(previous => {
            const next = { ...previous };
            Object.keys(next)
                .filter(key => key.startsWith(`${draftKey}${COMPLETION_DROP_ITEM_VALUE_SEPARATOR}`))
                .forEach(key => {
                    delete next[key];
                });
            return next;
        });
    }, []);

    const submitDeliveredRequest = useCallback(async () => {
        if (!completionOrder) {
            return;
        }

        setActionLoadingId(completionOrder._id);
        try {
            if (selectedCompletionSjRefs.length === 0) {
                setFeedback({ type: 'error', message: 'Pilih minimal 1 SJ yang akan diupdate.' });
                setActionLoadingId(null);
                return;
            }
            if (completionMode === 'TRIP_CLOSE') {
                if (completionOrder.status !== 'DELIVERED') {
                    setFeedback({ type: 'error', message: 'Tutup trip hanya bisa diajukan setelah status trip sudah Terkirim.' });
                    setActionLoadingId(null);
                    return;
                }
                const tripSjRows = getDriverOrderSjRows(completionOrder);
                if (!areAllDriverTripSuratJalanDelivered(tripSjRows)) {
                    setFeedback({ type: 'error', message: 'Semua SJ harus sudah Terkirim sebelum driver mengajukan tutup trip.' });
                    setActionLoadingId(null);
                    return;
                }
                if (completionOdometerKm <= 0) {
                    setFeedback({ type: 'error', message: 'Odometer akhir trip wajib diisi sebelum tutup trip.' });
                    setActionLoadingId(null);
                    return;
                }
                if (completionOdometerKm < completionVehicleCurrentOdometer) {
                    setFeedback({
                        type: 'error',
                        message: `Odometer akhir trip tidak boleh lebih kecil dari odometer kendaraan saat ini (${completionVehicleCurrentOdometer.toLocaleString('id-ID')} km).`,
                    });
                    setActionLoadingId(null);
                    return;
                }
                await postDeliveryProgress(completionOrder._id, 'DELIVERED', {
                    note: completionNote,
                    tripEndOdometerKm: completionOdometerKm,
                    selectedSuratJalanRefs: selectedCompletionSjRefs,
                    closeTripOnly: true,
                });
                setFeedback({ type: 'success', message: 'Permintaan tutup trip dikirim. Menunggu approval admin.' });
                await loadOrders();
                setShowDeliveredRequestModal(false);
                setCompletionOrderId(null);
                setCompletionMode('BATCH_STATUS');
                setCompletionTargetStatus('');
                setCompletionNote('');
                setCompletionOdometerKm(0);
                setCompletionInvoiceCustomerRef('');
                setCompletionInvoiceCustomerName('');
                setCompletionPodReceiverName('');
                setCompletionPodReceivedDate('');
                setCompletionPodNote('');
                setSelectedCompletionSjRefs([]);
                setCompletionCargoItems([]);
                setCompletionPartialHoldItemRefs([]);
                setCompletionDropPoints([]);
                setCompletionFrozenDropPoints([]);
                setCompletionDropItemValueMap({});
                setShowCompletionAdvancedDropEditor(false);
                setCompletionStep('SETUP');
                setActiveCompletionCargoItemRef('');
                setActiveCompletionDropKey('');
                return;
            }
            if (!completionTargetStatus) {
                setFeedback({ type: 'error', message: 'Pilih status tujuan batch SJ terlebih dahulu.' });
                setActionLoadingId(null);
                return;
            }
            if (completionTargetStatus !== 'DELIVERED') {
                const response = await fetch('/api/driver/delivery-orders/batch-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: completionOrder._id,
                        status: completionTargetStatus,
                        note: completionNote,
                        targetSuratJalanRefs: selectedCompletionSjRefs,
                    }),
                });
                const payload = await response.json().catch(() => null);
                if (!response.ok) {
                    throw createDriverPortalError(response.status, payload?.error || 'Gagal update batch SJ');
                }
                setFeedback({ type: 'success', message: `Batch SJ berhasil dipindahkan ke ${DO_STATUS_MAP[completionTargetStatus]?.label || completionTargetStatus}.` });
                await loadOrders();
                setShowDeliveredRequestModal(false);
                setCompletionOrderId(null);
                setCompletionMode('BATCH_STATUS');
                setCompletionTargetStatus('');
                setCompletionNote('');
                setCompletionOdometerKm(0);
                setCompletionInvoiceCustomerRef('');
                setCompletionInvoiceCustomerName('');
                setCompletionPodReceiverName('');
                setCompletionPodReceivedDate('');
                setCompletionPodNote('');
                setSelectedCompletionSjRefs([]);
                setCompletionCargoItems([]);
                setCompletionPartialHoldItemRefs([]);
                setCompletionDropPoints([]);
                setCompletionFrozenDropPoints([]);
                setCompletionDropItemValueMap({});
                setShowCompletionAdvancedDropEditor(false);
                setCompletionStep('SETUP');
                setActiveCompletionCargoItemRef('');
                setActiveCompletionDropKey('');
                return;
            }
            if (!completionPodReceiverName.trim() || !completionPodReceivedDate) {
                setFeedback({ type: 'error', message: 'Nama penerima POD dan tanggal terima POD wajib diisi.' });
                setActionLoadingId(null);
                return;
            }
            const submissionDropPoints = showCompletionAdvancedDropEditor
                ? (completionFrozenDropPoints.length > 0 ? completionFrozenDropPoints : selectedCompletionWorkingDropPoints)
                : completionDetailState.effectiveActualDropPoints;
            await postDeliveryProgress(completionOrder._id, 'DELIVERED', {
                note: completionNote,
                selectedSuratJalanRefs: selectedCompletionSjRefs,
                podReceiverName: completionPodReceiverName,
                podReceivedDate: completionPodReceivedDate,
                podNote: completionPodNote,
                actualItems: selectedCompletionDerivedActualCargoItems.map(item => ({
                    deliveryOrderItemRef: item.deliveryOrderItemRef,
                    actualQtyKoli: parseFormattedNumberish(item.actualQtyKoli || 0),
                    actualWeightInputValue: parseFormattedNumberish(item.actualWeightInputValue || 0, {
                        maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
                    }),
                    actualWeightInputUnit: item.actualWeightInputUnit,
                    actualVolumeInputValue: parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                        maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                    }),
                    actualVolumeInputUnit: item.actualVolumeInputUnit,
                })),
                actualDropPoints: submissionDropPoints.map(item => ({
                    stopType: item.stopType,
                    deliveryOrderItemRef: item.deliveryOrderItemRef || undefined,
                    shipperReferenceKey: item.shipperReferenceKey || undefined,
                    shipperReferenceNumber: item.shipperReferenceNumber || undefined,
                    billingCustomerRef: completionInvoiceCustomerRef || undefined,
                    billingCustomerName: completionInvoiceCustomerName || undefined,
                    originLocationName: item.originLocationName || undefined,
                    originLocationAddress: item.originLocationAddress || undefined,
                    locationName: item.locationName,
                    locationAddress: item.locationAddress,
                    qtyKoli: item.qtyKoli.trim() ? parseFormattedNumberish(item.qtyKoli) : 0,
                    weightInputValue: item.weightInputValue.trim()
                        ? parseFormattedNumberish(item.weightInputValue, {
                            maxFractionDigits: getWeightInputFractionDigits(item.weightInputUnit),
                        })
                        : 0,
                    weightInputUnit: item.weightInputUnit,
                    volumeInputValue: item.volumeInputValue.trim()
                        ? parseFormattedNumberish(item.volumeInputValue, {
                            maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
                        })
                        : 0,
                    volumeInputUnit: item.volumeInputUnit,
                    note: item.note.trim() || undefined,
                })),
            });
            setFeedback({ type: 'success', message: getDriverProgressSuccessMessage('DELIVERED') });
            await loadOrders();
            setShowDeliveredRequestModal(false);
            setCompletionOrderId(null);
            setCompletionMode('BATCH_STATUS');
            setCompletionTargetStatus('');
            setCompletionNote('');
            setCompletionOdometerKm(0);
            setCompletionInvoiceCustomerRef('');
            setCompletionInvoiceCustomerName('');
            setCompletionPodReceiverName('');
            setCompletionPodReceivedDate('');
            setCompletionPodNote('');
            setSelectedCompletionSjRefs([]);
            setCompletionCargoItems([]);
            setCompletionPartialHoldItemRefs([]);
            setCompletionDropPoints([]);
            setCompletionFrozenDropPoints([]);
            setCompletionDropItemValueMap({});
            setShowCompletionAdvancedDropEditor(false);
            setCompletionStep('SETUP');
            setActiveCompletionCargoItemRef('');
            setActiveCompletionDropKey('');
        } catch (error) {
            if (isDriverUnauthorizedError(error)) {
                handleDriverAuthFailure(error instanceof Error ? error.message : undefined);
                return;
            }
            setFeedback({
                type: 'error',
                message: error instanceof Error ? error.message : 'Gagal mengirim permintaan selesai',
            });
        } finally {
            setActionLoadingId(null);
        }
    }, [
        completionDetailState.effectiveActualDropPoints,
        completionInvoiceCustomerRef,
        completionInvoiceCustomerName,
        completionMode,
        completionNote,
        completionOdometerKm,
        completionOrder,
        completionPodNote,
        completionPodReceivedDate,
        completionPodReceiverName,
        completionTargetStatus,
        completionFrozenDropPoints,
        completionVehicleCurrentOdometer,
        handleDriverAuthFailure,
        loadOrders,
        postDeliveryProgress,
        selectedCompletionDerivedActualCargoItems,
        selectedCompletionSjRefs,
        selectedCompletionWorkingDropPoints,
        showCompletionAdvancedDropEditor,
    ]);

    const continueToCompletionActualCargo = useCallback(() => {
        if (!completionTargetStatus) {
            setFeedback({ type: 'error', message: 'Pilih status tujuan batch SJ terlebih dahulu.' });
            return;
        }
        if (selectedCompletionSjRefs.length === 0) {
            setFeedback({ type: 'error', message: 'Pilih minimal 1 SJ yang akan diupdate.' });
            return;
        }
        if (completionTargetStatus !== 'DELIVERED') {
            void submitDeliveredRequest();
            return;
        }
        if (!completionPodReceiverName.trim() || !completionPodReceivedDate) {
            setFeedback({ type: 'error', message: 'Nama penerima POD dan tanggal terima POD wajib diisi.' });
            return;
        }
        if (selectedCompletionCargoItems.length === 0) {
            setFeedback({ type: 'error', message: 'Pilih minimal 1 SJ yang punya item muatan sebelum update batch.' });
            return;
        }
        if (!completionDetailState.actualDropReady) {
            setFeedback({
                type: 'error',
                message: completionDetailState.actualDropMismatchMessage ||
                    completionDetailState.actualDropAmbiguityMessage ||
                    'Realisasi titik drop belum valid.',
            });
            return;
        }
        setCompletionFrozenDropPoints(selectedCompletionWorkingDropPoints);
        const nextActualCargoItems = showCompletionAdvancedDropEditor
            ? selectedCompletionBillableCargoItems
            : selectedCompletionCargoItems;
        setCompletionCargoItems(previous => previous.map(item => {
            const nextItem = nextActualCargoItems.find(candidate => candidate.deliveryOrderItemRef === item.deliveryOrderItemRef);
            return nextItem || item;
        }));
        const firstActualItem = nextActualCargoItems.find(hasActualCargoDraftValues);
        setActiveCompletionCargoItemRef(firstActualItem?.deliveryOrderItemRef || '');
        setCompletionStep('ACTUAL');
        setActiveCompletionDropKey('');
    }, [
        completionDetailState.actualDropAmbiguityMessage,
        completionDetailState.actualDropMismatchMessage,
        completionDetailState.actualDropReady,
        completionPodReceivedDate,
        completionPodReceiverName,
        completionTargetStatus,
        selectedCompletionBillableCargoItems,
        selectedCompletionCargoItems,
        selectedCompletionSjRefs.length,
        selectedCompletionWorkingDropPoints,
        showCompletionAdvancedDropEditor,
        submitDeliveredRequest,
    ]);

    const submitCargoInput = useCallback(async () => {
        if (!cargoInputOrder) {
            return;
        }
        if (cargoInputDraftGroups.length === 0) {
            setFeedback({ type: 'error', message: 'Isi minimal 1 SJ pengirim atau 1 barang sebelum disimpan.' });
            return;
        }
        const normalizedGroups = cargoInputDraftGroups.map(group => ({
            ...group,
            resolvedPickupStopKey: group.pickupStopKey || ((cargoInputOrder.pickupStops?.length || 0) === 1 ? cargoInputOrder.pickupStops?.[0]?._key || '' : ''),
            resolvedShipperReferenceNumber: group.shipperReferenceNumber.trim().toUpperCase(),
        }));
        const invalidReferenceGroup = normalizedGroups.findIndex(group => !group.resolvedShipperReferenceNumber);
        if (invalidReferenceGroup >= 0) {
            setFeedback({ type: 'error', message: `No. SJ pengirim wajib diisi pada SJ ${invalidReferenceGroup + 1}.` });
            return;
        }
        if ((cargoInputOrder.pickupStops?.length || 0) > 1) {
            const invalidPickupGroup = normalizedGroups.findIndex(group => !group.resolvedPickupStopKey);
            if (invalidPickupGroup >= 0) {
                setFeedback({ type: 'error', message: `Titik pickup wajib dipilih pada SJ ${invalidPickupGroup + 1}.` });
                return;
            }
        }
        if (cargoInputMode === 'SJ_ADD') {
            const emptyItemGroup = normalizedGroups.findIndex(group => group.draftItems.length === 0);
            if (emptyItemGroup >= 0) {
                setFeedback({ type: 'error', message: `Minimal 1 barang wajib diisi pada SJ ${emptyItemGroup + 1}.` });
                return;
            }
        }

        setActionLoadingId(cargoInputOrder._id);
        try {
            const normalizedShipperReferences = normalizedGroups.map(group => ({
                _key: group.shipperReferenceKey || undefined,
                referenceNumber: group.resolvedShipperReferenceNumber,
                pickupStopKey: group.resolvedPickupStopKey || undefined,
            }));
            const existingShipperReferencesForSubmit = cargoInputMode === 'SJ_EDIT' || cargoInputMode === 'SJ_ADD'
                ? (cargoInputOrder.shipperReferences || []).filter(reference => {
                    const referenceKey = reference._key || '';
                    const referenceNumber = (reference.referenceNumber || '').trim().toUpperCase();
                    if (cargoInputMode === 'SJ_EDIT') {
                        return !(
                            (cargoInputEditingReferenceKey && referenceKey === cargoInputEditingReferenceKey) ||
                            (cargoInputEditingReferenceNumber && referenceNumber === cargoInputEditingReferenceNumber)
                        );
                    }
                    return !normalizedShipperReferences.some(nextReference =>
                        (nextReference._key && referenceKey === nextReference._key) ||
                        (nextReference.referenceNumber && referenceNumber === nextReference.referenceNumber)
                    );
                })
                : [];
            const shipperReferencesForSubmit = cargoInputMode === 'SJ_EDIT' || cargoInputMode === 'SJ_ADD'
                ? [
                    ...existingShipperReferencesForSubmit,
                    ...normalizedShipperReferences,
                ]
                : normalizedShipperReferences;
            const response = await fetch(
                cargoInputMode === 'SJ_EDIT'
                    ? '/api/driver/delivery-orders/shipper-references'
                    : '/api/driver/delivery-orders/cargo',
                {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: cargoInputOrder._id,
                    shipperReferences: shipperReferencesForSubmit,
                    ...(cargoInputMode !== 'SJ_EDIT'
                        ? {
                            cargoItems: normalizedGroups.flatMap(group =>
                                group.draftItems.map(item => ({
                                    customerProductRef: item.customerProductRef || undefined,
                                    description: item.description,
                                    qtyKoli: item.qtyKoli,
                                    weightInputValue: item.weightInputValue,
                                    weightInputUnit: item.weightInputUnit,
                                    volumeInputValue: item.volumeInputValue,
                                    volumeInputUnit: item.volumeInputUnit,
                                    shipperReferenceNumber: group.resolvedShipperReferenceNumber,
                                    pickupStopKey: group.resolvedPickupStopKey || undefined,
                                }))
                            ),
                        }
                        : {}),
                }),
                }
            );
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw createDriverPortalError(
                    response.status,
                    payload?.error || (cargoInputMode === 'SJ_EDIT' ? 'Gagal menyimpan SJ' : 'Gagal menambah barang ke surat jalan')
                );
            }

            let changedItemCount = 0;
            if (cargoInputMode === 'SJ_EDIT' && cargoInputAllowsDirectCargoInput) {
                for (const group of normalizedGroups) {
                    for (const item of group.draftItems) {
                        if (item.deliveryOrderItemId) {
                            const itemResponse = await fetch('/api/driver/delivery-orders/cargo-item', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    id: cargoInputOrder._id,
                                    deliveryOrderItemId: item.deliveryOrderItemId,
                                    cargoItem: {
                                        customerProductRef: item.customerProductRef || undefined,
                                        description: item.description,
                                        qtyKoli: item.qtyKoli,
                                        weightInputValue: item.weightInputValue,
                                        weightInputUnit: item.weightInputUnit,
                                        volumeInputValue: item.volumeInputValue,
                                        volumeInputUnit: item.volumeInputUnit,
                                        shipperReferenceNumber: group.resolvedShipperReferenceNumber,
                                        pickupStopKey: group.resolvedPickupStopKey || undefined,
                                    },
                                }),
                            });
                            const itemPayload = await itemResponse.json().catch(() => null);
                            if (!itemResponse.ok) {
                                throw createDriverPortalError(itemResponse.status, itemPayload?.error || 'Gagal mengubah barang SJ');
                            }
                            changedItemCount += 1;
                        } else {
                            const itemResponse = await fetch('/api/driver/delivery-orders/cargo', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    id: cargoInputOrder._id,
                                    shipperReferences: shipperReferencesForSubmit,
                                    cargoItems: [{
                                        customerProductRef: item.customerProductRef || undefined,
                                        description: item.description,
                                        qtyKoli: item.qtyKoli,
                                        weightInputValue: item.weightInputValue,
                                        weightInputUnit: item.weightInputUnit,
                                        volumeInputValue: item.volumeInputValue,
                                        volumeInputUnit: item.volumeInputUnit,
                                        shipperReferenceNumber: group.resolvedShipperReferenceNumber,
                                        pickupStopKey: group.resolvedPickupStopKey || undefined,
                                    }],
                                }),
                            });
                            const itemPayload = await itemResponse.json().catch(() => null);
                            if (!itemResponse.ok) {
                                throw createDriverPortalError(itemResponse.status, itemPayload?.error || 'Gagal menambah barang SJ');
                            }
                            changedItemCount += 1;
                        }
                    }
                }
            }

            setFeedback({
                type: 'success',
                message: cargoInputMode === 'SJ_EDIT'
                    ? `${normalizedGroups.length} SJ berhasil disimpan${changedItemCount > 0 ? ` dengan ${changedItemCount} barang` : ''}.`
                    : normalizedGroups.length > 0 && (payload?.data?.appendedCount || 0) === 0
                        ? `${payload?.data?.shipperReferenceCount || normalizedGroups.length} SJ disimpan. Barang bisa ditambah menyusul.`
                        : `${payload?.data?.appendedCount || cargoInputDraftItems.length} barang ditambahkan ke surat jalan.`,
            });
            setShowCargoInputModal(false);
            setCargoInputOrderId(null);
            setCargoInputMode('CARGO');
            setCargoInputEditingReferenceKey('');
            setCargoInputEditingReferenceNumber('');
            setCargoInputGroups([createDefaultDeliveryOrderCargoDraftGroup()]);
            await loadOrders();
        } catch (error) {
            if (isDriverUnauthorizedError(error)) {
                handleDriverAuthFailure(error instanceof Error ? error.message : undefined);
                return;
            }
            setFeedback({
                type: 'error',
                message: error instanceof Error ? error.message : (cargoInputMode === 'SJ_EDIT' ? 'Gagal menyimpan SJ' : 'Gagal menambah barang ke surat jalan'),
            });
        } finally {
            setActionLoadingId(null);
        }
    }, [cargoInputAllowsDirectCargoInput, cargoInputDraftGroups, cargoInputDraftItems, cargoInputEditingReferenceKey, cargoInputEditingReferenceNumber, cargoInputMode, cargoInputOrder, handleDriverAuthFailure, loadOrders]);

    const submitTripCreate = useCallback(async () => {
        if (!tripCreateTarget) {
            return;
        }
        if (tripCreateDraftGroups.length === 0) {
            setFeedback({ type: 'error', message: 'Isi minimal 1 SJ pengirim atau 1 barang sebelum disimpan.' });
            return;
        }
        const normalizedGroups = tripCreateDraftGroups.map(group => ({
            ...group,
            resolvedPickupStopKey: group.pickupStopKey || ((tripCreateTarget.pickupStops?.length || 0) === 1 ? tripCreateTarget.pickupStops?.[0]?._key || '' : ''),
            resolvedShipperReferenceNumber: group.shipperReferenceNumber.trim().toUpperCase(),
        }));
        if ((tripCreateTarget.pickupStops?.length || 0) > 1) {
            const invalidPickupGroup = normalizedGroups.findIndex(group => !group.resolvedPickupStopKey);
            if (invalidPickupGroup >= 0) {
                setFeedback({ type: 'error', message: `Titik pickup wajib dipilih pada SJ ${invalidPickupGroup + 1}.` });
                return;
            }
        }
        const invalidReferenceGroup = normalizedGroups.findIndex(group => !group.resolvedShipperReferenceNumber);
        if (invalidReferenceGroup >= 0) {
            setFeedback({ type: 'error', message: `No. SJ pengirim wajib diisi pada SJ ${invalidReferenceGroup + 1}.` });
            return;
        }

        const actionId = getDriverTripPlanId(tripCreateTarget);
        setActionLoadingId(actionId);
        try {
            const response = await fetch('/api/driver/delivery-orders/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderRef: tripCreateTarget.orderRef,
                    orderTripPlanKey: tripCreateTarget.tripPlanKey,
                    shipperReferences: normalizedGroups.map(group => ({
                        referenceNumber: group.resolvedShipperReferenceNumber,
                        pickupStopKey: group.resolvedPickupStopKey || undefined,
                    })),
                    cargoItems: normalizedGroups.flatMap(group =>
                        group.draftItems.map(item => ({
                            customerProductRef: item.customerProductRef || undefined,
                            description: item.description,
                            qtyKoli: item.qtyKoli,
                            weightInputValue: item.weightInputValue,
                            weightInputUnit: item.weightInputUnit,
                            volumeInputValue: item.volumeInputValue,
                            volumeInputUnit: item.volumeInputUnit,
                            shipperReferenceNumber: group.resolvedShipperReferenceNumber,
                            pickupStopKey: group.resolvedPickupStopKey || undefined,
                        }))
                    ),
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw createDriverPortalError(response.status, payload?.error || 'Gagal membuat surat jalan dari trip driver');
            }

            setFeedback({
                type: 'success',
                message:
                    `${payload?.data?.doNumber || 'Surat jalan'} berhasil dibuat | ${normalizedGroups.length} SJ disimpan` +
                    `${tripCreateDraftItems.length === 0 ? ' | barang menyusul' : ''}.`,
            });
            setShowTripCreateModal(false);
            setTripCreateTargetId(null);
            setTripCreateGroups([createDefaultDeliveryOrderCargoDraftGroup()]);
            await loadOrders();
        } catch (error) {
            if (isDriverUnauthorizedError(error)) {
                handleDriverAuthFailure(error instanceof Error ? error.message : undefined);
                return;
            }
            setFeedback({
                type: 'error',
                message: error instanceof Error ? error.message : 'Gagal membuat surat jalan dari trip driver',
            });
        } finally {
            setActionLoadingId(null);
        }
    }, [handleDriverAuthFailure, loadOrders, tripCreateDraftGroups, tripCreateDraftItems, tripCreateTarget]);

    const submitIncidentReport = useCallback(async () => {
        if (!incidentOrder) {
            return;
        }
        if (!incidentForm.locationText.trim() || !incidentForm.description.trim()) {
            setFeedback({ type: 'error', message: 'Lokasi dan kronologi insiden wajib diisi.' });
            return;
        }
        if (incidentForm.odometer <= 0) {
            setFeedback({ type: 'error', message: 'Odometer insiden wajib diisi.' });
            return;
        }

        setActionLoadingId(`incident-${incidentOrder._id}`);
        try {
            const response = await fetch('/api/driver/incidents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    relatedDeliveryOrderRef: incidentOrder._id,
                    ...incidentForm,
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw createDriverPortalError(response.status, payload?.error || 'Gagal membuat laporan insiden');
            }

            setFeedback({ type: 'success', message: `Laporan insiden ${payload?.data?.incidentNumber || ''} berhasil dikirim.` });
            setShowIncidentModal(false);
            setIncidentOrderId(null);
            setIncidentForm({
                incidentType: 'OTHER',
                urgency: 'MEDIUM',
                locationText: '',
                odometer: 0,
                description: '',
            });
            await loadOrders();
        } catch (error) {
            if (isDriverUnauthorizedError(error)) {
                handleDriverAuthFailure(error instanceof Error ? error.message : undefined);
                return;
            }
            setFeedback({
                type: 'error',
                message: error instanceof Error ? error.message : 'Gagal membuat laporan insiden',
            });
        } finally {
            setActionLoadingId(null);
        }
    }, [handleDriverAuthFailure, incidentForm, incidentOrder, loadOrders]);

    const submitIncidentCompletionRequest = useCallback(async () => {
        if (!incidentCompletionIncident) {
            return;
        }
        if (!incidentCompletionForm.resolutionNote.trim()) {
            setFeedback({ type: 'error', message: 'Catatan penyelesaian insiden wajib diisi.' });
            return;
        }
        const invalidCostIndex = incidentCompletionForm.costs.findIndex(cost =>
            cost.amount <= 0 || !cost.description.trim()
        );
        if (invalidCostIndex >= 0) {
            setFeedback({ type: 'error', message: `Biaya insiden baris ${invalidCostIndex + 1} wajib berisi nominal dan deskripsi.` });
            return;
        }

        setActionLoadingId(`incident-complete-${incidentCompletionIncident._id}`);
        try {
            const response = await fetch('/api/driver/incidents', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'submit-resolution',
                    incidentRef: incidentCompletionIncident._id,
                    resolutionNote: incidentCompletionForm.resolutionNote,
                    resolutionLocationText: incidentCompletionForm.resolutionLocationText,
                    resolutionOdometer: incidentCompletionForm.resolutionOdometer,
                    costs: incidentCompletionForm.costs.map(cost => ({
                        category: cost.category,
                        amount: cost.amount,
                        description: cost.description,
                        payeeName: cost.payeeName,
                        note: cost.note,
                    })),
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw createDriverPortalError(response.status, payload?.error || 'Gagal mengajukan penyelesaian insiden');
            }

            setFeedback({ type: 'success', message: 'Penyelesaian insiden dikirim. Admin akan crosscheck biaya dan statusnya.' });
            setShowIncidentCompletionModal(false);
            setIncidentCompletionIncidentId(null);
            setIncidentCompletionForm({
                resolutionNote: '',
                resolutionLocationText: '',
                resolutionOdometer: 0,
                costs: [],
            });
            await loadOrders();
        } catch (error) {
            if (isDriverUnauthorizedError(error)) {
                handleDriverAuthFailure(error instanceof Error ? error.message : undefined);
                return;
            }
            setFeedback({
                type: 'error',
                message: error instanceof Error ? error.message : 'Gagal mengajukan penyelesaian insiden',
            });
        } finally {
            setActionLoadingId(null);
        }
    }, [handleDriverAuthFailure, incidentCompletionForm, incidentCompletionIncident, loadOrders]);

    const deleteShipperReference = useCallback(async (
        order: DriverAssignedDeliveryOrder,
        target: { referenceKey?: string; referenceNumber?: string }
    ) => {
        const referenceNumber = (target.referenceNumber || '').trim().toUpperCase();
        if (!referenceNumber) {
            return;
        }
        const confirmed = window.confirm(`Hapus SJ ${referenceNumber}? Barang yang terkait dengan SJ ini juga akan dihapus.`);
        if (!confirmed) {
            return;
        }

        setActionLoadingId(`${order._id}:delete-sj:${referenceNumber}`);
        try {
            const response = await fetch('/api/driver/delivery-orders/shipper-references', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: order._id,
                    shipperReferences: (order.shipperReferences || []).filter(reference => {
                        const referenceKey = reference._key || '';
                        const currentNumber = (reference.referenceNumber || '').trim().toUpperCase();
                        return !(
                            (target.referenceKey && referenceKey === target.referenceKey) ||
                            (referenceNumber && currentNumber === referenceNumber)
                        );
                    }),
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw createDriverPortalError(response.status, payload?.error || 'Gagal menghapus SJ');
            }
            setFeedback({ type: 'success', message: `SJ ${referenceNumber} berhasil dihapus.` });
            await loadOrders();
        } catch (error) {
            if (isDriverUnauthorizedError(error)) {
                handleDriverAuthFailure(error instanceof Error ? error.message : undefined);
                return;
            }
            setFeedback({
                type: 'error',
                message: error instanceof Error ? error.message : 'Gagal menghapus SJ',
            });
        } finally {
            setActionLoadingId(null);
        }
    }, [handleDriverAuthFailure, loadOrders]);

    if (loading) {
        return (
            <main className="driver-app-shell">
                <div className="driver-loading">
                    <Loader2 size={28} className="spinner" />
                    <p>Memuat aplikasi driver...</p>
                </div>
            </main>
        );
    }

    if (portalLoadError && (!user || !driver)) {
        return (
            <main className="driver-app-shell">
                <div className="driver-loading" style={{ gap: '0.9rem' }}>
                    <AlertCircle size={28} />
                    <p style={{ maxWidth: 420, textAlign: 'center' }}>{portalLoadError}</p>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <button className="btn btn-secondary" onClick={() => void loadDriverPortal()}>
                            <RefreshCw size={15} /> Coba Lagi
                        </button>
                        <button className="btn btn-primary" onClick={() => router.replace('/driver/login')}>
                            Kembali ke Login
                        </button>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="driver-app-shell">
            <section className="driver-topbar">
                <div>
                    <div className="driver-topbar-label">Portal Driver</div>
                    <h1>{companyName}</h1>
                    <p>{driver?.name || user?.name} | {driver?.phone || '-'}</p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={handleLogout} disabled={loggingOut}>
                    <LogOut size={15} /> {loggingOut ? 'Memproses...' : 'Keluar'}
                </button>
            </section>

            <section className="driver-hint-card">
                <div className="driver-hint-title">
                    <Smartphone size={18} />
                    Tracking live v1
                </div>
                <p>
                    Lokasi terkirim selama halaman ini tetap terbuka, internet aktif, dan GPS menyala.
                    Kalau browser ditutup total, tracking berhenti. Driver juga tidak bisa menutup tracking sendiri sebelum admin menyelesaikan DO.
                </p>
                {feedback && <div className={`driver-feedback ${feedback.type}`}>{feedback.message}</div>}
            </section>

            <section className="driver-section-tabs" aria-label="Menu driver">
                <button
                    type="button"
                    className={`driver-section-tab ${activeSection === 'TRIPS' ? 'active' : ''}`}
                    onClick={() => setActiveSection('TRIPS')}
                >
                    <Truck size={16} /> Cek Trip
                </button>
                <button
                    type="button"
                    className={`driver-section-tab ${activeSection === 'VOUCHERS' ? 'active' : ''}`}
                    onClick={() => setActiveSection('VOUCHERS')}
                >
                    <Wallet size={16} /> Uang Jalan Trip
                </button>
            </section>

            <section className="driver-toolbar">
                <div className="driver-toolbar-text">
                    {activeSection === 'VOUCHERS' ? (
                        <>Preview bon dan rincian uang jalan yang melekat ke trip kamu</>
                    ) : lockedTrackingDo ? (
                        <>DO terkunci di <strong>{lockedTrackingDo.doNumber}</strong></>
                    ) : (
                        <>Belum ada DO yang mengunci tracking</>
                    )}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => void loadOrders()} disabled={refreshing || isActionInFlight}>
                    <RefreshCw size={15} className={refreshing ? 'spin' : ''} /> Refresh
                </button>
            </section>

            {activeSection === 'TRIPS' ? (
            <>
            {plannedTrips.length > 0 && (
                <section className="driver-do-grid" style={{ marginBottom: '1rem' }}>
                    {plannedTrips.map(item => {
                        const tripId = getDriverTripPlanId(item);
                        const isBusy = actionLoadingId === tripId;
                        const tripAllowsDirectCargoInput = item.allowsDirectCargoInput !== false;
                        const hasLinkedDeliveryOrder = Boolean(item.linkedDeliveryOrderRef);
                        const linkedOrder = item.linkedDeliveryOrderRef
                            ? visibleOrders.find(order => order._id === item.linkedDeliveryOrderRef) || null
                            : null;
                        const linkedStatusMeta = linkedOrder ? getDeliveryOrderDisplayStatusMeta(linkedOrder) : null;
                        const pickupStops = item.pickupStops.length > 0
                            ? item.pickupStops
                            : item.pickupAddress
                                ? [{
                                    _key: 'fallback-pickup',
                                    sequence: 1,
                                    pickupLabel: '',
                                    pickupAddress: item.pickupAddress,
                                }]
                                : [];

                        return (
                            <div key={tripId} className="card driver-trip-panel">
                                <div className="card-header driver-trip-panel-header">
                                    <div>
                                        <div className="driver-trip-panel-kicker">Trip Driver</div>
                                        <div className="card-header-title">{item.linkedDeliveryOrderNumber || (hasLinkedDeliveryOrder ? 'Trip Aktif' : 'Siap Input Surat Jalan')}</div>
                                        <div className="text-muted text-sm">{item.masterResi || '-'} | {formatDate(item.date || '')} | Trip plan {item.tripSequence}</div>
                                    </div>
                                    <div className="driver-trip-status-stack">
                                        {linkedStatusMeta && (
                                            <span className={`badge badge-${linkedStatusMeta.color}`}>{linkedStatusMeta.label}</span>
                                        )}
                                        <span className={`badge badge-${hasLinkedDeliveryOrder ? 'success' : 'warning'}`}>
                                            {hasLinkedDeliveryOrder ? 'SJ Aktif' : 'Belum jadi SJ'}
                                        </span>
                                    </div>
                                </div>
                                <div className="card-body driver-trip-panel-body">
                                    <div className="detail-grid driver-trip-detail-grid">
                                        <div className="detail-item">
                                            <div className="detail-label">Trip</div>
                                            <div className="detail-value">{item.linkedDeliveryOrderNumber || `Trip plan ${item.tripSequence}`}</div>
                                        </div>
                                        <div className="detail-item">
                                            <div className="detail-label">Status</div>
                                            <div className="detail-value">{hasLinkedDeliveryOrder ? 'SJ Aktif' : 'Belum jadi SJ'}</div>
                                        </div>
                                        <div className="detail-item">
                                            <div className="detail-label">Kendaraan</div>
                                            <div className="detail-value">{item.vehiclePlate || '-'}</div>
                                        </div>
                                        <div className="detail-item">
                                            <div className="detail-label">Driver</div>
                                            <div className="detail-value">{linkedOrder?.driverName || item.driverName || driver?.name || '-'}</div>
                                        </div>
                                        <div className="detail-item">
                                            <div className="detail-label">Rute Trip</div>
                                            <div className="detail-value">{formatDriverTripRoute(item.tripOriginArea, item.tripDestinationArea)}</div>
                                        </div>
                                        <div className="detail-item">
                                            <div className="detail-label">Uang Jalan</div>
                                            <div className="detail-value">{formatCurrency(item.cashGiven || 0)}</div>
                                        </div>
                                        <div className="detail-item">
                                            <div className="detail-label">Borongan</div>
                                            <div className="detail-value">{formatCurrency(item.taripBorongan || 0)}</div>
                                        </div>
                                        <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                                            <div className="detail-label">Pickup</div>
                                            <div className="detail-value" style={{ display: 'grid', gap: '0.45rem' }}>
                                                {pickupStops.length > 0
                                                    ? pickupStops.map((pickupStop, pickupIndex) => (
                                                        <span key={pickupStop._key || `${pickupIndex}-${pickupStop.pickupAddress}`} style={{ display: 'grid', gap: '0.1rem' }}>
                                                            <span>{formatDriverPickupStopName(pickupStop)}</span>
                                                            {pickupStop.pickupAddress && pickupStop.pickupAddress !== formatDriverPickupStopName(pickupStop) && (
                                                                <span className="text-muted text-sm" style={{ fontWeight: 500 }}>
                                                                    {pickupStop.pickupAddress}
                                                                </span>
                                                            )}
                                                        </span>
                                                    ))
                                                    : '-'}
                                            </div>
                                        </div>
                                    </div>

                                    {!hasLinkedDeliveryOrder && (
                                        <div className="driver-trip-section driver-trip-actions">
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={() => openTripCreateModal(item)}
                                                disabled={isActionInFlight}
                                            >
                                                <Plus size={15} /> {isBusy ? 'Memproses...' : (tripAllowsDirectCargoInput ? 'Input Surat Jalan' : 'Input SJ')}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </section>
            )}

            <section className="driver-do-grid">
                {visibleOrders.length === 0 ? (
                    plannedTrips.length > 0 ? null : (
                    <div className="card">
                        <div className="card-body">
                            <div className="empty-state" style={{ padding: '1rem 0' }}>
                                <Truck size={40} className="empty-state-icon" />
                                <div className="empty-state-title">Belum ada surat jalan untuk akun driver ini</div>
                                <div className="empty-state-text">
                                    Hubungi admin jika seharusnya kamu sudah mendapat penugasan DO.
                                </div>
                            </div>
                        </div>
                    </div>
                    )
                ) : (
                    visibleOrders.map(item => {
                        const trackingBadge = formatTrackingState(item.trackingState);
                        const isBusy = actionLoadingId === item._id;
                        const canStart = canDriverStartTracking(item.status);
                        const sjRows = getDriverOrderSjRows(item);
                        const pendingRequests = getDriverPendingRequests(item);
                        const canManageCargo =
                            item.status !== 'DELIVERED' &&
                            item.status !== 'CANCELLED' &&
                            pendingRequests.length === 0 &&
                            !item.pendingDriverStatus;
                        const cargoItemCount = item.driverCargoItems?.length || 0;
                        const canShowBatchUpdate =
                            cargoItemCount > 0 &&
                            item.status !== 'CANCELLED' &&
                            !item.tripClosedByAdminAt;
                        const canRequestTripClose =
                            item.status === 'DELIVERED' &&
                            areAllDriverTripSuratJalanDelivered(sjRows) &&
                            pendingRequests.length === 0 &&
                            cargoItemCount > 0 &&
                            !item.tripClosedByAdminAt;
                        const relatedIncidents = driverIncidentsByOrder.get(item._id) || [];
                        const activeIncidentForReport = relatedIncidents.find(isDriverIncidentActiveForReport);
                        const activeIncidentBlocksReport = Boolean(activeIncidentForReport);
                        const activeIncidentLabel = activeIncidentForReport?.incidentNumber || 'insiden aktif';
                        const activeIncidentReportBlockMessage = activeIncidentForReport
                            ? isDriverIncidentWaitingResolutionReview(activeIncidentForReport)
                                ? `Lapor insiden baru tersedia setelah pengajuan ${activeIncidentLabel} direview admin.`
                                : activeIncidentForReport.status === 'RESOLVED'
                                    ? `Lapor insiden baru tersedia setelah ${activeIncidentLabel} ditutup admin.`
                                    : `Lapor insiden baru tersedia setelah ${activeIncidentLabel} diselesaikan admin.`
                            : '';
                        const mapsUrl =
                            typeof item.trackingLastLat === 'number' && typeof item.trackingLastLng === 'number'
                                ? `https://www.google.com/maps?q=${item.trackingLastLat},${item.trackingLastLng}`
                                : null;

                        const statusMeta = getDeliveryOrderDisplayStatusMeta(item);

                        return (
                            <div id={`driver-do-${item._id}`} key={item._id} className={`card driver-trip-panel ${item.trackingState === 'ACTIVE' ? 'live' : ''}`}>
                                <div className="card-header driver-trip-panel-header">
                                    <div>
                                        <div className="driver-trip-panel-kicker">Surat Jalan</div>
                                        <div className="card-header-title">{item.doNumber}</div>
                                    </div>
                                    <div className="driver-trip-status-stack">
                                        {canRequestTripClose && (
                                            <button
                                                className="btn btn-success btn-sm"
                                                onClick={() => openDeliveredRequestModal(item, { targetStatus: 'DELIVERED', mode: 'TRIP_CLOSE' })}
                                                disabled={isActionInFlight}
                                            >
                                                <Truck size={15} /> Tutup Trip ({Math.max(item.vehicleLastOdometer || 0, 0).toLocaleString('id-ID')} km)
                                            </button>
                                        )}
                                        <span className={`badge badge-${statusMeta.color}`}>{statusMeta.label}</span>
                                        <span className={`badge ${trackingBadge.color}`}>{trackingBadge.label}</span>
                                    </div>
                                </div>
                                <div className="card-body driver-trip-panel-body">
                                    <div className="detail-grid driver-trip-detail-grid">
                                        <div className="detail-item">
                                            <div className="detail-label">Muatan</div>
                                            <div className="detail-value">{cargoItemCount > 0 ? summarizeDriverOrderCargo(item) : 'Belum diisi'}</div>
                                        </div>
                                        <div className="detail-item">
                                            <div className="detail-label">Posisi Terakhir</div>
                                            <div className="detail-value">{item.trackingLastSeenAt ? formatDateTime(item.trackingLastSeenAt) : '-'}</div>
                                        </div>
                                        <div className="detail-item">
                                            <div className="detail-label">Koordinat</div>
                                            <div className="detail-value">
                                                {typeof item.trackingLastLat === 'number' && typeof item.trackingLastLng === 'number'
                                                    ? `${item.trackingLastLat.toFixed(6)}, ${item.trackingLastLng.toFixed(6)}`
                                                    : '-'}
                                            </div>
                                        </div>
                                    </div>

                                    {pendingRequests.length > 0 && (
                                        <div className="driver-pending-request">
                                            <div className="driver-pending-request-title">
                                                {pendingRequests.length} permintaan menunggu approval admin
                                            </div>
                                            {pendingRequests.map(request => {
                                                const requestSjNumbers = (request.targetSuratJalanRefs || [])
                                                    .map(ref => sjRows.find(row => row.documentId === ref)?.referenceNumber || ref.split(':').pop() || ref)
                                                    .filter(Boolean);
                                                return (
                                                    <div key={request.requestId} style={{ display: 'grid', gap: '0.2rem' }}>
                                                        <div>
                                                            Status diajukan: <span className={`badge badge-${DO_STATUS_MAP[request.status]?.color || 'warning'}`}>
                                                                {DO_STATUS_MAP[request.status]?.label || request.status}
                                                            </span>
                                                        </div>
                                                        {requestSjNumbers.length > 0 && (
                                                            <div className="text-muted text-sm">SJ: {requestSjNumbers.join(', ')}</div>
                                                        )}
                                                        {request.note && (
                                                            <div className="text-muted text-sm">Catatan: {request.note}</div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {relatedIncidents.length > 0 && (
                                        <div className="driver-pending-request" style={{ borderColor: 'rgba(245, 158, 11, 0.35)', background: '#fffbeb' }}>
                                            <div className="driver-pending-request-title">
                                                {activeIncidentBlocksReport ? 'Insiden Aktif' : 'Riwayat Insiden'}
                                            </div>
                                            {relatedIncidents.map(incident => {
                                                const pendingDraftCosts = (incident.settlementLines || []).filter(line => line.status === 'DRAFT').length;
                                                return (
                                                    <div key={incident._id} style={{ display: 'grid', gap: '0.45rem' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                            <div>
                                                                <strong>{incident.incidentNumber}</strong>
                                                                <span className="text-muted text-sm"> | {getDriverIncidentStatusLabel(incident.status)}</span>
                                                            </div>
                                                            {canDriverSubmitIncidentResolution(incident) && (
                                                                <button
                                                                    className="btn btn-secondary btn-sm"
                                                                    onClick={() => openIncidentCompletionModal(incident)}
                                                                    disabled={isActionInFlight}
                                                                >
                                                                    <Pencil size={15} /> Ajukan Selesai
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="text-muted text-sm">
                                                            {incident.locationText || '-'} | {incident.description || '-'}
                                                            {pendingDraftCosts > 0 ? ` | ${pendingDraftCosts} biaya draft menunggu admin` : ''}
                                                        </div>
                                                        {!canDriverSubmitIncidentResolution(incident) && hasDriverIncidentSubmittedResolution(incident) && (
                                                            <div className="text-muted text-sm">
                                                                {getDriverIncidentResolutionHint(incident)}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    <div className="driver-trip-section">
                                        <div className="driver-trip-section-header">
                                            <div>
                                                <div className="form-section-title" style={{ marginBottom: 0 }}>Surat Jalan</div>
                                                <div className="text-muted text-sm">{getShipperReferenceCount(item)} SJ | {cargoItemCount} barang</div>
                                            </div>
                                        </div>
                                        <div className="table-wrapper table-desktop-only driver-trip-sj-table">
                                            <table>
                                                <thead>
                                                    <tr>
                                                        <th>No. SJ</th>
                                                        <th>Status SJ</th>
                                                        <th>Pickup</th>
                                                        <th>Barang</th>
                                                        <th>Status Item</th>
                                                        <th>Aksi</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {sjRows.map(row => (
                                                        <tr key={row.key}>
                                                            <td className="font-semibold">{row.referenceNumber || 'Belum ada SJ'}</td>
                                                            <td>
                                                                <div style={{ display: 'grid', gap: '0.25rem' }}>
                                                                    <span className={`badge badge-${DO_STATUS_MAP[row.tripStatus]?.color || 'gray'}`}>{DO_STATUS_MAP[row.tripStatus]?.label || row.tripStatus}</span>
                                                                    {row.hasHoldCargo && (
                                                                        <span className="badge badge-warning">Ada Hold / Inap</span>
                                                                    )}
                                                                    {row.pendingRequest && (
                                                                        <span className="badge badge-warning">Menunggu Approval {DO_STATUS_MAP[row.pendingRequest.status]?.label || row.pendingRequest.status}</span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td>{row.pickupAddress || row.pickupStopKey || item.pickupAddress || '-'}</td>
                                                            <td>
                                                                <div style={{ display: 'grid', gap: '0.2rem' }}>
                                                                    {row.summaryItems.map(summaryItem => (
                                                                        <div key={summaryItem.label} className="text-sm">
                                                                            <span className="text-muted">{summaryItem.label}: </span>
                                                                            <span>{summaryItem.value}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </td>
                                                            <td>{row.itemCount} item | {row.finalizedCount} final</td>
                                                            <td>
                                                                {canManageCargo && row.referenceNumber ? (
                                                                    <div className="driver-sj-actions">
                                                                        {row.nextStatus && row.nextStatus !== 'DELIVERED' && row.itemCount > 0 && !row.pendingRequest && (
                                                                            <button
                                                                                className="table-action-btn"
                                                                                onClick={() => openDeliveredRequestModal(item, {
                                                                                    targetStatus: row.nextStatus || undefined,
                                                                                    selectedSuratJalanRefs: [row.documentId],
                                                                                })}
                                                                                disabled={isActionInFlight}
                                                                            >
                                                                                <Truck size={14} /> Update SJ
                                                                            </button>
                                                                        )}
                                                                        {row.nextStatus === 'DELIVERED' && row.itemCount > 0 && !row.pendingRequest && (
                                                                            <button
                                                                                className="table-action-btn"
                                                                                onClick={() => openDeliveredRequestModal(item, {
                                                                                    targetStatus: 'DELIVERED',
                                                                                    selectedSuratJalanRefs: [row.documentId],
                                                                                })}
                                                                                disabled={isActionInFlight}
                                                                            >
                                                                                <Truck size={14} /> Update SJ
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            className="table-action-btn"
                                                                            onClick={() => openCargoInputModal(item, 'SJ_EDIT', {
                                                                                referenceKey: row.referenceKey,
                                                                                referenceNumber: row.referenceNumber,
                                                                            })}
                                                                            disabled={isActionInFlight || row.pendingRequest?.status === 'DELIVERED'}
                                                                            title={row.pendingRequest?.status === 'DELIVERED' ? 'Finalisasi aktual SJ ini sedang menunggu approval admin.' : undefined}
                                                                        >
                                                                            <Pencil size={14} /> Edit SJ
                                                                        </button>
                                                                        {(item.shipperReferences?.length || 0) > 0 && (
                                                                            <button
                                                                                className="table-action-btn danger"
                                                                                onClick={() => void deleteShipperReference(item, {
                                                                                    referenceKey: row.referenceKey,
                                                                                    referenceNumber: row.referenceNumber,
                                                                                })}
                                                                                disabled={isActionInFlight || row.pendingRequest?.status === 'DELIVERED'}
                                                                                title={row.pendingRequest?.status === 'DELIVERED' ? 'Finalisasi aktual SJ ini sedang menunggu approval admin.' : undefined}
                                                                            >
                                                                                <Trash2 size={14} /> Hapus
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <span className="text-muted text-sm">-</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="mobile-card-list">
                                            {sjRows.map(row => (
                                                <div className="mobile-data-card" key={row.key}>
                                                    <div className="mobile-card-header">
                                                        <div className="mobile-card-title">{row.referenceNumber || 'Belum ada SJ'}</div>
                                                        <span className="badge badge-gray">{row.itemCount} item</span>
                                                    </div>
                                                    <div className="mobile-card-body">
                                                        <div><span className={`badge badge-${DO_STATUS_MAP[row.tripStatus]?.color || 'gray'}`}>{DO_STATUS_MAP[row.tripStatus]?.label || row.tripStatus}</span></div>
                                                        {row.hasHoldCargo && (
                                                            <div><span className="badge badge-warning">Ada Hold / Inap</span></div>
                                                        )}
                                                        {row.pendingRequest && (
                                                            <div><span className="badge badge-warning">Menunggu Approval {DO_STATUS_MAP[row.pendingRequest.status]?.label || row.pendingRequest.status}</span></div>
                                                        )}
                                                        <div>{row.pickupAddress || row.pickupStopKey || item.pickupAddress || '-'}</div>
                                                        <div style={{ display: 'grid', gap: '0.2rem' }}>
                                                            {row.summaryItems.map(summaryItem => (
                                                                <div key={summaryItem.label}>
                                                                    <span className="text-muted">{summaryItem.label}: </span>
                                                                    <span>{summaryItem.value}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <div>{row.finalizedCount} item final</div>
                                                    </div>
                                                    {canManageCargo && row.referenceNumber && (
                                                        <div className="driver-sj-actions">
                                                            {row.nextStatus && row.nextStatus !== 'DELIVERED' && row.itemCount > 0 && !row.pendingRequest && (
                                                                <button
                                                                    className="btn btn-primary btn-sm"
                                                                    onClick={() => openDeliveredRequestModal(item, {
                                                                        targetStatus: row.nextStatus || undefined,
                                                                        selectedSuratJalanRefs: [row.documentId],
                                                                    })}
                                                                    disabled={isActionInFlight}
                                                                >
                                                                    <Truck size={14} /> Update SJ
                                                                </button>
                                                            )}
                                                            {row.nextStatus === 'DELIVERED' && row.itemCount > 0 && !row.pendingRequest && (
                                                                <button
                                                                    className="btn btn-primary btn-sm"
                                                                    onClick={() => openDeliveredRequestModal(item, {
                                                                        targetStatus: 'DELIVERED',
                                                                        selectedSuratJalanRefs: [row.documentId],
                                                                    })}
                                                                    disabled={isActionInFlight}
                                                                >
                                                                    <Truck size={14} /> Update SJ
                                                                </button>
                                                            )}
                                                            <button
                                                                className="btn btn-secondary btn-sm"
                                                                onClick={() => openCargoInputModal(item, 'SJ_EDIT', {
                                                                    referenceKey: row.referenceKey,
                                                                    referenceNumber: row.referenceNumber,
                                                                })}
                                                                disabled={isActionInFlight || row.pendingRequest?.status === 'DELIVERED'}
                                                                title={row.pendingRequest?.status === 'DELIVERED' ? 'Finalisasi aktual SJ ini sedang menunggu approval admin.' : undefined}
                                                            >
                                                                <Pencil size={14} /> Edit SJ
                                                            </button>
                                                            {(item.shipperReferences?.length || 0) > 0 && (
                                                                <button
                                                                    className="btn btn-danger btn-sm"
                                                                    onClick={() => void deleteShipperReference(item, {
                                                                    referenceKey: row.referenceKey,
                                                                    referenceNumber: row.referenceNumber,
                                                                })}
                                                                    disabled={isActionInFlight || row.pendingRequest?.status === 'DELIVERED'}
                                                                    title={row.pendingRequest?.status === 'DELIVERED' ? 'Finalisasi aktual SJ ini sedang menunggu approval admin.' : undefined}
                                                                >
                                                                    <Trash2 size={14} /> Hapus
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="driver-trip-section driver-trip-actions">
                                        {item.trackingState === 'ACTIVE' ? (
                                            <>
                                                {pendingRequests.length > 0 ? (
                                                    <div className="text-muted text-sm" style={{ flex: 1, lineHeight: 1.5 }}>
                                                        SJ yang sudah diajukan menunggu keputusan admin. SJ lain tetap bisa diproses.
                                                    </div>
                                                ) : null}
                                                <div className="text-muted text-sm" style={{ flex: 1, lineHeight: 1.5 }}>
                                                    Tracking harus tetap aktif sampai admin menyelesaikan DO ini. Driver tidak bisa menjeda
                                                    atau menghentikannya sendiri.
                                                </div>
                                            </>
                                        ) : item.trackingState === 'PAUSED' ? (
                                            <>
                                                <button className="btn btn-primary btn-sm" onClick={() => startTracking(item._id, true)} disabled={isActionInFlight || !canStart}>
                                                    <PlayCircle size={15} /> {isBusy ? 'Memproses...' : 'Lanjut'}
                                                </button>
                                                <div className="text-muted text-sm" style={{ flex: 1, lineHeight: 1.5 }}>
                                                    Status jeda ini hanya untuk data lama. Tracking harus dipulihkan sampai admin menutup DO.
                                                </div>
                                            </>
                                        ) : (
                                            <button className="btn btn-primary btn-sm" onClick={() => startTracking(item._id)} disabled={isActionInFlight || !canStart || Boolean(lockedTrackingDo && lockedTrackingDo._id !== item._id)}>
                                                <PlayCircle size={15} /> {isBusy ? 'Memproses...' : 'Mulai Tracking'}
                                            </button>
                                        )}

                                        {canManageCargo && (
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => openCargoInputModal(item, 'SJ_ADD')}
                                                disabled={isActionInFlight || pendingRequests.length > 0 || Boolean(item.pendingDriverStatus)}
                                                title={pendingRequests.length > 0 || item.pendingDriverStatus ? 'Permintaan driver sedang menunggu approval admin.' : undefined}
                                            >
                                                <Plus size={15} /> Tambah SJ
                                            </button>
                                        )}

                                        {canShowBatchUpdate && (
                                            <button
                                                className="btn btn-success btn-sm"
                                                onClick={() => openDeliveredRequestModal(item)}
                                                disabled={isActionInFlight}
                                            >
                                                <Truck size={15} /> Update Batch SJ
                                            </button>
                                        )}

                                        {activeIncidentBlocksReport ? (
                                            <span className="text-muted text-sm" style={{ alignSelf: 'center' }}>
                                                {activeIncidentReportBlockMessage}
                                            </span>
                                        ) : (
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => openIncidentModal(item)}
                                                disabled={isActionInFlight || item.status === 'CANCELLED'}
                                            >
                                                <AlertTriangle size={15} /> Lapor Insiden
                                            </button>
                                        )}

                                        {mapsUrl && (
                                            <a className="btn btn-secondary btn-sm" href={mapsUrl} target="_blank" rel="noreferrer">
                                                <MapPin size={15} /> Maps
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </section>
            </>
            ) : (
                <section className="driver-do-grid">
                    {driverVouchers.length === 0 ? (
                        <div className="card">
                            <div className="card-body">
                                <div className="empty-state" style={{ padding: '1rem 0' }}>
                                    <Wallet size={40} className="empty-state-icon" />
                                    <div className="empty-state-title">Belum ada uang jalan trip</div>
                                    <div className="empty-state-text">
                                        Bon uang jalan akan muncul setelah admin menerbitkan bon untuk trip kamu.
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        driverVouchers.map(voucher => {
                            const items = voucher.items || [];
                            const disbursements = voucher.disbursements || [];
                            const summary = buildDriverVoucherDetailSummary(voucher, items);
                            const statusConfig = DRIVER_VOUCHER_STATUS_MAP[voucher.status] || { label: voucher.status || '-', cls: 'badge-gray' };
                            const statusColor = statusConfig.cls.replace('badge-', '') || 'gray';
                            const cashBreakdown = buildDriverVoucherCashBreakdown(disbursements, summary);
                            const settlementDisplay = buildDriverVoucherSettlementDisplay({
                                balance: summary.balance,
                                disbursements,
                                fallbackDisbursementCount: inferDriverVoucherDisbursementCount({
                                    ...voucher,
                                    topUpAmount: summary.topUpAmount,
                                }),
                            });

                            return (
                                <div key={voucher._id} className="card driver-trip-panel">
                                    <div className="card-header driver-trip-panel-header">
                                        <div>
                                            <div className="driver-trip-panel-kicker">Uang Jalan Trip</div>
                                            <div className="card-header-title">Ringkasan Uang Jalan</div>
                                            <div className="text-muted text-sm">{formatDate(voucher.issuedDate || '')}</div>
                                        </div>
                                        <div className="driver-trip-status-stack">
                                            <span className={`badge badge-${statusColor}`}>{statusConfig.label}</span>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => void handlePreviewDriverVoucher(voucher)}
                                            >
                                                <Printer size={15} /> Preview / PDF
                                            </button>
                                        </div>
                                    </div>
                                    <div className="card-body driver-trip-panel-body">
                                        <div className="detail-grid driver-trip-detail-grid">
                                            <div className="detail-item">
                                                <div className="detail-label">Total Uang Diberikan</div>
                                                <div className="detail-value">{formatCurrency(summary.totalIssuedAmount)}</div>
                                            </div>
                                            <div className="detail-item">
                                                <div className="detail-label">Biaya Lain-lain</div>
                                                <div className="detail-value">{formatCurrency(summary.operationalSpent)}</div>
                                            </div>
                                            <div className="detail-item">
                                                <div className="detail-label">Upah Borongan</div>
                                                <div className="detail-value">{formatCurrency(summary.driverFeeAmount)}</div>
                                            </div>
                                            <div className="detail-item">
                                                <div className="detail-label">{settlementDisplay.label}</div>
                                                <div className="detail-value">{formatCurrency(Math.abs(summary.balance))}</div>
                                                <div className="text-muted text-sm">{settlementDisplay.description}</div>
                                            </div>
                                            <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                                                <div className="detail-label">Rincian Bon</div>
                                                <div className="detail-value">{cashBreakdown}</div>
                                            </div>
                                        </div>

                                        <div className="driver-voucher-history">
                                            <div>
                                                <div className="form-section-title">Riwayat Uang Jalan</div>
                                                {disbursements.length === 0 ? (
                                                    <div className="text-muted text-sm">Belum ada rincian pencairan.</div>
                                                ) : (
                                                    <div className="driver-voucher-list">
                                                        {disbursements.map(disbursement => (
                                                            <div className="driver-voucher-row" key={disbursement._id}>
                                                                <div>
                                                                    <strong>{getDriverVoucherDisbursementLabel(disbursement, disbursements)}</strong>
                                                                    <div className="text-muted text-sm">{formatDate(disbursement.date || '')} | {disbursement.bankAccountName || '-'}</div>
                                                                    {disbursement.note && <div className="text-muted text-sm">{disbursement.note}</div>}
                                                                </div>
                                                                <strong>{formatCurrency(disbursement.amount || 0)}</strong>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <div className="form-section-title">Biaya Lain-lain Aktual</div>
                                                {items.length === 0 ? (
                                                    <div className="text-muted text-sm">Belum ada biaya lain-lain.</div>
                                                ) : (
                                                    <div className="driver-voucher-list">
                                                        {items.map(item => (
                                                            <div className="driver-voucher-row" key={item._id}>
                                                                <div>
                                                                    <strong>{item.category}</strong>
                                                                    <div className="text-muted text-sm">{formatDate(item.expenseDate || '')} | {item.description || '-'}</div>
                                                                </div>
                                                                <strong>{formatCurrency(item.amount || 0)}</strong>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </section>
            )}

            {showIncidentModal && incidentOrder && (
                <div className="modal-overlay" onClick={closeIncidentModal}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">Lapor Insiden {incidentOrder.doNumber}</h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>
                                    Laporan masuk ke modul Insiden Armada untuk ditindaklanjuti admin.
                                </div>
                            </div>
                            <button className="modal-close" onClick={closeIncidentModal} disabled={isActionInFlight}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="driver-completion-summary">
                                <div className="driver-completion-summary-card">
                                    <span>Trip/SJ</span>
                                    <strong>{incidentOrder.doNumber}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Kendaraan</span>
                                    <strong>{incidentOrder.vehiclePlate || '-'}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Rute</span>
                                    <strong>{formatDriverTripRoute(incidentOrder.tripOriginArea, incidentOrder.tripDestinationArea)}</strong>
                                </div>
                            </div>

                            <div className="form-row" style={{ marginTop: '1rem' }}>
                                <div className="form-group">
                                    <label className="form-label">Tipe Insiden</label>
                                    <select
                                        className="form-select"
                                        value={incidentForm.incidentType}
                                        onChange={event => setIncidentForm(previous => ({ ...previous, incidentType: event.target.value as Incident['incidentType'] }))}
                                        disabled={isActionInFlight}
                                    >
                                        <option value="BLOWOUT_TIRE">Ban Pecah</option>
                                        <option value="ENGINE_TROUBLE">Mesin Bermasalah</option>
                                        <option value="ACCIDENT_MINOR">Kecelakaan Ringan</option>
                                        <option value="ACCIDENT_MAJOR">Kecelakaan Berat</option>
                                        <option value="OTHER">Lainnya</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Urgensi</label>
                                    <select
                                        className="form-select"
                                        value={incidentForm.urgency}
                                        onChange={event => setIncidentForm(previous => ({ ...previous, urgency: event.target.value as Incident['urgency'] }))}
                                        disabled={isActionInFlight}
                                    >
                                        <option value="LOW">Rendah</option>
                                        <option value="MEDIUM">Sedang</option>
                                        <option value="HIGH">Tinggi</option>
                                    </select>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Lokasi Insiden <span className="required">*</span></label>
                                <input
                                    className="form-input"
                                    value={incidentForm.locationText}
                                    onChange={event => setIncidentForm(previous => ({ ...previous, locationText: event.target.value }))}
                                    disabled={isActionInFlight}
                                    placeholder="Koordinat, nama jalan, rest area, atau patokan lokasi"
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Odometer Saat Insiden <span className="required">*</span></label>
                                <FormattedNumberInput
                                    min={0}
                                    allowDecimal={false}
                                    value={incidentForm.odometer}
                                    onValueChange={value => setIncidentForm(previous => ({ ...previous, odometer: value }))}
                                    disabled={isActionInFlight}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Kronologi <span className="required">*</span></label>
                                <textarea
                                    className="form-textarea"
                                    rows={4}
                                    value={incidentForm.description}
                                    onChange={event => setIncidentForm(previous => ({ ...previous, description: event.target.value }))}
                                    disabled={isActionInFlight}
                                    placeholder="Jelaskan kejadian, kondisi kendaraan/barang, dan tindakan sementara."
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeIncidentModal} disabled={isActionInFlight}>
                                Batal
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => void submitIncidentReport()}
                                disabled={isActionInFlight || !incidentForm.locationText.trim() || !incidentForm.description.trim() || incidentForm.odometer <= 0}
                            >
                                <AlertTriangle size={15} /> {actionLoadingId === `incident-${incidentOrder._id}` ? 'Mengirim...' : 'Kirim Laporan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showIncidentCompletionModal && incidentCompletionIncident && (
                <div className="modal-overlay" onClick={closeIncidentCompletionModal}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">Ajukan Selesai Insiden {incidentCompletionIncident.incidentNumber}</h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>
                                    Biaya yang diisi supir masuk draft dan tetap dicek admin sebelum diposting.
                                </div>
                            </div>
                            <button className="modal-close" onClick={closeIncidentCompletionModal} disabled={isActionInFlight}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="driver-completion-summary">
                                <div className="driver-completion-summary-card">
                                    <span>Trip/SJ</span>
                                    <strong>{incidentCompletionOrder?.doNumber || incidentCompletionIncident.relatedDONumber || '-'}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Kendaraan</span>
                                    <strong>{incidentCompletionIncident.vehiclePlate || incidentCompletionOrder?.vehiclePlate || '-'}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Status</span>
                                    <strong>{getDriverIncidentStatusLabel(incidentCompletionIncident.status)}</strong>
                                </div>
                            </div>

                            <div className="form-group" style={{ marginTop: '1rem' }}>
                                <label className="form-label">Catatan Penyelesaian <span className="required">*</span></label>
                                <textarea
                                    className="form-textarea"
                                    rows={3}
                                    value={incidentCompletionForm.resolutionNote}
                                    onChange={event => setIncidentCompletionForm(previous => ({ ...previous, resolutionNote: event.target.value }))}
                                    disabled={isActionInFlight}
                                    placeholder="Contoh: ban sudah diganti, kendaraan lanjut jalan, nota biaya terlampir ke admin."
                                />
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Lokasi Akhir</label>
                                    <input
                                        className="form-input"
                                        value={incidentCompletionForm.resolutionLocationText}
                                        onChange={event => setIncidentCompletionForm(previous => ({ ...previous, resolutionLocationText: event.target.value }))}
                                        disabled={isActionInFlight}
                                        placeholder="Opsional"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Odometer Akhir</label>
                                    <FormattedNumberInput
                                        min={0}
                                        allowDecimal={false}
                                        value={incidentCompletionForm.resolutionOdometer}
                                        onValueChange={value => setIncidentCompletionForm(previous => ({ ...previous, resolutionOdometer: value }))}
                                        disabled={isActionInFlight}
                                    />
                                </div>
                            </div>

                            <div className="form-section-title" style={{ marginTop: '1rem' }}>Biaya yang Dikeluarkan Supir</div>
                            <div style={{ display: 'grid', gap: '0.8rem' }}>
                                {incidentCompletionForm.costs.length === 0 ? (
                                    <div className="text-muted text-sm">Kosongkan jika tidak ada biaya. Admin tetap bisa menambahkan biaya dari halaman insiden.</div>
                                ) : (
                                    incidentCompletionForm.costs.map((cost, index) => (
                                        <div key={cost.draftId} className="card" style={{ boxShadow: 'none' }}>
                                            <div className="card-body" style={{ display: 'grid', gap: '0.75rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                                                    <strong>Biaya {index + 1}</strong>
                                                    <button
                                                        type="button"
                                                        className="btn btn-danger btn-sm"
                                                        onClick={() => removeIncidentCompletionCost(cost.draftId)}
                                                        disabled={isActionInFlight}
                                                    >
                                                        <Trash2 size={14} /> Hapus
                                                    </button>
                                                </div>
                                                <div className="form-row">
                                                    <div className="form-group">
                                                        <label className="form-label">Kategori</label>
                                                        <select
                                                            className="form-select"
                                                            value={cost.category}
                                                            onChange={event => updateIncidentCompletionCost(cost.draftId, 'category', event.target.value as IncidentSettlementCategory)}
                                                            disabled={isActionInFlight}
                                                        >
                                                            {DRIVER_INCIDENT_COST_CATEGORY_OPTIONS.map(option => (
                                                                <option key={option.value} value={option.value}>{option.label}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Nominal <span className="required">*</span></label>
                                                        <FormattedNumberInput
                                                            min={0}
                                                            allowDecimal={false}
                                                            value={cost.amount}
                                                            onValueChange={value => updateIncidentCompletionCost(cost.draftId, 'amount', value)}
                                                            disabled={isActionInFlight}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">Deskripsi Biaya <span className="required">*</span></label>
                                                    <input
                                                        className="form-input"
                                                        value={cost.description}
                                                        onChange={event => updateIncidentCompletionCost(cost.draftId, 'description', event.target.value)}
                                                        disabled={isActionInFlight}
                                                        placeholder="Contoh: Tambal ban luar, derek ke bengkel, beli oli darurat"
                                                    />
                                                </div>
                                                <div className="form-row">
                                                    <div className="form-group">
                                                        <label className="form-label">Dibayar ke</label>
                                                        <input
                                                            className="form-input"
                                                            value={cost.payeeName}
                                                            onChange={event => updateIncidentCompletionCost(cost.draftId, 'payeeName', event.target.value)}
                                                            disabled={isActionInFlight}
                                                            placeholder="Nama bengkel/toko/orang"
                                                        />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Catatan</label>
                                                        <input
                                                            className="form-input"
                                                            value={cost.note}
                                                            onChange={event => updateIncidentCompletionCost(cost.draftId, 'note', event.target.value)}
                                                            disabled={isActionInFlight}
                                                            placeholder="Opsional"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={addIncidentCompletionCost}
                                    disabled={isActionInFlight}
                                    style={{ justifySelf: 'start' }}
                                >
                                    <Plus size={15} /> Tambah Biaya
                                </button>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeIncidentCompletionModal} disabled={isActionInFlight}>
                                Batal
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => void submitIncidentCompletionRequest()}
                                disabled={isActionInFlight || !incidentCompletionForm.resolutionNote.trim()}
                            >
                                <AlertTriangle size={15} /> {actionLoadingId === `incident-complete-${incidentCompletionIncident._id}` ? 'Mengirim...' : 'Kirim ke Admin'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showTripCreateModal && tripCreateTarget && (
                <div className="modal-overlay" onClick={closeTripCreateModal}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">
                                    {tripCreateAllowsDirectCargoInput
                                        ? `Input Surat Jalan Trip ${tripCreateTarget.tripSequence}`
                                        : `Buat Surat Jalan Trip ${tripCreateTarget.tripSequence}`}
                                </h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>
                                    {tripCreateAllowsDirectCargoInput
                                        ? 'Trip ini sudah menempel ke driver, kendaraan, dan uang jalan. Isi SJ pengirim dan muatan sesuai dokumen yang dibawa.'
                                        : 'Trip ini sudah menempel ke driver, kendaraan, dan uang jalan. Isi daftar SJ pengirim yang dibawa.'}
                                </div>
                            </div>
                            <button className="modal-close" onClick={closeTripCreateModal} disabled={isActionInFlight}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="driver-completion-summary">
                                <div className="driver-completion-summary-card">
                                    <span>Order</span>
                                    <strong>{tripCreateTarget.masterResi || '-'}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Kendaraan</span>
                                    <strong>{tripCreateTarget.vehiclePlate || '-'}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Pickup</span>
                                    <strong>{tripCreateTarget.pickupStops.length > 0 ? `${tripCreateTarget.pickupStops.length} titik` : (tripCreateTarget.pickupAddress || '-')}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>{tripCreateAllowsDirectCargoInput ? 'Ringkasan Barang' : 'Muatan Order'}</span>
                                    <strong>
                                        {tripCreateDraftItems.length > 0
                                            ? formatCargoSummary(tripCreateSummary)
                                            : (tripCreateAllowsDirectCargoInput ? 'Belum ada barang' : 'Mengikuti order / resi')}
                                    </strong>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginTop: '1rem', marginBottom: '1rem' }}>
                                <div className="driver-completion-summary-card">
                                    <span>Draft SJ</span>
                                    <strong>{tripCreateGroups.length} SJ</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>{tripCreateAllowsDirectCargoInput ? 'Barang Dicatat' : 'Input Barang'}</span>
                                    <strong>{tripCreateAllowsDirectCargoInput ? `${tripCreateDraftItems.length} barang` : 'Ikut order'}</strong>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gap: '0.85rem' }}>
                                {tripCreateGroups.map((group, groupIndex) => {
                                    const draftItemsInGroup = getDeliveryOrderCargoDraftItems(group);
                                    return (
                                        <div key={group.id} style={{ display: 'grid', gap: '0.85rem', padding: '1rem', background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <div>
                                                    <div className="font-semibold">SJ {groupIndex + 1}</div>
                                                    <div className="text-muted text-sm">
                                                        {tripCreateAllowsDirectCargoInput ? `${draftItemsInGroup.length} barang` : 'Muatan ikut order'}
                                                    </div>
                                                </div>
                                                {tripCreateGroups.length > 1 && (
                                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeTripCreateGroup(group.id)} disabled={isActionInFlight}>
                                                        <X size={14} /> Hapus SJ
                                                    </button>
                                                )}
                                            </div>

                                            {tripCreateTarget.pickupStops.length > 0 && (
                                                <div style={{ flex: '1 1 240px' }}>
                                                    <label className="form-label">Titik Pickup</label>
                                                    <select
                                                        className="form-select"
                                                        value={group.pickupStopKey}
                                                        onChange={event => updateTripCreateGroup(group.id, 'pickupStopKey', event.target.value)}
                                                        disabled={isActionInFlight}
                                                    >
                                                        <option value="">Pilih titik pickup</option>
                                                        {tripCreateTarget.pickupStops.map((pickupStop, pickupIndex) => (
                                                            <option key={pickupStop._key || `${pickupIndex}-${pickupStop.pickupAddress}`} value={pickupStop._key || ''}>
                                                                {`Pickup ${pickupIndex + 1}${pickupStop.pickupLabel ? ` - ${pickupStop.pickupLabel}` : ''}`}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}

                                            <div style={{ flex: '1 1 220px' }}>
                                                <label className="form-label">No. SJ Pengirim</label>
                                                <input
                                                    className="form-input"
                                                    value={group.shipperReferenceNumber}
                                                    onChange={event => updateTripCreateGroup(group.id, 'shipperReferenceNumber', event.target.value.toUpperCase())}
                                                    placeholder="Masukkan nomor surat jalan pengirim"
                                                    disabled={isActionInFlight}
                                                />
                                            </div>

                                            {tripCreateAllowsDirectCargoInput ? (
                                                <div style={{ display: 'grid', gap: '0.75rem' }}>
                                                    {group.items.map((item, itemIndex) => (
                                                    <div key={`${group.id}-item-${itemIndex}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', padding: 12, background: 'var(--color-white)', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)' }}>
                                                        <div style={{ flex: '1 1 240px' }}>
                                                            <label className="form-label">Barang Customer</label>
                                                            <select
                                                                className="form-select"
                                                                value={item.customerProductRef}
                                                                onChange={event => applyTripCreateProductSelection(group.id, itemIndex, event.target.value)}
                                                                disabled={isActionInFlight || !tripCreateTarget.customerRef}
                                                            >
                                                                <option value="">{tripCreateCustomerProducts.length > 0 ? 'Pilih dari master barang customer' : 'Belum ada master barang customer'}</option>
                                                                {tripCreateCustomerProducts.map(product => (
                                                                    <option key={product._id} value={product._id}>
                                                                        {product.code ? `${product.code} - ` : ''}{product.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div style={{ flex: '2 1 260px' }}>
                                                            <label className="form-label">Deskripsi Barang</label>
                                                            <input
                                                                className="form-input"
                                                                value={item.description}
                                                                onChange={event => updateTripCreateItem(group.id, itemIndex, 'description', event.target.value)}
                                                                placeholder="Mis. Oli 50 liter / Ban luar / Pupuk"
                                                                disabled={isActionInFlight}
                                                            />
                                                        </div>
                                                        <div style={{ flex: '0 1 110px' }}>
                                                            <label className="form-label">Koli</label>
                                                            <FormattedNumberInput
                                                                min={0}
                                                                allowDecimal={false}
                                                                value={item.qtyKoli}
                                                                onValueChange={value => updateTripCreateItem(group.id, itemIndex, 'qtyKoli', value)}
                                                                disabled={isActionInFlight}
                                                            />
                                                        </div>
                                                        <div style={{ flex: '1 1 180px' }}>
                                                            <label className="form-label">Berat</label>
                                                            <div className="driver-completion-unit-row">
                                                                <FormattedNumberInput
                                                                    min={0}
                                                                    maxFractionDigits={getWeightInputFractionDigits(item.weightInputUnit)}
                                                                    value={item.weightInputValue}
                                                                    onValueChange={value => updateTripCreateItem(group.id, itemIndex, 'weightInputValue', value)}
                                                                    disabled={isActionInFlight || shouldLockOrderItemWeight(item)}
                                                                />
                                                                <select
                                                                    className="form-select"
                                                                    value={item.weightInputUnit}
                                                                    onChange={event => setTripCreateGroups(previous => previous.map(entry => (
                                                                        entry.id === group.id
                                                                            ? {
                                                                                ...entry,
                                                                                items: entry.items.map((entryItem, entryItemIndex) => (
                                                                                    entryItemIndex === itemIndex
                                                                                        ? toDeliveryOrderCargoDraftItem(updateOrderItemWeightUnit({
                                                                                            ...entryItem,
                                                                                            pickupStopKey: entry.pickupStopKey,
                                                                                            shipperReferenceNumber: entry.shipperReferenceNumber,
                                                                                        }, event.target.value as DeliveryOrderCargoDraftItem['weightInputUnit']))
                                                                                        : entryItem
                                                                                )),
                                                                            }
                                                                            : entry
                                                                    )))}
                                                                    disabled={isActionInFlight}
                                                                >
                                                                    {WEIGHT_INPUT_UNIT_OPTIONS.map(option => (
                                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        <div style={{ flex: '1 1 180px' }}>
                                                            <label className="form-label">Volume</label>
                                                            <div className="driver-completion-unit-row">
                                                                <FormattedNumberInput
                                                                    min={0}
                                                                    maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3}
                                                                    value={item.volumeInputValue}
                                                                    onValueChange={value => updateTripCreateItem(group.id, itemIndex, 'volumeInputValue', value)}
                                                                    disabled={isActionInFlight}
                                                                />
                                                                <select
                                                                    className="form-select"
                                                                    value={item.volumeInputUnit}
                                                                    onChange={event => setTripCreateGroups(previous => previous.map(entry => (
                                                                        entry.id === group.id
                                                                            ? {
                                                                                ...entry,
                                                                                items: entry.items.map((entryItem, entryItemIndex) => (
                                                                                    entryItemIndex === itemIndex
                                                                                        ? toDeliveryOrderCargoDraftItem(updateOrderItemVolumeUnit({
                                                                                            ...entryItem,
                                                                                            pickupStopKey: entry.pickupStopKey,
                                                                                            shipperReferenceNumber: entry.shipperReferenceNumber,
                                                                                        }, event.target.value as DeliveryOrderCargoDraftItem['volumeInputUnit']))
                                                                                        : entryItem
                                                                                )),
                                                                            }
                                                                            : entry
                                                                    )))}
                                                                    disabled={isActionInFlight}
                                                                >
                                                                    {VOLUME_INPUT_UNIT_OPTIONS.map(option => (
                                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        {group.items.length > 1 && !item.deliveryOrderItemId && (
                                                            <button
                                                                type="button"
                                                                className="btn btn-ghost btn-icon-only"
                                                                onClick={() => removeTripCreateItem(group.id, itemIndex)}
                                                                disabled={isActionInFlight}
                                                                style={{ marginBottom: 4 }}
                                                            >
                                                                &times;
                                                            </button>
                                                        )}
                                                    </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-muted text-sm" style={{ padding: '0.75rem 0' }}>
                                                    Trip ini mengikuti item order. Driver cukup melengkapi daftar SJ pengirim.
                                                </div>
                                            )}

                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                <div className="text-muted text-sm">
                                                    {tripCreateAllowsDirectCargoInput ? 'Satu SJ boleh berisi banyak barang.' : 'Trip ini boleh memuat beberapa SJ pengirim.'}
                                                </div>
                                                {tripCreateAllowsDirectCargoInput && (
                                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => addTripCreateItem(group.id)} disabled={isActionInFlight}>
                                                        <Plus size={14} /> Tambah Barang di SJ Ini
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                                <div className="text-muted text-sm">
                                    {tripCreateAllowsDirectCargoInput
                                        ? 'Kalau barang belum final, simpan SJ dulu lalu lengkapi dari DO aktif.'
                                        : 'Simpan daftar SJ pengirim yang dibawa.'}
                                </div>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={addTripCreateGroup} disabled={isActionInFlight}>
                                    <Plus size={14} /> Tambah SJ
                                </button>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeTripCreateModal} disabled={isActionInFlight}>
                                Batal
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => void submitTripCreate()}
                                disabled={isActionInFlight}
                            >
                                <Truck size={15} /> {actionLoadingId === getDriverTripPlanId(tripCreateTarget) ? 'Menyimpan...' : 'Simpan Surat Jalan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showCargoInputModal && cargoInputOrder && (
                <div className="modal-overlay" onClick={closeCargoInputModal}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">
                                    {cargoInputMode === 'SJ_ADD'
                                        ? `Tambah SJ ${cargoInputOrder.doNumber}`
                                        : cargoInputMode === 'SJ_EDIT'
                                        ? `Edit SJ ${cargoInputOrder.doNumber}`
                                        : cargoInputAllowsDirectCargoInput
                                        ? `${(cargoInputOrder.driverCargoItems?.length || 0) > 0 ? 'Tambah Barang' : 'Input Barang'} ${cargoInputOrder.doNumber}`
                                        : `Kelola SJ ${cargoInputOrder.doNumber}`}
                                </h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>
                                    {cargoInputMode === 'SJ_ADD'
                                        ? 'Tambah nomor SJ baru dan barang yang terkait dengan SJ tersebut.'
                                        : cargoInputMode === 'SJ_EDIT'
                                        ? 'Koreksi nomor SJ, titik pickup, dan barang pada SJ yang dipilih.'
                                        : cargoInputAllowsDirectCargoInput
                                        ? 'Isi manifest sesuai SJ yang driver pegang. Barang akan masuk ke Surat Jalan aktif.'
                                        : 'Lengkapi daftar SJ pengirim yang driver bawa. Muatan tetap mengikuti order / resi dan dikroscek admin.'}
                                </div>
                            </div>
                            <button className="modal-close" onClick={closeCargoInputModal} disabled={isActionInFlight}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="driver-completion-summary">
                                <div className="driver-completion-summary-card">
                                    <span>Customer</span>
                                    <strong>{cargoInputOrder.customerName || '-'}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>SJ Pengirim</span>
                                    <strong>{getShipperReferenceCount(cargoInputOrder) > 0 ? formatShipperDeliveryOrderNumber(cargoInputOrder) : '-'}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Rute Trip</span>
                                    <strong>{formatDriverTripRoute(cargoInputOrder.tripOriginArea, cargoInputOrder.tripDestinationArea)}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Pickup</span>
                                    <strong>{cargoInputOrder.pickupStops?.length ? `${cargoInputOrder.pickupStops.length} titik` : (cargoInputOrder.pickupAddress || '-')}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>{cargoInputMode === 'SJ_EDIT' ? 'Barang SJ Ini' : cargoInputAllowsDirectCargoInput ? 'Ringkasan Tambahan' : 'Muatan DO'}</span>
                                    <strong>
                                        {cargoInputMode === 'SJ_EDIT'
                                            ? `${cargoInputDraftItems.length} barang`
                                            : cargoInputDraftItems.length > 0
                                            ? formatCargoSummary(cargoInputSummary)
                                            : (cargoInputAllowsDirectCargoInput ? 'Belum ada barang' : (cargoInputExistingSummary || 'Mengikuti order / resi'))}
                                    </strong>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginTop: '1rem', marginBottom: '1rem' }}>
                                <div className="driver-completion-summary-card">
                                    <span>Draft SJ</span>
                                    <strong>{cargoInputGroups.length} SJ</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>{cargoInputMode === 'SJ_EDIT' ? 'Mode' : cargoInputAllowsDirectCargoInput ? 'Barang Dicatat' : 'Input Barang'}</span>
                                    <strong>{cargoInputMode === 'SJ_EDIT' ? 'Satu SJ' : cargoInputAllowsDirectCargoInput ? `${cargoInputDraftItems.length} barang` : 'Ikut order'}</strong>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gap: '0.85rem' }}>
                                {cargoInputGroups.map((group, groupIndex) => {
                                    const draftItemsInGroup = getDeliveryOrderCargoDraftItems(group);
                                    const normalizedGroupReference = group.shipperReferenceNumber.trim().toUpperCase();
                                    const existingItemsInGroup = normalizedGroupReference
                                        ? (cargoInputOrder?.driverCargoItems || []).filter(item =>
                                            (group.shipperReferenceKey && item.shipperReferenceKey === group.shipperReferenceKey) ||
                                            (item.shipperReferenceNumber || cargoInputOrder?.customerDoNumber || '').trim().toUpperCase() === normalizedGroupReference
                                        )
                                        : [];
                                    const finalizedItemsInGroup = existingItemsInGroup.filter(existingItem =>
                                        existingItem.actualQtyKoli !== undefined || existingItem.actualWeightKg !== undefined
                                    );
                                    return (
                                        <div key={group.id} style={{ display: 'grid', gap: '0.85rem', padding: 12, background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <div>
                                                    <div className="font-semibold">SJ {groupIndex + 1}</div>
                                                    <div className="text-muted text-sm">
                                                        {cargoInputMode === 'SJ_EDIT'
                                                            ? `${draftItemsInGroup.length} barang bisa diubah`
                                                            : cargoInputAllowsDirectCargoInput ? `${draftItemsInGroup.length} barang` : 'Muatan ikut order'}
                                                    </div>
                                                    {existingItemsInGroup.length > 0 && (
                                                        <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                            {existingItemsInGroup.length} barang tersimpan • {finalizedItemsInGroup.length} final • {existingItemsInGroup.length - finalizedItemsInGroup.length} belum final
                                                        </div>
                                                    )}
                                                </div>
                                                {cargoInputGroups.length > 1 && (
                                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeCargoInputGroup(group.id)} disabled={isActionInFlight}>
                                                        <X size={14} /> Hapus SJ
                                                    </button>
                                                )}
                                            </div>

                                            {existingItemsInGroup.length > 0 && (
                                                <div style={{ display: 'grid', gap: '0.45rem', padding: '0.75rem', background: 'var(--color-white)', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem' }}>
                                                    <div className="text-muted text-sm">Barang tersimpan di SJ ini</div>
                                                    {existingItemsInGroup.map(existingItem => (
                                                        <div key={existingItem._id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                                                            <span className="font-medium">{existingItem.orderItemDescription || 'Barang'}</span>
                                                            <span className="text-muted">
                                                                {formatCargoSummary({
                                                                    qtyKoli: existingItem.orderItemQtyKoli,
                                                                    weightKg: existingItem.orderItemWeight,
                                                                    weightInputValue: existingItem.orderItemWeightInputValue,
                                                                    weightInputUnit: existingItem.orderItemWeightInputUnit,
                                                                    volumeM3: existingItem.orderItemVolumeM3,
                                                                    volumeInputValue: existingItem.orderItemVolumeInputValue,
                                                                    volumeInputUnit: existingItem.orderItemVolumeInputUnit,
                                                                })}
                                                            </span>
                                                            <span style={{ color: existingItem.actualQtyKoli !== undefined || existingItem.actualWeightKg !== undefined ? 'var(--color-success)' : 'var(--color-gray-500)' }}>
                                                                {existingItem.actualQtyKoli !== undefined || existingItem.actualWeightKg !== undefined ? 'Sudah final' : 'Belum final'}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {(cargoInputOrder.pickupStops?.length || 0) > 0 && (
                                                <div style={{ flex: '1 1 240px' }}>
                                                    <label className="form-label">Titik Pickup</label>
                                                    <select
                                                        className="form-select"
                                                        value={group.pickupStopKey}
                                                        onChange={event => updateCargoInputGroup(group.id, 'pickupStopKey', event.target.value)}
                                                        disabled={isActionInFlight}
                                                    >
                                                        <option value="">Pilih titik pickup</option>
                                                        {(cargoInputOrder.pickupStops || []).map((pickupStop, pickupIndex) => (
                                                            <option key={pickupStop._key || `${pickupIndex}-${pickupStop.pickupAddress}`} value={pickupStop._key || ''}>
                                                                {`Pickup ${pickupIndex + 1}${pickupStop.pickupLabel ? ` - ${pickupStop.pickupLabel}` : ''}`}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}
                                            <div style={{ flex: '1 1 220px' }}>
                                                <label className="form-label">No. SJ Pengirim</label>
                                                <input
                                                    className="form-input"
                                                    value={group.shipperReferenceNumber}
                                                    onChange={event => updateCargoInputGroup(group.id, 'shipperReferenceNumber', event.target.value.toUpperCase())}
                                                    placeholder="Masukkan nomor surat jalan pengirim"
                                                    disabled={isActionInFlight}
                                                />
                                            </div>

                                            {cargoInputMode === 'SJ_EDIT' || cargoInputAllowsDirectCargoInput ? (
                                                <div style={{ display: 'grid', gap: '0.75rem' }}>
                                                    {group.items.map((item, itemIndex) => (
                                                    <div key={`${group.id}-item-${itemIndex}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', padding: 12, background: 'var(--color-white)', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)' }}>
                                                        <div style={{ flex: '1 1 240px' }}>
                                                            <label className="form-label">Barang Customer</label>
                                                            <select
                                                                className="form-select"
                                                                value={item.customerProductRef}
                                                                onChange={event => applyCargoInputProductSelection(group.id, itemIndex, event.target.value)}
                                                                disabled={isActionInFlight || !cargoInputOrder.customerRef}
                                                            >
                                                                <option value="">{cargoInputCustomerProducts.length > 0 ? 'Pilih dari master barang customer' : 'Belum ada master barang customer'}</option>
                                                                {cargoInputCustomerProducts.map(product => (
                                                                    <option key={product._id} value={product._id}>
                                                                        {product.code ? `${product.code} - ` : ''}{product.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div style={{ flex: '2 1 260px' }}>
                                                            <label className="form-label">Deskripsi Barang</label>
                                                            <input
                                                                className="form-input"
                                                                value={item.description}
                                                                onChange={event => updateCargoInputItem(group.id, itemIndex, 'description', event.target.value)}
                                                                placeholder="Mis. Oli 50 liter / Ban luar / Pupuk"
                                                                disabled={isActionInFlight}
                                                            />
                                                        </div>
                                                        <div style={{ flex: '0 1 110px' }}>
                                                            <label className="form-label">Koli</label>
                                                            <FormattedNumberInput
                                                                min={0}
                                                                allowDecimal={false}
                                                                value={item.qtyKoli}
                                                                onValueChange={value => updateCargoInputItem(group.id, itemIndex, 'qtyKoli', value)}
                                                                disabled={isActionInFlight}
                                                            />
                                                        </div>
                                                        <div style={{ flex: '1 1 180px' }}>
                                                            <label className="form-label">Berat</label>
                                                            <div className="driver-completion-unit-row">
                                                                <FormattedNumberInput
                                                                    min={0}
                                                                    maxFractionDigits={getWeightInputFractionDigits(item.weightInputUnit)}
                                                                    value={item.weightInputValue}
                                                                    onValueChange={value => updateCargoInputItem(group.id, itemIndex, 'weightInputValue', value)}
                                                                    disabled={isActionInFlight || shouldLockOrderItemWeight(item)}
                                                                />
                                                                <select
                                                                    className="form-select"
                                                                    value={item.weightInputUnit}
                                                                    onChange={event => setCargoInputGroups(previous => previous.map(entry => (
                                                                        entry.id === group.id
                                                                            ? {
                                                                                ...entry,
                                                                                items: entry.items.map((entryItem, entryItemIndex) => (
                                                                                    entryItemIndex === itemIndex
                                                                                        ? toDeliveryOrderCargoDraftItem(updateOrderItemWeightUnit({
                                                                                            ...entryItem,
                                                                                            pickupStopKey: entry.pickupStopKey,
                                                                                            shipperReferenceNumber: entry.shipperReferenceNumber,
                                                                                        }, event.target.value as DeliveryOrderCargoDraftItem['weightInputUnit']))
                                                                                        : entryItem
                                                                                )),
                                                                            }
                                                                            : entry
                                                                    )))}
                                                                    disabled={isActionInFlight}
                                                                >
                                                                    {WEIGHT_INPUT_UNIT_OPTIONS.map(option => (
                                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        <div style={{ flex: '1 1 180px' }}>
                                                            <label className="form-label">Volume</label>
                                                            <div className="driver-completion-unit-row">
                                                                <FormattedNumberInput
                                                                    min={0}
                                                                    maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3}
                                                                    value={item.volumeInputValue}
                                                                    onValueChange={value => updateCargoInputItem(group.id, itemIndex, 'volumeInputValue', value)}
                                                                    disabled={isActionInFlight}
                                                                />
                                                                <select
                                                                    className="form-select"
                                                                    value={item.volumeInputUnit}
                                                                    onChange={event => setCargoInputGroups(previous => previous.map(entry => (
                                                                        entry.id === group.id
                                                                            ? {
                                                                                ...entry,
                                                                                items: entry.items.map((entryItem, entryItemIndex) => (
                                                                                    entryItemIndex === itemIndex
                                                                                        ? toDeliveryOrderCargoDraftItem(updateOrderItemVolumeUnit({
                                                                                            ...entryItem,
                                                                                            pickupStopKey: entry.pickupStopKey,
                                                                                            shipperReferenceNumber: entry.shipperReferenceNumber,
                                                                                        }, event.target.value as DeliveryOrderCargoDraftItem['volumeInputUnit']))
                                                                                        : entryItem
                                                                                )),
                                                                            }
                                                                            : entry
                                                                    )))}
                                                                    disabled={isActionInFlight}
                                                                >
                                                                    {VOLUME_INPUT_UNIT_OPTIONS.map(option => (
                                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        {group.items.length > 1 && (
                                                            <button
                                                                type="button"
                                                                className="btn btn-ghost btn-icon-only"
                                                                onClick={() => removeCargoInputItem(group.id, itemIndex)}
                                                                disabled={isActionInFlight}
                                                                style={{ marginBottom: 4 }}
                                                            >
                                                                &times;
                                                            </button>
                                                        )}
                                                    </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-muted text-sm" style={{ padding: '0.75rem 0' }}>
                                                    DO ini mengikuti item order. Driver cukup melengkapi daftar SJ pengirim.
                                                </div>
                                            )}

                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                <div className="text-muted text-sm">
                                                    {cargoInputMode === 'SJ_EDIT'
                                                        ? 'Perubahan barang berlaku untuk SJ yang sedang diedit saja.'
                                                        : cargoInputAllowsDirectCargoInput
                                                        ? 'Satu SJ boleh berisi banyak barang dan bisa ditambah bertahap selama trip masih aktif.'
                                                        : 'SJ bisa ditambah atau diperbarui selama trip masih aktif.'}
                                                </div>
                                                {(cargoInputMode === 'SJ_EDIT' || cargoInputAllowsDirectCargoInput) && (
                                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => addCargoInputItem(group.id)} disabled={isActionInFlight}>
                                                        <Plus size={14} /> Tambah Barang di SJ Ini
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                                <div className="text-muted text-sm">
                                    {cargoInputMode === 'SJ_ADD'
                                        ? 'Form ini tidak memuat SJ lama. Minimal 1 barang wajib diisi untuk setiap SJ baru.'
                                        : cargoInputMode === 'SJ_EDIT'
                                        ? 'Mode edit hanya memuat satu SJ dari baris yang dipilih.'
                                        : cargoInputAllowsDirectCargoInput
                                        ? 'Barang boleh ditambah bertahap. Pastikan deskripsi dan muatan sesuai surat jalan yang driver pegang.'
                                        : 'Lengkapi daftar SJ pengirim yang dibawa.'}
                                </div>
                                {cargoInputMode !== 'SJ_EDIT' && (
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={addCargoInputGroup} disabled={isActionInFlight}>
                                        <Plus size={14} /> Tambah SJ
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeCargoInputModal} disabled={isActionInFlight}>
                                Batal
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => void submitCargoInput()}
                                disabled={isActionInFlight}
                            >
                                <Truck size={15} /> {actionLoadingId === cargoInputOrder._id ? 'Menyimpan...' : (cargoInputMode === 'SJ_EDIT' ? 'Simpan SJ' : cargoInputMode === 'SJ_ADD' ? 'Simpan SJ & Barang' : cargoInputDraftItems.length > 0 ? 'Simpan SJ & Barang' : 'Simpan SJ')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDeliveredRequestModal && completionOrder && (
                <div className="modal-overlay" onClick={closeDeliveredRequestModal}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">{completionMode === 'TRIP_CLOSE' ? 'Tutup Trip' : completionTargetStatus === 'DELIVERED' ? 'Finalisasi Batch SJ' : 'Update Batch SJ'} {completionOrder.doNumber}</h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>
                                    {completionMode === 'TRIP_CLOSE'
                                        ? 'Semua SJ sudah terkirim. Ajukan odometer akhir ke admin untuk konfirmasi tutup trip.'
                                        : completionTargetStatus === 'DELIVERED'
                                        ? 'Pilih SJ yang selesai, isi POD, drop, dan aktual barang, lalu kirim ke admin untuk approval.'
                                        : 'Pilih SJ yang memenuhi syarat lalu simpan progres batch.'}
                                </div>
                            </div>
                            <button className="modal-close" onClick={closeDeliveredRequestModal} disabled={isActionInFlight}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="driver-completion-summary">
                                <div className="driver-completion-summary-card">
                                    <span>Customer</span>
                                    <strong>{completionOrder.customerName || '-'}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Rute Trip</span>
                                    <strong>{formatDriverTripRoute(completionOrder.tripOriginArea, completionOrder.tripDestinationArea)}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Muatan Batch SJ</span>
                                    <strong>{selectedCompletionCargoItems.length > 0 ? completionBatchSjCargoSummary : 'Belum ada item dipilih'}</strong>
                                </div>
                            </div>

                            {completionMode !== 'TRIP_CLOSE' && completionTargetStatus === 'DELIVERED' && (
                                <div className="driver-completion-steps">
                                    <div className={`driver-completion-step ${completionStep === 'SETUP' ? 'active' : 'done'}`}>
                                        <span>1</span>
                                        <strong>Batch, POD, Drop</strong>
                                    </div>
                                    <div className={`driver-completion-step ${completionStep === 'ACTUAL' ? 'active' : ''}`}>
                                        <span>2</span>
                                        <strong>Aktual Barang</strong>
                                    </div>
                                </div>
                            )}

                            {completionMode === 'TRIP_CLOSE' ? (
                                <>
                                    <div className="form-group" style={{ marginTop: '1rem' }}>
                                        <label className="form-label">SJ Terkirim</label>
                                        <div style={{ display: 'grid', gap: '0.5rem' }}>
                                            {getDriverOrderSjRows(completionOrder)
                                                .filter(row => selectedCompletionSjSet.has(row.documentId))
                                                .map(row => (
                                                    <div
                                                        key={row.documentId}
                                                        style={{
                                                            padding: '0.7rem 0.85rem',
                                                            border: '1px solid var(--color-gray-200)',
                                                            borderRadius: '0.75rem',
                                                            background: 'var(--color-white)',
                                                        }}
                                                    >
                                                        <div className="font-semibold">{formatDriverSjReferenceLabel(row)}</div>
                                                        <div className="text-muted text-sm">
                                                            Status sekarang {DO_STATUS_MAP[row.tripStatus]?.label || row.tripStatus} | {row.itemCount} item | {row.summary}
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                    <div className="form-group" style={{ marginTop: '1rem' }}>
                                        <label className="form-label">Odometer Akhir Trip <span className="required">*</span></label>
                                        <div className="driver-odometer-current">
                                            Odometer kendaraan saat ini: <strong>{completionVehicleCurrentOdometer.toLocaleString('id-ID')} km</strong>
                                            {completionOrder.vehicleLastOdometerAt ? ` | ${formatDateTime(completionOrder.vehicleLastOdometerAt)}` : ''}
                                        </div>
                                        <FormattedNumberInput
                                            min={0}
                                            allowDecimal={false}
                                            value={completionOdometerKm}
                                            onValueChange={value => setCompletionOdometerKm(value)}
                                            disabled={isActionInFlight}
                                        />
                                        {completionOdometerTooLow && (
                                            <div style={{ background: 'var(--color-danger-light)', borderRadius: '0.5rem', padding: '0.65rem 0.8rem', marginTop: '0.65rem', fontSize: '0.8rem', color: 'var(--color-danger)' }}>
                                                Odometer akhir trip tidak boleh lebih kecil dari odometer kendaraan saat ini.
                                            </div>
                                        )}
                                        <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                            Admin akan menutup trip setelah memeriksa odometer ini.
                                        </div>
                                    </div>
                                </>
                            ) : completionStep === 'SETUP' && (
                                <>
                            <div className="form-group" style={{ marginTop: '1rem' }}>
                                <label className="form-label">Pilih Batch Surat Jalan yang Diupdate <span className="required">*</span></label>
                                <div style={{ display: 'grid', gap: '0.5rem' }}>
                                    {completionSjOptions.length === 0 ? (
                                        <div className="driver-completion-empty">
                                            Belum ada SJ dengan item muatan yang bisa diupdate.
                                        </div>
                                    ) : completionSjOptions.map(row => (
                                        <label
                                            key={row.documentId}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.6rem',
                                                padding: '0.7rem 0.85rem',
                                                border: '1px solid var(--color-gray-200)',
                                                borderRadius: '0.75rem',
                                                background: 'var(--color-white)',
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedCompletionSjSet.has(row.documentId)}
                                                onChange={event => {
                                                    setSelectedCompletionSjRefs(previous => {
                                                        const nextRefs = event.target.checked
                                                            ? [...new Set([...previous, row.documentId])]
                                                            : previous.filter(item => item !== row.documentId);
                                                        if (completionOrder) {
                                                            prepareCompletionDraftsForSelection(completionOrder, completionTargetStatus, nextRefs);
                                                        }
                                                        return nextRefs;
                                                    });
                                                    setCompletionStep('SETUP');
                                                    setCompletionFrozenDropPoints([]);
                                                    setActiveCompletionCargoItemRef('');
                                                }}
                                                disabled={isActionInFlight}
                                            />
                                            <div style={{ display: 'grid', gap: '0.15rem' }}>
                                                <div className="font-semibold">{formatDriverSjReferenceLabel(row)}</div>
                                                <div className="text-muted text-sm">
                                                    Status sekarang {DO_STATUS_MAP[row.tripStatus]?.label || row.tripStatus} | {row.itemCount} item | {row.summary}
                                                </div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="form-group" style={{ marginTop: '1rem' }}>
                                <label className="form-label">Status Tujuan</label>
                                <select
                                    className="form-select"
                                    value={completionTargetStatus}
                                    onChange={event => {
                                        const nextStatus = event.target.value as DriverBatchStatusSelection;
                                        const nextRefs = nextStatus
                                            ? getDriverOrderSjRows(completionOrder)
                                                .filter(row => row.referenceNumber && row.itemCount > 0 && row.tripStatus !== 'DELIVERED' && row.nextStatus === nextStatus)
                                                .map(row => row.documentId)
                                            : [];
                                        setCompletionTargetStatus(nextStatus);
                                        setSelectedCompletionSjRefs(nextRefs);
                                        prepareCompletionDraftsForSelection(completionOrder, nextStatus, nextRefs);
                                        setCompletionStep('SETUP');
                                        setCompletionFrozenDropPoints([]);
                                        setActiveCompletionCargoItemRef('');
                                    }}
                                    disabled={isActionInFlight}
                                >
                                    <option value="">Pilih status</option>
                                    {completionBatchStatusOptions.map(status => (
                                        <option key={status} value={status}>{DO_STATUS_MAP[status]?.label || status}</option>
                                    ))}
                                </select>
                            </div>
                                </>
                            )}

                            {completionMode !== 'TRIP_CLOSE' && completionTargetStatus === 'DELIVERED' && (
                                <>
                            {completionStep === 'SETUP' && (
                                <>
                            <div className="form-group" style={{ marginTop: '1rem' }}>
                                <label className="form-label">Customer Invoice</label>
                                <select
                                    className="form-select"
                                    value={completionInvoiceCustomerRef}
                                    onChange={event => {
                                        const selectedCustomer = completionBillingCustomerOptions.find(customer => customer._id === event.target.value);
                                        setCompletionInvoiceCustomerRef(event.target.value);
                                        setCompletionInvoiceCustomerName(selectedCustomer?.name || '');
                                    }}
                                    disabled={isActionInFlight}
                                >
                                    <option value="">Pilih customer invoice</option>
                                    {completionBillingCustomerOptions.map(customer => (
                                        <option key={customer._id} value={customer._id}>
                                            {customer.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group" style={{ marginTop: '1rem' }}>
                                <label className="form-label">Nama Penerima POD <span className="required">*</span></label>
                                <input
                                    className="form-input"
                                    value={completionPodReceiverName}
                                    onChange={event => setCompletionPodReceiverName(event.target.value)}
                                    disabled={isActionInFlight}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Tanggal Terima POD <span className="required">*</span></label>
                                <input
                                    type="date"
                                    className="form-input"
                                    value={completionPodReceivedDate}
                                    onChange={event => setCompletionPodReceivedDate(event.target.value)}
                                    disabled={isActionInFlight}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan POD</label>
                                <textarea
                                    className="form-textarea"
                                    rows={2}
                                    value={completionPodNote}
                                    onChange={event => setCompletionPodNote(event.target.value)}
                                    disabled={isActionInFlight}
                                />
                            </div>
                                </>
                            )}

                            {completionStep === 'ACTUAL' && (
                            <div className="driver-completion-list">
                                {selectedCompletionCargoItems.length === 0 ? (
                                    <div className="driver-completion-empty">
                                        Pilih minimal 1 SJ yang punya item muatan sebelum update batch.
                                    </div>
                                ) : selectedCompletionActualCargoTabItems.length === 0 ? (
                                    <div className="driver-completion-empty">
                                        Semua barang pada SJ yang dipilih dialokasikan ke hold. Tidak ada item DROP yang perlu diisi di Aktual Barang.
                                    </div>
                                ) : activeCompletionCargoItem ? (
                                    <>
                                        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', borderBottom: '1px solid var(--color-gray-200)', marginBottom: '1rem', paddingBottom: '0.5rem' }}>
                                            {selectedCompletionActualCargoTabItems.map((item, index) => {
                                                const isActive = item.deliveryOrderItemRef === activeCompletionCargoItem.deliveryOrderItemRef;
                                                const isReady = isActualCargoDraftReady(item);
                                                return (
                                                    <button
                                                        key={item.deliveryOrderItemRef}
                                                        type="button"
                                                        className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                                                        onClick={() => setActiveCompletionCargoItemRef(item.deliveryOrderItemRef)}
                                                        disabled={isActionInFlight}
                                                        title={`${item.description} | ${summarizeActualCargoDraft(item)}`}
                                                        style={{
                                                            alignItems: 'flex-start',
                                                            display: 'grid',
                                                            gap: '0.15rem',
                                                            minWidth: 150,
                                                            textAlign: 'left',
                                                            whiteSpace: 'normal',
                                                        }}
                                                    >
                                                        <span>Item {index + 1}</span>
                                                        <span style={{ fontSize: '0.72rem', fontWeight: 500, opacity: 0.85 }}>
                                                            {isReady ? summarizeActualCargoDraft(item) : 'Belum lengkap'}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                                <div>
                                                    <div className="text-muted text-sm">{activeCompletionCargoItem.shipperReferenceNumber || completionOrder.customerDoNumber || 'Tanpa SJ'}</div>
                                                    <div style={{ fontWeight: 700, marginTop: '0.2rem' }}>{activeCompletionCargoItem.description}</div>
                                                </div>
                                                <span className={`badge ${isActualCargoDraftReady(activeCompletionCargoItem) ? 'badge-success' : 'badge-warning'}`}>
                                                    {isActualCargoDraftReady(activeCompletionCargoItem) ? 'Lengkap' : 'Belum lengkap'}
                                                </span>
                                            </div>

                                            <div style={{ background: 'var(--color-white)', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem', display: 'grid', gap: '0.75rem' }}>
                                                {activeCompletionCargoItem.requireQty && (
                                                    <div className="form-group">
                                                        <label className="form-label">Qty Aktual</label>
                                                        <FormattedNumberInput
                                                            min={0}
                                                            maxFractionDigits={2}
                                                            value={parseFormattedNumberish(activeCompletionCargoItem.actualQtyKoli || 0, { maxFractionDigits: 2 })}
                                                            onValueChange={value => updateCompletionActualCargoValue(activeCompletionCargoItem, 'actualQtyKoli', String(value))}
                                                            disabled={isActionInFlight}
                                                        />
                                                    </div>
                                                )}

                                                {(activeCompletionCargoItem.requireWeight || activeCompletionCargoItem.plannedWeightKg > 0) && (
                                                    <div className="form-group">
                                                        <label className="form-label">Berat Aktual</label>
                                                        <div className="driver-completion-unit-row">
                                                            <FormattedNumberInput
                                                                min={0}
                                                                maxFractionDigits={getWeightInputFractionDigits(activeCompletionCargoItem.actualWeightInputUnit)}
                                                                value={parseFormattedNumberish(activeCompletionCargoItem.actualWeightInputValue || 0, {
                                                                    maxFractionDigits: getWeightInputFractionDigits(activeCompletionCargoItem.actualWeightInputUnit),
                                                                })}
                                                                onValueChange={value => updateCompletionActualCargoValue(activeCompletionCargoItem, 'actualWeightInputValue', String(value))}
                                                                disabled={isActionInFlight}
                                                            />
                                                            <select
                                                                className="form-select"
                                                                value={activeCompletionCargoItem.actualWeightInputUnit}
                                                                onChange={event => updateCompletionActualCargoUnit(activeCompletionCargoItem, 'actualWeightInputUnit', event.target.value)}
                                                                disabled={isActionInFlight}
                                                            >
                                                                {WEIGHT_INPUT_UNIT_OPTIONS.map(option => (
                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                )}

                                                {(activeCompletionCargoItem.requireVolume || (activeCompletionCargoItem.plannedVolumeM3 || 0) > 0) && (
                                                    <div className="form-group">
                                                        <label className="form-label">Volume Aktual</label>
                                                        <div className="driver-completion-unit-row">
                                                            <FormattedNumberInput
                                                                min={0}
                                                                maxFractionDigits={activeCompletionCargoItem.actualVolumeInputUnit === 'LITER' ? 0 : 3}
                                                                value={parseFormattedNumberish(activeCompletionCargoItem.actualVolumeInputValue || 0, {
                                                                    maxFractionDigits: activeCompletionCargoItem.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                                                                })}
                                                                onValueChange={value => updateCompletionActualCargoValue(activeCompletionCargoItem, 'actualVolumeInputValue', String(value))}
                                                                disabled={isActionInFlight}
                                                            />
                                                            <select
                                                                className="form-select"
                                                                value={activeCompletionCargoItem.actualVolumeInputUnit}
                                                                onChange={event => updateCompletionActualCargoUnit(activeCompletionCargoItem, 'actualVolumeInputUnit', event.target.value)}
                                                                disabled={isActionInFlight}
                                                            >
                                                                {VOLUME_INPUT_UNIT_OPTIONS.map(option => (
                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem', background: 'var(--color-white)', marginTop: '0.75rem', display: 'grid', gap: '0.55rem' }}>
                                                <div className="font-semibold">Detail Item Aktual</div>
                                                <div
                                                    style={{
                                                        display: 'grid',
                                                        gap: '0.18rem',
                                                        padding: '0.65rem 0.75rem',
                                                        border: '1px solid var(--color-gray-100)',
                                                        borderRadius: '0.65rem',
                                                        background: 'var(--color-gray-50)',
                                                    }}
                                                >
                                                    <div className="font-medium">{activeCompletionCargoItem.description || 'Barang'}</div>
                                                    <div className="text-muted text-sm">No SJ: {activeCompletionCargoItem.shipperReferenceNumber || completionOrder.customerDoNumber || 'Tanpa SJ'}</div>
                                                    <div className="text-muted text-sm">
                                                        Rencana awal SJ: {formatCargoSummary({
                                                            qtyKoli: activeCompletionCargoItem.plannedQtyKoli,
                                                            weightKg: activeCompletionCargoItem.plannedWeightKg,
                                                            weightInputValue: activeCompletionCargoItem.plannedWeightInputValue,
                                                            weightInputUnit: activeCompletionCargoItem.plannedWeightInputUnit,
                                                            volumeM3: activeCompletionCargoItem.plannedVolumeM3,
                                                            volumeInputValue: activeCompletionCargoItem.plannedVolumeInputValue,
                                                            volumeInputUnit: activeCompletionCargoItem.plannedVolumeInputUnit,
                                                        })}
                                                    </div>
                                                    {completionPartialHoldItemRefs.includes(activeCompletionCargoItem.deliveryOrderItemRef) && (
                                                        <div className="text-muted text-sm">Sisa hold saat ini: {summarizeActualCargoDraft(activeCompletionCargoItem)}</div>
                                                    )}
                                                    <div className="text-muted text-sm">Akan direalisasikan: {summarizeActualCargoDraft(activeCompletionCargoItem)}</div>
                                                    <div className="text-muted text-sm">Total alokasi drop: {summarizeActualCargoDraft(activeCompletionCargoItem)}</div>
                                                    <div className="text-muted text-sm">Total alokasi hold: {summarizeActualStepDropPointsForItemByType(activeCompletionCargoItem, ['HOLD'])}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="driver-completion-empty">
                                        Item aktual belum siap.
                                    </div>
                                )}
                            </div>
                            )}

                            {completionStep === 'SETUP' && (
                                <>
                            <div className="form-group" style={{ marginTop: '1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                    <label className="form-label" style={{ marginBottom: 0 }}>Realisasi Titik Drop <span className="required">*</span></label>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setShowCompletionAdvancedDropEditor(previous => !previous)}
                                        disabled={isActionInFlight}
                                    >
                                        {showCompletionAdvancedDropEditor ? 'Tutup Detail Drop' : 'Ada Multi-drop / Hold'}
                                    </button>
                                </div>
                                {completionDetailState.actualDropMismatchMessage && (
                                    <div style={{ background: 'var(--color-danger-light)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-danger)' }}>
                                        {completionDetailState.actualDropMismatchMessage} Muatan aktual {formatCargoSummary(completionDetailState.actualCargoTotals)} tetapi alokasi drop baru {formatCargoSummary(completionDetailState.actualDropTotals)}.
                                    </div>
                                )}
                                {completionDetailState.actualDropAmbiguityMessage && (
                                    <div style={{ background: 'var(--color-warning-light)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-warning-dark)' }}>
                                        {completionDetailState.actualDropAmbiguityMessage}
                                    </div>
                                )}
                                {!showCompletionAdvancedDropEditor ? (
                                    <div className="driver-completion-item">
                                        <div className="driver-completion-item-header">
                                            <div>
                                                <div className="driver-completion-item-title">Realisasi Default</div>
                                            </div>
                                        </div>
                                        <div className="driver-completion-metrics">
                                            {completionCustomerRecipients.length > 0 && (
                                                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                                    <label className="form-label">Master Tujuan Customer</label>
                                                    <select
                                                        className="form-select"
                                                        value={resolveCompletionDropRecipientValue(completionDetailState.autoActualDropDraft)}
                                                        onChange={event => applyCompletionDropRecipient(completionDetailState.autoActualDropDraft.draftKey, event.target.value)}
                                                        disabled={isActionInFlight}
                                                    >
                                                        <option value="">Pilih tujuan customer atau isi manual</option>
                                                        {completionCustomerRecipients.map(recipient => (
                                                            <option key={recipient._id} value={recipient._id}>
                                                                {formatCustomerRecipientOptionLabel(recipient)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}
                                            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                                <label className="form-label">Nama Lokasi</label>
                                                <input
                                                    className="form-input"
                                                    value={completionDetailState.autoActualDropDraft.locationName}
                                                    onChange={event => updateCompletionDropDraft(completionDetailState.autoActualDropDraft.draftKey, 'locationName', event.target.value)}
                                                    disabled={isActionInFlight}
                                                    placeholder="Nama tujuan aktual"
                                                />
                                            </div>
                                            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                                <label className="form-label">Alamat</label>
                                                <input
                                                    className="form-input"
                                                    value={completionDetailState.autoActualDropDraft.locationAddress}
                                                    onChange={event => updateCompletionDropDraft(completionDetailState.autoActualDropDraft.draftKey, 'locationAddress', event.target.value)}
                                                    disabled={isActionInFlight}
                                                    placeholder="Alamat aktual titik drop"
                                                />
                                            </div>
                                        </div>
                                        <div style={{ display: 'grid', gap: '0.55rem' }}>
                                            <div className="font-semibold">Barang Realisasi Default</div>
                                            {selectedCompletionCargoItems.length === 0 ? (
                                                <div className="text-muted text-sm">Belum ada barang dari SJ yang dipilih.</div>
                                            ) : (
                                                <>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.55rem' }}>
                                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.65rem', padding: '0.65rem 0.75rem', background: 'var(--color-gray-50)' }}>
                                                            <div className="text-muted text-sm">Total akan direalisasikan</div>
                                                            <div className="font-semibold" style={{ marginTop: '0.15rem' }}>{selectedCompletionCargoTotalSummary}</div>
                                                        </div>
                                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.65rem', padding: '0.65rem 0.75rem', background: 'var(--color-gray-50)' }}>
                                                            <div className="text-muted text-sm">Total sisa hold saat ini</div>
                                                            <div className="font-semibold" style={{ marginTop: '0.15rem' }}>{selectedCompletionHoldCargoTotalSummary}</div>
                                                        </div>
                                                    </div>
                                                    {selectedCompletionCargoItems.map(cargoItem => (
                                                        <div
                                                            key={cargoItem.deliveryOrderItemRef}
                                                            style={{
                                                                display: 'grid',
                                                                gap: '0.2rem',
                                                                padding: '0.65rem 0.75rem',
                                                                border: '1px solid var(--color-gray-200)',
                                                                borderRadius: '0.65rem',
                                                                background: 'var(--color-white)',
                                                            }}
                                                        >
                                                            <div className="font-medium">{cargoItem.description || 'Barang'}</div>
                                                            <div className="text-muted text-sm">No SJ: {cargoItem.shipperReferenceNumber || completionOrder.customerDoNumber || 'Tanpa SJ'}</div>
                                                            <div className="text-muted text-sm">
                                                                Rencana awal SJ: {formatCargoSummary({
                                                                    qtyKoli: cargoItem.plannedQtyKoli,
                                                                    weightKg: cargoItem.plannedWeightKg,
                                                                    weightInputValue: cargoItem.plannedWeightInputValue,
                                                                    weightInputUnit: cargoItem.plannedWeightInputUnit,
                                                                    volumeM3: cargoItem.plannedVolumeM3,
                                                                    volumeInputValue: cargoItem.plannedVolumeInputValue,
                                                                    volumeInputUnit: cargoItem.plannedVolumeInputUnit,
                                                                })}
                                                            </div>
                                                            {completionPartialHoldItemRefs.includes(cargoItem.deliveryOrderItemRef) && (
                                                                <div className="text-muted text-sm">
                                                                    Sisa hold saat ini: {summarizeActualCargoDraft(cargoItem)}
                                                                </div>
                                                            )}
                                                            <div className="text-muted text-sm">
                                                                Akan direalisasikan: {summarizeActualCargoDraft(cargoItem)}
                                                            </div>
                                                            <div className="text-muted text-sm">
                                                                Tipe realisasi: {DO_ACTUAL_DROP_TYPE_MAP[completionDetailState.autoActualDropDraft.stopType]?.label || completionDetailState.autoActualDropDraft.stopType}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={addCompletionDropDraft} disabled={isActionInFlight}>
                                                <Plus size={14} /> Tambah Titik Drop
                                            </button>
                                        </div>
                                        {selectedCompletionDropPoints.map((item, index) => {
                                            const dropTypeLabel = DO_ACTUAL_DROP_TYPE_MAP[item.stopType]?.label || item.stopType;
                                            return (
                                            <div key={item.draftKey} className="driver-completion-item">
                                                <div className="driver-completion-item-header">
                                                    <div>
                                                        <div className="driver-completion-item-title">Titik Drop {index + 1}</div>
                                                    </div>
                                                    {selectedCompletionDropPoints.length > 1 && (
                                                        <button
                                                            type="button"
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => removeCompletionDropDraft(item.draftKey)}
                                                            disabled={isActionInFlight}
                                                        >
                                                            <X size={14} /> Hapus
                                                        </button>
                                                    )}
                                                </div>
                                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.65rem', padding: '0.7rem 0.8rem', background: 'var(--color-white)', marginBottom: '0.75rem' }}>
                                                    <div className="text-muted text-sm" style={{ marginBottom: '0.35rem' }}>
                                                        Barang dialokasikan dari semua SJ yang dicentang pada batch ini.
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="btn btn-primary btn-sm"
                                                        onClick={() => {
                                                            setActiveCompletionDropKey(item.draftKey);
                                                            setActiveCompletionCargoItemRef(selectedCompletionCargoItems[0]?.deliveryOrderItemRef || '');
                                                        }}
                                                        disabled={isActionInFlight || selectedCompletionCargoItems.length === 0}
                                                    >
                                                        Tentukan Barang
                                                    </button>
                                                </div>
                                                <div style={{ display: 'grid', gap: '0.55rem', marginBottom: '0.75rem' }}>
                                                    <div className="font-semibold">Alokasi {dropTypeLabel}</div>
                                                    {selectedCompletionCargoItems.length === 0 ? (
                                                        <div className="text-muted text-sm">Belum ada barang dari SJ yang dipilih.</div>
                                                    ) : (
                                                        <>
                                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.55rem' }}>
                                                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.65rem', padding: '0.65rem 0.75rem', background: 'var(--color-white)' }}>
                                                                    <div className="text-muted text-sm">Total alokasi titik ini</div>
                                                                    <div className="font-semibold" style={{ marginTop: '0.15rem' }}>
                                                                        {summarizeCompletionDropAllocationForItems(item, selectedCompletionCargoItems)}
                                                                    </div>
                                                                </div>
                                                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.65rem', padding: '0.65rem 0.75rem', background: 'var(--color-white)' }}>
                                                                    <div className="text-muted text-sm">Total alokasi hold</div>
                                                                    <div className="font-semibold" style={{ marginTop: '0.15rem' }}>
                                                                        {item.stopType === 'HOLD'
                                                                            ? summarizeCompletionDropAllocationForItems(item, selectedCompletionCargoItems)
                                                                            : '-'}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {selectedCompletionCargoItems.map(cargoItem => {
                                                                const allocationValues = pickCompletionDropItemValues(getCompletionDropAllocationForItem(item, cargoItem));
                                                                const allocatedSummary = formatCargoSummary({
                                                                    qtyKoli: parseFormattedNumberish(allocationValues.qtyKoli || 0, { maxFractionDigits: 2 }),
                                                                    weightInputValue: allocationValues.weightInputValue,
                                                                    weightInputUnit: allocationValues.weightInputUnit,
                                                                    volumeInputValue: allocationValues.volumeInputValue,
                                                                    volumeInputUnit: allocationValues.volumeInputUnit,
                                                                });
                                                                const allocationVerb = item.stopType === 'HOLD'
                                                                    ? 'Akan di-hold di titik ini'
                                                                    : 'Akan dialokasikan di titik ini';
                                                                return (
                                                                    <div
                                                                        key={`${item.draftKey}-${cargoItem.deliveryOrderItemRef}`}
                                                                        style={{
                                                                            display: 'grid',
                                                                            gap: '0.15rem',
                                                                            padding: '0.55rem 0.65rem',
                                                                            border: '1px solid var(--color-gray-100)',
                                                                            borderRadius: '0.55rem',
                                                                            background: 'var(--color-gray-50)',
                                                                        }}
                                                                    >
                                                                        <div className="font-medium">{cargoItem.description || 'Barang'}</div>
                                                                        <div className="text-muted text-sm">No SJ: {cargoItem.shipperReferenceNumber || completionOrder.customerDoNumber || 'Tanpa SJ'}</div>
                                                                        <div className="text-muted text-sm">
                                                                            Rencana awal SJ: {formatCargoSummary({
                                                                                qtyKoli: cargoItem.plannedQtyKoli,
                                                                                weightKg: cargoItem.plannedWeightKg,
                                                                                weightInputValue: cargoItem.plannedWeightInputValue,
                                                                                weightInputUnit: cargoItem.plannedWeightInputUnit,
                                                                                volumeM3: cargoItem.plannedVolumeM3,
                                                                                volumeInputValue: cargoItem.plannedVolumeInputValue,
                                                                                volumeInputUnit: cargoItem.plannedVolumeInputUnit,
                                                                            })}
                                                                        </div>
                                                                        {completionPartialHoldItemRefs.includes(cargoItem.deliveryOrderItemRef) && (
                                                                            <div className="text-muted text-sm">
                                                                                Sisa hold saat ini: {summarizeActualCargoDraft(cargoItem)}
                                                                            </div>
                                                                        )}
                                                                        <div className="text-muted text-sm">{allocationVerb}: {allocatedSummary}</div>
                                                                        <div className="text-muted text-sm">Sisa belum dialokasikan: {summarizeCompletionRemainingUnallocatedForItem(cargoItem)}</div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </>
                                                    )}
                                                </div>
                                                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                                    <label className="form-label">Tipe Titik</label>
                                                    <select
                                                        className="form-select"
                                                        value={item.stopType}
                                                        onChange={event => updateCompletionDropDraft(item.draftKey, 'stopType', event.target.value)}
                                                        disabled={isActionInFlight}
                                                    >
                                                        <option value="DROP">Drop</option>
                                                        <option value="HOLD">Hold</option>
                                                    </select>
                                                </div>
                                                <div className="driver-completion-metrics">
                                                    {completionCustomerRecipients.length > 0 && (
                                                        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                                            <label className="form-label">Master Tujuan Customer</label>
                                                            <select
                                                                className="form-select"
                                                                value={resolveCompletionDropRecipientValue(item)}
                                                                onChange={event => applyCompletionDropRecipient(item.draftKey, event.target.value)}
                                                                disabled={isActionInFlight}
                                                            >
                                                                <option value="">Pilih tujuan customer atau isi manual</option>
                                                                {completionCustomerRecipients.map(recipient => (
                                                                    <option key={recipient._id} value={recipient._id}>
                                                                        {formatCustomerRecipientOptionLabel(recipient)}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    )}
                                                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                                        <label className="form-label">Nama Lokasi</label>
                                                        <input
                                                            className="form-input"
                                                            value={item.locationName}
                                                            onChange={event => updateCompletionDropDraft(item.draftKey, 'locationName', event.target.value)}
                                                            disabled={isActionInFlight}
                                                            placeholder="Nama tujuan aktual"
                                                        />
                                                    </div>
                                                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                                        <label className="form-label">Alamat</label>
                                                        <input
                                                            className="form-input"
                                                            value={item.locationAddress}
                                                            onChange={event => updateCompletionDropDraft(item.draftKey, 'locationAddress', event.target.value)}
                                                            disabled={isActionInFlight}
                                                            placeholder="Alamat aktual titik drop"
                                                        />
                                                    </div>
                                                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                                        <label className="form-label">Catatan</label>
                                                        <textarea
                                                            className="form-textarea"
                                                            rows={2}
                                                            value={item.note}
                                                            onChange={event => updateCompletionDropDraft(item.draftKey, 'note', event.target.value)}
                                                            disabled={isActionInFlight}
                                                            placeholder="Opsional: parsial, hold, dll."
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                                </>
                            )}
                                </>
                            )}

                            {completionMode !== 'TRIP_CLOSE' && selectedCompletionCargoItems.length > 0 && (
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem', background: 'var(--color-white)', marginTop: '1rem', display: 'grid', gap: '0.6rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                                        <div>
                                            <div className="font-semibold">Ringkasan Item</div>
                                            <div className="text-muted text-sm">
                                                {selectedCompletionCargoItems.length} item | {selectedCompletionCargoTotalSummary}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'grid', gap: '0.45rem' }}>
                                        {selectedCompletionCargoItems.map(cargoItem => (
                                            <div
                                                key={`completion-item-summary-${cargoItem.deliveryOrderItemRef}`}
                                                style={{
                                                    display: 'grid',
                                                    gap: '0.18rem',
                                                    padding: '0.6rem 0.7rem',
                                                    border: '1px solid var(--color-gray-100)',
                                                    borderRadius: '0.6rem',
                                                    background: 'var(--color-gray-50)',
                                                }}
                                            >
                                                <div className="font-medium">{cargoItem.description || 'Barang'}</div>
                                                <div className="text-muted text-sm">No SJ: {cargoItem.shipperReferenceNumber || completionOrder.customerDoNumber || 'Tanpa SJ'}</div>
                                                {completionTargetStatus === 'DELIVERED' && (
                                                    <>
                                                        <div className="text-muted text-sm">Alokasi drop: {completionStep === 'ACTUAL' ? summarizeActualCargoDraft(cargoItem) : summarizeCompletionDropAllocationsForItemByType(cargoItem, ['DROP', 'EXTRA_DROP'])}</div>
                                                        <div className="text-muted text-sm">Alokasi hold: {summarizeActualStepDropPointsForItemByType(cargoItem, ['HOLD'])}</div>
                                                    </>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="form-group" style={{ marginTop: '1rem' }}>
                                <label className="form-label">Catatan Driver</label>
                                <textarea
                                    className="form-textarea"
                                    rows={3}
                                    value={completionNote}
                                    onChange={event => setCompletionNote(event.target.value)}
                                    disabled={isActionInFlight}
                                    placeholder="Mis. berat aktual berubah setelah bongkar atau ada selisih koli."
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            {completionTargetStatus === 'DELIVERED' && completionStep === 'ACTUAL' && (
                                <button
                                    className="btn btn-secondary"
                                    onClick={returnToCompletionDropSetup}
                                    disabled={isActionInFlight}
                                >
                                    Kembali ke Titik Drop
                                </button>
                            )}
                            {!(completionTargetStatus === 'DELIVERED' && completionStep === 'ACTUAL') && (
                                <button className="btn btn-secondary" onClick={closeDeliveredRequestModal} disabled={isActionInFlight}>
                                    Batal
                                </button>
                            )}
                            <button
                                className="btn btn-success"
                                onClick={() => {
                                    if (completionMode !== 'TRIP_CLOSE' && completionTargetStatus === 'DELIVERED' && completionStep === 'SETUP') {
                                        continueToCompletionActualCargo();
                                        return;
                                    }
                                    void submitDeliveredRequest();
                                }}
                                disabled={
                                    isActionInFlight ||
                                    (completionMode !== 'TRIP_CLOSE' && !completionTargetStatus) ||
                                    selectedCompletionSjRefs.length === 0 ||
                                    (
                                        completionMode === 'TRIP_CLOSE'
                                            ? (
                                                completionOdometerKm <= 0 ||
                                                completionOdometerTooLow
                                            )
                                            : completionTargetStatus === 'DELIVERED' &&
                                        (completionStep === 'SETUP'
                                            ? (
                                                !completionPodReceiverName.trim() ||
                                                !completionPodReceivedDate ||
                                                selectedCompletionCargoItems.length === 0 ||
                                                !completionDetailState.actualDropReady
                                            )
                                            : (
                                                selectedCompletionCargoItems.length === 0 ||
                                                !completionCargoReady
                                            ))
                                    )
                                }
                            >
                                <Truck size={15} /> {actionLoadingId === completionOrder._id
                                    ? 'Mengirim...'
                                    : completionMode === 'TRIP_CLOSE'
                                        ? `Ajukan Tutup Trip (${completionOdometerKm.toLocaleString('id-ID')} km)`
                                    : !completionTargetStatus
                                        ? 'Pilih Status'
                                    : completionTargetStatus !== 'DELIVERED'
                                        ? 'Simpan Batch SJ'
                                        : completionStep === 'SETUP'
                                            ? 'Lanjut Aktual Barang'
                                            : 'Kirim Finalisasi Batch SJ'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDeliveredRequestModal && completionOrder && activeCompletionDrop && (
                <div className="modal-overlay" onClick={() => { if (!isActionInFlight) setActiveCompletionDropKey(''); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">Tentukan Barang Titik Drop</h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>
                                    {activeCompletionDrop.locationName || activeCompletionDrop.locationAddress || 'Titik Drop'} | {selectedCompletionCargoItems.length} item dalam batch SJ
                                </div>
                            </div>
                            <button className="modal-close" onClick={() => setActiveCompletionDropKey('')} disabled={isActionInFlight}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">Alokasi titik ini</div>
                                    <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>{activeCompletionDropAllocationSummary || '-'}</div>
                                </div>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">Realisasi drop</div>
                                    <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>{selectedCompletionDropModeLabel}</div>
                                    <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>
                                        {activeCompletionDropAllocationSummary || '-'}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', borderBottom: '1px solid var(--color-gray-200)', marginBottom: '1rem', paddingBottom: '0.5rem' }}>
                                {selectedCompletionCargoItems.map((item, index) => {
                                    const isActive = activeCompletionDropCargoItem?.deliveryOrderItemRef === item.deliveryOrderItemRef;
                                    const allocationValues = pickCompletionDropItemValues(getCompletionDropAllocationForItem(activeCompletionDrop, item));
                                    const hasValues = hasCompletionDropItemValues(allocationValues);
                                    const valueSummary = formatCargoSummary({
                                        qtyKoli: parseFormattedNumberish(allocationValues.qtyKoli || 0, { maxFractionDigits: 2 }),
                                        weightInputValue: allocationValues.weightInputValue,
                                        weightInputUnit: allocationValues.weightInputUnit,
                                        volumeInputValue: allocationValues.volumeInputValue,
                                        volumeInputUnit: allocationValues.volumeInputUnit,
                                    });
                                    return (
                                        <button
                                            key={item.deliveryOrderItemRef}
                                            type="button"
                                            className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => setActiveCompletionCargoItemRef(item.deliveryOrderItemRef)}
                                            disabled={isActionInFlight}
                                            title={`${item.shipperReferenceNumber || completionOrder.customerDoNumber || 'Tanpa SJ'} | ${item.description} | ${hasValues ? valueSummary : 'Belum diisi'}`}
                                            style={{
                                                alignItems: 'flex-start',
                                                display: 'grid',
                                                gap: '0.15rem',
                                                minWidth: 150,
                                                textAlign: 'left',
                                                whiteSpace: 'normal',
                                            }}
                                        >
                                            <span>Item {index + 1}</span>
                                            <span style={{ fontSize: '0.72rem', fontWeight: 500, opacity: 0.85 }}>
                                                {hasValues ? valueSummary : 'Belum diisi'}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>

                            {activeCompletionDropCargoItem ? (
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                    {(() => {
                                        const allocation = getCompletionDropAllocationForItem(activeCompletionDrop, activeCompletionDropCargoItem);
                                        const allocationSummary = formatCargoSummary({
                                            qtyKoli: parseFormattedNumberish(allocation.qtyKoli || 0, { maxFractionDigits: 2 }),
                                            weightInputValue: allocation.weightInputValue,
                                            weightInputUnit: allocation.weightInputUnit,
                                            volumeInputValue: allocation.volumeInputValue,
                                            volumeInputUnit: allocation.volumeInputUnit,
                                        });
                                        return (
                                            <>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                                    <div>
                                                        <div className="text-muted text-sm">{activeCompletionDropCargoItem.shipperReferenceNumber || completionOrder.customerDoNumber || 'Tanpa SJ'}</div>
                                                        <div style={{ fontWeight: 700, marginTop: '0.2rem' }}>{activeCompletionDropCargoItem.description}</div>
                                                    </div>
                                                    <div className="text-muted text-sm" style={{ display: 'grid', gap: '0.15rem', textAlign: 'right' }}>
                                                        <div>
                                                            Rencana: {formatCargoSummary({
                                                                qtyKoli: activeCompletionDropCargoItem.plannedQtyKoli,
                                                                weightKg: activeCompletionDropCargoItem.plannedWeightKg,
                                                                weightInputValue: activeCompletionDropCargoItem.plannedWeightInputValue,
                                                                weightInputUnit: activeCompletionDropCargoItem.plannedWeightInputUnit,
                                                                volumeM3: activeCompletionDropCargoItem.plannedVolumeM3,
                                                                volumeInputValue: activeCompletionDropCargoItem.plannedVolumeInputValue,
                                                                volumeInputUnit: activeCompletionDropCargoItem.plannedVolumeInputUnit,
                                                            })}
                                                        </div>
                                                        <div>Alokasi titik ini: {allocationSummary}</div>
                                                    </div>
                                                </div>
                                                {!activeCompletionDropCargoItem.requireQty && (
                                                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                                                        Item ini tidak memakai basis koli. Isi alokasi berat dan/atau volume aktual lapangan.
                                                    </div>
                                                )}
                                                <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.85rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                                    Isi alokasi barang untuk titik <strong>{activeCompletionDrop.locationName || activeCompletionDrop.locationAddress || 'ini'}</strong>. Nilai ini hanya rencana pembagian DROP atau HOLD dan masih bisa diubah sebelum finalisasi dikirim.
                                                </div>
                                                <div className="form-row">
                                                    <div className="form-group">
                                                        <label className="form-label">Koli Alokasi {activeCompletionDropCargoItem.requireQty && <span className="required">*</span>}</label>
                                                        <FormattedNumberInput
                                                            min={0}
                                                            maxFractionDigits={2}
                                                            value={parseFormattedNumberish(allocation.qtyKoli || 0, { maxFractionDigits: 2 })}
                                                            onValueChange={value => updateCompletionDropAllocationForItem(activeCompletionDrop, activeCompletionDropCargoItem, 'qtyKoli', String(value))}
                                                            disabled={isActionInFlight || !activeCompletionDropCargoItem.requireQty}
                                                        />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Berat Alokasi {activeCompletionDropCargoItem.requireWeight && <span className="required">*</span>}</label>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                            <FormattedNumberInput
                                                                min={0}
                                                                maxFractionDigits={getWeightInputFractionDigits(allocation.weightInputUnit)}
                                                                value={parseFormattedNumberish(allocation.weightInputValue || 0, {
                                                                    maxFractionDigits: getWeightInputFractionDigits(allocation.weightInputUnit),
                                                                })}
                                                                onValueChange={value => updateCompletionDropAllocationForItem(activeCompletionDrop, activeCompletionDropCargoItem, 'weightInputValue', String(value))}
                                                                disabled
                                                            />
                                                            <select
                                                                className="form-select"
                                                                value={allocation.weightInputUnit}
                                                                onChange={event => updateCompletionDropAllocationForItem(activeCompletionDrop, activeCompletionDropCargoItem, 'weightInputUnit', event.target.value)}
                                                                disabled
                                                            >
                                                                {WEIGHT_INPUT_UNIT_OPTIONS.map(option => (
                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="form-row">
                                                    <div className="form-group">
                                                        <label className="form-label">Volume Alokasi {activeCompletionDropCargoItem.requireVolume && <span className="required">*</span>}</label>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                            <FormattedNumberInput
                                                                min={0}
                                                                maxFractionDigits={allocation.volumeInputUnit === 'LITER' ? 0 : 3}
                                                                value={parseFormattedNumberish(allocation.volumeInputValue || 0, {
                                                                    maxFractionDigits: allocation.volumeInputUnit === 'LITER' ? 0 : 3,
                                                                })}
                                                                onValueChange={value => updateCompletionDropAllocationForItem(activeCompletionDrop, activeCompletionDropCargoItem, 'volumeInputValue', String(value))}
                                                                disabled={isActionInFlight}
                                                            />
                                                            <select
                                                                className="form-select"
                                                                value={allocation.volumeInputUnit}
                                                                onChange={event => updateCompletionDropAllocationForItem(activeCompletionDrop, activeCompletionDropCargoItem, 'volumeInputUnit', event.target.value)}
                                                                disabled={isActionInFlight}
                                                            >
                                                                {VOLUME_INPUT_UNIT_OPTIONS.map(option => (
                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            ) : (
                                <div className="driver-completion-empty">Pilih item barang untuk titik drop ini.</div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setActiveCompletionDropKey('')} disabled={isActionInFlight}>
                                Kembali ke Titik Drop
                            </button>
                            <button className="btn btn-primary" onClick={() => setActiveCompletionDropKey('')} disabled={isActionInFlight}>
                                Simpan Alokasi Barang
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
