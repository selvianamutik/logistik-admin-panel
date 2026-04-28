'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useApp, useToast } from '../layout';
import { Printer, FileDown, Truck, Upload, Save, MapPin, Radio, Edit, Wallet, Plus, Trash2, X } from 'lucide-react';
import CollapsibleCard from '@/components/CollapsibleCard';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { parseFormattedNumberish } from '@/lib/formatted-number';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData, fetchAdminData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import {
    buildDeliveryOrderDetailState,
    buildDeliveryOrderPrintHtml,
    buildActualCargoDrafts,
    buildTripResourceBusyIds,
    buildDeliveryOrderPodUpdateData,
    buildDeliveryOrderTripFeeUpdateData,
    buildResolvedDeliveryOrder,
    buildDefaultActualDropDrafts,
    createEmptyActualDropDraft,
    applyActualCargoAutoWeightFromQty,
    applyActualDropAutoWeightFromQty,
    getActualCargoDraftsForDrop,
    getAssignableTripDrivers,
    getAssignableTripVehicles,
    getNextDeliveryOrderStatuses,
    getTripResourceActionLabel,
    summarizeActualCargoDraftDescriptions,
    summarizeDeliveryOrderItemDescriptionsForDrop,
    shouldRequireTripVehicleOverrideReason,
    shouldOpenAdvancedDropEditor,
    shouldLockActualDropWeight,
    shouldLockActualCargoWeight,
    sortTrackingLogs,
    updateActualCargoDraftVolumeUnit,
    type ActualCargoDraft,
    type ActualDropDraft,
} from '@/lib/delivery-order-detail-support';
import {
    deriveDeliveryOrderCompletionOutcome,
    getDeliveryOrderBillableCargoSummary,
    getDeliveryOrderDisplayStatusMeta,
    getDeliveryOrderHoldCargoSummary,
    getDeliveryOrderReturnCargoSummary,
    isDeliveryOrderBillableDropType,
    isDeliveryOrderHoldDropType,
    isDeliveryOrderReturnDropType,
} from '@/lib/delivery-order-completion';
import { fetchCompanyProfile, openBrandedPrint, openPrintWindow, resolveDocumentIssuerProfile } from '@/lib/print';
import {
    DO_ACTUAL_DROP_TYPE_MAP,
    DO_STATUS_MAP,
    formatCurrency,
    formatDate,
    formatDateTime,
    formatInternalDeliveryOrderNumber,
    formatShipperDeliveryOrderNumber,
    getDriverVoucherFinancialSummary,
} from '@/lib/utils';
import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
    formatCargoSummary,
    formatWeightDisplay,
    VOLUME_INPUT_UNIT_OPTIONS,
    WEIGHT_INPUT_UNIT_OPTIONS,
} from '@/lib/measurement';
import {
    createDefaultDeliveryOrderCargoDraftItem,
    createDefaultDeliveryOrderCargoDraftGroup,
    flattenDeliveryOrderCargoDraftGroups,
    getDraftDeliveryOrderCargoGroups,
    getDeliveryOrderCargoDraftItems,
    toDeliveryOrderCargoDraftItem,
    type DeliveryOrderCargoDraftGroup,
    type DeliveryOrderCargoDraftItem,
} from '@/lib/delivery-order-cargo-draft-support';
import { applyCustomerProductToOrderItem, applyOrderItemAutoWeightFromQty, shouldLockOrderItemWeight, summarizeDraftOrderCargo, updateOrderItemVolumeUnit, updateOrderItemWeightUnit } from '@/lib/order-create-page-support';
import { generateDOPdf } from '@/lib/pdf/doTemplate';
import { hasPageAccess, hasPermission, normalizeUserRole } from '@/lib/rbac';
import { buildTripRateAreaOptions, findMatchingTripRouteRate, formatTripRouteRateLabel } from '@/lib/trip-route-rate-support';
import type { SuratJalanDocument, Trip, TripCashLinkSummary, TripDetailReferencesSnapshot, TripDetailSnapshot, TripTrackingEvent } from '@/lib/trip-document-types';
import type { Customer, CustomerProduct, CustomerRecipient, DeliveryOrder, DeliveryOrderItem, CompanyProfile, OrderItem, Driver, DriverVoucher, TripRouteRate, Vehicle } from '@/lib/types';

const BATCH_SURAT_JALAN_STATUS_OPTIONS = ['HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED', 'CANCELLED'] as const;

type ShipperReferenceDraft = {
    draftKey: string;
    referenceKey: string;
    referenceNumber: string;
    pickupStopKey: string;
    selectedRecipientId: string;
    billingCustomerRef: string;
    billingCustomerName: string;
    receiverName: string;
    receiverPhone: string;
    receiverAddress: string;
    receiverCompany: string;
};

type ExistingShipperReferenceItemDraft = DeliveryOrderCargoDraftItem & {
    deliveryOrderItemId: string;
};

type ActualDropItemValueDraft = Pick<
    ActualDropDraft,
    'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit'
>;

type ActualCargoItemValueDraft = Pick<
    ActualCargoDraft,
    'actualQtyKoli' | 'actualWeightInputValue' | 'actualWeightInputUnit' | 'actualVolumeInputValue' | 'actualVolumeInputUnit'
>;

type ResolvedShipperReferenceEntry = {
    draftKey: string;
    referenceKey: string;
    referenceNumber: string;
    pickupStopKey: string;
    pickupLabel: string;
    pickupAddress: string;
    billingCustomerRef: string;
    billingCustomerName: string;
    receiverName: string;
    receiverPhone: string;
    receiverAddress: string;
    receiverCompany: string;
};

const ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR = '::item::';

function buildActualDropItemValueKey(draftKey: string, deliveryOrderItemRef: string) {
    return `${draftKey}${ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR}${deliveryOrderItemRef}`;
}

function parseActualDropItemValueKey(valueKey: string) {
    const separatorIndex = valueKey.indexOf(ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR);
    if (separatorIndex < 0) {
        return null;
    }
    return {
        draftKey: valueKey.slice(0, separatorIndex),
        deliveryOrderItemRef: valueKey.slice(separatorIndex + ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR.length),
    };
}

function pickActualDropItemValues(drop: ActualDropDraft): ActualDropItemValueDraft {
    return {
        qtyKoli: drop.qtyKoli,
        weightInputValue: drop.weightInputValue,
        weightInputUnit: drop.weightInputUnit,
        volumeInputValue: drop.volumeInputValue,
        volumeInputUnit: drop.volumeInputUnit,
    };
}

function buildResolvedShipperReferenceEntries(
    deliveryOrder: DeliveryOrder | null,
    doItems: DeliveryOrderItem[]
): ResolvedShipperReferenceEntry[] {
    if (!deliveryOrder) {
        return [];
    }

    const pickupStops = (deliveryOrder.pickupStops || [])
        .map((pickupStop, index) => ({
            _key: pickupStop._key || `pickup-stop-${index + 1}`,
            sequence: pickupStop.sequence || index + 1,
            pickupLabel: pickupStop.pickupLabel || '',
            pickupAddress: pickupStop.pickupAddress || '',
        }))
        .sort((left, right) => left.sequence - right.sequence);
    const pickupStopMap = new Map(pickupStops.map(stop => [stop._key, stop]));
    const entries = new Map<string, ResolvedShipperReferenceEntry>();
    const compositeIndex = new Map<string, string>();

    const upsertEntry = (
        referenceNumber: string,
        pickupStopKey = '',
        pickupAddress = '',
        draftKeyHint = '',
        referenceKeyHint = ''
    ) => {
        const normalizedReference = referenceNumber.trim();
        if (!normalizedReference) {
            return;
        }
        const matchedStop = pickupStopKey ? pickupStopMap.get(pickupStopKey) : null;
        const resolvedPickupLabel = matchedStop
            ? `Pickup ${matchedStop.sequence}${matchedStop.pickupLabel ? ` - ${matchedStop.pickupLabel}` : ''}`
            : '';
        const resolvedPickupAddress = matchedStop?.pickupAddress || pickupAddress || '';
        const compositeKey = `${pickupStopKey || 'tanpa-pickup'}::${normalizedReference}`;
        const resolvedEntryKey =
            (referenceKeyHint && entries.has(referenceKeyHint) && referenceKeyHint)
            || (draftKeyHint && entries.has(draftKeyHint) && draftKeyHint)
            || compositeIndex.get(compositeKey)
            || referenceKeyHint
            || draftKeyHint
            || compositeKey;
        if (entries.has(resolvedEntryKey)) {
            const current = entries.get(resolvedEntryKey)!;
            entries.set(resolvedEntryKey, {
                ...current,
                draftKey: current.draftKey || resolvedEntryKey,
                referenceKey: current.referenceKey || referenceKeyHint,
                referenceNumber: current.referenceNumber || normalizedReference,
                pickupStopKey: current.pickupStopKey || pickupStopKey,
                pickupLabel: current.pickupLabel || resolvedPickupLabel,
                pickupAddress: current.pickupAddress || resolvedPickupAddress,
            });
            compositeIndex.set(compositeKey, resolvedEntryKey);
            return;
        }
        entries.set(resolvedEntryKey, {
            draftKey: draftKeyHint || resolvedEntryKey,
            referenceKey: referenceKeyHint,
            referenceNumber: normalizedReference,
            pickupStopKey,
            pickupLabel: resolvedPickupLabel,
            pickupAddress: resolvedPickupAddress,
            billingCustomerRef: '',
            billingCustomerName: '',
            receiverName: '',
            receiverPhone: '',
            receiverAddress: '',
            receiverCompany: '',
        });
        compositeIndex.set(compositeKey, resolvedEntryKey);
    };

    (deliveryOrder.shipperReferences || []).forEach((reference, index) => {
        upsertEntry(
            reference.referenceNumber || '',
            reference.pickupStopKey || '',
            reference.pickupAddress || '',
            reference._key || `shipper-reference-${index + 1}`,
            reference._key || ''
        );
        const entryKey =
            reference._key
            || compositeIndex.get(`${reference.pickupStopKey || 'tanpa-pickup'}::${(reference.referenceNumber || '').trim()}`)
            || `${reference.pickupStopKey || 'tanpa-pickup'}::${(reference.referenceNumber || '').trim()}`;
        const current = entries.get(entryKey);
        if (current) {
            entries.set(entryKey, {
                ...current,
                referenceKey: reference._key || current.referenceKey,
                billingCustomerRef: reference.billingCustomerRef || current.billingCustomerRef,
                billingCustomerName: reference.billingCustomerName || current.billingCustomerName,
                receiverName: reference.receiverName || current.receiverName,
                receiverPhone: reference.receiverPhone || current.receiverPhone,
                receiverAddress: reference.receiverAddress || current.receiverAddress,
                receiverCompany: reference.receiverCompany || current.receiverCompany,
            });
        }
    });

    doItems.forEach(item => {
        upsertEntry(
            item.shipperReferenceNumber || '',
            item.pickupStopKey || '',
            item.pickupAddress || '',
            item.shipperReferenceKey || `delivery-order-item-${item._id}`,
            item.shipperReferenceKey || ''
        );
    });

    if (entries.size === 0 && deliveryOrder.customerDoNumber?.trim()) {
        upsertEntry(
            deliveryOrder.customerDoNumber,
            deliveryOrder.pickupStops?.[0]?._key || '',
            deliveryOrder.pickupAddress || '',
            'legacy-customer-do-number',
            ''
        );
    }

    return [...entries.values()];
}

function matchesShipperReferenceDraft(
    draft: Pick<ShipperReferenceDraft, 'referenceKey' | 'referenceNumber'>,
    deliveryOrder: DeliveryOrder | null,
    item: Pick<DeliveryOrderItem, 'shipperReferenceKey' | 'shipperReferenceNumber'>
) {
    const itemReferenceKey = (item.shipperReferenceKey || '').trim();
    const itemReferenceNumber = (item.shipperReferenceNumber || deliveryOrder?.customerDoNumber || '').trim().toUpperCase();
    const selectedReferenceKey = draft.referenceKey.trim();
    const selectedReferenceNumber = draft.referenceNumber.trim().toUpperCase();
    return (
        (selectedReferenceKey && itemReferenceKey === selectedReferenceKey) ||
        (selectedReferenceNumber && itemReferenceNumber === selectedReferenceNumber)
    );
}

export default function TripDetailPage() {
    const params = useParams();
    const pathname = usePathname();
    const { addToast } = useToast();
    const { user } = useApp();
    const doId = params.id as string;
    const [tripData, setTripData] = useState<Trip | null>(null);
    const [doData, setDoData] = useState<DeliveryOrder | null>(null);
    const [doItems, setDoItems] = useState<DeliveryOrderItem[]>([]);
    const [suratJalanDocuments, setSuratJalanDocuments] = useState<SuratJalanDocument[]>([]);
    const [trackingLogs, setTrackingLogs] = useState<TripTrackingEvent[]>([]);
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [billingCustomers, setBillingCustomers] = useState<Array<Pick<Customer, '_id' | 'name' | 'active'>>>([]);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    const [customerRecipients, setCustomerRecipients] = useState<CustomerRecipient[]>([]);
    const [activeTrips, setActiveTrips] = useState<Trip[]>([]);
    const [loading, setLoading] = useState(true);
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [showPODModal, setShowPODModal] = useState(false);
    const [showRejectRequestModal, setShowRejectRequestModal] = useState(false);
    const [showTripResourcesModal, setShowTripResourcesModal] = useState(false);
    const [showShipperReferenceModal, setShowShipperReferenceModal] = useState(false);
    const [showTargetModal, setShowTargetModal] = useState(false);
    const [showCargoModal, setShowCargoModal] = useState(false);
    const [newStatus, setNewStatus] = useState('');
    const [selectedStatusSuratJalanRefs, setSelectedStatusSuratJalanRefs] = useState<string[]>([]);
    const [statusNote, setStatusNote] = useState('');
    const [reviewingDriverRequest, setReviewingDriverRequest] = useState(false);
    const [rejectRequestNote, setRejectRequestNote] = useState('');
    const [podName, setPodName] = useState('');
    const [podDate, setPodDate] = useState(getBusinessDateValue());
    const [podNote, setPodNote] = useState('');
    const [suratJalanStatusFilter, setSuratJalanStatusFilter] = useState('');
    const [actualCargoItems, setActualCargoItems] = useState<ActualCargoDraft[]>([]);
    const [actualCargoItemValueMap, setActualCargoItemValueMap] = useState<Record<string, ActualCargoItemValueDraft>>({});
    const [actualDropPoints, setActualDropPoints] = useState<ActualDropDraft[]>([]);
    const [actualDropItemValueMap, setActualDropItemValueMap] = useState<Record<string, ActualDropItemValueDraft>>({});
    const [partialHoldContinuationItemRefs, setPartialHoldContinuationItemRefs] = useState<string[]>([]);
    const [showAdvancedDropEditor, setShowAdvancedDropEditor] = useState(false);
    const [editingTarip, setEditingTarip] = useState(false);
    const [taripBorongan, setTaripBorongan] = useState<number>(0);
    const [keteranganBorongan, setKeteranganBorongan] = useState('');
    const [tripRouteRates, setTripRouteRates] = useState<TripRouteRate[]>([]);
    const [tripRouteRateRef, setTripRouteRateRef] = useState('');
    const [tripOriginArea, setTripOriginArea] = useState('');
    const [tripDestinationArea, setTripDestinationArea] = useState('');
    const [linkedVoucher, setLinkedVoucher] = useState<DriverVoucher | null>(null);
    const [linkedTripCashLink, setLinkedTripCashLink] = useState<TripCashLinkSummary | null>(null);
    const [linkedVoucherBonNumber, setLinkedVoucherBonNumber] = useState('');
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [savingPOD, setSavingPOD] = useState(false);
    const [savingTarip, setSavingTarip] = useState(false);
    const [rejectingRequest, setRejectingRequest] = useState(false);
    const [loadingTripResources, setLoadingTripResources] = useState(false);
    const [savingTripResources, setSavingTripResources] = useState(false);
    const [savingShipperReference, setSavingShipperReference] = useState(false);
    const [savingTarget, setSavingTarget] = useState(false);
    const [savingCargo, setSavingCargo] = useState(false);
    const [togglingTripClosure, setTogglingTripClosure] = useState(false);
    const [removingCargoItemId, setRemovingCargoItemId] = useState<string | null>(null);
    const [deletingShipperReferenceKey, setDeletingShipperReferenceKey] = useState<string | null>(null);
    const [pendingDeleteAction, setPendingDeleteAction] = useState<
        | { type: 'cargo-item'; deliveryOrderItemId: string; itemLabel: string }
        | { type: 'shipper-reference'; reference: ResolvedShipperReferenceEntry; itemCount: number }
        | null
    >(null);
    const [editingCargoItemId, setEditingCargoItemId] = useState<string | null>(null);
    const [editableCargoItemMap, setEditableCargoItemMap] = useState<Record<string, boolean>>({});
    const [linkedOrderItemDetailMap, setLinkedOrderItemDetailMap] = useState<Record<string, Pick<OrderItem, '_id' | 'entrySource' | 'sourceDeliveryOrderRef' | 'customerProductRef'> | undefined>>({});
    const [tripVehicleRef, setTripVehicleRef] = useState('');
    const [tripDriverRef, setTripDriverRef] = useState('');
    const [tripVehicleOverrideReason, setTripVehicleOverrideReason] = useState('');
    const [shipperReferenceDrafts, setShipperReferenceDrafts] = useState<ShipperReferenceDraft[]>([{
        draftKey: crypto.randomUUID(),
        referenceKey: '',
        referenceNumber: '',
        pickupStopKey: '',
        selectedRecipientId: '',
        billingCustomerRef: '',
        billingCustomerName: '',
        receiverName: '',
        receiverPhone: '',
        receiverAddress: '',
        receiverCompany: '',
    }]);
    const [shipperReferenceModalMode, setShipperReferenceModalMode] = useState<'edit' | 'create'>('edit');
    const [selectedShipperReferenceDraftKey, setSelectedShipperReferenceDraftKey] = useState('');
    const [shipperReferenceItemDraftMap, setShipperReferenceItemDraftMap] = useState<Record<string, DeliveryOrderCargoDraftItem[]>>({});
    const [shipperReferenceExistingItemDraftMap, setShipperReferenceExistingItemDraftMap] = useState<Record<string, ExistingShipperReferenceItemDraft[]>>({});
    const [shipperReferenceFormat, setShipperReferenceFormat] = useState('SJ');
    const [cargoDraftGroups, setCargoDraftGroups] = useState<DeliveryOrderCargoDraftGroup[]>([createDefaultDeliveryOrderCargoDraftGroup()]);
    const [targetReceiverName, setTargetReceiverName] = useState('');
    const [targetReceiverPhone, setTargetReceiverPhone] = useState('');
    const [targetReceiverAddress, setTargetReceiverAddress] = useState('');
    const [targetReceiverCompany, setTargetReceiverCompany] = useState('');
    const [selectedTargetRecipientId, setSelectedTargetRecipientId] = useState('');
    const editingTaripRef = useRef(false);
    const loadedReferenceCustomerRef = useRef<string>('');
    const normalizedRole = user ? normalizeUserRole(user.role) : null;
    const canManageDeliveryStatus = user ? hasPermission(user.role, 'deliveryOrders', 'update') : false;
    const canExportDeliveryOrder = user ? hasPermission(user.role, 'deliveryOrders', 'export') : false;
    const canPrintDeliveryOrder = user ? hasPermission(user.role, 'deliveryOrders', 'print') : false;
    const canOpenCustomerPage = user ? hasPageAccess(user.role, 'customers') : false;
    const canOpenSourceOrderPage = user ? hasPageAccess(user.role, 'orders') : false;
    const canOpenDriverPage = user ? hasPageAccess(user.role, 'drivers') : false;
    const canOpenVehiclePage = user ? hasPageAccess(user.role, 'vehicles') : false;
    const canViewTripCash = user ? hasPermission(user.role, 'driverVouchers', 'view') : false;
    const canCreateTripCash = user ? hasPermission(user.role, 'driverVouchers', 'create') : false;
    const canOpenTripCashPage = user ? hasPageAccess(user.role, 'driverVouchers') : false;
    const canAssignTripResources = normalizedRole === 'OWNER' || normalizedRole === 'OPERASIONAL' || normalizedRole === 'ARMADA';
    const canEditShipperReference = normalizedRole === 'OWNER' || normalizedRole === 'OPERASIONAL' || normalizedRole === 'FINANCE';
    const canEditDeliveryCargo = normalizedRole === 'OWNER' || normalizedRole === 'OPERASIONAL' || normalizedRole === 'ARMADA';
    const canEditDeliveryTarget = normalizedRole === 'OWNER' || normalizedRole === 'OPERASIONAL' || normalizedRole === 'FINANCE';
    const canReviewDriverRequest = canManageDeliveryStatus;
    const canManageTripFee = canManageDeliveryStatus;
    const currentPath = pathname || `/delivery-orders/${doId}`;
    const withReturnTo = (href: string) => `${href}${href.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(currentPath)}`;
    const getDefaultPodName = useCallback(() => {
        return doData?.podReceiverName?.trim()
            || doData?.receiverName?.trim()
            || doData?.receiverCompany?.trim()
            || '';
    }, [doData?.podReceiverName, doData?.receiverName, doData?.receiverCompany]);
    const getDefaultPodDate = useCallback(() => {
        const rawDate = doData?.podReceivedDate?.trim() || '';
        return rawDate ? rawDate.slice(0, 10) : getBusinessDateValue();
    }, [doData?.podReceivedDate]);
    const getDefaultPodNote = useCallback(() => doData?.podNote || '', [doData?.podNote]);
    const hasOpenModal =
        showStatusModal ||
        showPODModal ||
        showRejectRequestModal ||
        showTripResourcesModal ||
        showShipperReferenceModal ||
        showTargetModal ||
        showCargoModal;
    const tripOriginAreaOptions = buildTripRateAreaOptions(tripRouteRates, 'originArea', {
        serviceRef: doData?.serviceRef,
    });
    const tripDestinationAreaOptions = buildTripRateAreaOptions(tripRouteRates, 'destinationArea', {
        originArea: tripOriginArea,
        serviceRef: doData?.serviceRef,
    });
    const matchedTripRouteRate = findMatchingTripRouteRate(tripRouteRates, {
        originArea: tripOriginArea,
        destinationArea: tripDestinationArea,
        serviceRef: doData?.serviceRef,
    });
    const isTripFeeLockedToMaster = Boolean(matchedTripRouteRate);

    const applyTripRouteSelection = (nextOriginArea: string, nextDestinationArea: string) => {
        setTripOriginArea(nextOriginArea);
        setTripDestinationArea(nextDestinationArea);

        const nextMatchedRate = findMatchingTripRouteRate(tripRouteRates, {
            originArea: nextOriginArea,
            destinationArea: nextDestinationArea,
            serviceRef: doData?.serviceRef,
        });
        setTripRouteRateRef(nextMatchedRate?._id || '');
        if (nextMatchedRate) {
            setTaripBorongan(nextMatchedRate.rate || 0);
        } else {
            setTaripBorongan(0);
        }
    };

    const handleTripOriginAreaChange = (nextOriginArea: string) => {
        const nextDestinationOptions = buildTripRateAreaOptions(tripRouteRates, 'destinationArea', {
            originArea: nextOriginArea,
            serviceRef: doData?.serviceRef,
        });
        const preservedDestination =
            nextOriginArea && nextDestinationOptions.includes(tripDestinationArea)
                ? tripDestinationArea
                : '';
        applyTripRouteSelection(nextOriginArea, preservedDestination);
    };

    const handleTripDestinationAreaChange = (nextDestinationArea: string) => {
        applyTripRouteSelection(tripOriginArea, nextDestinationArea);
    };

    useEffect(() => {
        editingTaripRef.current = editingTarip;
    }, [editingTarip]);

    useEffect(() => {
        if (!hasOpenModal) {
            return;
        }

        const previousBodyOverflow = document.body.style.overflow;
        const previousHtmlOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previousBodyOverflow;
            document.documentElement.style.overflow = previousHtmlOverflow;
        };
    }, [hasOpenModal]);

    useEffect(() => {
        if (!showStatusModal || !reviewingDriverRequest || newStatus !== 'DELIVERED') {
            return;
        }
        if (!doData?.pendingDriverActualDropPoints?.length) {
            return;
        }

        const syncedDropDrafts = buildDefaultActualDropDrafts(
            doData,
            actualCargoItems,
            doData.pendingDriverActualDropPoints
        );
        const shouldUseAdvancedDropEditor = shouldOpenAdvancedDropEditor(doData, syncedDropDrafts);
        const nextSyncedDropDrafts = shouldUseAdvancedDropEditor
            ? expandActualDropDraftsBySelectedItems(syncedDropDrafts, actualCargoItems)
            : syncedDropDrafts;

        setActualDropPoints(current => {
            if (current.length === nextSyncedDropDrafts.length) {
                const isSame = current.every((item, index) => {
                    const nextItem = nextSyncedDropDrafts[index];
                    return nextItem
                        && item.stopType === nextItem.stopType
                        && item.locationName === nextItem.locationName
                        && item.locationAddress === nextItem.locationAddress
                        && item.qtyKoli === nextItem.qtyKoli
                        && item.weightInputValue === nextItem.weightInputValue
                        && item.weightInputUnit === nextItem.weightInputUnit
                        && item.volumeInputValue === nextItem.volumeInputValue
                        && item.volumeInputUnit === nextItem.volumeInputUnit
                        && item.note === nextItem.note;
                });
                if (isSame) {
                    return current;
                }
            }
            return nextSyncedDropDrafts;
        });
        setShowAdvancedDropEditor(shouldUseAdvancedDropEditor);
    }, [
        actualCargoItems,
        doData,
        newStatus,
        reviewingDriverRequest,
        showStatusModal,
    ]);

    const hydrateDeliveryOrderItemsState = useCallback(async (deliveryOrderItems: DeliveryOrderItem[]) => {
        const linkedOrderItemRefs = Array.from(
            new Set(
                deliveryOrderItems
                    .map(item => item.orderItemRef)
                    .filter((value): value is string => Boolean(value))
            )
        );
        const linkedOrderItems = linkedOrderItemRefs.length > 0
            ? await fetchAllAdminCollectionData<Pick<OrderItem, '_id' | 'entrySource' | 'sourceDeliveryOrderRef' | 'customerProductRef'>>(
                `/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ _id: linkedOrderItemRefs }))}`,
                'Gagal memuat detail trip'
            )
            : [];
        const linkedOrderItemMap = new Map(
            (linkedOrderItems || []).map(item => [item._id, item])
        );
        const nextEditableCargoItemMap = deliveryOrderItems.reduce<Record<string, boolean>>((acc, item) => {
            const linkedOrderItem = linkedOrderItemMap.get(item.orderItemRef);
            acc[item._id] = Boolean(
                linkedOrderItem?.entrySource === 'DELIVERY_ORDER' &&
                linkedOrderItem.sourceDeliveryOrderRef === doId
            );
            return acc;
        }, {});

        setDoItems(deliveryOrderItems);
        setEditableCargoItemMap(nextEditableCargoItemMap);
        setLinkedOrderItemDetailMap(
            (linkedOrderItems || []).reduce<Record<string, Pick<OrderItem, '_id' | 'entrySource' | 'sourceDeliveryOrderRef' | 'customerProductRef'> | undefined>>((acc, item) => {
                acc[item._id] = item;
                return acc;
            }, {})
        );
    }, [doId]);

    const loadDOReferences = useCallback(async (deliveryOrder: DeliveryOrder | null) => {
        if (!deliveryOrder?._id) {
            setBillingCustomers([]);
            setCustomerProducts([]);
            setCustomerRecipients([]);
            setShipperReferenceFormat('SJ');
            setTripRouteRates([]);
            loadedReferenceCustomerRef.current = '';
            return;
        }

        const snapshot = await fetchAdminData<TripDetailReferencesSnapshot | null>(
            `/api/data?entity=trip-detail-references&id=${deliveryOrder._id}`,
            'Gagal memuat referensi trip'
        );

        setBillingCustomers(snapshot?.billingCustomers || []);
        setCustomerProducts(snapshot?.customerProducts || []);
        setCustomerRecipients(snapshot?.customerRecipients || []);
        setShipperReferenceFormat((snapshot?.customerData?.deliveryOrderPrefix || 'SJ').toUpperCase());
        setTripRouteRates(snapshot?.tripRouteRates || []);
        loadedReferenceCustomerRef.current = deliveryOrder?.customerRef || '';
    }, []);

    const applyTripDetailSnapshot = useCallback(async (tripDetail: TripDetailSnapshot | null) => {
        const trip = tripDetail?.trip || null;
        const deliveryOrder = tripDetail?.deliveryOrder || null;
        const sourceOrder = tripDetail?.sourceOrder || null;
        const deliveryOrderItems = tripDetail?.deliveryOrderItems || [];
        const trackingEvents = tripDetail?.trackingEvents || [];
        const resolvedDeliveryOrder = buildResolvedDeliveryOrder(deliveryOrder, sourceOrder);

        setTripData(trip);
        setDoData(resolvedDeliveryOrder);
        setSuratJalanDocuments(tripDetail?.suratJalanDocuments || []);
        setLinkedVoucher(tripDetail?.linkedVoucher || null);
        setLinkedTripCashLink(tripDetail?.tripCashLink || null);
        setLinkedVoucherBonNumber(tripDetail?.linkedVoucher?.bonNumber || tripDetail?.tripCashLink?.bonNumber || '');
        if (!editingTaripRef.current) {
            setTaripBorongan((resolvedDeliveryOrder?.baseTaripBorongan ?? resolvedDeliveryOrder?.taripBorongan) || 0);
            setKeteranganBorongan(resolvedDeliveryOrder?.keteranganBorongan || '');
            setTripRouteRateRef(resolvedDeliveryOrder?.tripRouteRateRef || '');
            setTripOriginArea(resolvedDeliveryOrder?.tripOriginArea || '');
            setTripDestinationArea(resolvedDeliveryOrder?.tripDestinationArea || '');
        }
        await hydrateDeliveryOrderItemsState(deliveryOrderItems);
        setTrackingLogs(sortTrackingLogs(trackingEvents));

        return {
            deliveryOrder,
            deliveryOrderItems,
            resolvedDeliveryOrder,
        };
    }, [hydrateDeliveryOrderItemsState]);

    const loadDO = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
        if (mode === 'initial') {
            setLoading(true);
        }

        try {
            const tripDetail = await fetchAdminData<TripDetailSnapshot | null>(
                `/api/data?entity=trip-detail&id=${doId}`,
                'Gagal memuat detail trip'
            );
            const { deliveryOrder } = await applyTripDetailSnapshot(tripDetail);

            const shouldReloadReferences =
                mode === 'initial' ||
                loadedReferenceCustomerRef.current !== (deliveryOrder?.customerRef || '');
            if (shouldReloadReferences) {
                await loadDOReferences(deliveryOrder);
            }
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail trip');
        } finally {
            if (mode === 'initial') {
                setLoading(false);
            }
        }
    }, [addToast, applyTripDetailSnapshot, doId, loadDOReferences]);

    const refreshTripDetail = useCallback(async () => {
        await loadDO('refresh');
    }, [loadDO]);

    const loadTripResources = useCallback(async () => {
        setLoadingTripResources(true);
        try {
            const [driverRows, vehicleRows, deliveryOrders, currentDriver, currentVehicle] = await Promise.all([
                fetchAdminCollectionData<Driver[]>(
                    `/api/data?entity=drivers&filter=${encodeURIComponent(JSON.stringify({ active: true }))}`,
                    'Gagal memuat opsi armada trip'
                ),
                fetchAdminCollectionData<Vehicle[]>(
                    `/api/data?entity=vehicles&filter=${encodeURIComponent(JSON.stringify({ status: ['ACTIVE', 'IN_SERVICE'] }))}`,
                    'Gagal memuat opsi armada trip'
                ),
                fetchAdminCollectionData<Trip[]>(
                    `/api/data?entity=trips&filter=${encodeURIComponent(JSON.stringify({ status: ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'] }))}`,
                    'Gagal memuat opsi armada trip'
                ),
                doData?.driverRef
                    ? fetchAdminData<Driver | null>(`/api/data?entity=drivers&id=${doData.driverRef}`, 'Gagal memuat opsi armada trip')
                    : Promise.resolve(null),
                doData?.vehicleRef
                    ? fetchAdminData<Vehicle | null>(`/api/data?entity=vehicles&id=${doData.vehicleRef}`, 'Gagal memuat opsi armada trip')
                    : Promise.resolve(null),
            ]);

            const nextDrivers = [...(driverRows || [])];
            if (currentDriver && !nextDrivers.some(driver => driver._id === currentDriver._id)) {
                nextDrivers.push(currentDriver);
            }

            const nextVehicles = [...(vehicleRows || [])];
            if (currentVehicle && !nextVehicles.some(vehicle => vehicle._id === currentVehicle._id)) {
                nextVehicles.push(currentVehicle);
            }

            setDrivers(nextDrivers);
            setVehicles(nextVehicles);
            setActiveTrips(deliveryOrders || []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat opsi armada trip');
        } finally {
            setLoadingTripResources(false);
        }
    }, [addToast, doData?.driverRef, doData?.vehicleRef]);

    const openTripResourcesModal = async () => {
        if (!canAssignTripResources) return;
        setTripVehicleRef(doData?.vehicleRef || '');
        setTripDriverRef(doData?.driverRef || '');
        setTripVehicleOverrideReason(doData?.vehicleCategoryOverrideReason || '');
        setShowTripResourcesModal(true);
        await loadTripResources();
    };

    const openShipperReferenceModal = (mode: 'edit' | 'create' = 'edit') => {
        if (mode === 'edit' && !canEditShipperReference) return;
        if (mode === 'create' && !canAppendCargoToDo) return;
        const resolvedShipperReferences = buildResolvedShipperReferenceEntries(doData, doItems);
        const normalizedFormat = shipperReferenceFormat.trim().toUpperCase() || 'SJ';
        const nextReferences = resolvedShipperReferences
            .map(reference => ({
                draftKey: reference.draftKey,
                referenceKey: reference.referenceKey,
                referenceNumber: reference.referenceNumber,
                pickupStopKey: reference.pickupStopKey,
                selectedRecipientId: resolveMatchingRecipientId(reference.billingCustomerRef || doData?.customerRef, {
                    receiverName: reference.receiverName,
                    receiverPhone: reference.receiverPhone,
                    receiverCompany: reference.receiverCompany,
                    receiverAddress: reference.receiverAddress,
                }),
                billingCustomerRef: reference.billingCustomerRef,
                billingCustomerName: reference.billingCustomerName,
                receiverName: reference.receiverName,
                receiverPhone: reference.receiverPhone,
                receiverAddress: reference.receiverAddress,
                receiverCompany: reference.receiverCompany,
            }))
            .filter(reference => Boolean(reference.referenceNumber));
        const editableReferenceKeySet = new Set(
            resolvedShipperReferences
                .filter(reference => getSuratJalanOperationalStatus(reference.referenceKey).status !== 'DELIVERED')
                .map(reference => reference.referenceKey || reference.draftKey || reference.referenceNumber)
        );
        const firstEditableDraftKey = nextReferences.find(reference =>
            editableReferenceKeySet.has(reference.referenceKey || reference.draftKey || reference.referenceNumber)
        )?.draftKey || '';
        const baseDrafts = nextReferences.length > 0
            ? nextReferences
            : [{
                draftKey: crypto.randomUUID(),
                referenceKey: '',
                referenceNumber: doData?.customerDoNumber || (normalizedFormat !== 'SJ' ? normalizedFormat : ''),
                pickupStopKey: '',
                selectedRecipientId: resolveMatchingRecipientId(doData?.customerRef, {
                    receiverName: doData?.receiverName,
                    receiverPhone: doData?.receiverPhone,
                    receiverCompany: doData?.receiverCompany,
                    receiverAddress: doData?.receiverAddress,
                }),
                billingCustomerRef: doData?.customerRef || '',
                billingCustomerName: doData?.customerName || '',
                receiverName: doData?.receiverName || '',
                receiverPhone: doData?.receiverPhone || '',
                receiverAddress: doData?.receiverAddress || '',
                receiverCompany: doData?.receiverCompany || '',
            }];
        const initialDrafts = mode === 'create'
            ? [
                ...baseDrafts,
                {
                    draftKey: crypto.randomUUID(),
                    referenceKey: '',
                    referenceNumber: '',
                    pickupStopKey: pickupStopList.length === 1 ? pickupStopList[0]._key : '',
                    selectedRecipientId: resolveMatchingRecipientId(doData?.customerRef, {
                        receiverName: doData?.receiverName,
                        receiverPhone: doData?.receiverPhone,
                        receiverCompany: doData?.receiverCompany,
                        receiverAddress: doData?.receiverAddress,
                    }),
                    billingCustomerRef: doData?.customerRef || '',
                    billingCustomerName: doData?.customerName || '',
                    receiverName: doData?.receiverName || '',
                    receiverPhone: doData?.receiverPhone || '',
                    receiverAddress: doData?.receiverAddress || '',
                    receiverCompany: doData?.receiverCompany || '',
                },
            ]
            : baseDrafts;
        setShipperReferenceDrafts(initialDrafts);
        setSelectedShipperReferenceDraftKey(
            mode === 'create'
                ? (initialDrafts[initialDrafts.length - 1]?.draftKey || '')
                : firstEditableDraftKey
        );
        setShipperReferenceModalMode(mode);
        setShipperReferenceExistingItemDraftMap(
            initialDrafts.reduce<Record<string, ExistingShipperReferenceItemDraft[]>>((acc, draft) => {
                acc[draft.draftKey] = doItems
                    .filter(item => matchesShipperReferenceDraft(draft, doData, item))
                    .map(item => {
                        const weightInputUnit = item.orderItemWeightInputUnit || 'KG';
                        const volumeInputUnit = item.orderItemVolumeInputUnit || 'M3';
                        const linkedOrderItem = item.orderItemRef ? linkedOrderItemDetailMap[item.orderItemRef] : undefined;
                        return {
                            deliveryOrderItemId: item._id,
                            customerProductRef: linkedOrderItem?.customerProductRef || '',
                            description: item.orderItemDescription || '',
                            qtyKoli: parseFormattedNumberish(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0),
                            weightInputValue: parseFormattedNumberish(
                                item.orderItemWeightInputValue ?? item.orderItemWeight ?? item.shippedWeight ?? 0,
                                { maxFractionDigits: weightInputUnit === 'TON' ? 3 : 2 }
                            ),
                            weightInputUnit,
                            volumeInputValue: parseFormattedNumberish(
                                item.orderItemVolumeInputValue ?? item.orderItemVolumeM3 ?? 0,
                                { maxFractionDigits: volumeInputUnit === 'LITER' ? 0 : 3 }
                            ),
                            volumeInputUnit,
                            value: 0,
                            id: item.orderItemRef,
                        };
                    });
                return acc;
            }, {})
        );
        setShipperReferenceItemDraftMap(
            mode === 'create' && initialDrafts[initialDrafts.length - 1]?.draftKey
                ? {
                    [initialDrafts[initialDrafts.length - 1].draftKey]: [createDefaultDeliveryOrderCargoDraftItem()],
                }
                : {}
        );
        setShowShipperReferenceModal(true);
    };

    const updateShipperReferenceDraft = (draftKey: string, patch: Partial<ShipperReferenceDraft>) => {
        setShipperReferenceDrafts(previous => previous.map(entry => (
            entry.draftKey === draftKey
                ? { ...entry, ...patch }
                : entry
        )));
    };

    const removeShipperReferenceDraft = (draftKey: string) => {
        const nextDrafts = shipperReferenceDrafts.filter(entry => entry.draftKey !== draftKey);
        const resolvedDrafts = nextDrafts.length > 0
            ? nextDrafts
            : [{
                draftKey: crypto.randomUUID(),
                referenceKey: '',
                referenceNumber: '',
                pickupStopKey: pickupStopList.length === 1 ? pickupStopList[0]._key : '',
                selectedRecipientId: resolveMatchingRecipientId(doData?.customerRef, {
                    receiverName: doData?.receiverName,
                    receiverPhone: doData?.receiverPhone,
                    receiverCompany: doData?.receiverCompany,
                    receiverAddress: doData?.receiverAddress,
                }),
                billingCustomerRef: doData?.customerRef || '',
                billingCustomerName: doData?.customerName || '',
                receiverName: doData?.receiverName || '',
                receiverPhone: doData?.receiverPhone || '',
                receiverAddress: doData?.receiverAddress || '',
                receiverCompany: doData?.receiverCompany || '',
            }];
        setShipperReferenceDrafts(resolvedDrafts);
        setSelectedShipperReferenceDraftKey(current => (
            current === draftKey
                ? (resolvedDrafts[0]?.draftKey || '')
                : (resolvedDrafts.some(entry => entry.draftKey === current) ? current : (resolvedDrafts[0]?.draftKey || ''))
        ));
        setShipperReferenceItemDraftMap(previous => {
            const nextMap = { ...previous };
            delete nextMap[draftKey];
            return nextMap;
        });
        setShipperReferenceExistingItemDraftMap(previous => {
            const nextMap = { ...previous };
            delete nextMap[draftKey];
            return nextMap;
        });
    };

    const updateSelectedShipperReferenceItemDraft = <K extends keyof DeliveryOrderCargoDraftItem>(
        itemIndex: number,
        field: K,
        value: DeliveryOrderCargoDraftItem[K]
    ) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? (
                        field === 'qtyKoli'
                            ? toDeliveryOrderCargoDraftItem(applyOrderItemAutoWeightFromQty({
                                ...item,
                                pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                                shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                            }, value as number))
                            : (field === 'weightInputValue' || field === 'weightInputUnit') && shouldLockOrderItemWeight(item)
                                ? item
                            : { ...item, [field]: value }
                    )
                    : item
            )),
        }));
    };

    const updateSelectedExistingShipperReferenceItemDraft = <K extends keyof DeliveryOrderCargoDraftItem>(
        itemIndex: number,
        field: K,
        value: DeliveryOrderCargoDraftItem[K]
    ) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceExistingItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? (
                        field === 'qtyKoli'
                            ? {
                                ...item,
                                ...toDeliveryOrderCargoDraftItem(applyOrderItemAutoWeightFromQty({
                                    ...item,
                                    pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                                    shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                                }, value as number)),
                            }
                            : (field === 'weightInputValue' || field === 'weightInputUnit') && shouldLockOrderItemWeight(item)
                                ? item
                            : { ...item, [field]: value }
                    )
                    : item
            )),
        }));
    };

    const addSelectedShipperReferenceItemDraft = () => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: [
                ...(previous[selectedShipperReferenceDraft.draftKey] || []),
                createDefaultDeliveryOrderCargoDraftItem(),
            ],
        }));
    };

    const removeSelectedShipperReferenceItemDraft = (itemIndex: number) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).filter((_, currentIndex) => currentIndex !== itemIndex),
        }));
    };

    const applySelectedShipperReferenceItemProduct = (itemIndex: number, nextProductRef: string) => {
        if (!selectedShipperReferenceDraft) return;
        const selectedProduct = deliveryOrderCustomerProducts.find(product => product._id === nextProductRef);
        setShipperReferenceItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? toDeliveryOrderCargoDraftItem(applyCustomerProductToOrderItem({
                        ...item,
                        pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                        shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                    }, selectedProduct))
                    : item
            )),
        }));
    };

    const applySelectedExistingShipperReferenceItemProduct = (itemIndex: number, nextProductRef: string) => {
        if (!selectedShipperReferenceDraft) return;
        const selectedProduct = deliveryOrderCustomerProducts.find(product => product._id === nextProductRef);
        setShipperReferenceExistingItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? {
                        ...item,
                        ...toDeliveryOrderCargoDraftItem(applyCustomerProductToOrderItem({
                            ...item,
                            pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                            shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                        }, selectedProduct)),
                        deliveryOrderItemId: item.deliveryOrderItemId,
                    }
                    : item
            )),
        }));
    };

    const updateSelectedShipperReferenceItemWeightUnit = (itemIndex: number, nextUnit: DeliveryOrderCargoDraftItem['weightInputUnit']) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? shouldLockOrderItemWeight(item)
                        ? item
                        : toDeliveryOrderCargoDraftItem(updateOrderItemWeightUnit({
                        ...item,
                        pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                        shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                    }, nextUnit))
                    : item
            )),
        }));
    };

    const updateSelectedExistingShipperReferenceItemWeightUnit = (itemIndex: number, nextUnit: DeliveryOrderCargoDraftItem['weightInputUnit']) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceExistingItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? shouldLockOrderItemWeight(item)
                        ? item
                        : {
                        ...item,
                        ...toDeliveryOrderCargoDraftItem(updateOrderItemWeightUnit({
                            ...item,
                            pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                            shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                        }, nextUnit)),
                        deliveryOrderItemId: item.deliveryOrderItemId,
                    }
                    : item
            )),
        }));
    };

    const updateSelectedShipperReferenceItemVolumeUnit = (itemIndex: number, nextUnit: DeliveryOrderCargoDraftItem['volumeInputUnit']) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? toDeliveryOrderCargoDraftItem(updateOrderItemVolumeUnit({
                        ...item,
                        pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                        shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                    }, nextUnit))
                    : item
            )),
        }));
    };

    const updateSelectedExistingShipperReferenceItemVolumeUnit = (itemIndex: number, nextUnit: DeliveryOrderCargoDraftItem['volumeInputUnit']) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceExistingItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? {
                        ...item,
                        ...toDeliveryOrderCargoDraftItem(updateOrderItemVolumeUnit({
                            ...item,
                            pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                            shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                        }, nextUnit)),
                        deliveryOrderItemId: item.deliveryOrderItemId,
                    }
                    : item
            )),
        }));
    };

    const getCustomerRecipientOptions = (customerRef?: string) => {
        const normalizedCustomerRef = customerRef?.trim();
        return customerRecipients.filter(recipient =>
            recipient.active !== false &&
            (!normalizedCustomerRef || recipient.customerRef === normalizedCustomerRef)
        );
    };

    const formatCustomerRecipientLabel = (recipient: CustomerRecipient) => {
        const targetName = recipient.receiverCompany || recipient.receiverName || recipient.label;
        return `${recipient.label}${targetName && targetName !== recipient.label ? ` - ${targetName}` : ''}`;
    };

    const normalizeRecipientComparable = (value?: string) => value?.trim().toLowerCase() || '';

    const resolveMatchingRecipientId = (
        customerRef: string | undefined,
        target: {
            receiverName?: string;
            receiverPhone?: string;
            receiverCompany?: string;
            receiverAddress?: string;
        }
    ) => {
        const options = getCustomerRecipientOptions(customerRef);
        if (options.length === 0) {
            return '';
        }

        const targetName = normalizeRecipientComparable(target.receiverName);
        const targetPhone = normalizeRecipientComparable(target.receiverPhone);
        const targetCompany = normalizeRecipientComparable(target.receiverCompany);
        const targetAddress = normalizeRecipientComparable(target.receiverAddress);

        const matchedRecipient = options.find(recipient => {
            const score =
                (targetAddress && normalizeRecipientComparable(recipient.receiverAddress) === targetAddress ? 2 : 0) +
                (targetCompany && normalizeRecipientComparable(recipient.receiverCompany) === targetCompany ? 1 : 0) +
                (targetName && normalizeRecipientComparable(recipient.receiverName) === targetName ? 1 : 0) +
                (targetPhone && normalizeRecipientComparable(recipient.receiverPhone) === targetPhone ? 1 : 0);
            return score >= 2;
        });

        return matchedRecipient?._id || '';
    };

    const applyTargetRecipient = (recipientId: string) => {
        const recipient = customerRecipients.find(item => item._id === recipientId);
        if (!recipient) return;
        setSelectedTargetRecipientId(recipientId);
        setTargetReceiverName(recipient.receiverName || '');
        setTargetReceiverPhone(recipient.receiverPhone || '');
        setTargetReceiverCompany(recipient.receiverCompany || '');
        setTargetReceiverAddress(recipient.receiverAddress || '');
    };

    const applyShipperReferenceRecipient = (draftKey: string, recipientId: string) => {
        const recipient = customerRecipients.find(item => item._id === recipientId);
        if (!recipient) return;
        updateShipperReferenceDraft(draftKey, {
            selectedRecipientId: recipientId,
            receiverName: recipient.receiverName || '',
            receiverPhone: recipient.receiverPhone || '',
            receiverCompany: recipient.receiverCompany || '',
            receiverAddress: recipient.receiverAddress || '',
        });
    };

    const openTargetModal = () => {
        if (!canEditDeliveryTarget) return;
        setSelectedTargetRecipientId(resolveMatchingRecipientId(doData?.customerRef, {
            receiverName: doData?.receiverName,
            receiverPhone: doData?.receiverPhone,
            receiverCompany: doData?.receiverCompany,
            receiverAddress: doData?.receiverAddress,
        }));
        setTargetReceiverName(doData?.receiverName || '');
        setTargetReceiverPhone(doData?.receiverPhone || '');
        setTargetReceiverAddress(doData?.receiverAddress || '');
        setTargetReceiverCompany(doData?.receiverCompany || '');
        setShowTargetModal(true);
    };

    const getDefaultCargoDraftPickupKey = () => (
        pickupStopList.length === 1 ? pickupStopList[0]._key : ''
    );

    const closeCargoModal = () => {
        if (savingCargo) return;
        setShowCargoModal(false);
        setEditingCargoItemId(null);
        setCargoDraftGroups([createDefaultDeliveryOrderCargoDraftGroup(getDefaultCargoDraftPickupKey())]);
    };

    const openCargoEditModal = (item: DeliveryOrderItem) => {
        if (!canEditDeliveryCargo || !editableCargoItemMap[item._id]) return;

        const weightInputUnit = item.orderItemWeightInputUnit || 'KG';
        const volumeInputUnit = item.orderItemVolumeInputUnit || 'M3';
        setEditingCargoItemId(item._id);
        setCargoDraftGroups([{
            id: crypto.randomUUID(),
            pickupStopKey: item.pickupStopKey || pickupStopList[0]?._key || '',
            shipperReferenceNumber: item.shipperReferenceNumber || doData?.customerDoNumber || '',
            items: [{
                customerProductRef: '',
                description: item.orderItemDescription || '',
                qtyKoli: parseFormattedNumberish(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0),
                weightInputValue: parseFormattedNumberish(
                    item.orderItemWeightInputValue ?? item.orderItemWeight ?? item.shippedWeight ?? 0,
                    { maxFractionDigits: weightInputUnit === 'TON' ? 3 : 2 }
                ),
                weightInputUnit,
                volumeInputValue: parseFormattedNumberish(
                    item.orderItemVolumeInputValue ?? item.orderItemVolumeM3 ?? 0,
                    { maxFractionDigits: volumeInputUnit === 'LITER' ? 0 : 3 }
                ),
                volumeInputUnit,
                value: 0,
                id: item.orderItemRef,
            }],
        }]);
        setShowCargoModal(true);
    };

    const updateCargoDraftGroup = <K extends keyof Pick<DeliveryOrderCargoDraftGroup, 'pickupStopKey' | 'shipperReferenceNumber'>>(
        groupId: string,
        field: K,
        value: DeliveryOrderCargoDraftGroup[K]
    ) => {
        setCargoDraftGroups(previous => previous.map(group => (
            group.id === groupId
                ? { ...group, [field]: value }
                : group
        )));
    };

    const updateCargoDraftItem = <K extends keyof DeliveryOrderCargoDraftItem>(
        groupId: string,
        itemIndex: number,
        field: K,
        value: DeliveryOrderCargoDraftItem[K]
    ) => {
        setCargoDraftGroups(previous => previous.map(group => (
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
                                    }, value as number))
                                    : (field === 'weightInputValue' || field === 'weightInputUnit') && shouldLockOrderItemWeight(item)
                                        ? item
                                    : { ...item, [field]: value }
                            )
                            : item
                    )),
                }
                : group
        )));
    };

    const applyCargoDraftProductSelection = (groupId: string, itemIndex: number, nextProductRef: string) => {
        const selectedProduct = deliveryOrderCustomerProducts.find(product => product._id === nextProductRef);
        setCargoDraftGroups(previous => previous.map(group => (
            group.id === groupId
                ? {
                    ...group,
                    items: group.items.map((item, currentIndex) => (
                        currentIndex === itemIndex
                            ? toDeliveryOrderCargoDraftItem(applyCustomerProductToOrderItem({
                                ...item,
                                pickupStopKey: group.pickupStopKey,
                                shipperReferenceNumber: group.shipperReferenceNumber,
                            }, selectedProduct))
                            : item
                    )),
                }
                : group
        )));
    };

    const addCargoDraftGroup = () => {
        setCargoDraftGroups(previous => [
            ...previous,
            createDefaultDeliveryOrderCargoDraftGroup(getDefaultCargoDraftPickupKey()),
        ]);
    };

    const removeCargoDraftGroup = (groupId: string) => {
        setCargoDraftGroups(previous => {
            const nextGroups = previous.filter(group => group.id !== groupId);
            return nextGroups.length > 0
                ? nextGroups
                : [createDefaultDeliveryOrderCargoDraftGroup(getDefaultCargoDraftPickupKey())];
        });
    };

    const addCargoDraftItem = (groupId: string) => {
        setCargoDraftGroups(previous => previous.map(group => (
            group.id === groupId
                ? { ...group, items: [...group.items, createDefaultDeliveryOrderCargoDraftItem()] }
                : group
        )));
    };

    const getSelectedProductRefsForCargoDraftGroup = (groupId: string, currentItemIndex: number) => {
        const selectedGroup = cargoDraftGroups.find(group => group.id === groupId);
        if (!selectedGroup) {
            return new Set<string>();
        }
        return new Set(
            selectedGroup.items
                .map((item, index) => index === currentItemIndex ? '' : item.customerProductRef.trim())
                .filter(Boolean)
        );
    };

    const removeCargoDraftItem = (groupId: string, itemIndex: number) => {
        setCargoDraftGroups(previous => previous.map(group => {
            if (group.id !== groupId) {
                return group;
            }
            const nextItems = group.items.filter((_, currentIndex) => currentIndex !== itemIndex);
            return {
                ...group,
                items: nextItems.length > 0 ? nextItems : [createDefaultDeliveryOrderCargoDraftItem()],
            };
        }));
    };

    const openTripFeeEditor = () => {
        if (!canManageTripFee || linkedVoucherBonNumber) return;
        setEditingTarip(true);
        if (typeof window !== 'undefined') {
            window.requestAnimationFrame(() => {
                document.getElementById('delivery-order-trip-fee-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
    };

    const buildPartialHoldContinuationDrafts = (
        sourceDOData: DeliveryOrder | null,
        sourceDoItems: DeliveryOrderItem[],
        baseCargoItems: ActualCargoDraft[]
    ) => {
        const partialHoldSuratJalanRefs = new Set(
            suratJalanDocuments
                .filter(document => document.tripStatus === 'PARTIAL_HOLD')
                .map(document => document._id)
        );
        const actualDropPointSource = sourceDOData?.actualDropPoints || [];
        if (!sourceDOData?._id || partialHoldSuratJalanRefs.size === 0 || actualDropPointSource.length === 0) {
            return {
                actualCargoItems: baseCargoItems,
                sourceDropPoints: undefined as DeliveryOrder['actualDropPoints'] | undefined,
                itemRefs: [] as string[],
            };
        }

        const getItemSuratJalanRef = (item: DeliveryOrderItem) =>
            `${sourceDOData._id}:${item.shipperReferenceKey || item.shipperReferenceNumber || 'primary'}`;
        const itemsById = new Map(sourceDoItems.map(item => [item._id, item]));
        const partialHoldItemIds = new Set(
            sourceDoItems
                .filter(item => partialHoldSuratJalanRefs.has(getItemSuratJalanRef(item)))
                .map(item => item._id)
        );
        const getPointItemIds = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) => {
            const explicitItemRefs = [
                point.deliveryOrderItemRef,
                ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
            ].filter((value): value is string => Boolean(value));
            if (explicitItemRefs.length > 0) {
                return explicitItemRefs.filter(itemId => partialHoldItemIds.has(itemId));
            }

            const pointReferenceKey = (point.shipperReferenceKey || '').trim();
            const pointReferenceNumber = (point.shipperReferenceNumber || '').trim().toUpperCase();
            const matchingItems = sourceDoItems.filter(item => {
                if (!partialHoldItemIds.has(item._id)) {
                    return false;
                }
                return (
                    (pointReferenceKey && (item.shipperReferenceKey || '').trim() === pointReferenceKey) ||
                    (pointReferenceNumber && (item.shipperReferenceNumber || '').trim().toUpperCase() === pointReferenceNumber)
                );
            });
            return matchingItems.length === 1 ? [matchingItems[0]._id] : [];
        };

        const continuableHoldPoints = actualDropPointSource.filter(point => (
            (point.stopType === 'HOLD' || point.stopType === 'TRANSIT') &&
            getPointItemIds(point).length > 0
        ));
        if (continuableHoldPoints.length === 0) {
            return {
                actualCargoItems: baseCargoItems,
                sourceDropPoints: undefined as DeliveryOrder['actualDropPoints'] | undefined,
                itemRefs: [] as string[],
            };
        }

        const holdDraftByItemId = new Map<string, ActualCargoItemValueDraft>();
        continuableHoldPoints.forEach(point => {
            const pointItemIds = getPointItemIds(point);
            pointItemIds.forEach(itemId => {
                const sourceItem = itemsById.get(itemId);
                if (!sourceItem) {
                    return;
                }
                const current = holdDraftByItemId.get(itemId);
                const weightInputUnit = point.weightInputUnit || sourceItem.actualWeightInputUnit || sourceItem.orderItemWeightInputUnit || 'KG';
                const volumeInputUnit = point.volumeInputUnit || sourceItem.actualVolumeInputUnit || sourceItem.orderItemVolumeInputUnit || 'M3';
                const currentWeightKg = current
                    ? convertWeightToKg(parseFormattedNumberish(current.actualWeightInputValue || 0), current.actualWeightInputUnit)
                    : 0;
                const currentVolumeM3 = current
                    ? convertVolumeToM3(parseFormattedNumberish(current.actualVolumeInputValue || 0), current.actualVolumeInputUnit)
                    : 0;
                const nextWeightKg = currentWeightKg + convertWeightToKg(point.weightInputValue ?? point.weightKg ?? 0, weightInputUnit);
                const nextVolumeM3 = currentVolumeM3 + convertVolumeToM3(point.volumeInputValue ?? point.volumeM3 ?? 0, volumeInputUnit);
                holdDraftByItemId.set(itemId, {
                    actualQtyKoli: String(parseFormattedNumberish(current?.actualQtyKoli || 0) + parseFormattedNumberish(point.qtyKoli || 0)),
                    actualWeightInputValue: nextWeightKg > 0 ? String(convertKgToWeightInputValue(nextWeightKg, weightInputUnit)) : '',
                    actualWeightInputUnit: weightInputUnit,
                    actualVolumeInputValue: nextVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(nextVolumeM3, volumeInputUnit)) : '',
                    actualVolumeInputUnit: volumeInputUnit,
                });
            });
        });

        const continuationCargoItems = baseCargoItems.map(item => {
            const holdDraft = holdDraftByItemId.get(item.deliveryOrderItemRef);
            return holdDraft ? { ...item, ...holdDraft } : item;
        });
        return {
            actualCargoItems: continuationCargoItems,
            sourceDropPoints: [] as DeliveryOrder['actualDropPoints'],
            itemRefs: Array.from(holdDraftByItemId.keys()),
        };
    };

    const openStatusModal = async (requestedStatus?: string, fromDriverRequest: boolean = false) => {
        if (!canManageDeliveryStatus) return;
        const hydratingDriverDeliveredRequest = fromDriverRequest && requestedStatus === 'DELIVERED';
        let statusModalDOData = doData;
        let statusModalDoItems = doItems;
        let pendingDriverActualCargoItems = hydratingDriverDeliveredRequest ? doData?.pendingDriverActualCargoItems : undefined;
        let pendingDriverActualDropPoints = hydratingDriverDeliveredRequest ? doData?.pendingDriverActualDropPoints : undefined;

        if (hydratingDriverDeliveredRequest && doId) {
            try {
                const latestTripDetail = await fetchAdminData<TripDetailSnapshot | null>(
                    `/api/data?entity=trip-detail&id=${doId}`,
                    'Gagal memuat permintaan driver terbaru'
                );
                if (latestTripDetail?.deliveryOrder) {
                    const snapshotState = await applyTripDetailSnapshot(latestTripDetail);
                    statusModalDOData = snapshotState.resolvedDeliveryOrder;
                    statusModalDoItems = snapshotState.deliveryOrderItems;
                    pendingDriverActualCargoItems = latestTripDetail.deliveryOrder.pendingDriverActualCargoItems;
                    pendingDriverActualDropPoints = latestTripDetail.deliveryOrder.pendingDriverActualDropPoints;
                }
            } catch {
                addToast('warning', 'Permintaan driver terbaru belum sempat disegarkan. Modal memakai data yang sudah terbuka.');
            }
        }

        const defaultPodName =
            statusModalDOData?.podReceiverName?.trim()
            || statusModalDOData?.receiverName?.trim()
            || statusModalDOData?.receiverCompany?.trim()
            || '';
        const defaultPodDate = statusModalDOData?.podReceivedDate?.trim()
            ? statusModalDOData.podReceivedDate.trim().slice(0, 10)
            : getBusinessDateValue();
        const defaultPodNote = statusModalDOData?.podNote || '';

        setNewStatus(requestedStatus || '');
        setSelectedStatusSuratJalanRefs(
            requestedStatus
                ? suratJalanDocuments
                    .filter(document =>
                        getNextDeliveryOrderStatuses(document.tripStatus || (tripData?.status || statusModalDOData?.status || doData?.status || ''))
                            .filter(status => status === 'CREATED' || status === 'CANCELLED' || hasTripResourcesAssigned)
                            .includes(requestedStatus)
                    )
                    .map(document => document._id)
                : []
        );
        setStatusNote(fromDriverRequest ? (statusModalDOData?.pendingDriverStatusNote || '') : '');
        setReviewingDriverRequest(fromDriverRequest);
        setPodName(defaultPodName);
        setPodDate(defaultPodDate);
        setPodNote(defaultPodNote);
        const baseActualCargoItems = buildActualCargoDrafts(
            statusModalDoItems,
            hydratingDriverDeliveredRequest ? pendingDriverActualCargoItems : undefined
        );
        const continuationDrafts = !hydratingDriverDeliveredRequest
            ? buildPartialHoldContinuationDrafts(statusModalDOData, statusModalDoItems, baseActualCargoItems)
            : {
                actualCargoItems: baseActualCargoItems,
                sourceDropPoints: undefined as DeliveryOrder['actualDropPoints'] | undefined,
                itemRefs: [] as string[],
            };
        const nextActualCargoItems = continuationDrafts.actualCargoItems;
        const isPartialHoldContinuation = !hydratingDriverDeliveredRequest && continuationDrafts.itemRefs.length > 0;
        const nextActualDropPoints = isPartialHoldContinuation
            ? []
            : buildDefaultActualDropDrafts(
                statusModalDOData,
                nextActualCargoItems,
                hydratingDriverDeliveredRequest ? pendingDriverActualDropPoints : continuationDrafts.sourceDropPoints
            );
        const shouldUseAdvancedDropEditor = isPartialHoldContinuation || shouldOpenAdvancedDropEditor(statusModalDOData, nextActualDropPoints);
        setActualCargoItems(nextActualCargoItems);
        setPartialHoldContinuationItemRefs(continuationDrafts.itemRefs);
        setActualDropPoints(
            shouldUseAdvancedDropEditor
                ? expandActualDropDraftsBySelectedItems(nextActualDropPoints, nextActualCargoItems)
                : nextActualDropPoints
        );
        setActualCargoItemValueMap({});
        setActualDropItemValueMap({});
        setShowAdvancedDropEditor(shouldUseAdvancedDropEditor);
        setShowStatusModal(true);
    };

    const rejectDriverStatusRequest = async () => {
        if (!canReviewDriverRequest) return;
        setRejectingRequest(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'reject-driver-status-request',
                    data: {
                        id: doData?._id,
                        note: rejectRequestNote,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menolak permintaan driver');
                return;
            }
            setShowRejectRequestModal(false);
            setRejectRequestNote('');
            await refreshTripDetail();
            addToast('success', 'Permintaan driver ditolak');
        } catch {
            addToast('error', 'Gagal menolak permintaan driver');
        } finally {
            setRejectingRequest(false);
        }
    };

    const saveDeliveryTarget = async () => {
        if (!canEditDeliveryTarget || !doData?._id) return;
        setSavingTarget(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'update',
                    data: {
                        id: doData._id,
                        updates: {
                            receiverName: targetReceiverName,
                            receiverPhone: targetReceiverPhone,
                            receiverAddress: targetReceiverAddress,
                            receiverCompany: targetReceiverCompany,
                        },
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan tujuan surat jalan');
                return;
            }
            setShowTargetModal(false);
            await refreshTripDetail();
            addToast('success', 'Tujuan surat jalan berhasil diperbarui');
        } catch {
            addToast('error', 'Gagal menyimpan tujuan surat jalan');
        } finally {
            setSavingTarget(false);
        }
    };

    const saveCargoDrafts = async () => {
        if (!canEditDeliveryCargo || !doData?._id) return;
        if (cargoDraftItemCount === 0) {
            addToast('error', 'Isi minimal 1 barang sebelum disimpan ke Surat Jalan.');
            return;
        }

        const normalizedGroups = cargoDraftGroupsWithItems.map(group => ({
            ...group,
            resolvedPickupStopKey: group.pickupStopKey || (pickupStopList.length === 1 ? pickupStopList[0]._key : ''),
            resolvedShipperReferenceNumber: group.shipperReferenceNumber.trim().toUpperCase(),
        }));
        const invalidReferenceIndex = normalizedGroups.findIndex(group => group.draftItems.length > 0 && !group.resolvedShipperReferenceNumber);
        if (invalidReferenceIndex >= 0) {
            addToast('error', `No. SJ pengirim wajib diisi pada SJ ${invalidReferenceIndex + 1}`);
            return;
        }
        const invalidPickupIndex = normalizedGroups.findIndex(group => pickupStopList.length > 0 && !group.resolvedPickupStopKey);
        if (invalidPickupIndex >= 0) {
            addToast('error', `Titik pickup wajib dipilih pada SJ ${invalidPickupIndex + 1}`);
            return;
        }
        const duplicateGroupReferenceNumber = (() => {
            const seen = new Set<string>();
            for (const group of normalizedGroups) {
                if (seen.has(group.resolvedShipperReferenceNumber)) {
                    return group.resolvedShipperReferenceNumber;
                }
                seen.add(group.resolvedShipperReferenceNumber);
            }
            return '';
        })();
        if (duplicateGroupReferenceNumber) {
            addToast('error', `No. SJ pengirim ${duplicateGroupReferenceNumber} ditulis lebih dari sekali. Tambahkan barangnya di SJ yang sama, bukan membuat grup SJ baru.`);
            return;
        }
        if (editingCargoItemId) {
            if (normalizedGroups.length !== 1 || normalizedGroups[0].draftItems.length !== 1) {
                addToast('error', 'Mode edit barang hanya menerima 1 SJ dan 1 barang dalam satu kali simpan.');
                return;
            }
        }

        setSavingCargo(true);
        try {
            const action = editingCargoItemId ? 'update-cargo-item' : 'append-cargo-items';
            const payloadData = editingCargoItemId
                ? {
                    id: doData._id,
                    deliveryOrderItemId: editingCargoItemId,
                    cargoItem: {
                        ...normalizedGroups[0].draftItems[0],
                        shipperReferenceNumber: normalizedGroups[0].resolvedShipperReferenceNumber,
                        pickupStopKey: normalizedGroups[0].resolvedPickupStopKey || undefined,
                    },
                }
                : {
                    id: doData._id,
                    cargoItems: normalizedGroups.flatMap(group =>
                        group.draftItems.map(item => ({
                            ...item,
                            shipperReferenceNumber: group.resolvedShipperReferenceNumber,
                            pickupStopKey: group.resolvedPickupStopKey || undefined,
                        }))
                    ),
                };
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action,
                    data: payloadData,
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || (editingCargoItemId ? 'Gagal memperbarui barang Surat Jalan' : 'Gagal menambah barang ke Surat Jalan'));
                return;
            }
            setShowCargoModal(false);
            setEditingCargoItemId(null);
            setCargoDraftGroups([createDefaultDeliveryOrderCargoDraftGroup(getDefaultCargoDraftPickupKey())]);
            await refreshTripDetail();
            addToast(
                'success',
                editingCargoItemId
                    ? 'Barang Surat Jalan berhasil diperbarui'
                    : `${result.data?.appendedCount || cargoDraftItemCount} barang ditambahkan ke Surat Jalan`
            );
        } catch {
            addToast('error', editingCargoItemId ? 'Gagal memperbarui barang Surat Jalan' : 'Gagal menambah barang ke Surat Jalan');
        } finally {
            setSavingCargo(false);
        }
    };

    const continueHeldCargoOnSameDo = () => {
        void openStatusModal('DELIVERED');
    };

    const toggleTripClosure = async () => {
        if (!canManageDeliveryStatus || !doData?._id) return;
        const nextClosed = !isTripClosedByAdmin;
        if (typeof window !== 'undefined') {
            const confirmed = window.confirm(
                nextClosed
                    ? 'Tutup trip ini? Setelah ditutup admin, tambah SJ dan edit muatan SJ akan dikunci sampai trip dibuka kembali.'
                    : 'Buka kembali trip ini? Admin bisa menambah SJ baru lagi setelah trip dibuka.'
            );
            if (!confirmed) return;
        }

        setTogglingTripClosure(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'set-trip-closure',
                    data: {
                        id: doData._id,
                        closed: nextClosed,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal memperbarui status penutupan trip');
                return;
            }
            await refreshTripDetail();
            addToast('success', nextClosed ? 'Trip ditutup oleh admin' : 'Trip dibuka kembali');
        } catch {
            addToast('error', 'Gagal memperbarui status penutupan trip');
        } finally {
            setTogglingTripClosure(false);
        }
    };

    const removeCargoItemNow = async (deliveryOrderItemId: string, itemLabel: string) => {
        if (!canEditDeliveryCargo || !doData?._id) return;
        setRemovingCargoItemId(deliveryOrderItemId);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'remove-cargo-item',
                    data: {
                        id: doData._id,
                        deliveryOrderItemId,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus barang dari Surat Jalan');
                return;
            }
            await refreshTripDetail();
            addToast('success', 'Barang Surat Jalan berhasil dihapus');
        } catch {
            addToast('error', 'Gagal menghapus barang dari Surat Jalan');
        } finally {
            setRemovingCargoItemId(null);
        }
    };

    const removeCargoItem = (deliveryOrderItemId: string, itemLabel: string) => {
        if (!canEditDeliveryCargo || !doData?._id) return;
        setPendingDeleteAction({ type: 'cargo-item', deliveryOrderItemId, itemLabel });
    };

    const deleteShipperReferenceNow = async (reference: ResolvedShipperReferenceEntry) => {
        if (!canEditShipperReference || !doData?._id) return;
        if (isTripClosedByAdmin) {
            addToast('error', 'Trip ini sudah ditutup admin. Buka kembali trip jika masih ingin menghapus SJ.');
            return;
        }
        if (getSuratJalanOperationalStatus(reference.referenceKey).status === 'DELIVERED') {
            addToast('error', `SJ ${reference.referenceNumber || 'ini'} sudah delivered dan tidak bisa dihapus.`);
            return;
        }

        const referenceLabel = reference.referenceNumber || 'Surat Jalan ini';
        const referenceIdentity = reference.referenceKey || reference.draftKey || reference.referenceNumber;
        const remainingReferences = shipperReferenceDisplayList.filter(candidate => {
            const sameKey = reference.referenceKey && candidate.referenceKey === reference.referenceKey;
            const sameDraft = reference.draftKey && candidate.draftKey === reference.draftKey;
            const sameNumber = candidate.referenceNumber.trim().toUpperCase() === reference.referenceNumber.trim().toUpperCase();
            return !(sameKey || sameDraft || sameNumber);
        });
        if (remainingReferences.length === 0) {
            addToast('error', 'Minimal 1 Surat Jalan harus tersisa di trip ini. Ubah nomornya lewat Edit Surat Jalan jika perlu.');
            return;
        }

        const itemsForReference = doItems.filter(item => matchesShipperReferenceDraft(reference, doData, item));
        const lockedItems = itemsForReference.filter(item => !editableCargoItemMap[item._id]);
        if (lockedItems.length > 0) {
            addToast('error', `SJ ${referenceLabel} punya barang yang sudah terkunci atau berasal dari order utama, jadi tidak bisa dihapus langsung.`);
            return;
        }
        if (itemsForReference.length > 0 && !canEditDeliveryCargo) {
            addToast('error', 'Anda tidak punya akses menghapus barang pada SJ ini.');
            return;
        }

        setDeletingShipperReferenceKey(referenceIdentity);
        try {
            for (const item of itemsForReference) {
                const itemRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'delivery-orders',
                        action: 'remove-cargo-item',
                        data: {
                            id: doData._id,
                            deliveryOrderItemId: item._id,
                        },
                    }),
                });
                const itemResult = await itemRes.json();
                if (!itemRes.ok) {
                    addToast('error', itemResult.error || `Gagal menghapus barang pada SJ ${referenceLabel}`);
                    return;
                }
            }

            const referenceRes = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'update-shipper-reference',
                    data: {
                        id: doData._id,
                        shipperReferences: remainingReferences.map((entry, index) => ({
                            _key: entry.referenceKey || undefined,
                            sequence: index + 1,
                            referenceNumber: entry.referenceNumber,
                            pickupStopKey: entry.pickupStopKey || undefined,
                            billingCustomerRef: entry.billingCustomerRef || undefined,
                            billingCustomerName: entry.billingCustomerName || undefined,
                            receiverName: entry.receiverName || undefined,
                            receiverPhone: entry.receiverPhone || undefined,
                            receiverAddress: entry.receiverAddress || undefined,
                            receiverCompany: entry.receiverCompany || undefined,
                        })),
                    },
                }),
            });
            const referenceResult = await referenceRes.json();
            if (!referenceRes.ok) {
                addToast('error', referenceResult.error || `Barang terhapus, tapi gagal menghapus data SJ ${referenceLabel}. Refresh lalu cek ulang.`);
                return;
            }

            await refreshTripDetail();
            addToast('success', `SJ ${referenceLabel} berhasil dihapus`);
        } catch {
            addToast('error', `Gagal menghapus SJ ${referenceLabel}`);
        } finally {
            setDeletingShipperReferenceKey(null);
        }
    };

    const deleteShipperReference = (reference: ResolvedShipperReferenceEntry) => {
        if (!canEditShipperReference || !doData?._id) return;
        const itemsForReference = doItems.filter(item => matchesShipperReferenceDraft(reference, doData, item));
        setPendingDeleteAction({
            type: 'shipper-reference',
            reference,
            itemCount: itemsForReference.length,
        });
    };

    const confirmPendingDeleteAction = async () => {
        if (!pendingDeleteAction) return;
        const action = pendingDeleteAction;
        setPendingDeleteAction(null);
        if (action.type === 'cargo-item') {
            await removeCargoItemNow(action.deliveryOrderItemId, action.itemLabel);
            return;
        }
        await deleteShipperReferenceNow(action.reference);
    };

    const updateActualCargoDraft = (
        deliveryOrderItemRef: string,
        field: keyof Pick<ActualCargoDraft, 'actualQtyKoli' | 'actualWeightInputValue' | 'actualWeightInputUnit' | 'actualVolumeInputValue' | 'actualVolumeInputUnit'>,
        value: string
    ) => {
        const currentItem = actualCargoItems.find(item => item.deliveryOrderItemRef === deliveryOrderItemRef);
        const buildNextItem = (item: ActualCargoDraft) => {
            if (field === 'actualQtyKoli') {
                return applyActualCargoAutoWeightFromQty(item, value);
            }
            return { ...item, [field]: value };
        };
        if (currentItem) {
            const nextItem = buildNextItem(currentItem);
            setActualCargoItemValueMap(previous => {
                const nextManualValues = Object.assign({
                    actualQtyKoli: currentItem.actualQtyKoli,
                    actualWeightInputValue: currentItem.actualWeightInputValue,
                    actualWeightInputUnit: currentItem.actualWeightInputUnit,
                    actualVolumeInputValue: currentItem.actualVolumeInputValue,
                    actualVolumeInputUnit: currentItem.actualVolumeInputUnit,
                }, previous[deliveryOrderItemRef] || {}) as ActualCargoItemValueDraft;
                return {
                    ...previous,
                    [deliveryOrderItemRef]: {
                        ...nextManualValues,
                        actualQtyKoli: nextItem.actualQtyKoli,
                        actualWeightInputValue: nextItem.actualWeightInputValue,
                        actualWeightInputUnit: nextItem.actualWeightInputUnit,
                        actualVolumeInputValue: nextItem.actualVolumeInputValue,
                        actualVolumeInputUnit: nextItem.actualVolumeInputUnit,
                    },
                };
            });
        }
        setActualCargoItems(previous =>
            previous.map(item =>
                item.deliveryOrderItemRef === deliveryOrderItemRef
                    ? buildNextItem(item)
                    : item
            )
        );
    };

    const updateActualCargoWeightUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualWeightInputUnit']) => {
        setActualCargoItems(previous =>
            previous.map(item => {
                if (item.deliveryOrderItemRef !== deliveryOrderItemRef) {
                    return item;
                }
                const currentWeightInputValue = parseFormattedNumberish(item.actualWeightInputValue || 0, {
                    maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
                });
                const currentWeightKg = currentWeightInputValue > 0
                    ? convertWeightToKg(currentWeightInputValue, item.actualWeightInputUnit)
                    : 0;
                const nextItem = {
                    ...item,
                    actualWeightInputUnit: nextUnit,
                    actualWeightInputValue: currentWeightKg > 0
                        ? String(convertKgToWeightInputValue(currentWeightKg, nextUnit))
                        : '',
                };
                setActualCargoItemValueMap(current => ({
                    ...current,
                    [deliveryOrderItemRef]: {
                        actualQtyKoli: nextItem.actualQtyKoli,
                        actualWeightInputValue: nextItem.actualWeightInputValue,
                        actualWeightInputUnit: nextItem.actualWeightInputUnit,
                        actualVolumeInputValue: nextItem.actualVolumeInputValue,
                        actualVolumeInputUnit: nextItem.actualVolumeInputUnit,
                    },
                }));
                return nextItem;
            })
        );
    };

    const updateActualCargoVolumeUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualVolumeInputUnit']) => {
        setActualCargoItems(previous =>
            previous.map(item => {
                if (item.deliveryOrderItemRef !== deliveryOrderItemRef) {
                    return item;
                }
                const nextItem = updateActualCargoDraftVolumeUnit(item, nextUnit);
                setActualCargoItemValueMap(current => ({
                    ...current,
                    [deliveryOrderItemRef]: {
                        actualQtyKoli: nextItem.actualQtyKoli,
                        actualWeightInputValue: nextItem.actualWeightInputValue,
                        actualWeightInputUnit: nextItem.actualWeightInputUnit,
                        actualVolumeInputValue: nextItem.actualVolumeInputValue,
                        actualVolumeInputUnit: nextItem.actualVolumeInputUnit,
                    },
                }));
                return nextItem;
            })
        );
    };

    const updateActualDropDraft = (
        draftKey: string,
        field: keyof Pick<ActualDropDraft, 'stopType' | 'shipperReferenceKey' | 'shipperReferenceNumber' | 'locationName' | 'locationAddress' | 'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit' | 'note'>,
        value: string
    ) => {
        const buildNextDrop = (drop: ActualDropDraft) => {
            const selectedCargoItem = drop.deliveryOrderItemRef
                ? actualCargoItems.find(item => item.deliveryOrderItemRef === drop.deliveryOrderItemRef)
                : undefined;
            if (field === 'qtyKoli') {
                return applyActualDropAutoWeightFromQty(drop, selectedCargoItem, value);
            }
            if ((field === 'weightInputValue' || field === 'weightInputUnit') && shouldLockActualDropWeight(selectedCargoItem)) {
                const nextUnit = field === 'weightInputUnit'
                    ? value as ActualDropDraft['weightInputUnit']
                    : drop.weightInputUnit;
                return applyActualDropAutoWeightFromQty(drop, selectedCargoItem, drop.qtyKoli, nextUnit);
            }
            return { ...drop, [field]: value };
        };
        if (field === 'qtyKoli' || field === 'weightInputValue' || field === 'weightInputUnit' || field === 'volumeInputValue' || field === 'volumeInputUnit') {
            const currentDrop = actualDropPoints.find(item => item.draftKey === draftKey);
            if (currentDrop?.deliveryOrderItemRef) {
                const nextDrop = buildNextDrop(currentDrop);
                const valueKey = buildActualDropItemValueKey(draftKey, currentDrop.deliveryOrderItemRef);
                setActualDropItemValueMap(previous => ({
                    ...previous,
                    [valueKey]: pickActualDropItemValues(nextDrop),
                }));
            }
        }
        setActualDropPoints(previous =>
            previous.map(item => (item.draftKey === draftKey ? buildNextDrop(item) : item))
        );
    };

    const applyActualDropShipperReference = (draftKey: string, optionValue: string) => {
        const selectedReference = actualDropShipperReferenceOptions.find(reference => reference.optionValue === optionValue);
        setActualDropPoints(previous => previous.map(item => {
            if (item.draftKey !== draftKey) {
                return item;
            }
            if (!selectedReference) {
                return {
                    ...item,
                    deliveryOrderItemRef: '',
                    shipperReferenceKey: '',
                    shipperReferenceNumber: '',
                };
            }
            const nextDrop = {
                ...item,
                deliveryOrderItemRef: '',
                shipperReferenceKey: selectedReference.referenceKey || '',
                shipperReferenceNumber: selectedReference.referenceNumber || '',
                locationName:
                    selectedReference.receiverCompany?.trim()
                    || selectedReference.receiverName?.trim()
                    || selectedReference.receiverAddress?.trim()
                    || item.locationName,
                locationAddress: selectedReference.receiverAddress || item.locationAddress,
            };
            const firstCargoItem = getActualDropItemOptionsFromCargoItems(nextDrop, actualCargoItems)[0];
            if (!firstCargoItem) {
                return nextDrop;
            }
            return {
                ...nextDrop,
                deliveryOrderItemRef: firstCargoItem.deliveryOrderItemRef,
                shipperReferenceKey: firstCargoItem.shipperReferenceKey || nextDrop.shipperReferenceKey,
                shipperReferenceNumber: firstCargoItem.shipperReferenceNumber || nextDrop.shipperReferenceNumber,
                ...getRemainingActualDropValuesForCargoItem(firstCargoItem, item, draftKey),
            };
        }));
    };

    const getActualDropItemOptionsFromCargoItems = (
        drop: Pick<ActualDropDraft, 'deliveryOrderItemRef' | 'shipperReferenceKey' | 'shipperReferenceNumber'>,
        cargoItems: ActualCargoDraft[]
    ) => {
        const deliveryOrderItemRef = drop.deliveryOrderItemRef.trim();
        if (deliveryOrderItemRef) {
            return cargoItems.filter(item => item.deliveryOrderItemRef === deliveryOrderItemRef);
        }

        const shipperReferenceKey = drop.shipperReferenceKey.trim();
        const shipperReferenceNumber = drop.shipperReferenceNumber.trim().toUpperCase();
        if (!shipperReferenceKey && !shipperReferenceNumber) {
            return cargoItems;
        }

        return cargoItems.filter(item => (
            (shipperReferenceKey && item.shipperReferenceKey.trim() === shipperReferenceKey) ||
            (shipperReferenceNumber && item.shipperReferenceNumber.trim().toUpperCase() === shipperReferenceNumber)
        ));
    };

    const applyActualDropItem = (draftKey: string, deliveryOrderItemRef: string) => {
        const selectedCargoItem = actualCargoItems.find(item => item.deliveryOrderItemRef === deliveryOrderItemRef);
        const currentDrop = actualDropPoints.find(item => item.draftKey === draftKey);
        if (currentDrop?.deliveryOrderItemRef) {
            const currentValueKey = buildActualDropItemValueKey(draftKey, currentDrop.deliveryOrderItemRef);
            setActualDropItemValueMap(previous => ({
                ...previous,
                [currentValueKey]: pickActualDropItemValues(currentDrop),
            }));
        }

        setActualDropPoints(previous => previous.map(item => {
            if (item.draftKey !== draftKey) {
                return item;
            }
            if (!selectedCargoItem) {
                return {
                    ...item,
                    deliveryOrderItemRef: '',
                };
            }
            const selectedValueKey = buildActualDropItemValueKey(draftKey, selectedCargoItem.deliveryOrderItemRef);
            return {
                ...item,
                deliveryOrderItemRef: selectedCargoItem.deliveryOrderItemRef,
                shipperReferenceKey: selectedCargoItem.shipperReferenceKey || item.shipperReferenceKey,
                shipperReferenceNumber: selectedCargoItem.shipperReferenceNumber || item.shipperReferenceNumber,
                ...(actualDropItemValueMap[selectedValueKey] || getRemainingActualDropValuesForCargoItem(selectedCargoItem, item, draftKey)),
            };
        }));
    };

    const getActualDropValuesFromCargoItem = (
        cargoItem: ActualCargoDraft,
        fallback: Pick<ActualDropDraft, 'weightInputUnit' | 'volumeInputUnit'>
    ) => ({
        qtyKoli: cargoItem.actualQtyKoli || '',
        weightInputValue: cargoItem.actualWeightInputValue || '',
        weightInputUnit: cargoItem.actualWeightInputUnit || fallback.weightInputUnit,
        volumeInputValue: cargoItem.actualVolumeInputValue || '',
        volumeInputUnit: cargoItem.actualVolumeInputUnit || fallback.volumeInputUnit,
    });

    const getRemainingActualDropValuesForCargoItem = (
        cargoItem: ActualCargoDraft,
        fallback: Pick<ActualDropDraft, 'weightInputUnit' | 'volumeInputUnit'>,
        excludeDraftKey = ''
    ) => {
        const weightInputUnit = cargoItem.actualWeightInputUnit || fallback.weightInputUnit;
        const volumeInputUnit = cargoItem.actualVolumeInputUnit || fallback.volumeInputUnit;
        const baseQtyKoli = parseFormattedNumberish(cargoItem.actualQtyKoli || 0, { maxFractionDigits: 2 });
        const baseWeightKg = convertWeightToKg(
            parseFormattedNumberish(cargoItem.actualWeightInputValue || 0, {
                maxFractionDigits: cargoItem.actualWeightInputUnit === 'TON' ? 3 : 2,
            }),
            cargoItem.actualWeightInputUnit
        );
        const baseVolumeM3 = convertVolumeToM3(
            parseFormattedNumberish(cargoItem.actualVolumeInputValue || 0, {
                maxFractionDigits: cargoItem.actualVolumeInputUnit === 'LITER' ? 0 : 3,
            }),
            cargoItem.actualVolumeInputUnit
        );
        const visibleValueKeys = new Set(
            actualDropPoints
                .filter(drop => drop.deliveryOrderItemRef)
                .map(drop => buildActualDropItemValueKey(drop.draftKey, drop.deliveryOrderItemRef))
        );
        const usedFromVisibleDrops = actualDropPoints
            .filter(drop => drop.draftKey !== excludeDraftKey && drop.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef)
            .reduce((sum, drop) => ({
                qtyKoli: sum.qtyKoli + parseFormattedNumberish(drop.qtyKoli || 0, { maxFractionDigits: 2 }),
                weightKg: sum.weightKg + convertWeightToKg(
                    parseFormattedNumberish(drop.weightInputValue || 0, {
                        maxFractionDigits: drop.weightInputUnit === 'TON' ? 3 : 2,
                    }),
                    drop.weightInputUnit
                ),
                volumeM3: sum.volumeM3 + convertVolumeToM3(
                    parseFormattedNumberish(drop.volumeInputValue || 0, {
                        maxFractionDigits: drop.volumeInputUnit === 'LITER' ? 0 : 3,
                    }),
                    drop.volumeInputUnit
                ),
            }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        const usedFromCachedDrops = Object.entries(actualDropItemValueMap)
            .reduce((sum, [valueKey, cachedValues]) => {
                const parsedKey = parseActualDropItemValueKey(valueKey);
                if (
                    !parsedKey ||
                    parsedKey.draftKey === excludeDraftKey ||
                    parsedKey.deliveryOrderItemRef !== cargoItem.deliveryOrderItemRef ||
                    visibleValueKeys.has(valueKey)
                ) {
                    return sum;
                }
                return {
                    qtyKoli: sum.qtyKoli + parseFormattedNumberish(cachedValues.qtyKoli || 0, { maxFractionDigits: 2 }),
                    weightKg: sum.weightKg + convertWeightToKg(
                        parseFormattedNumberish(cachedValues.weightInputValue || 0, {
                            maxFractionDigits: cachedValues.weightInputUnit === 'TON' ? 3 : 2,
                        }),
                        cachedValues.weightInputUnit
                    ),
                    volumeM3: sum.volumeM3 + convertVolumeToM3(
                        parseFormattedNumberish(cachedValues.volumeInputValue || 0, {
                            maxFractionDigits: cachedValues.volumeInputUnit === 'LITER' ? 0 : 3,
                        }),
                        cachedValues.volumeInputUnit
                    ),
                };
            }, { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        const used = {
            qtyKoli: usedFromVisibleDrops.qtyKoli + usedFromCachedDrops.qtyKoli,
            weightKg: usedFromVisibleDrops.weightKg + usedFromCachedDrops.weightKg,
            volumeM3: usedFromVisibleDrops.volumeM3 + usedFromCachedDrops.volumeM3,
        };
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
    };

    const expandActualDropDraftsBySelectedItems = (
        dropDrafts: ActualDropDraft[],
        cargoItems: ActualCargoDraft[] = actualCargoItems
    ) =>
        dropDrafts.flatMap(drop => {
            if (drop.deliveryOrderItemRef) {
                return [drop];
            }

            const itemOptions = getActualDropItemOptionsFromCargoItems(drop, cargoItems);
            const firstItem = itemOptions[0];
            if (!firstItem) {
                return [drop];
            }

            return [{
                ...drop,
                deliveryOrderItemRef: firstItem.deliveryOrderItemRef,
                shipperReferenceKey: firstItem.shipperReferenceKey || drop.shipperReferenceKey,
                shipperReferenceNumber: firstItem.shipperReferenceNumber || drop.shipperReferenceNumber,
                ...getActualDropValuesFromCargoItem(firstItem, drop),
            }];
        });

    const toggleAdvancedDropEditor = () => {
        if (showAdvancedDropEditor) {
            setShowAdvancedDropEditor(false);
            return;
        }
        setActualDropPoints(current => expandActualDropDraftsBySelectedItems(current));
        setShowAdvancedDropEditor(true);
    };

    const addActualDropDraft = () => {
        const selectedReference = selectedActualDropShipperReferenceOptions[0];
        const nextDraft = createEmptyActualDropDraft();
        const baseDraft = selectedReference
            ? {
                ...nextDraft,
                shipperReferenceKey: selectedReference.referenceKey || '',
                shipperReferenceNumber: selectedReference.referenceNumber || '',
                locationName:
                    selectedReference.receiverCompany?.trim()
                    || selectedReference.receiverName?.trim()
                    || selectedReference.receiverAddress?.trim()
                    || nextDraft.locationName,
                locationAddress: selectedReference.receiverAddress || nextDraft.locationAddress,
            }
            : nextDraft;
        const firstCargoItem = getActualDropItemOptionsFromCargoItems(baseDraft, actualCargoItems)[0];
        setActualDropPoints(previous => [
            ...previous,
            firstCargoItem
                ? {
                    ...baseDraft,
                    deliveryOrderItemRef: firstCargoItem.deliveryOrderItemRef,
                    shipperReferenceKey: firstCargoItem.shipperReferenceKey || baseDraft.shipperReferenceKey,
                    shipperReferenceNumber: firstCargoItem.shipperReferenceNumber || baseDraft.shipperReferenceNumber,
                    ...getRemainingActualDropValuesForCargoItem(firstCargoItem, baseDraft),
                }
                : baseDraft,
        ]);
    };

    const removeActualDropDraft = (draftKey: string) => {
        setActualDropPoints(previous => previous.filter(item => item.draftKey !== draftKey));
        setActualDropItemValueMap(previous => {
            const next = { ...previous };
            Object.keys(next)
                .filter(key => key.startsWith(`${draftKey}${ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR}`))
                .forEach(key => {
                    delete next[key];
                });
            return next;
        });
    };

    useEffect(() => {
        void loadDO('initial');
    }, [loadDO]);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            if (editingTaripRef.current || hasOpenModal || document.hidden) {
                return;
            }
            void loadDO();
        }, 15000);

        return () => window.clearInterval(intervalId);
    }, [hasOpenModal, loadDO]);

    const updateDOStatus = async () => {
        if (!newStatus) return;
        const completingDelivery = newStatus === 'DELIVERED';
        const selectedCount = selectedStatusSuratJalanRefs.length;
        setUpdatingStatus(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'set-surat-jalan-status-batch',
                    data: {
                        id: doData?._id,
                        status: newStatus,
                        note: statusNote,
                        targetSuratJalanRefs: selectedStatusSuratJalanRefs,
                        ...(completingDelivery
                            ? {
                                podReceiverName: podName,
                                podReceivedDate: podDate,
                                podNote,
                                actualItems: selectedDerivedActualCargoItems.map(item => ({
                                    deliveryOrderItemRef: item.deliveryOrderItemRef,
                                    actualQtyKoli: parseFormattedNumberish(item.actualQtyKoli),
                                    actualWeightInputValue: parseFormattedNumberish(item.actualWeightInputValue, {
                                        maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
                                    }),
                                    actualWeightInputUnit: item.actualWeightInputUnit,
                                    actualVolumeInputValue: item.actualVolumeInputValue.trim()
                                        ? parseFormattedNumberish(item.actualVolumeInputValue, {
                                            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                                        })
                                        : 0,
                                    actualVolumeInputUnit: item.actualVolumeInputUnit,
                                })),
                                actualDropPoints: (showAdvancedDropEditor ? selectedEffectiveActualDropPoints : [autoActualDropDraft]).map(item => ({
                                    stopType: item.stopType,
                                    deliveryOrderItemRef: item.deliveryOrderItemRef,
                                    shipperReferenceKey: item.shipperReferenceKey,
                                    shipperReferenceNumber: item.shipperReferenceNumber,
                                    locationName: item.locationName,
                                    locationAddress: item.locationAddress,
                                    qtyKoli: item.qtyKoli.trim() ? parseFormattedNumberish(item.qtyKoli) : 0,
                                    weightInputValue: item.weightInputValue.trim()
                                        ? parseFormattedNumberish(item.weightInputValue, {
                                            maxFractionDigits: item.weightInputUnit === 'TON' ? 3 : 2,
                                        })
                                        : 0,
                                    weightInputUnit: item.weightInputUnit,
                                    volumeInputValue: item.volumeInputValue.trim()
                                        ? parseFormattedNumberish(item.volumeInputValue, {
                                            maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
                                        })
                                        : 0,
                                    volumeInputUnit: item.volumeInputUnit,
                                    note: item.note,
                                })),
                            }
                            : {}),
                    },
                }),
            });
            const d = await res.json();
            if (!res.ok) {
                addToast('error', d.error || 'Gagal memperbarui status surat jalan');
                return;
            }

            setShowStatusModal(false);
            setNewStatus('');
            setStatusNote('');
            setReviewingDriverRequest(false);
            if (completingDelivery) {
                setPodName('');
                setPodDate(getBusinessDateValue());
                setPodNote('');
            }
            setSelectedStatusSuratJalanRefs([]);
            await refreshTripDetail();
            addToast(
                'success',
                completingDelivery
                    ? `${selectedCount} SJ berhasil difinalkan dan POD tersimpan`
                    : `${selectedCount} SJ berhasil dipindahkan ke ${DO_STATUS_MAP[newStatus]?.label || newStatus}`
            );
        } catch {
            addToast('error', 'Gagal memperbarui batch surat jalan');
        } finally {
            setUpdatingStatus(false);
        }
    };

    const savePOD = async () => {
        setSavingPOD(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'update',
                    data: buildDeliveryOrderPodUpdateData({
                        id: doData?._id,
                        podName,
                        podDate,
                        podNote,
                    }),
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan POD');
                return;
            }
            setShowPODModal(false);
            setPodName('');
            setPodDate(getBusinessDateValue());
            setPodNote('');
            await refreshTripDetail();
            addToast('success', 'POD berhasil disimpan');
        } catch {
            addToast('error', 'Gagal menyimpan POD');
        } finally {
            setSavingPOD(false);
        }
    };

    const handlePrint = async () => {
        const printWindow = openPrintWindow('Menyiapkan cetak surat jalan...');
        if (!printWindow) {
            addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba cetak lagi.');
            return;
        }
        try {
            const company = resolveDocumentIssuerProfile(doData, await fetchCompanyProfile().catch(() => null));
            openBrandedPrint({
                title: 'Surat Jalan',
                subtitle: displayTripNumber,
                company,
                targetWindow: printWindow,
                bodyHtml: doData ? buildDeliveryOrderPrintHtml(doData, doItems, trackingLogs) : '',
            });
        } catch {
            try {
                printWindow.close();
            } catch {}
            addToast('error', 'Gagal menyiapkan dokumen cetak');
        }
    };

    const handleExportPDF = async () => {
        try {
            const companyData = await fetchCompanyProfile().catch(() => null);
            const issuerCompany = resolveDocumentIssuerProfile(doData, companyData as CompanyProfile | null);
            if (!issuerCompany) {
                throw new Error('Profil perusahaan tidak tersedia');
            }
            generateDOPdf(doData!, doItems, issuerCompany);
            addToast('success', 'PDF Surat Jalan berhasil di-download');
        } catch (err) {
            console.error('PDF Export Error:', err);
            addToast('error', `Gagal membuat PDF: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    const saveTaripBorongan = async () => {
        setSavingTarip(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'update',
                    data: buildDeliveryOrderTripFeeUpdateData({
                        id: doData?._id,
                        tripRouteRateRef,
                        tripOriginArea,
                        tripDestinationArea,
                        taripBorongan: matchedTripRouteRate?.rate ?? taripBorongan,
                        keteranganBorongan,
                    }),
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan upah trip');
                return;
            }
            setEditingTarip(false);
            await refreshTripDetail();
            addToast('success', 'Upah trip disimpan');
        } catch {
            addToast('error', 'Gagal menyimpan upah trip');
        } finally {
            setSavingTarip(false);
        }
    };

    const saveTripResources = async () => {
        if (!tripVehicleRef && !tripDriverRef) {
            addToast('error', 'Pilih kendaraan dan/atau supir untuk trip ini');
            return;
        }

        setSavingTripResources(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'assign-trip-resources',
                    data: {
                        id: doData?._id,
                        vehicleRef: tripVehicleRef || undefined,
                        driverRef: tripDriverRef || undefined,
                        vehicleCategoryOverrideReason: requiresTripVehicleOverrideReason
                            ? tripVehicleOverrideReason
                            : undefined,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal melengkapi armada trip');
                return;
            }
            setShowTripResourcesModal(false);
            await refreshTripDetail();
            addToast('success', 'Armada trip berhasil diperbarui');
        } catch {
            addToast('error', 'Gagal melengkapi armada trip');
        } finally {
            setSavingTripResources(false);
        }
    };

    const saveShipperReference = async () => {
        const normalizeDraftValue = (value: unknown) => String(value ?? '').trim();
        const normalizedReferences = shipperReferenceDrafts
            .map(entry => ({
                referenceKey: entry.referenceKey.trim(),
                referenceNumber: entry.referenceNumber.trim().toUpperCase(),
                pickupStopKey: entry.pickupStopKey.trim(),
                billingCustomerRef: entry.billingCustomerRef.trim(),
                billingCustomerName: entry.billingCustomerName.trim(),
                receiverName: entry.receiverName.trim(),
                receiverPhone: entry.receiverPhone.trim(),
                receiverAddress: entry.receiverAddress.trim(),
                receiverCompany: entry.receiverCompany.trim(),
            }))
            .filter(entry => Boolean(entry.referenceNumber));
        if (normalizedReferences.length === 0) {
            addToast('error', 'Minimal 1 SJ pengirim wajib diisi');
            return;
        }
        if (pickupStopList.length > 1) {
            const invalidPickupIndex = normalizedReferences.findIndex(entry => !entry.pickupStopKey);
            if (invalidPickupIndex >= 0) {
                addToast('error', `Titik pickup wajib dipilih pada SJ pengirim baris ${invalidPickupIndex + 1}`);
                return;
            }
        }
        const duplicateReferenceNumber = (() => {
            const seen = new Set<string>();
            for (const reference of normalizedReferences) {
                if (seen.has(reference.referenceNumber)) {
                    return reference.referenceNumber;
                }
                seen.add(reference.referenceNumber);
            }
            return '';
        })();
        if (duplicateReferenceNumber) {
            addToast('error', `No. SJ pengirim ${duplicateReferenceNumber} terisi lebih dari sekali. Pakai 1 baris SJ saja lalu lengkapi datanya di baris itu.`);
            return;
        }

        const normalizedSelectedItemDrafts = selectedShipperReferenceItemDrafts
            .map(item => ({
                ...item,
                customerProductRef: normalizeDraftValue(item.customerProductRef),
                description: normalizeDraftValue(item.description),
                qtyKoli: normalizeDraftValue(item.qtyKoli),
                weightInputValue: normalizeDraftValue(item.weightInputValue),
                volumeInputValue: normalizeDraftValue(item.volumeInputValue),
            }))
            .filter(item =>
                Boolean(
                    item.customerProductRef ||
                    item.description ||
                    item.qtyKoli ||
                    item.weightInputValue ||
                    item.volumeInputValue
                )
            );
        const invalidSelectedItemIndex = normalizedSelectedItemDrafts.findIndex(item =>
            !item.description && !item.customerProductRef
        );
        if (invalidSelectedItemIndex >= 0) {
            addToast('error', `Barang baru baris ${invalidSelectedItemIndex + 1} perlu deskripsi atau master barang.`);
            return;
        }
        const invalidSelectedItemCargoIndex = normalizedSelectedItemDrafts.findIndex(item =>
            !item.qtyKoli && !item.weightInputValue && !item.volumeInputValue
        );
        if (invalidSelectedItemCargoIndex >= 0) {
            addToast('error', `Barang baru baris ${invalidSelectedItemCargoIndex + 1} perlu isi koli, berat, atau volume.`);
            return;
        }
        const normalizedExistingItemDrafts = (isCreatingNewShipperReference
            ? []
            : Object.entries(shipperReferenceExistingItemDraftMap))
            .flatMap(([draftKey, items]) => {
                const matchingDraft = shipperReferenceDrafts.find(entry => entry.draftKey === draftKey);
                if (!matchingDraft) {
                    return [];
                }
                return items.map(item => ({
                    deliveryOrderItemId: item.deliveryOrderItemId,
                    customerProductRef: normalizeDraftValue(item.customerProductRef),
                    description: normalizeDraftValue(item.description),
                    qtyKoli: normalizeDraftValue(item.qtyKoli),
                    weightInputValue: normalizeDraftValue(item.weightInputValue),
                    weightInputUnit: item.weightInputUnit,
                    volumeInputValue: normalizeDraftValue(item.volumeInputValue),
                    volumeInputUnit: item.volumeInputUnit,
                    shipperReferenceNumber: matchingDraft.referenceNumber.trim().toUpperCase(),
                    pickupStopKey: matchingDraft.pickupStopKey.trim() || undefined,
                }));
            })
            .filter(item => Boolean(item.deliveryOrderItemId));
        const invalidExistingItemIndex = normalizedExistingItemDrafts.findIndex(item =>
            !item.description && !item.customerProductRef
        );
        if (invalidExistingItemIndex >= 0) {
            addToast('error', `Barang tersimpan baris ${invalidExistingItemIndex + 1} perlu deskripsi atau master barang.`);
            return;
        }
        const invalidExistingItemCargoIndex = normalizedExistingItemDrafts.findIndex(item =>
            !item.qtyKoli && !item.weightInputValue && !item.volumeInputValue
        );
        if (invalidExistingItemCargoIndex >= 0) {
            addToast('error', `Barang tersimpan baris ${invalidExistingItemCargoIndex + 1} perlu isi koli, berat, atau volume.`);
            return;
        }

        setSavingShipperReference(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'update-shipper-reference',
                    data: {
                        id: doData?._id,
                        shipperReferences: normalizedReferences.map(reference => ({
                            _key: reference.referenceKey || undefined,
                            referenceNumber: reference.referenceNumber,
                            pickupStopKey: reference.pickupStopKey || undefined,
                            billingCustomerRef: reference.billingCustomerRef || undefined,
                            billingCustomerName: reference.billingCustomerName || undefined,
                            receiverName: reference.receiverName || undefined,
                            receiverPhone: reference.receiverPhone || undefined,
                            receiverAddress: reference.receiverAddress || undefined,
                            receiverCompany: reference.receiverCompany || undefined,
                        })),
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan SJ pengirim');
                return;
            }
            if (normalizedSelectedItemDrafts.length > 0 && selectedShipperReferenceDraft) {
                const selectedReferenceAfterSave = normalizedReferences.find(reference =>
                    reference.referenceKey === selectedShipperReferenceDraft.referenceKey.trim() ||
                    reference.referenceNumber === selectedShipperReferenceDraft.referenceNumber.trim().toUpperCase()
                );
                const cargoRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'delivery-orders',
                        action: 'append-cargo-items',
                        data: {
                            id: doData?._id,
                            cargoItems: normalizedSelectedItemDrafts.map(item => ({
                                ...item,
                                shipperReferenceNumber: selectedReferenceAfterSave?.referenceNumber || selectedShipperReferenceDraft.referenceNumber.trim().toUpperCase(),
                                pickupStopKey: (selectedReferenceAfterSave?.pickupStopKey || selectedShipperReferenceDraft.pickupStopKey || '').trim() || undefined,
                            })),
                        },
                    }),
                });
                const cargoResult = await cargoRes.json();
                if (!cargoRes.ok) {
                    addToast('error', cargoResult.error || 'SJ tersimpan, tapi gagal menambah barang baru.');
                    return;
                }
            }
            for (const item of normalizedExistingItemDrafts) {
                const cargoUpdateRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'delivery-orders',
                        action: 'update-cargo-item',
                        data: {
                            id: doData?._id,
                            deliveryOrderItemId: item.deliveryOrderItemId,
                            cargoItem: {
                                customerProductRef: item.customerProductRef || undefined,
                                description: item.description,
                                qtyKoli: item.qtyKoli,
                                weightInputValue: item.weightInputValue,
                                weightInputUnit: item.weightInputUnit,
                                volumeInputValue: item.volumeInputValue,
                                volumeInputUnit: item.volumeInputUnit,
                                shipperReferenceNumber: item.shipperReferenceNumber,
                                pickupStopKey: item.pickupStopKey,
                            },
                        },
                    }),
                });
                const cargoUpdateResult = await cargoUpdateRes.json();
                if (!cargoUpdateRes.ok) {
                    addToast('error', cargoUpdateResult.error || 'SJ tersimpan, tapi gagal memperbarui barang terdaftar.');
                    return;
                }
            }
            setShowShipperReferenceModal(false);
            setShipperReferenceExistingItemDraftMap({});
            setShipperReferenceItemDraftMap({});
            await refreshTripDetail();
            addToast(
                'success',
                normalizedSelectedItemDrafts.length > 0 || normalizedExistingItemDrafts.length > 0
                    ? 'Dokumen Surat Jalan dan barang berhasil diperbarui'
                    : 'Dokumen Surat Jalan berhasil diperbarui'
            );
        } catch {
            addToast('error', 'Gagal menyimpan SJ pengirim');
        } finally {
            setSavingShipperReference(false);
        }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!doData) return <div className="empty-state"><div className="empty-state-title">Trip tidak ditemukan</div></div>;

    const hasTripResourcesAssigned = Boolean(doData.vehicleRef && doData.driverRef);
    const displayTripStatus = tripData?.status || doData.status;
    const tripResourceActionLabel = getTripResourceActionLabel(doData);
    const tripResourceBusyIds = buildTripResourceBusyIds(activeTrips, doData._id);
    const assignableVehicles = getAssignableTripVehicles({
        vehicles,
        busyVehicleIds: tripResourceBusyIds.busyVehicleIds,
        currentVehicleRef: doData.vehicleRef,
        requestedServiceRef: doData.serviceRef,
    });
    const assignableDrivers = getAssignableTripDrivers({
        drivers,
        busyDriverIds: tripResourceBusyIds.busyDriverIds,
        currentDriverRef: doData.driverRef,
    });
    const resolvedShipperReferenceEntries = buildResolvedShipperReferenceEntries(doData, doItems);
    const selectedTripVehicle = assignableVehicles.find(vehicle => vehicle._id === tripVehicleRef) || null;
    const requiresTripVehicleOverrideReason = shouldRequireTripVehicleOverrideReason(doData, selectedTripVehicle);
    const isCompletingDelivery = newStatus === 'DELIVERED';
    const pendingDriverStatusMeta = doData.pendingDriverStatus ? DO_STATUS_MAP[doData.pendingDriverStatus] : null;
    const shipperReferenceList = Array.from(new Set(resolvedShipperReferenceEntries.map(reference => reference.referenceNumber)));
    const hasShipperReference = shipperReferenceList.length > 0;
    const normalizedShipperReferenceFormat = shipperReferenceFormat.trim().toUpperCase() || 'SJ';
    const shipperReferenceExample = `${normalizedShipperReferenceFormat}/27032026/001`;
    const pickupStopList = (doData.pickupStops || [])
        .map((pickupStop, index) => ({
            _key: pickupStop._key || `pickup-stop-${index + 1}`,
            sequence: pickupStop.sequence || index + 1,
            pickupLabel: pickupStop.pickupLabel || '',
            pickupAddress: pickupStop.pickupAddress || '',
        }))
        .sort((left, right) => left.sequence - right.sequence);
    const pickupStopMap = new Map(pickupStopList.map(stop => [stop._key, stop]));
    const isCreatingNewShipperReference = shipperReferenceModalMode === 'create';
    const selectedShipperReferenceDraft =
        shipperReferenceDrafts.find(entry => entry.draftKey === selectedShipperReferenceDraftKey)
        || (isCreatingNewShipperReference ? shipperReferenceDrafts[0] || null : null);
    const selectedShipperReferenceItemDrafts = selectedShipperReferenceDraft
        ? (shipperReferenceItemDraftMap[selectedShipperReferenceDraft.draftKey] || [])
        : [];
    const selectedShipperReferenceExistingItemDrafts = selectedShipperReferenceDraft
        ? (shipperReferenceExistingItemDraftMap[selectedShipperReferenceDraft.draftKey] || [])
        : [];
    const shipperReferenceDisplayList = resolvedShipperReferenceEntries.map(reference => ({
        ...reference,
        pickupLabel: reference.pickupStopKey && pickupStopMap.get(reference.pickupStopKey)
            ? `Pickup ${pickupStopMap.get(reference.pickupStopKey)?.sequence}${pickupStopMap.get(reference.pickupStopKey)?.pickupLabel ? ` - ${pickupStopMap.get(reference.pickupStopKey)?.pickupLabel}` : ''}`
            : reference.pickupLabel,
        pickupAddress: reference.pickupStopKey && pickupStopMap.get(reference.pickupStopKey)
            ? pickupStopMap.get(reference.pickupStopKey)?.pickupAddress || reference.pickupAddress
            : reference.pickupAddress,
    }));
    const suratJalanDocumentByReferenceKey = new Map(
        suratJalanDocuments
            .map(document => [document.referenceKey || 'primary', document] as const)
    );
    const getSuratJalanOperationalStatus = (referenceKey?: string) => {
        const document = suratJalanDocumentByReferenceKey.get(referenceKey || 'primary') || null;
        const status = document?.tripStatus || displayTripStatus;
        return {
            document,
            status,
            meta: DO_STATUS_MAP[status] || displayStatusMeta,
        };
    };
    const isTripClosedByAdmin = Boolean(doData.tripClosedByAdminAt);
    const hasEditableShipperReference = shipperReferenceDisplayList.some(reference =>
        getSuratJalanOperationalStatus(reference.referenceKey).status !== 'DELIVERED'
    );
    const selectedShipperReferenceDraftStatus = selectedShipperReferenceDraft
        ? getSuratJalanOperationalStatus(selectedShipperReferenceDraft.referenceKey).status
        : '';
    const isDeliveryOrderItemEditable = (item: Pick<DeliveryOrderItem, '_id' | 'shipperReferenceKey'>) =>
        Boolean(editableCargoItemMap[item._id]) &&
        !isTripClosedByAdmin &&
        getSuratJalanOperationalStatus(item.shipperReferenceKey).status !== 'DELIVERED';
    const suratJalanStatusSortWeight: Record<string, number> = {
        CREATED: 0,
        HEADING_TO_PICKUP: 1,
        ON_DELIVERY: 2,
        ARRIVED: 3,
        DELIVERED: 4,
        CANCELLED: 5,
    };
    const sortedShipperReferenceDisplayList = [...shipperReferenceDisplayList].sort((left, right) => {
        const leftStatus = getSuratJalanOperationalStatus(left.referenceKey).status;
        const rightStatus = getSuratJalanOperationalStatus(right.referenceKey).status;
        const weightDiff = (suratJalanStatusSortWeight[leftStatus] ?? 999) - (suratJalanStatusSortWeight[rightStatus] ?? 999);
        if (weightDiff !== 0) {
            return weightDiff;
        }
        return left.referenceNumber.localeCompare(right.referenceNumber);
    });
    const filteredShipperReferenceDisplayList = suratJalanStatusFilter
        ? sortedShipperReferenceDisplayList.filter(reference =>
            getSuratJalanOperationalStatus(reference.referenceKey).status === suratJalanStatusFilter
        )
        : sortedShipperReferenceDisplayList;
    const suratJalanStatusSummary = sortedShipperReferenceDisplayList.reduce<Map<string, number>>((acc, reference) => {
        const status = getSuratJalanOperationalStatus(reference.referenceKey).status;
        acc.set(status, (acc.get(status) || 0) + 1);
        return acc;
    }, new Map());
    const actualDropShipperReferenceOptions = shipperReferenceDisplayList.map(reference => {
            const optionValue = `sj:${reference.referenceKey || reference.draftKey || reference.referenceNumber}`;
            return {
                ...reference,
                optionValue,
                optionLabel: `${reference.referenceNumber}${reference.receiverCompany || reference.receiverName ? ` - ${reference.receiverCompany || reference.receiverName}` : ''}`,
            };
        });
    const resolveActualDropShipperReferenceValue = (
        drop: Pick<ActualDropDraft, 'deliveryOrderItemRef' | 'shipperReferenceKey' | 'shipperReferenceNumber'>
    ) => {
        const itemCargo = drop.deliveryOrderItemRef
            ? actualCargoItems.find(item => item.deliveryOrderItemRef === drop.deliveryOrderItemRef)
            : null;
        const matchedReference = shipperReferenceDisplayList.find(reference =>
            (itemCargo?.shipperReferenceKey && reference.referenceKey === itemCargo.shipperReferenceKey) ||
            (itemCargo?.shipperReferenceNumber && reference.referenceNumber === itemCargo.shipperReferenceNumber) ||
            (drop.shipperReferenceKey && reference.referenceKey === drop.shipperReferenceKey) ||
            (drop.shipperReferenceNumber && reference.referenceNumber === drop.shipperReferenceNumber)
        );
        const referenceValue = matchedReference?.referenceKey || matchedReference?.draftKey || matchedReference?.referenceNumber;
        return referenceValue ? `sj:${referenceValue}` : '';
    };
    const getActualDropItemOptions = (
        drop: Pick<ActualDropDraft, 'deliveryOrderItemRef' | 'shipperReferenceKey' | 'shipperReferenceNumber'>
    ) => {
        const selectedReferenceValue = resolveActualDropShipperReferenceValue(drop);
        const selectedReference = actualDropShipperReferenceOptions.find(reference => reference.optionValue === selectedReferenceValue);
        if (!selectedReference) {
            return actualCargoItems;
        }
        return actualCargoItems.filter(item => {
            const sourceDoItem = doItems.find(row => row._id === item.deliveryOrderItemRef);
            const itemReferenceKey = (item.shipperReferenceKey || sourceDoItem?.shipperReferenceKey || '').trim();
            const itemReferenceNumber = (
                item.shipperReferenceNumber ||
                sourceDoItem?.shipperReferenceNumber ||
                doData.customerDoNumber ||
                doData.doNumber ||
                ''
            ).trim().toUpperCase();
            return (
                (selectedReference.referenceKey && itemReferenceKey === selectedReference.referenceKey) ||
                (selectedReference.referenceNumber && itemReferenceNumber === selectedReference.referenceNumber.trim().toUpperCase())
            );
        });
    };
    const resolveActualDropItemValue = (
        drop: Pick<ActualDropDraft, 'deliveryOrderItemRef'>
    ) => drop.deliveryOrderItemRef ? drop.deliveryOrderItemRef : '';
    const getActualDropCargoSummary = (
        drop: Pick<ActualDropDraft, 'deliveryOrderItemRef' | 'shipperReferenceKey' | 'shipperReferenceNumber'>
    ) =>
        summarizeActualCargoDraftDescriptions(getActualCargoDraftsForDrop(drop, actualCargoItems));
    const cargoGroups = (() => {
        const groups = new Map<string, {
            key: string;
            shipperReferenceNumber: string;
            pickupStopKey: string;
            pickupLabel: string;
            pickupAddress: string;
            items: DeliveryOrderItem[];
        }>();
        for (const item of doItems) {
            const shipperReferenceNumber = item.shipperReferenceNumber?.trim() || doData.customerDoNumber || 'TANPA-SJ';
            const pickupStop = item.pickupStopKey ? pickupStopMap.get(item.pickupStopKey) : null;
            const pickupLabel = pickupStop
                ? `Pickup ${pickupStop.sequence}${pickupStop.pickupLabel ? ` - ${pickupStop.pickupLabel}` : ''}`
                : item.pickupAddress
                    ? 'Pickup'
                    : '';
            const pickupAddress = pickupStop?.pickupAddress || item.pickupAddress || '';
            const key = `${pickupStop?._key || item.pickupStopKey || 'tanpa-pickup'}::${shipperReferenceNumber}`;
            const current = groups.get(key);
            if (current) {
                current.items.push(item);
                continue;
            }
            groups.set(key, {
                key,
                shipperReferenceNumber,
                pickupStopKey: pickupStop?._key || item.pickupStopKey || '',
                pickupLabel,
                pickupAddress,
                items: [item],
            });
        }
        return [...groups.values()];
    })();
    const flattenedCargoDraftItems = flattenDeliveryOrderCargoDraftGroups(cargoDraftGroups);
    const cargoDraftGroupsWithItems = getDraftDeliveryOrderCargoGroups(cargoDraftGroups);
    const cargoDraftSummary = summarizeDraftOrderCargo(flattenedCargoDraftItems);
    const cargoDraftItemCount = cargoDraftGroupsWithItems.reduce((sum, group) => sum + getDeliveryOrderCargoDraftItems(group).length, 0);
    const cargoDraftSelectedProductRefs = new Set(
        flattenedCargoDraftItems
            .map(item => item.customerProductRef.trim())
            .filter(Boolean)
    );
    const deliveryOrderCustomerProducts = customerProducts.filter(product =>
        product.customerRef === doData.customerRef ||
        cargoDraftSelectedProductRefs.has(product._id)
    );
    const isEditingCargoItem = Boolean(editingCargoItemId);
    const canAppendCargoToDo =
        canEditDeliveryCargo &&
        ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED', 'PARTIAL_HOLD'].includes(doData.status) &&
        !isTripClosedByAdmin &&
        !doData.pendingDriverStatus;
    const linkedVoucherSummary = linkedVoucher ? getDriverVoucherFinancialSummary(linkedVoucher) : null;
    const linkedTripCashVoucherId = linkedVoucher?._id || linkedTripCashLink?.voucherId || '';
    const linkedTripCashBonNumber = linkedVoucher?.bonNumber || linkedTripCashLink?.bonNumber || linkedVoucherBonNumber;
    const linkedTripCashIssuedDate = linkedVoucher?.issuedDate || linkedTripCashLink?.issuedDate || '';
    const linkedTripCashStatus = linkedVoucher?.status || linkedTripCashLink?.status || null;
    const hasLinkedTripCash = Boolean(linkedTripCashVoucherId || linkedTripCashBonNumber);
    const linkedVoucherStatusMeta = linkedTripCashStatus
        ? ({
            DRAFT: { label: 'Draft', cls: 'badge-gray' },
            ISSUED: { label: 'Belum Diselesaikan', cls: 'badge-info' },
            SETTLED: { label: 'Selesai', cls: 'badge-success' },
        }[linkedTripCashStatus || 'DRAFT'])
        : null;
    const baseTripFee = doData.baseTaripBorongan ?? doData.taripBorongan ?? 0;
    const overtonaseDriverAmount = doData.overtonaseDriverAmount || 0;
    const totalTripFee = doData.taripBorongan || 0;
    const hasOvertonase = (doData.overtonaseWeightKg || 0) > 0;
    const exceedsVehicleCapacity = (doData.vehicleCapacityExceededKg || 0) > 0;
    const effectiveOvertonaseLimitKg = doData.vehicleCapacityKg || doData.serviceMaxPayloadKg || 0;
    const effectiveOvertonaseLimitSource = doData.vehicleCapacityKg ? 'Kapasitas kendaraan' : 'Referensi layanan';
    const shouldOpenTripFeeCard = !doData.taripBorongan || hasOvertonase || exceedsVehicleCapacity;
    const settledVoucherNeedsManualAdjustment = Boolean(
        linkedVoucher?.status === 'SETTLED' &&
        totalTripFee > 0 &&
        Math.abs((linkedVoucher.driverFeeAmount || 0) - totalTripFee) > 0.01
    );
    const voucherIssueBlockingReasons = [
        !doData.driverRef ? 'supir trip belum diisi' : null,
        !doData.vehicleRef && !doData.vehiclePlate ? 'kendaraan trip belum diisi' : null,
        !doData.taripBorongan || doData.taripBorongan <= 0 ? 'upah trip belum diisi di Trip' : null,
        !['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED'].includes(doData.status)
            ? 'status Trip tidak bisa diterbitkan ke uang jalan trip'
            : null,
    ].filter((value): value is string => Boolean(value));
    const canIssueVoucherFromDo =
        canCreateTripCash &&
        !hasLinkedTripCash &&
        voucherIssueBlockingReasons.length === 0;
    const canShowTripManager =
        canAssignTripResources ||
        canEditShipperReference ||
        canManageTripFee ||
        canCreateTripCash ||
        canOpenTripCashPage ||
        canManageDeliveryStatus;
    const {
        autoActualDropDraft,
        actualDropSummary,
        actualDropMismatchMessage,
        actualDropAmbiguityMessage,
        hasLiveCoordinates,
        trackingMapUrl,
        mapEmbedUrl,
    } = buildDeliveryOrderDetailState({
        doData,
        actualCargoItems,
        actualDropPoints,
        showAdvancedDropEditor,
    });
    const displayStatusMeta = DO_STATUS_MAP[displayTripStatus] || getDeliveryOrderDisplayStatusMeta(doData);
    const completionOutcome = deriveDeliveryOrderCompletionOutcome(doData);
    const billableCargoSummary = getDeliveryOrderBillableCargoSummary(doData);
    const holdCargoSummary = getDeliveryOrderHoldCargoSummary(doData);
    const returnCargoSummary = getDeliveryOrderReturnCargoSummary(doData);
    const displayTripNumber = tripData?.tripNumber || formatInternalDeliveryOrderNumber(doData);
    const suratJalanStatusOptions = suratJalanDocuments.filter(document => document.itemCount > 0);
    const getEligibleStatusesForSuratJalan = (document: SuratJalanDocument) =>
        getNextDeliveryOrderStatuses(document.tripStatus || displayTripStatus).filter(status =>
            status === 'CREATED' ||
            status === 'CANCELLED' ||
            hasTripResourcesAssigned
        );
    const availableBatchStatuses = BATCH_SURAT_JALAN_STATUS_OPTIONS.filter(status =>
        suratJalanStatusOptions.some(document => getEligibleStatusesForSuratJalan(document).includes(status))
    );
    const eligibleStatusSuratJalanDocuments = newStatus
        ? suratJalanStatusOptions.filter(document => getEligibleStatusesForSuratJalan(document).includes(newStatus))
        : [];
    const selectedStatusSuratJalanSet = new Set(selectedStatusSuratJalanRefs);
    const selectedStatusSuratJalanDocuments = suratJalanDocuments.filter(document =>
        selectedStatusSuratJalanSet.has(document._id)
    );
    const hasSelectedPrimarySuratJalan = selectedStatusSuratJalanDocuments.some(document => !document.referenceKey);
    const selectedStatusReferenceKeys = new Set(
        selectedStatusSuratJalanDocuments
            .map(document => (document.referenceKey || '').trim())
            .filter(Boolean)
    );
    const selectedStatusReferenceNumbers = new Set(
        selectedStatusSuratJalanDocuments
            .map(document => (document.suratJalanNumber || '').trim().toUpperCase())
            .filter(Boolean)
    );
    const matchesSelectedStatusSuratJalan = (shipperReferenceKey?: string, shipperReferenceNumber?: string) => {
        const normalizedKey = (shipperReferenceKey || '').trim();
        const normalizedNumber = (shipperReferenceNumber || '').trim().toUpperCase();
        if (normalizedKey && selectedStatusReferenceKeys.has(normalizedKey)) {
            return true;
        }
        if (normalizedNumber && selectedStatusReferenceNumbers.has(normalizedNumber)) {
            return true;
        }
        return hasSelectedPrimarySuratJalan && !normalizedKey && !normalizedNumber;
    };
    const partialHoldContinuationItemRefSet = new Set(partialHoldContinuationItemRefs);
    const selectedPartialHoldSuratJalanRefSet = new Set(
        selectedStatusSuratJalanDocuments
            .filter(document => document.tripStatus === 'PARTIAL_HOLD')
            .map(document => document._id)
    );
    const getActualCargoItemSuratJalanRef = (item: ActualCargoDraft) =>
        `${doData._id}:${item.shipperReferenceKey || item.shipperReferenceNumber || 'primary'}`;
    const selectedActualCargoItems = actualCargoItems.filter(item =>
        matchesSelectedStatusSuratJalan(item.shipperReferenceKey, item.shipperReferenceNumber) &&
        (
            newStatus !== 'DELIVERED' ||
            !selectedPartialHoldSuratJalanRefSet.has(getActualCargoItemSuratJalanRef(item)) ||
            partialHoldContinuationItemRefSet.has(item.deliveryOrderItemRef)
        )
    );
    const shouldDisableAutoInferredActualDropPoints =
        newStatus === 'DELIVERED' &&
        partialHoldContinuationItemRefSet.size > 0 &&
        selectedPartialHoldSuratJalanRefSet.size > 0;
    const selectedActualCargoItemRefs = new Set(selectedActualCargoItems.map(item => item.deliveryOrderItemRef));
    const selectedActualCargoItemByRef = new Map(
        selectedActualCargoItems.map(item => [item.deliveryOrderItemRef, item])
    );
    const selectedActualDropPoints = actualDropPoints.filter(drop => {
        const hasDropTarget =
            Boolean(drop.deliveryOrderItemRef) ||
            Boolean(drop.shipperReferenceKey) ||
            Boolean(drop.shipperReferenceNumber);
        return (
            selectedActualCargoItemRefs.has(drop.deliveryOrderItemRef) ||
            matchesSelectedStatusSuratJalan(drop.shipperReferenceKey, drop.shipperReferenceNumber) ||
            (showAdvancedDropEditor && !hasDropTarget)
        );
    });
    const selectedWorkingActualDropPoints = (() => {
        if (!showAdvancedDropEditor) {
            return selectedActualDropPoints;
        }

        const visibleDropValueKeys = new Set(
            selectedActualDropPoints
                .filter(drop => drop.deliveryOrderItemRef.trim())
                .map(drop => buildActualDropItemValueKey(drop.draftKey, drop.deliveryOrderItemRef))
                .filter(Boolean)
        );
        const cachedDropPoints = Object.entries(actualDropItemValueMap)
            .map(([valueKey, cachedValues]) => {
                const parsedKey = parseActualDropItemValueKey(valueKey);
                if (!parsedKey || visibleDropValueKeys.has(valueKey)) {
                    return null;
                }
                const sourceDrop = actualDropPoints.find(drop => drop.draftKey === parsedKey.draftKey);
                const cargoItem = selectedActualCargoItemByRef.get(parsedKey.deliveryOrderItemRef);
                if (!sourceDrop || !cargoItem || !selectedActualCargoItemRefs.has(parsedKey.deliveryOrderItemRef)) {
                    return null;
                }
                return {
                    ...sourceDrop,
                    ...cachedValues,
                    draftKey: `${sourceDrop.draftKey}${ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR}${parsedKey.deliveryOrderItemRef}`,
                    deliveryOrderItemRef: parsedKey.deliveryOrderItemRef,
                    shipperReferenceKey: cargoItem.shipperReferenceKey || sourceDrop.shipperReferenceKey,
                    shipperReferenceNumber: cargoItem.shipperReferenceNumber || sourceDrop.shipperReferenceNumber,
                };
            })
            .filter((drop): drop is ActualDropDraft => Boolean(drop));

        return [...cachedDropPoints, ...selectedActualDropPoints];
    })();
    const getActualCargoItemWeightKg = (item: ActualCargoDraft) => convertWeightToKg(
        parseFormattedNumberish(item.actualWeightInputValue || 0, {
            maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
        }),
        item.actualWeightInputUnit
    );
    const getActualCargoItemVolumeM3 = (item: ActualCargoDraft) => convertVolumeToM3(
        parseFormattedNumberish(item.actualVolumeInputValue || 0, {
            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
        }),
        item.actualVolumeInputUnit
    );
    const getActualDropWeightKg = (drop: ActualDropDraft) => convertWeightToKg(
        parseFormattedNumberish(drop.weightInputValue || 0, {
            maxFractionDigits: drop.weightInputUnit === 'TON' ? 3 : 2,
        }),
        drop.weightInputUnit
    );
    const getActualDropVolumeM3 = (drop: ActualDropDraft) => convertVolumeToM3(
        parseFormattedNumberish(drop.volumeInputValue || 0, {
            maxFractionDigits: drop.volumeInputUnit === 'LITER' ? 0 : 3,
        }),
        drop.volumeInputUnit
    );
    const getActualCargoSuratJalanGroupKey = (item: ActualCargoDraft) => {
        const referenceKey = item.shipperReferenceKey.trim();
        const referenceNumber = item.shipperReferenceNumber.trim().toUpperCase();
        if (selectedStatusSuratJalanDocuments.length === 1) {
            return `document:${selectedStatusSuratJalanDocuments[0]._id}`;
        }
        const matchedDocument = selectedStatusSuratJalanDocuments.find(document => {
            const documentReferenceKey = (document.referenceKey || '').trim();
            const documentNumber = (document.suratJalanNumber || '').trim().toUpperCase();
            return (
                (referenceKey && documentReferenceKey && referenceKey === documentReferenceKey) ||
                (referenceNumber && documentNumber && referenceNumber === documentNumber)
            );
        });
        if (matchedDocument) {
            return `document:${matchedDocument._id}`;
        }
        if (referenceKey) {
            return `key:${referenceKey}`;
        }
        if (referenceNumber) {
            return `number:${referenceNumber}`;
        }
        return 'primary';
    };
    const selectedDeliveryRatioBySuratJalan = selectedWorkingActualDropPoints
        .filter(drop => isDeliveryOrderBillableDropType(drop.stopType) && drop.deliveryOrderItemRef.trim())
        .reduce<Map<string, {
            qtyRatio: number;
            weightRatio: number;
            volumeRatio: number;
        }>>((groups, drop) => {
            const cargoItem = selectedActualCargoItemByRef.get(drop.deliveryOrderItemRef);
            if (!cargoItem) {
                return groups;
            }
            const groupKey = getActualCargoSuratJalanGroupKey(cargoItem);
            const baseQtyKoli = parseFormattedNumberish(cargoItem.actualQtyKoli || 0, { maxFractionDigits: 2 });
            const baseWeightKg = getActualCargoItemWeightKg(cargoItem);
            const baseVolumeM3 = getActualCargoItemVolumeM3(cargoItem);
            groups.set(groupKey, {
                qtyRatio: baseQtyKoli > 0
                    ? parseFormattedNumberish(drop.qtyKoli || 0, { maxFractionDigits: 2 }) / baseQtyKoli
                    : 1,
                weightRatio: baseWeightKg > 0 ? getActualDropWeightKg(drop) / baseWeightKg : 1,
                volumeRatio: baseVolumeM3 > 0 ? getActualDropVolumeM3(drop) / baseVolumeM3 : 1,
            });
            return groups;
        }, new Map());
    const selectedAutoDerivedActualCargoItems = selectedActualCargoItems.map(item => {
        if (!showAdvancedDropEditor) {
            return item;
        }

        const itemSpecificDrops = selectedWorkingActualDropPoints.filter(drop => drop.deliveryOrderItemRef === item.deliveryOrderItemRef);
        const billableItemDrops = itemSpecificDrops.filter(drop => isDeliveryOrderBillableDropType(drop.stopType));
        const nonBillableItemDrops = itemSpecificDrops.filter(drop => !isDeliveryOrderBillableDropType(drop.stopType));

        const groupRatio = selectedDeliveryRatioBySuratJalan.get(getActualCargoSuratJalanGroupKey(item));
        if (groupRatio) {
            const actualQtyKoli = parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }) * groupRatio.qtyRatio;
            const actualWeightKg = getActualCargoItemWeightKg(item) * groupRatio.weightRatio;
            const actualVolumeM3 = getActualCargoItemVolumeM3(item) * groupRatio.volumeRatio;
            return {
                ...item,
                actualQtyKoli: actualQtyKoli > 0 ? String(actualQtyKoli) : '',
                actualWeightInputValue: actualWeightKg > 0 ? String(convertKgToWeightInputValue(actualWeightKg, item.actualWeightInputUnit)) : '',
                actualVolumeInputValue: actualVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(actualVolumeM3, item.actualVolumeInputUnit)) : '',
            };
        }

        if (billableItemDrops.length === 0 && nonBillableItemDrops.length === 0) {
            return item;
        }

        const actualQtyKoli = billableItemDrops.reduce(
            (sum, drop) => sum + parseFormattedNumberish(drop.qtyKoli || 0, { maxFractionDigits: 2 }),
            0
        );
        const actualWeightKg = billableItemDrops.reduce(
            (sum, drop) => sum + getActualDropWeightKg(drop),
            0
        );
        const actualVolumeM3 = billableItemDrops.reduce(
            (sum, drop) => sum + getActualDropVolumeM3(drop),
            0
        );

        return {
            ...item,
            actualQtyKoli: actualQtyKoli > 0 ? String(actualQtyKoli) : '',
            actualWeightInputValue: actualWeightKg > 0 ? String(convertKgToWeightInputValue(actualWeightKg, item.actualWeightInputUnit)) : '',
            actualVolumeInputValue: actualVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(actualVolumeM3, item.actualVolumeInputUnit)) : '',
        };
    });
    const selectedDerivedActualCargoItems = selectedAutoDerivedActualCargoItems.map(item => {
        const manualValues = actualCargoItemValueMap[item.deliveryOrderItemRef];
        return manualValues ? { ...item, ...manualValues } : item;
    });
    const selectedEffectiveActualDropPoints = (() => {
        if (!showAdvancedDropEditor) {
            return selectedActualDropPoints;
        }
        if (shouldDisableAutoInferredActualDropPoints) {
            return selectedWorkingActualDropPoints;
        }

        const explicitItemRefs = new Set(
            selectedWorkingActualDropPoints
                .map(drop => drop.deliveryOrderItemRef.trim())
                .filter(Boolean)
        );
        const fallbackBillableDrop = selectedWorkingActualDropPoints.find(drop => isDeliveryOrderBillableDropType(drop.stopType));
        const inferredDropPoints = selectedDerivedActualCargoItems
            .filter(item => !explicitItemRefs.has(item.deliveryOrderItemRef))
            .filter(item =>
                parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }) > 0 ||
                parseFormattedNumberish(item.actualWeightInputValue || 0, {
                    maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
                }) > 0 ||
                parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                    maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                }) > 0
            )
            .map((item): ActualDropDraft => ({
                draftKey: `auto-drop-${item.deliveryOrderItemRef}`,
                stopType: 'DROP',
                deliveryOrderItemRef: item.deliveryOrderItemRef,
                shipperReferenceKey: item.shipperReferenceKey,
                shipperReferenceNumber: item.shipperReferenceNumber,
                locationName: fallbackBillableDrop?.locationName || doData.receiverCompany || doData.receiverName || 'Tujuan Invoice',
                locationAddress: fallbackBillableDrop?.locationAddress || doData.receiverAddress || '',
                qtyKoli: item.actualQtyKoli,
                weightInputValue: item.actualWeightInputValue,
                weightInputUnit: item.actualWeightInputUnit,
                volumeInputValue: item.actualVolumeInputValue,
                volumeInputUnit: item.actualVolumeInputUnit,
                note: 'Auto dari item SJ tanpa titik khusus',
            }));

        return [...selectedWorkingActualDropPoints, ...inferredDropPoints];
    })();
    const selectedActualCargoTotals = selectedDerivedActualCargoItems.reduce((sum, item) => ({
        qtyKoli: sum.qtyKoli + parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }),
        weightKg: sum.weightKg + convertWeightToKg(
            parseFormattedNumberish(item.actualWeightInputValue || 0, {
                maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
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
    const selectedBillableEffectiveActualDropPoints = selectedEffectiveActualDropPoints.filter(point =>
        isDeliveryOrderBillableDropType(point.stopType)
    );
    const selectedActualDropTotals = selectedBillableEffectiveActualDropPoints.reduce((sum, point) => ({
        qtyKoli: sum.qtyKoli + parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }),
        weightKg: sum.weightKg + convertWeightToKg(
            parseFormattedNumberish(point.weightInputValue || 0, {
                maxFractionDigits: point.weightInputUnit === 'TON' ? 3 : 2,
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
    const selectedActualDropShipperReferenceOptions = actualDropShipperReferenceOptions.filter(reference =>
        matchesSelectedStatusSuratJalan(reference.referenceKey, reference.referenceNumber)
    );
    const {
        autoActualDropDraft: selectedAutoActualDropDraft,
        actualDropAmbiguityMessage: selectedActualDropAmbiguityMessage,
    } = buildDeliveryOrderDetailState({
        doData,
        actualCargoItems: selectedDerivedActualCargoItems,
        actualDropPoints: selectedEffectiveActualDropPoints,
        showAdvancedDropEditor,
    });
    const selectedActualDropMismatchMessage =
        selectedActualCargoTotals.qtyKoli > 0 && Math.abs(selectedActualDropTotals.qtyKoli - selectedActualCargoTotals.qtyKoli) > 0.01
            ? 'Total qty titik drop harus sama dengan qty aktual muatan terkirim.'
            : selectedActualCargoTotals.weightKg > 0 && Math.abs(selectedActualDropTotals.weightKg - selectedActualCargoTotals.weightKg) > 0.01
                ? 'Total berat titik drop harus sama dengan berat aktual muatan terkirim.'
                : selectedActualCargoTotals.volumeM3 > 0 && Math.abs(selectedActualDropTotals.volumeM3 - selectedActualCargoTotals.volumeM3) > 0.001
                    ? 'Total volume titik drop harus sama dengan volume aktual muatan terkirim.'
                    : null;
    const selectedBillableDropCount = selectedEffectiveActualDropPoints.filter(point => isDeliveryOrderBillableDropType(point.stopType)).length;
    const selectedHoldDropCount = selectedEffectiveActualDropPoints.filter(point => isDeliveryOrderHoldDropType(point.stopType)).length;
    const selectedReturnDropCount = selectedEffectiveActualDropPoints.filter(point => isDeliveryOrderReturnDropType(point.stopType)).length;
    const selectedDropModeLabel = showAdvancedDropEditor ? `${selectedEffectiveActualDropPoints.length} titik aktual` : 'Trip normal / 1 tujuan';
    const selectedSuratJalanLabelMap = new Map(
        selectedStatusSuratJalanDocuments.flatMap(document => {
            const labels: Array<[string, string]> = [];
            const label = document.suratJalanNumber || 'Surat Jalan';
            labels.push([`document:${document._id}`, label]);
            if (document.referenceKey) {
                labels.push([`key:${document.referenceKey}`, label]);
            }
            if (document.suratJalanNumber) {
                labels.push([`number:${document.suratJalanNumber.trim().toUpperCase()}`, label]);
            }
            if (!document.referenceKey && !document.suratJalanNumber) {
                labels.push(['primary', label]);
            }
            return labels;
        })
    );
    const selectedDerivedActualCargoGroupMap = selectedDerivedActualCargoItems.reduce<Map<string, {
        key: string;
        label: string;
        items: ActualCargoDraft[];
    }>>((groups, item) => {
        const groupKey = getActualCargoSuratJalanGroupKey(item);
        const fallbackLabel = item.shipperReferenceNumber || 'Surat Jalan';
        const current = groups.get(groupKey) || {
            key: groupKey,
            label: selectedSuratJalanLabelMap.get(groupKey) || fallbackLabel,
            items: [],
        };
        current.items.push(item);
        groups.set(groupKey, current);
        return groups;
    }, new Map());
    const selectedDerivedActualCargoGroups = Array.from(selectedDerivedActualCargoGroupMap.values());
    const selectedDropOutcomeSummary = [
        selectedBillableDropCount > 0 ? `${selectedBillableDropCount} drop invoice` : null,
        selectedHoldDropCount > 0 ? `${selectedHoldDropCount} hold` : null,
        selectedReturnDropCount > 0 ? `${selectedReturnDropCount} return` : null,
    ].filter(Boolean).join(' • ') || 'Semua muatan mengikuti tujuan default';
    const isPartialSuratJalanBatchFinalize =
        newStatus === 'DELIVERED' &&
        eligibleStatusSuratJalanDocuments.length > 1 &&
        selectedStatusSuratJalanRefs.length > 0 &&
        selectedStatusSuratJalanRefs.length < eligibleStatusSuratJalanDocuments.length;
    const billableDropCount = actualDropSummary.filter(point => isDeliveryOrderBillableDropType(point.stopType)).length;
    const holdDropCount = actualDropSummary.filter(point => isDeliveryOrderHoldDropType(point.stopType)).length;
    const returnDropCount = actualDropSummary.filter(point => isDeliveryOrderReturnDropType(point.stopType)).length;
    const hasContinuableHoldCargo =
        holdDropCount > 0 &&
        (holdCargoSummary.qtyKoli > 0 || holdCargoSummary.weightKg > 0 || holdCargoSummary.volumeM3 > 0);
    const canContinueHeldCargoOnSameDo =
        canManageDeliveryStatus &&
        (doData.status === 'DELIVERED' || doData.status === 'PARTIAL_HOLD') &&
        !doData.pendingDriverStatus &&
        hasContinuableHoldCargo;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/trips" />
                    <div>
                        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {displayTripNumber}
                            <span className={`badge badge-${displayStatusMeta.color}`}>
                                <span className="badge-dot" /> {displayStatusMeta.label}
                            </span>
                        </h1>
                        <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                            Status trip ini dibaca otomatis dari progres seluruh Surat Jalan di bawahnya.
                        </div>
                    </div>
                </div>
                <div className="page-actions">
                    {availableBatchStatuses.length > 0 && canManageDeliveryStatus && !doData.pendingDriverStatus && (
                        <button className="btn btn-primary" onClick={() => openStatusModal()}>
                            <Truck size={16} /> Update Batch SJ
                        </button>
                    )}
                    {canManageDeliveryStatus && (
                        <button className="btn btn-secondary" onClick={toggleTripClosure} disabled={togglingTripClosure}>
                            {togglingTripClosure
                                ? 'Menyimpan...'
                                : isTripClosedByAdmin
                                    ? 'Buka Kembali Trip'
                                    : 'Tutup Trip'}
                        </button>
                    )}
                    {canContinueHeldCargoOnSameDo && (
                        <button className="btn btn-primary" onClick={continueHeldCargoOnSameDo}>
                            <Truck size={16} /> Finalisasi Sisa Hold
                        </button>
                    )}
                    {doData.status === 'DELIVERED' && !doData.podReceiverName && canManageDeliveryStatus && (
                        <button
                            className="btn btn-success"
                            onClick={() => {
                                setPodName(getDefaultPodName());
                                setPodDate(getDefaultPodDate());
                                setPodNote(getDefaultPodNote());
                                setShowPODModal(true);
                            }}
                        >
                            <Upload size={16} /> Lengkapi POD
                        </button>
                    )}
                    {canExportDeliveryOrder && <button className="btn btn-secondary" onClick={handleExportPDF}>
                        <FileDown size={16} /> Export PDF
                    </button>}
                    {canPrintDeliveryOrder && <button className="btn btn-secondary" onClick={handlePrint}>
                        <Printer size={16} /> Print
                    </button>}
                </div>
            </div>

            {doData.status === 'CREATED' && (!doData.vehicleRef || !doData.driverRef) && (
                <div className="card" style={{ marginBottom: 'var(--space-4)', border: '1px solid var(--color-warning-light)', background: 'var(--color-warning-soft)' }}>
                    <div className="card-body">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'grid', gap: '0.35rem' }}>
                                <div className="form-section-title" style={{ marginBottom: 0 }}>Armada Trip Belum Lengkap</div>
                                <div className="detail-value">
                                    {!doData.vehicleRef && !doData.driverRef
                                        ? 'Kendaraan dan supir belum dipilih. Lengkapi dulu sebelum trip diteruskan ke workflow operasional berikutnya.'
                                        : !doData.vehicleRef
                                            ? 'Kendaraan trip belum dipilih. Lengkapi dulu sebelum trip diteruskan ke workflow operasional berikutnya.'
                                            : 'Supir trip belum dipilih. Lengkapi dulu sebelum trip diteruskan ke workflow operasional berikutnya.'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {doData.pendingDriverStatus && (
                <div className="card" style={{ marginBottom: 'var(--space-4)', border: '1px solid var(--color-warning-light)', background: 'var(--color-warning-soft)' }}>
                    <div className="card-body">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'grid', gap: '0.35rem' }}>
                                <div className="form-section-title" style={{ marginBottom: 0 }}>Permintaan Driver Menunggu Approval</div>
                                <div className="detail-value">
                                    Driver mengajukan progres batch SJ ke status{' '}
                                    <span className={`badge badge-${pendingDriverStatusMeta?.color || 'warning'}`}>
                                        <span className="badge-dot" /> {pendingDriverStatusMeta?.label || doData.pendingDriverStatus}
                                    </span>
                                </div>
                                <div className="text-muted text-sm">
                                    {doData.pendingDriverStatusRequestedByName || 'Driver'} | {formatDateTime(doData.pendingDriverStatusRequestedAt)}
                                </div>
                                {doData.pendingDriverStatusNote && (
                                    <div className="text-muted text-sm">Catatan driver: {doData.pendingDriverStatusNote}</div>
                                )}
                            </div>
                            {canReviewDriverRequest ? (
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <button className="btn btn-success" onClick={() => openStatusModal(doData.pendingDriverStatus, true)}>
                                        <Save size={16} /> Review & Approve
                                    </button>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => {
                                            setRejectRequestNote('');
                                            setShowRejectRequestModal(true);
                                        }}
                                    >
                                        Tolak
                                    </button>
                                </div>
                            ) : (
                                <div className="text-muted text-sm">Menunggu review owner / operasional.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {canShowTripManager && (
                <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
                    <div className="card-header">
                        <span className="card-header-title">Kelola Trip</span>
                    </div>
                    <div className="card-body" style={{ display: 'grid', gap: '0.85rem' }}>
                        <div className="text-muted text-sm">
                            Kelola armada, dokumen SJ, dan uang jalan dari halaman ini. Progres status operasional mengikuti batch SJ.
                        </div>
                        <div className="text-muted text-sm">
                            {isTripClosedByAdmin
                                ? `Trip sudah ditutup admin${doData.tripClosedByAdminName ? ` oleh ${doData.tripClosedByAdminName}` : ''}. Tambah SJ dan edit muatan SJ dikunci sampai trip dibuka kembali.`
                                : 'Trip masih terbuka. Admin masih bisa menambah SJ baru walaupun seluruh SJ sebelumnya sudah selesai.'}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {doData.status === 'CREATED' && canAssignTripResources && !hasLinkedTripCash && (
                                <button className="btn btn-secondary btn-sm" onClick={() => void openTripResourcesModal()}>
                                    <Truck size={14} /> Edit Trip / Armada
                                </button>
                            )}
                            {canEditDeliveryTarget && (
                                <button className="btn btn-secondary btn-sm" onClick={openTargetModal}>
                                    <MapPin size={14} /> Edit Tujuan
                                </button>
                            )}
                            {canAppendCargoToDo && (
                                <button className="btn btn-secondary btn-sm" onClick={() => openShipperReferenceModal('create')}>
                                    <Plus size={14} /> Tambah SJ
                                </button>
                            )}
                            {canManageDeliveryStatus && (
                                <button className="btn btn-secondary btn-sm" onClick={toggleTripClosure} disabled={togglingTripClosure}>
                                    {togglingTripClosure
                                        ? 'Menyimpan...'
                                        : isTripClosedByAdmin
                                            ? 'Buka Kembali Trip'
                                            : 'Tutup Trip'}
                                </button>
                            )}
                            {canContinueHeldCargoOnSameDo && (
                                <button className="btn btn-secondary btn-sm" onClick={continueHeldCargoOnSameDo}>
                                    <Truck size={14} /> Finalisasi Sisa Hold
                                </button>
                            )}
                            {canManageTripFee && !hasLinkedTripCash && !editingTarip && (
                                <button className="btn btn-secondary btn-sm" onClick={openTripFeeEditor}>
                                    <Edit size={14} /> {doData.taripBorongan ? 'Edit Upah Trip' : 'Isi Upah Trip'}
                                </button>
                            )}
                            {canManageDeliveryStatus && availableBatchStatuses.includes('CANCELLED') && (
                                <button className="btn btn-secondary btn-sm" onClick={() => openStatusModal('CANCELLED')}>
                                    Batalkan Batch SJ
                                </button>
                            )}
                        </div>
                        {!hasLinkedTripCash && canCreateTripCash && voucherIssueBlockingReasons.length > 0 && (
                            <div className="text-muted text-sm">
                                Uang jalan trip belum bisa diterbitkan: {voucherIssueBlockingReasons.join('; ')}.
                            </div>
                        )}
                        {linkedTripCashBonNumber && (
                            <div className="text-muted text-sm">
                            Trip ini sudah terhubung ke uang jalan trip {linkedTripCashBonNumber}. Armada trip dan upah trip dikunci supaya settlement tidak berubah diam-diam.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {(canViewTripCash || canCreateTripCash || hasLinkedTripCash) && (
                <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span className="card-header-title">Uang Jalan Trip</span>
                        {linkedTripCashVoucherId && canOpenTripCashPage && (
                            <Link className="btn btn-secondary btn-sm" href={withReturnTo(`/driver-vouchers/${linkedTripCashVoucherId}`)}>
                                <Wallet size={14} /> Buka Detail Bon
                            </Link>
                        )}
                        {!hasLinkedTripCash && canIssueVoucherFromDo && (
                            <Link className="btn btn-primary btn-sm" href={withReturnTo(`/driver-vouchers/new?deliveryOrderRef=${encodeURIComponent(doData._id)}`)}>
                                <Wallet size={14} /> Terbitkan Uang Jalan
                            </Link>
                        )}
                    </div>
                    <div className="card-body">
                        {linkedVoucher && linkedVoucherSummary ? (
                            <div style={{ display: 'grid', gap: '0.85rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <div>
                                        <div className="detail-label">Bon Terkait</div>
                                        <div className="detail-value font-mono">
                                            {canOpenTripCashPage ? <Link href={withReturnTo(`/driver-vouchers/${linkedVoucher._id}`)}>{linkedVoucher.bonNumber}</Link> : linkedVoucher.bonNumber}
                                        </div>
                                    </div>
                                    {linkedVoucherStatusMeta && (
                                        <span className={`badge ${linkedVoucherStatusMeta.cls}`}>{linkedVoucherStatusMeta.label}</span>
                                    )}
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item">
                                        <div className="detail-label">Tanggal Bon</div>
                                        <div className="detail-value">{formatDate(linkedVoucher.issuedDate)}</div>
                                    </div>
                                    <div className="detail-item">
                                        <div className="detail-label">Sumber Dana</div>
                                        <div className="detail-value">{linkedVoucher.issueBankName || '-'}</div>
                                    </div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item">
                                        <div className="detail-label">Uang Jalan Awal</div>
                                        <div className="detail-value">{formatCurrency(linkedVoucherSummary.initialCashGiven)}</div>
                                    </div>
                                    <div className="detail-item">
                                        <div className="detail-label">Top Up Uang Jalan</div>
                                        <div className="detail-value">{formatCurrency(linkedVoucherSummary.topUpAmount)}</div>
                                    </div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item">
                                        <div className="detail-label">Biaya Perjalanan</div>
                                        <div className="detail-value">{formatCurrency(linkedVoucherSummary.totalSpent)}</div>
                                    </div>
                                    <div className="detail-item">
                                        <div className="detail-label">Upah Trip Snapshot DO</div>
                                        <div className="detail-value">{formatCurrency(linkedVoucherSummary.driverFeeAmount)}</div>
                                    </div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item">
                                        <div className="detail-label">Total Uang Diberikan</div>
                                        <div className="detail-value">{formatCurrency(linkedVoucherSummary.totalIssuedAmount)}</div>
                                    </div>
                                    <div className="detail-item">
                                        <div className="detail-label">Net Settlement Akhir</div>
                                        <div
                                            className="detail-value"
                                            style={{ color: linkedVoucherSummary.balance >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}
                                        >
                                            {formatCurrency(Math.abs(linkedVoucherSummary.balance))}
                                        </div>
                                        <div className="text-muted text-sm">
                                            {linkedVoucherSummary.balance >= 0
                                                ? 'Kembali ke perusahaan setelah biaya dan upah diperhitungkan'
                                                : 'Tambahan bayar ke supir setelah biaya dan upah diperhitungkan'}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-muted text-sm">
                                    Bon ini melekat ke trip ini. Detail biaya perjalanan, top up, dan settlement akhir dibuka dari modul Uang Jalan Trip.
                                </div>
                            </div>
                        ) : hasLinkedTripCash ? (
                            <div style={{ display: 'grid', gap: '0.85rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <div>
                                        <div className="detail-label">Bon Terkait</div>
                                        <div className="detail-value font-mono">{linkedTripCashBonNumber || '-'}</div>
                                    </div>
                                    {linkedVoucherStatusMeta && (
                                        <span className={`badge ${linkedVoucherStatusMeta.cls}`}>{linkedVoucherStatusMeta.label}</span>
                                    )}
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item">
                                        <div className="detail-label">Tanggal Bon</div>
                                        <div className="detail-value">{formatDate(linkedTripCashIssuedDate)}</div>
                                    </div>
                                    <div className="detail-item">
                                        <div className="detail-label">Akses Detail Bon</div>
                                        <div className="detail-value">{canOpenTripCashPage ? 'Tersedia' : 'Role ini hanya melihat keterkaitan DO dengan bon'}</div>
                                    </div>
                                </div>
                                <div className="text-muted text-sm">
                                    Trip ini sudah punya uang jalan trip. Detail nominal, biaya perjalanan, top up, dan settlement akhir hanya dibuka dari modul Uang Jalan Trip oleh role yang memang berwenang.
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                <div className="detail-value">Belum ada uang jalan trip yang terbit untuk trip ini.</div>
                                <div className="text-muted text-sm">
                                    Terbitkan uang jalan dari trip ini setelah trip siap jalan.
                                </div>
                                {canCreateTripCash && voucherIssueBlockingReasons.length > 0 && (
                                    <div className="text-muted text-sm">
                                        Yang masih perlu dilengkapi: {voucherIssueBlockingReasons.join('; ')}.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span className="card-header-title">Informasi Trip</span>
                    </div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">No. Trip Internal</div><div className="detail-value font-mono"><Link href={`/trips/${doData._id}`}>{displayTripNumber}</Link></div></div>
                            <div className="detail-item"><div className="detail-label">Tanggal Trip</div><div className="detail-value">{formatDate(doData.date)}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Kendaraan</div><div className="detail-value">{canOpenVehiclePage && doData.vehicleRef ? <Link href={withReturnTo(`/fleet/vehicles/${doData.vehicleRef}`)}>{doData.vehiclePlate || '-'}</Link> : (doData.vehiclePlate || '-')}</div></div>
                            <div className="detail-item"><div className="detail-label">Driver</div><div className="detail-value">{canOpenDriverPage && doData.driverRef ? <Link href={withReturnTo(`/fleet/drivers/${doData.driverRef}`)}>{doData.driverName || '-'}</Link> : (doData.driverName || '-')}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Customer</div><div className="detail-value">{canOpenCustomerPage && doData.customerRef ? <Link href={withReturnTo(`/customers/${doData.customerRef}`)}>{doData.customerName || '-'}</Link> : (doData.customerName || '-')}</div></div>
                            <div className="detail-item"><div className="detail-label">Master Resi</div><div className="detail-value">{canOpenSourceOrderPage ? <Link href={withReturnTo(`/orders/${doData.orderRef}`)}>{doData.masterResi}</Link> : doData.masterResi}</div></div>
                        </div>
                        {shipperReferenceDisplayList.length > 0 && (
                            <div className="detail-row">
                                <div className="detail-item">
                                    <div className="detail-label">Surat Jalan Terkait</div>
                                    <div className="detail-value" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        {shipperReferenceDisplayList.map(reference => {
                                            const document = suratJalanDocumentByReferenceKey.get(reference.referenceKey || 'primary');
                                            return document ? (
                                                <Link key={document._id} href={withReturnTo(`/surat-jalan/${encodeURIComponent(document._id)}`)}>
                                                    {reference.referenceNumber}
                                                </Link>
                                            ) : (
                                                <span key={reference.draftKey || reference.referenceKey || reference.referenceNumber}>{reference.referenceNumber}</span>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Armada Diminta</div><div className="detail-value">{doData.serviceName || '-'}</div></div>
                            <div className="detail-item"><div className="detail-label">Armada Aktual</div><div className="detail-value">{doData.vehicleServiceName || doData.serviceName || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Alasan Override Armada</div><div className="detail-value">{doData.vehicleCategoryOverrideReason || '-'}</div></div>
                            <div className="detail-item"><div className="detail-label">Alamat Pickup Trip</div><div className="detail-value">{doData.pickupAddress || '-'}</div></div>
                        </div>
                        {doData.cargoFinalizedAt && (
                            <div className="detail-row">
                                <div className="detail-item">
                                    <div className="detail-label">Muatan Aktual Final</div>
                                    <div className="detail-value">{formatDateTime(doData.cargoFinalizedAt)}</div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Difinalkan Oleh</div>
                                    <div className="detail-value">{doData.cargoFinalizedByName || '-'}</div>
                                </div>
                            </div>
                        )}
                        {doData.notes && <div className="mt-2"><div className="detail-label">Catatan Trip</div><div className="detail-value">{doData.notes}</div></div>}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span className="card-header-title">Dokumen Surat Jalan</span>
                        {canEditShipperReference && !isTripClosedByAdmin && (
                            <button className="btn btn-secondary btn-sm" onClick={() => openShipperReferenceModal()}>
                                <Edit size={14} /> {hasShipperReference ? 'Edit Surat Jalan' : 'Isi Surat Jalan'}
                            </button>
                        )}
                    </div>
                    <div className="card-body">
                        <div className="text-muted text-sm" style={{ marginBottom: '0.85rem' }}>
                            Satu trip bisa membawa satu atau beberapa nomor Surat Jalan pengirim. Daftar dokumen di bawah ini adalah dokumen yang menempel ke trip ini.
                        </div>
                        {suratJalanStatusSummary.size > 0 && (
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
                                <button
                                    type="button"
                                    className={`btn btn-sm ${suratJalanStatusFilter ? 'btn-secondary' : 'btn-primary'}`}
                                    onClick={() => setSuratJalanStatusFilter('')}
                                >
                                    Semua
                                </button>
                                {[...suratJalanStatusSummary.entries()].map(([status, count]) => {
                                    const meta = DO_STATUS_MAP[status] || displayStatusMeta;
                                    const isActive = suratJalanStatusFilter === status;
                                    return (
                                        <button
                                            key={status}
                                            type="button"
                                            className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => setSuratJalanStatusFilter(current => current === status ? '' : status)}
                                            title={`Tampilkan hanya SJ dengan status ${meta.label}`}
                                        >
                                            <span className={`badge badge-${meta.color}`} style={{ marginRight: '0.45rem' }}>
                                                <span className="badge-dot" />
                                            </span>
                                            {count} {meta.label.toLowerCase()}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        <div className="detail-item">
                            <div className="detail-label">SJ Pengirim</div>
                            {shipperReferenceDisplayList.length > 0 ? (
                                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                                        {filteredShipperReferenceDisplayList.length === 0 && (
                                            <div className="text-muted text-sm">Tidak ada SJ dengan status yang sedang difilter.</div>
                                        )}
                                        {filteredShipperReferenceDisplayList.map(reference => (
                                            <div key={reference.draftKey || reference.referenceKey || `${reference.pickupStopKey || 'tanpa-pickup'}::${reference.referenceNumber}`} style={{
                                                border: '1px solid var(--color-gray-200)',
                                                borderRadius: '0.75rem',
                                                padding: '0.6rem 0.75rem',
                                                background: 'var(--color-gray-50)',
                                            }}>
                                                {(() => {
                                                    const { document, status: documentOperationalStatus, meta: documentStatusMeta } = getSuratJalanOperationalStatus(reference.referenceKey);
                                                    return (
                                                        <>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                                {document ? (
                                                                    <Link
                                                                        className="detail-value font-mono"
                                                                        style={{ color: 'var(--color-primary)' }}
                                                                        href={withReturnTo(`/surat-jalan/${encodeURIComponent(document._id)}`)}
                                                                    >
                                                                        {reference.referenceNumber}
                                                                    </Link>
                                                                ) : (
                                                                    <div className="detail-value font-mono">{reference.referenceNumber}</div>
                                                                )}
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                                                    <span className={`badge badge-${documentStatusMeta.color}`}>
                                                                        <span className="badge-dot" /> {documentStatusMeta.label}
                                                                    </span>
                                                                    {canEditShipperReference && documentOperationalStatus !== 'DELIVERED' && !isTripClosedByAdmin && (
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-ghost btn-sm"
                                                                            onClick={() => void deleteShipperReference(reference)}
                                                                            disabled={Boolean(deletingShipperReferenceKey) || savingShipperReference}
                                                                            style={{ color: 'var(--color-danger)' }}
                                                                            title="Hapus SJ ini dari trip"
                                                                        >
                                                                            <Trash2 size={14} /> {deletingShipperReferenceKey === (reference.referenceKey || reference.draftKey || reference.referenceNumber) ? 'Menghapus...' : 'Hapus'}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                                Status SJ: {documentStatusMeta.label}
                                                            </div>
                                                        </>
                                                    );
                                                })()}
                                                {reference.pickupLabel && (
                                                    <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                        {reference.pickupLabel}{reference.pickupAddress ? ` | ${reference.pickupAddress}` : ''}
                                                </div>
                                            )}
                                            {reference.billingCustomerName && (
                                                <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                    Invoice: {reference.billingCustomerName}
                                                </div>
                                            )}
                                            {(reference.receiverAddress || reference.receiverName || reference.receiverCompany) && (
                                                <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                    Tujuan Dokumen: {reference.receiverAddress || reference.receiverCompany || reference.receiverName}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="detail-value font-mono">{formatShipperDeliveryOrderNumber(doData)}</div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span className="card-header-title">Tujuan / Penerima Default Trip</span>
                        {!canShowTripManager && canEditDeliveryTarget && (
                            <button className="btn btn-secondary btn-sm" onClick={openTargetModal}>
                                <Edit size={14} /> Edit Tujuan
                            </button>
                        )}
                    </div>
                    <div className="card-body">
                        <div className="detail-item"><div className="detail-label">Nama</div><div className="detail-value">{doData.receiverName || '-'}</div></div>
                        <div className="detail-item mt-2"><div className="detail-label">Telepon</div><div className="detail-value">{doData.receiverPhone || '-'}</div></div>
                        <div className="detail-item mt-2"><div className="detail-label">Alamat</div><div className="detail-value">{doData.receiverAddress || '-'}</div></div>
                        {doData.receiverCompany && <div className="detail-item mt-2"><div className="detail-label">Perusahaan</div><div className="detail-value">{doData.receiverCompany}</div></div>}
                    </div>
                    {doData.podReceiverName && (
                        <div className="card-body" style={{ borderTop: '1px solid var(--color-gray-100)', background: 'var(--color-success-light)' }}>
                            <div className="form-section-title" style={{ color: 'var(--color-success)' }}>Proof of Delivery (POD)</div>
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Diterima Oleh</div><div className="detail-value">{doData.podReceiverName}</div></div>
                                <div className="detail-item"><div className="detail-label">Tanggal Terima</div><div className="detail-value">{formatDate(doData.podReceivedDate)}</div></div>
                            </div>
                            {doData.podNote && <div className="mt-2"><div className="detail-label">Catatan</div><div className="detail-value">{doData.podNote}</div></div>}
                        </div>
                    )}
                </div>
            </div>

            <div style={{ display: 'grid', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            <CollapsibleCard title="Muatan & Realisasi Trip">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                            <div className="detail-label">Hasil Realisasi</div>
                            <div className="detail-value" style={{ marginTop: '0.25rem' }}>{completionOutcome?.label || displayStatusMeta.label}</div>
                            <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                {actualDropSummary.length > 0
                                    ? `${billableDropCount} titik invoice${holdDropCount > 0 ? ` • ${holdDropCount} hold/transit` : ''}${returnDropCount > 0 ? ` • ${returnDropCount} retur` : ''}`
                                    : 'Belum ada realisasi drop'}
                            </div>
                        </div>
                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                            <div className="detail-label">Masuk Invoice</div>
                            <div className="detail-value" style={{ marginTop: '0.25rem' }}>{formatCargoSummary(billableCargoSummary)}</div>
                            <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Hanya DROP dan EXTRA_DROP yang ikut invoice.</div>
                        </div>
                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                            <div className="detail-label">Hold / Transit</div>
                            <div className="detail-value" style={{ marginTop: '0.25rem' }}>{formatCargoSummary(holdCargoSummary)}</div>
                            <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Barang ini tidak ikut invoice sampai dikirim lagi.</div>
                        </div>
                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                            <div className="detail-label">Retur</div>
                            <div className="detail-value" style={{ marginTop: '0.25rem' }}>{formatCargoSummary(returnCargoSummary)}</div>
                            <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Barang retur tidak ikut invoice DO ini.</div>
                        </div>
                    </div>
                    <div className="detail-row">
                        <div className="detail-item">
                            <div className="detail-label">Asal Invoice</div>
                            <div className="detail-value">{doData.pickupAddress || '-'}</div>
                        </div>
                        <div className="detail-item">
                            <div className="detail-label">Tujuan Invoice</div>
                            <div className="detail-value">{doData.receiverAddress || '-'}</div>
                        </div>
                    </div>
                    <div style={{ marginTop: '1rem' }}>
                        <div className="detail-label" style={{ marginBottom: '0.5rem' }}>
                            Titik Drop Aktual {actualDropSummary.length > 0 ? `(${actualDropSummary.length})` : ''}
                        </div>
                        {actualDropSummary.length === 0 ? (
                            <div className="text-muted text-sm">Belum ada realisasi drop. Saat DO diselesaikan, sistem akan mencatat tujuan aktual per titik.</div>
                        ) : (
                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                {actualDropSummary
                                    .slice()
                                    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
                                    .map(point => (
                                        <div key={point._key || `${point.sequence}-${point.locationName}`} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                <div style={{ fontWeight: 600 }}>
                                                    {point.sequence}. {point.locationName}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                    <span className={`badge badge-${DO_ACTUAL_DROP_TYPE_MAP[point.stopType]?.color || 'gray'}`}>
                                                        {DO_ACTUAL_DROP_TYPE_MAP[point.stopType]?.label || point.stopType}
                                                    </span>
                                                    <span className={`badge badge-${isDeliveryOrderBillableDropType(point.stopType) ? 'success' : isDeliveryOrderReturnDropType(point.stopType) ? 'danger' : 'warning'}`}>
                                                        {isDeliveryOrderBillableDropType(point.stopType) ? 'Masuk Invoice' : isDeliveryOrderReturnDropType(point.stopType) ? 'Retur / Tidak Masuk Invoice' : 'Hold / Tidak Masuk Invoice'}
                                                    </span>
                                                </div>
                                            </div>
                                            {point.locationAddress && (
                                                <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                                    {point.locationAddress}
                                                </div>
                                            )}
                                            <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                                SJ Pengirim: {point.shipperReferenceNumber || 'Mengikuti DO'}
                                            </div>
                                            <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                                Barang: {summarizeDeliveryOrderItemDescriptionsForDrop(point, doItems)}
                                            </div>
                                            <div className="detail-row" style={{ marginTop: '0.75rem' }}>
                                                <div className="detail-item">
                                                    <div className="detail-label">Muatan</div>
                                                    <div className="detail-value">
                                                        {formatCargoSummary({
                                                            qtyKoli: point.qtyKoli,
                                                            weightKg: point.weightKg,
                                                            weightInputValue: point.weightInputValue,
                                                            weightInputUnit: point.weightInputUnit,
                                                            volumeM3: point.volumeM3,
                                                            volumeInputValue: point.volumeInputValue,
                                                            volumeInputUnit: point.volumeInputUnit,
                                                        })}
                                                    </div>
                                                </div>
                                                <div className="detail-item">
                                                    <div className="detail-label">Catatan</div>
                                                    <div className="detail-value">{point.note || '-'}</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
            </CollapsibleCard>

            <CollapsibleCard title="Tracking Driver" defaultOpen={doData.trackingState === 'ACTIVE'}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                        <div className="detail-label" style={{ marginBottom: 0 }}>Status Tracking</div>
                        <span className={`badge ${doData.trackingState === 'ACTIVE' ? 'badge-info' : doData.trackingState === 'PAUSED' ? 'badge-warning' : 'badge-gray'}`}>
                            <Radio size={12} /> {doData.trackingState || 'IDLE'}
                        </span>
                    </div>
                    <div className="detail-row">
                        <div className="detail-item">
                            <div className="detail-label">Posisi terakhir</div>
                            <div className="detail-value">{doData.trackingLastSeenAt ? formatDateTime(doData.trackingLastSeenAt) : 'Belum ada update dari driver app'}</div>
                        </div>
                        <div className="detail-item">
                            <div className="detail-label">Akurasi GPS</div>
                            <div className="detail-value">{typeof doData.trackingLastAccuracyM === 'number' ? `${Math.round(doData.trackingLastAccuracyM)} meter` : '-'}</div>
                        </div>
                    </div>
                    <div className="detail-row">
                        <div className="detail-item">
                            <div className="detail-label">Koordinat</div>
                            <div className="detail-value">
                                {hasLiveCoordinates ? `${doData.trackingLastLat?.toFixed(6)}, ${doData.trackingLastLng?.toFixed(6)}` : '-'}
                            </div>
                        </div>
                        <div className="detail-item">
                            <div className="detail-label">Kecepatan terakhir</div>
                            <div className="detail-value">{typeof doData.trackingLastSpeedKph === 'number' ? `${doData.trackingLastSpeedKph} km/jam` : '-'}</div>
                        </div>
                    </div>
                    {trackingMapUrl && (
                        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                            <a href={trackingMapUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ width: 'fit-content' }}>
                                <MapPin size={14} /> Buka di Google Maps
                            </a>
                            {mapEmbedUrl && (
                                <iframe
                                    title="Peta posisi driver"
                                    src={mapEmbedUrl}
                                    style={{ width: '100%', minHeight: 260, border: '1px solid var(--color-gray-200)', borderRadius: '12px' }}
                                    loading="lazy"
                                />
                            )}
                        </div>
                    )}
            </CollapsibleCard>

            <div id="delivery-order-trip-fee-card">
            <CollapsibleCard title="Upah Trip Driver" defaultOpen={shouldOpenTripFeeCard}>
                    {!editingTarip ? (
                        <div>
                            <div className="detail-row">
                                <div className="detail-item">
                                    <div className="detail-label">Upah Dasar Trip</div>
                                    <div className="detail-value font-semibold" style={{ color: doData.taripBorongan ? 'var(--color-primary)' : 'var(--color-gray-400)' }}>
                                        {baseTripFee ? formatCurrency(baseTripFee) : 'Belum diisi'}
                                    </div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Tambahan Overtonase</div>
                                    <div className="detail-value font-semibold" style={{ color: hasOvertonase ? 'var(--color-warning)' : 'var(--color-gray-500)' }}>
                                        {hasOvertonase ? formatCurrency(overtonaseDriverAmount) : '-'}
                                    </div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Total Upah Trip Final</div>
                                    <div className="detail-value font-semibold" style={{ color: totalTripFee ? 'var(--color-primary)' : 'var(--color-gray-400)' }}>
                                        {totalTripFee ? formatCurrency(totalTripFee) : 'Belum diisi'}
                                    </div>
                                </div>
                            </div>
                            <div className="detail-row" style={{ marginTop: '0.75rem' }}>
                                <div className="detail-item">
                                    <div className="detail-label">Keterangan</div>
                                    <div className="detail-value">{doData.keteranganBorongan || '-'}</div>
                                </div>
                                {canManageTripFee && !hasLinkedTripCash && !canShowTripManager && (
                                    <div className="detail-item" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
                                        <button className="btn btn-secondary btn-sm" onClick={openTripFeeEditor}>
                                            <Edit size={14} /> {doData.taripBorongan ? 'Edit Upah' : 'Isi Upah'}
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="detail-row" style={{ marginTop: '0.75rem' }}>
                                <div className="detail-item">
                                    <div className="detail-label">Berat Aktual Final</div>
                                    <div className="detail-value">
                                        {doData.actualTotalWeightKg ? `${doData.actualTotalWeightKg} kg` : 'Belum difinalkan'}
                                    </div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Acuan Batas Overtonase</div>
                                    <div className="detail-value">
                                        {effectiveOvertonaseLimitKg ? `${effectiveOvertonaseLimitKg} kg` : '-'}
                                    </div>
                                    <div className="text-muted text-sm">{effectiveOvertonaseLimitKg ? effectiveOvertonaseLimitSource : ''}</div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Referensi Layanan</div>
                                    <div className="detail-value">
                                        {doData.serviceMaxPayloadKg ? `${doData.serviceMaxPayloadKg} kg` : '-'}
                                    </div>
                                </div>
                            </div>
                            <div className="detail-row" style={{ marginTop: '0.75rem' }}>
                                <div className="detail-item">
                                    <div className="detail-label">Berat Overtonase</div>
                                    <div className="detail-value">
                                        {hasOvertonase ? `${doData.overtonaseWeightKg} kg` : '-'}
                                    </div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Rate Tambahan / kg</div>
                                    <div className="detail-value">
                                        {doData.overtonaseDriverRatePerKg ? formatCurrency(doData.overtonaseDriverRatePerKg) : '-'}
                                    </div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Asal Area Trip</div>
                                    <div className="detail-value">{doData.tripOriginArea || '-'}</div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Tujuan Area Trip</div>
                                    <div className="detail-value">{doData.tripDestinationArea || '-'}</div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Master Tarif</div>
                                    <div className="detail-value">
                                        {matchedTripRouteRate
                                            ? formatTripRouteRateLabel(matchedTripRouteRate)
                                        : doData.tripRouteRateRef
                                            ? (canManageTripFee ? 'Master tidak ditemukan' : 'Tersambung ke master tarif')
                                            : '-'}
                                    </div>
                                </div>
                            </div>
                            {exceedsVehicleCapacity && (
                                <div className="text-danger text-sm" style={{ marginTop: '0.75rem' }}>
                                    Berat aktual final melebihi kapasitas kendaraan sebesar {doData.vehicleCapacityExceededKg} kg. Ini bukan sekadar overtonase tarif, tapi sudah melewati batas armada dan perlu evaluasi operasional.
                                </div>
                            )}
                            {linkedTripCashBonNumber && (
                                <div className="text-muted text-sm" style={{ marginTop: '0.75rem' }}>
                                    Upah trip sudah terkunci karena DO ini sudah punya uang jalan trip {linkedTripCashBonNumber}. Untuk menjaga settlement tetap konsisten, nominal dan master rute tidak bisa diubah lagi dari DO.
                                </div>
                            )}
                            {settledVoucherNeedsManualAdjustment && (
                                <div className="text-muted text-sm" style={{ marginTop: '0.75rem' }}>
                                    Bon {linkedTripCashBonNumber || linkedVoucher?.bonNumber} sudah settle. Tambahan overtonase hanya tercermin di DO ini dan tidak mengubah settlement lama secara otomatis.
                                </div>
                            )}
                        </div>
                    ) : (
                        <div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Asal Area Trip</label>
                                    <select className="form-select" value={tripOriginArea} onChange={e => handleTripOriginAreaChange(e.target.value)}>
                                        <option value="">Pilih asal area</option>
                                        {tripOriginAreaOptions.map(area => <option key={area} value={area}>{area}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tujuan Area Trip</label>
                                    <select className="form-select" value={tripDestinationArea} onChange={e => handleTripDestinationAreaChange(e.target.value)} disabled={!tripOriginArea}>
                                        <option value="">Pilih tujuan area</option>
                                        {tripDestinationAreaOptions.map(area => <option key={area} value={area}>{area}</option>)}
                                    </select>
                                </div>
                            </div>
                            {matchedTripRouteRate && (
                                <div
                                    style={{
                                        background: 'var(--color-primary-50)',
                                        border: '1px solid var(--color-primary-100)',
                                        borderRadius: '0.75rem',
                                        padding: '0.85rem 1rem',
                                        marginBottom: '1rem',
                                    }}
                                >
                                    <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-primary-700)' }}>
                                        Tarif master ditemukan
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--color-primary-700)' }}>
                                        {formatTripRouteRateLabel(matchedTripRouteRate)} | {formatCurrency(matchedTripRouteRate.rate)}
                                        {matchedTripRouteRate.notes ? ` | ${matchedTripRouteRate.notes}` : ''}
                                    </div>
                                </div>
                            )}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Upah Dasar Trip per DO (Rp) <span className="required">*</span></label>
                                    <FormattedNumberInput allowDecimal={false}
                                        value={matchedTripRouteRate?.rate ?? taripBorongan}
                                        onValueChange={value => setTaripBorongan(value)}
                                        placeholder={isTripFeeLockedToMaster ? 'Mengikuti master biaya rute trip' : 'Ketik upah trip per DO'}
                                        disabled={isTripFeeLockedToMaster}
                                    />
                                    <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                        {isTripFeeLockedToMaster
                                            ? 'Upah dasar trip terkunci mengikuti master biaya rute trip yang dipilih.'
                                            : 'Jika belum ada master rute yang cocok, upah dasar trip masih boleh diisi manual sebelum voucher diterbitkan.'}
                                    </div>
                                    <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                        Tambahan overtonase dihitung otomatis dari berat aktual final saat DO diselesaikan, jadi field ini hanya untuk upah dasar.
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Keterangan</label>
                                    <input className="form-input" value={keteranganBorongan} onChange={e => setKeteranganBorongan(e.target.value)} placeholder="Opsional..." />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button className="btn btn-primary btn-sm" onClick={saveTaripBorongan} disabled={savingTarip}>
                                    <Save size={14} /> {savingTarip ? 'Menyimpan...' : 'Simpan Upah'}
                                </button>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => {
                                        setTripRouteRateRef(doData.tripRouteRateRef || '');
                                        setTripOriginArea(doData.tripOriginArea || '');
                                        setTripDestinationArea(doData.tripDestinationArea || '');
                                        setTaripBorongan((doData.baseTaripBorongan ?? doData.taripBorongan) || 0);
                                        setKeteranganBorongan(doData.keteranganBorongan || '');
                                        setEditingTarip(false);
                                    }}
                                >
                                    Batal
                                </button>
                            </div>
                        </div>
                    )}
            </CollapsibleCard>
            </div>

            {/* Items */}
            <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span className="card-header-title">Item dalam DO ({doItems.length})</span>
                    {!canShowTripManager && canAppendCargoToDo && (
                        <button className="btn btn-secondary btn-sm" onClick={() => openShipperReferenceModal('create')}>
                            <Plus size={14} /> Tambah SJ
                        </button>
                    )}
                </div>
                {doItems.length === 0 ? (
                    <div className="card-body">
                        <div className="empty-state" style={{ padding: '1rem 0' }}>
                            <div className="empty-state-title">Muatan Surat Jalan belum diisi</div>
                            <div className="empty-state-text">Barang masih bisa ditambahkan sebelum finalisasi trip diajukan.</div>
                        </div>
                    </div>
                ) : (
                    <div className="card-body" style={{ display: 'grid', gap: '1rem' }}>
                        {cargoGroups.length > 1 && (
                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                {cargoGroups.map(group => (
                                    <div key={group.key} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.8rem', padding: '0.85rem 1rem', background: 'var(--color-gray-50)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                            <div>
                                                <div className="detail-label">SJ Pengirim</div>
                                                <div className="detail-value font-mono">{group.shipperReferenceNumber}</div>
                                            </div>
                                            <div>
                                                <div className="detail-label">Pickup</div>
                                                <div className="detail-value">{group.pickupLabel || '-'}</div>
                                                {group.pickupAddress && (
                                                    <div className="text-muted text-sm">{group.pickupAddress}</div>
                                                )}
                                            </div>
                                            <div>
                                                <div className="detail-label">Ringkasan</div>
                                                <div className="detail-value">
                                                    {formatCargoSummary({
                                                        qtyKoli: group.items.reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0), 0),
                                                        weightKg: group.items.reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemWeight ?? item.shippedWeight ?? 0), 0),
                                                        volumeM3: group.items.reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 }), 0),
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    <div className="table-wrapper">
                        <table>
                            <thead>
                                <tr>
                                    <th>SJ Pengirim</th>
                                    <th>Pickup</th>
                                    <th>Deskripsi</th>
                                    <th>Koli</th>
                                    <th>Muatan</th>
                                    {canAppendCargoToDo && <th>Aksi</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {doItems.map(item => (
                                    <tr key={item._id}>
                                        <td>
                                            <div className="font-mono">{item.shipperReferenceNumber || doData.customerDoNumber || '-'}</div>
                                        </td>
                                        <td>
                                            <div className="font-medium">
                                                {item.pickupStopKey && pickupStopMap.get(item.pickupStopKey)
                                                    ? `Pickup ${pickupStopMap.get(item.pickupStopKey)?.sequence}${pickupStopMap.get(item.pickupStopKey)?.pickupLabel ? ` - ${pickupStopMap.get(item.pickupStopKey)?.pickupLabel}` : ''}`
                                                    : item.pickupAddress
                                                        ? 'Pickup'
                                                        : '-'}
                                            </div>
                                            <div className="text-muted text-xs">{item.pickupAddress || pickupStopMap.get(item.pickupStopKey || '')?.pickupAddress || '-'}</div>
                                        </td>
                                        <td className="font-medium">{item.orderItemDescription}</td>
                                        <td>
                                            <div className="text-muted text-xs">Rencana Trip (Estimasi)</div>
                                            <div className="font-medium">{item.orderItemQtyKoli && item.orderItemQtyKoli > 0 ? `${item.orderItemQtyKoli} koli` : '-'}</div>
                                            <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>Aktual Final</div>
                                            <div className="font-medium" style={{ color: item.actualQtyKoli !== undefined ? 'var(--color-success)' : 'var(--color-gray-500)' }}>
                                                {item.actualQtyKoli !== undefined
                                                    ? `${item.actualQtyKoli} koli`
                                                    : item.orderItemQtyKoli && item.orderItemQtyKoli > 0
                                                        ? 'Belum final'
                                                        : '-'}
                                            </div>
                                        </td>
                                        <td>
                                            <div className="text-muted text-xs">Rencana Trip (Estimasi)</div>
                                            <div className="font-medium">
                                                {formatCargoSummary({
                                                    qtyKoli: item.orderItemQtyKoli,
                                                    weightKg: item.orderItemWeight,
                                                    weightInputValue: item.orderItemWeightInputValue,
                                                    weightInputUnit: item.orderItemWeightInputUnit,
                                                    volumeM3: item.orderItemVolumeM3,
                                                    volumeInputValue: item.orderItemVolumeInputValue,
                                                    volumeInputUnit: item.orderItemVolumeInputUnit,
                                                })}
                                            </div>
                                            <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>Aktual Final</div>
                                            <div className="font-medium" style={{ color: item.actualQtyKoli !== undefined ? 'var(--color-success)' : 'var(--color-gray-500)' }}>
                                                {item.actualQtyKoli !== undefined || item.actualWeightKg !== undefined || item.actualVolumeM3 !== undefined
                                                    ? formatCargoSummary({
                                                        qtyKoli: item.actualQtyKoli,
                                                        weightKg: item.actualWeightKg,
                                                        weightInputValue: item.actualWeightInputValue,
                                                        weightInputUnit: item.actualWeightInputUnit,
                                                        volumeM3: item.actualVolumeM3,
                                                        volumeInputValue: item.actualVolumeInputValue,
                                                        volumeInputUnit: item.actualVolumeInputUnit,
                                                    })
                                                    : 'Belum final'}
                                            </div>
                                        </td>
                                        {canAppendCargoToDo && (
                                            <td>
                                                {isDeliveryOrderItemEditable(item) ? (
                                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                        <button
                                                            type="button"
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => openCargoEditModal(item)}
                                                            disabled={Boolean(removingCargoItemId) || savingCargo}
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => void removeCargoItem(item._id, item.orderItemDescription || 'barang ini')}
                                                            disabled={Boolean(removingCargoItemId) || savingCargo}
                                                        >
                                                            {removingCargoItemId === item._id ? 'Menghapus...' : 'Hapus'}
                                                        </button>
                                                    </div>
                                                ) : editableCargoItemMap[item._id] ? (
                                                    <span className="text-muted text-sm">SJ delivered</span>
                                                ) : (
                                                    <span className="text-muted text-sm">-</span>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    </div>
                )}
            </div>

            <CollapsibleCard title="Riwayat Tracking">
                    {trackingLogs.length === 0 ? (
                        <p className="text-muted text-sm text-center" style={{ padding: '1rem' }}>Belum ada tracking log</p>
                    ) : (
                        <div className="timeline">
                            {trackingLogs.map((log, idx) => (
                                <div key={log._id || idx} className="timeline-item">
                                    <div className={`timeline-dot ${log.status === 'DELIVERED' ? 'success' : ['HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(log.status) ? 'active' : ''}`} />
                                    <div className="timeline-content">
                                        <div className="timeline-title">{DO_STATUS_MAP[log.status]?.label || log.status}</div>
                                        <div className="timeline-meta">{formatDateTime(log.timestamp)} {log.locationText ? `- ${log.locationText}` : ''}</div>
                                        {log.note && <div className="timeline-text">{log.note}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
            </CollapsibleCard>
            </div>

            {showTripResourcesModal && (
                <div className="modal-overlay" onClick={() => { if (!savingTripResources) setShowTripResourcesModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{tripResourceActionLabel}</h3>
                            <button className="modal-close" onClick={() => setShowTripResourcesModal(false)} disabled={savingTripResources}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kendaraan</label>
                                    <select
                                        className="form-select"
                                        value={tripVehicleRef}
                                        onChange={e => setTripVehicleRef(e.target.value)}
                                        disabled={loadingTripResources || savingTripResources}
                                    >
                                        <option value="">{loadingTripResources ? 'Memuat kendaraan...' : 'Pilih kendaraan untuk trip ini'}</option>
                                        {assignableVehicles.map(vehicle => (
                                            <option key={vehicle._id} value={vehicle._id}>
                                                {vehicle.unitCode ? `${vehicle.unitCode} - ` : ''}{vehicle.plateNumber || '-'}{vehicle.serviceName ? ` (${vehicle.serviceName})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    {!loadingTripResources && assignableVehicles.length === 0 && (
                                        <div className="detail-value" style={{ color: 'var(--color-warning-dark)', marginTop: '0.5rem' }}>
                                            Tidak ada kendaraan kosong. Semua armada operasional sedang terikat di DO aktif lain.
                                        </div>
                                    )}
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Supir</label>
                                    <select
                                        className="form-select"
                                        value={tripDriverRef}
                                        onChange={e => setTripDriverRef(e.target.value)}
                                        disabled={loadingTripResources || savingTripResources}
                                    >
                                        <option value="">{loadingTripResources ? 'Memuat supir...' : 'Pilih supir untuk trip ini'}</option>
                                        {assignableDrivers.map(driver => (
                                            <option key={driver._id} value={driver._id}>
                                                {driver.name}{driver.phone ? ` | ${driver.phone}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    {!loadingTripResources && assignableDrivers.length === 0 && (
                                        <div className="detail-value" style={{ color: 'var(--color-warning-dark)', marginTop: '0.5rem' }}>
                                            Tidak ada supir kosong. Semua supir aktif sedang terikat di DO aktif lain.
                                        </div>
                                    )}
                                </div>
                            </div>
                            {requiresTripVehicleOverrideReason && (
                                <div className="form-group">
                                    <label className="form-label">Alasan Override Armada <span className="required">*</span></label>
                                    <textarea
                                        className="form-textarea"
                                        rows={2}
                                        value={tripVehicleOverrideReason}
                                        onChange={e => setTripVehicleOverrideReason(e.target.value)}
                                        disabled={savingTripResources}
                                        placeholder="Contoh: armada sesuai kategori sedang penuh, trip ini harus tetap jalan."
                                    />
                                </div>
                            )}
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.82rem', color: 'var(--color-gray-600)' }}>
                                Perubahan armada hanya diizinkan saat status trip masih <strong>Dibuat</strong> dan belum masuk uang jalan / settlement trip.
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowTripResourcesModal(false)} disabled={savingTripResources}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={saveTripResources}
                                disabled={
                                    loadingTripResources ||
                                    savingTripResources ||
                                    (requiresTripVehicleOverrideReason && !tripVehicleOverrideReason.trim())
                                }
                            >
                                <Save size={16} /> {savingTripResources ? 'Menyimpan...' : 'Simpan Armada Trip'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Status Modal */}
            {showStatusModal && (
                <div className="modal-overlay" onClick={() => { if (!updatingStatus) setShowStatusModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{isCompletingDelivery ? (reviewingDriverRequest ? 'Review Finalisasi Batch SJ' : 'Finalisasi Batch SJ') : 'Update Status Batch SJ'}</h3>
                            <button className="modal-close" onClick={() => { setShowStatusModal(false); setReviewingDriverRequest(false); }} disabled={updatingStatus}>&times;</button>
                        </div>
                        <div className="modal-body">
                            {newStatus && eligibleStatusSuratJalanDocuments.length > 0 && (
                                <div className="form-group">
                                    <label className="form-label">Pilih Batch Surat Jalan yang Memenuhi Syarat</label>
                                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                                        {eligibleStatusSuratJalanDocuments.map(document => (
                                            <label
                                                key={document._id}
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
                                                    checked={selectedStatusSuratJalanSet.has(document._id)}
                                                    onChange={event => {
                                                        setSelectedStatusSuratJalanRefs(previous => {
                                                            if (event.target.checked) {
                                                                return [...new Set([...previous, document._id])];
                                                            }
                                                            return previous.filter(item => item !== document._id);
                                                        });
                                                    }}
                                                    disabled={updatingStatus}
                                                />
                                                <div style={{ display: 'grid', gap: '0.15rem' }}>
                                                    <div className="font-semibold">{document.suratJalanNumber}</div>
                                                    <div className="text-muted text-sm">
                                                        Status sekarang {DO_STATUS_MAP[document.tripStatus || displayTripStatus]?.label || document.tripStatus || displayTripStatus} | {document.itemCount} item | {formatCargoSummary(document.cargoSummary)}
                                                    </div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Status Tujuan</label>
                                {reviewingDriverRequest && doData.pendingDriverStatus ? (
                                    <div className="detail-value">
                                        <span className={`badge badge-${pendingDriverStatusMeta?.color || 'warning'}`}>
                                            <span className="badge-dot" /> {pendingDriverStatusMeta?.label || doData.pendingDriverStatus}
                                        </span>
                                    </div>
                                ) : (
                                    <select
                                        className="form-select"
                                        value={newStatus}
                                        onChange={e => {
                                            const nextStatus = e.target.value;
                                            setNewStatus(nextStatus);
                                            if (!nextStatus) {
                                                setSelectedStatusSuratJalanRefs([]);
                                                return;
                                            }
                                            const nextEligibleRefs = suratJalanStatusOptions
                                                .filter(document => getEligibleStatusesForSuratJalan(document).includes(nextStatus))
                                                .map(document => document._id);
                                            setSelectedStatusSuratJalanRefs(nextEligibleRefs);
                                        }}
                                        disabled={updatingStatus}
                                    >
                                        <option value="">Pilih status</option>
                                        {availableBatchStatuses.map(s => <option key={s} value={s}>{DO_STATUS_MAP[s]?.label || s}</option>)}
                                    </select>
                                )}
                            </div>
                            {newStatus && eligibleStatusSuratJalanDocuments.length === 0 && (
                                <div style={{ background: 'var(--color-warning-soft)', borderRadius: '0.75rem', padding: '0.85rem 1rem', marginBottom: '0.75rem', border: '1px solid var(--color-warning-light)', color: 'var(--color-warning-dark)', fontSize: '0.82rem' }}>
                                    Belum ada SJ dalam trip ini yang bisa dipindahkan ke <strong>{DO_STATUS_MAP[newStatus]?.label || newStatus}</strong>.
                                </div>
                            )}
                            {reviewingDriverRequest && doData.pendingDriverStatusNote && (
                                <div className="form-group">
                                    <label className="form-label">Catatan Driver</label>
                                    <div className="detail-value">{doData.pendingDriverStatusNote}</div>
                                </div>
                            )}
                            {isCompletingDelivery && (
                                <>
                                    {isPartialSuratJalanBatchFinalize && (
                                        <div style={{ background: 'var(--color-info-light)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-info)' }}>
                                            Hanya SJ yang dicentang yang akan dipindahkan ke status <strong>{DO_STATUS_MAP[newStatus]?.label || newStatus}</strong>. SJ lain tetap berada di statusnya sekarang.
                                        </div>
                                    )}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Item dalam batch SJ</div>
                                            <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{selectedActualCargoItems.length} item</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Muatan batch SJ</div>
                                            <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                                {selectedActualCargoItems.length > 0 ? formatCargoSummary(selectedActualCargoTotals) : 'Belum diisi'}
                                            </div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Mode drop</div>
                                            <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                                {selectedDropModeLabel}
                                            </div>
                                            <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>{selectedDropOutcomeSummary}</div>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Nama Penerima POD <span className="required">*</span></label>
                                        <input className="form-input" value={podName} onChange={e => setPodName(e.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Tanggal Terima POD <span className="required">*</span></label>
                                        <input type="date" className="form-input" value={podDate} onChange={e => setPodDate(e.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Catatan POD</label>
                                        <textarea className="form-textarea" rows={2} value={podNote} onChange={e => setPodNote(e.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group" style={{ marginBottom: '1rem' }}>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '1rem', padding: '1rem', background: 'var(--color-white)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                                <div>
                                                    <div className="text-muted text-sm" style={{ marginBottom: '0.2rem' }}>Langkah 1</div>
                                                    <label className="form-label" style={{ marginBottom: 0 }}>Tentukan Realisasi Titik Drop <span className="required">*</span></label>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={toggleAdvancedDropEditor}
                                                    disabled={updatingStatus}
                                                >
                                                    {showAdvancedDropEditor ? 'Tutup Detail Drop' : 'Ada Multi-drop / Hold / Extra Drop'}
                                                </button>
                                            </div>
                                            <div style={{ background: 'var(--color-info-light)', borderRadius: '0.75rem', padding: '0.85rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-info)' }}>
                                                Pilih dulu barang batch SJ ini turun ke mana. Kalau semua selesai di satu tujuan, sistem otomatis pakai <strong>{selectedAutoActualDropDraft.locationName || 'Tujuan Invoice'}</strong>. Buka detail ini hanya kalau ada multi-drop, hold, return, atau extra drop.
                                            </div>
                                            {selectedActualDropMismatchMessage && (
                                                <div style={{ background: 'var(--color-danger-light)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-danger)' }}>
                                                    {selectedActualDropMismatchMessage} Muatan aktual {formatCargoSummary(selectedActualCargoTotals)} tetapi alokasi drop baru {formatCargoSummary(selectedActualDropTotals)}.
                                                </div>
                                            )}
                                            {selectedActualDropAmbiguityMessage && (
                                                <div style={{ background: 'var(--color-warning-light)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-warning-dark)' }}>
                                                    {selectedActualDropAmbiguityMessage}
                                                </div>
                                            )}
                                            {!showAdvancedDropEditor ? (
                                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                                    <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Realisasi Default</div>
                                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'grid', gap: '0.2rem' }}>
                                                        <div>Lokasi: {selectedAutoActualDropDraft.locationName || 'Tujuan Invoice'}</div>
                                                        {selectedAutoActualDropDraft.locationAddress && <div>Alamat: {selectedAutoActualDropDraft.locationAddress}</div>}
                                                        <div>Barang: {summarizeActualCargoDraftDescriptions(getActualCargoDraftsForDrop(selectedAutoActualDropDraft, selectedActualCargoItems))}</div>
                                                        <div>Muatan: {formatCargoSummary({ qtyKoli: selectedActualCargoTotals.qtyKoli, weightKg: selectedActualCargoTotals.weightKg, volumeM3: selectedActualCargoTotals.volumeM3 })}</div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                                        <div className="text-muted text-sm">
                                                            Tentukan per titik apakah barang turun, hold, return, atau lanjut ke titik lain.
                                                        </div>
                                                        <button type="button" className="btn btn-secondary btn-sm" onClick={addActualDropDraft} disabled={updatingStatus}>
                                                            + Tambah Titik Drop
                                                        </button>
                                                    </div>
                                                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                                                        {selectedActualDropPoints.map((item, index) => (
                                                            (() => {
                                                                const selectedReferenceValue = resolveActualDropShipperReferenceValue(item);
                                                                const itemOptions = selectedReferenceValue ? getActualDropItemOptions(item).filter(cargoItem => selectedActualCargoItemRefs.has(cargoItem.deliveryOrderItemRef)) : [];
                                                                const selectedItemRef = resolveActualDropItemValue(item);
                                                                const selectedCargoItem = actualCargoItems.find(cargoItem => cargoItem.deliveryOrderItemRef === item.deliveryOrderItemRef);
                                                                const lockedDropWeight = shouldLockActualDropWeight(selectedCargoItem);
                                                                return (
                                                            <div key={item.draftKey} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                                                    <div style={{ fontWeight: 600 }}>Titik Drop {index + 1}</div>
                                                                    {selectedActualDropPoints.length > 1 && (
                                                                        <button type="button" className="btn btn-danger btn-sm" onClick={() => removeActualDropDraft(item.draftKey)} disabled={updatingStatus}>
                                                                            Hapus
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <div className="form-row">
                                                                    {selectedActualDropShipperReferenceOptions.length > 0 && (
                                                                        <div className="form-group">
                                                                            <label className="form-label">No. SJ</label>
                                                                            <select
                                                                                className="form-select"
                                                                                value={resolveActualDropShipperReferenceValue(item)}
                                                                                onChange={e => applyActualDropShipperReference(item.draftKey, e.target.value)}
                                                                                disabled={updatingStatus}
                                                                            >
                                                                                <option value="">Pilih surat jalan</option>
                                                                                {selectedActualDropShipperReferenceOptions.map(target => (
                                                                                    <option key={target.optionValue} value={target.optionValue}>
                                                                                        {target.optionLabel}
                                                                                    </option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                    )}
                                                                    <div className="form-group">
                                                                        <label className="form-label">Tipe Titik</label>
                                                                        <select
                                                                            className="form-select"
                                                                            value={item.stopType}
                                                                            onChange={e => updateActualDropDraft(item.draftKey, 'stopType', e.target.value)}
                                                                            disabled={updatingStatus}
                                                                        >
                                                                            {Object.entries(DO_ACTUAL_DROP_TYPE_MAP).map(([value, meta]) => (
                                                                                <option key={value} value={value}>{meta.label}</option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                    <div className="form-group">
                                                                        <label className="form-label">Nama Lokasi <span className="required">*</span></label>
                                                                        <input
                                                                            className="form-input"
                                                                            value={item.locationName}
                                                                            onChange={e => updateActualDropDraft(item.draftKey, 'locationName', e.target.value)}
                                                                            disabled={updatingStatus}
                                                                            placeholder="Mis. Gudang Transit Malang"
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Barang di SJ</label>
                                                                    <select
                                                                        className="form-select"
                                                                        value={selectedItemRef}
                                                                        onChange={e => applyActualDropItem(item.draftKey, e.target.value)}
                                                                        disabled={updatingStatus || itemOptions.length === 0}
                                                                    >
                                                                        {itemOptions.length === 0 && <option value="">Tidak ada barang di SJ ini</option>}
                                                                        {itemOptions.map(cargoItem => (
                                                                            <option key={cargoItem.deliveryOrderItemRef} value={cargoItem.deliveryOrderItemRef}>
                                                                                {cargoItem.description} - {formatCargoSummary({
                                                                                    qtyKoli: parseFormattedNumberish(cargoItem.actualQtyKoli || 0, { maxFractionDigits: 2 }),
                                                                                    weightInputValue: parseFormattedNumberish(cargoItem.actualWeightInputValue || 0, {
                                                                                        maxFractionDigits: cargoItem.actualWeightInputUnit === 'TON' ? 3 : 2,
                                                                                    }),
                                                                                    weightInputUnit: cargoItem.actualWeightInputUnit,
                                                                                    volumeInputValue: parseFormattedNumberish(cargoItem.actualVolumeInputValue || 0, {
                                                                                        maxFractionDigits: cargoItem.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                                                                                    }),
                                                                                    volumeInputUnit: cargoItem.actualVolumeInputUnit,
                                                                                })}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                    <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                                                        {selectedItemRef ? `Barang dipakai di baris ini: ${getActualDropCargoSummary(item)}. Perubahan qty, berat, dan volume disimpan di modal sampai finalisasi disimpan.` : 'Belum ada barang yang bisa dialokasikan untuk titik ini.'}
                                                                    </div>
                                                                </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Alamat Lokasi</label>
                                                                    <input
                                                                        className="form-input"
                                                                        value={item.locationAddress}
                                                                        onChange={e => updateActualDropDraft(item.draftKey, 'locationAddress', e.target.value)}
                                                                        disabled={updatingStatus}
                                                                        placeholder="Opsional, isi jika berbeda dari tujuan invoice"
                                                                    />
                                                                </div>
                                                                <div className="form-row">
                                                                    <div className="form-group">
                                                                        <label className="form-label">Qty Drop</label>
                                                                        <FormattedNumberInput
                                                                            min={0}
                                                                            maxFractionDigits={2}
                                                                            value={parseFormattedNumberish(item.qtyKoli || 0, { maxFractionDigits: 2 })}
                                                                            onValueChange={value => updateActualDropDraft(item.draftKey, 'qtyKoli', String(value))}
                                                                            disabled={updatingStatus}
                                                                        />
                                                                    </div>
                                                                    <div className="form-group">
                                                                        <label className="form-label">Berat Drop</label>
                                                                        {lockedDropWeight ? (
                                                                            <div className="form-input" style={{ display: 'flex', alignItems: 'center', background: 'var(--color-gray-100)', color: 'var(--color-gray-900)' }}>
                                                                                {formatWeightDisplay({
                                                                                    weightInputValue: item.weightInputValue,
                                                                                    weightInputUnit: item.weightInputUnit,
                                                                                })}
                                                                            </div>
                                                                        ) : (
                                                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                                <FormattedNumberInput
                                                                                    min={0}
                                                                                    maxFractionDigits={item.weightInputUnit === 'TON' ? 3 : 2}
                                                                                    value={parseFormattedNumberish(item.weightInputValue || 0, {
                                                                                        maxFractionDigits: item.weightInputUnit === 'TON' ? 3 : 2,
                                                                                    })}
                                                                                    onValueChange={value => updateActualDropDraft(item.draftKey, 'weightInputValue', String(value))}
                                                                                    disabled={updatingStatus}
                                                                                />
                                                                                <select
                                                                                    className="form-select"
                                                                                    value={item.weightInputUnit}
                                                                                    onChange={e => updateActualDropDraft(item.draftKey, 'weightInputUnit', e.target.value)}
                                                                                    disabled={updatingStatus}
                                                                                >
                                                                                    {WEIGHT_INPUT_UNIT_OPTIONS.map(option => (
                                                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                                                    ))}
                                                                                </select>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="form-row">
                                                                    <div className="form-group">
                                                                        <label className="form-label">Volume Drop</label>
                                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                        <FormattedNumberInput
                                                                            min={0}
                                                                            maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3}
                                                                            value={parseFormattedNumberish(item.volumeInputValue || 0, {
                                                                                maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
                                                                            })}
                                                                            onValueChange={value => updateActualDropDraft(item.draftKey, 'volumeInputValue', String(value))}
                                                                            disabled={updatingStatus}
                                                                            />
                                                                            <select
                                                                                className="form-select"
                                                                                value={item.volumeInputUnit}
                                                                                onChange={e => updateActualDropDraft(item.draftKey, 'volumeInputUnit', e.target.value)}
                                                                                disabled={updatingStatus}
                                                                            >
                                                                                {VOLUME_INPUT_UNIT_OPTIONS.map(option => (
                                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Catatan Titik Drop</label>
                                                                    <textarea
                                                                        className="form-textarea"
                                                                        rows={2}
                                                                        value={item.note}
                                                                        onChange={e => updateActualDropDraft(item.draftKey, 'note', e.target.value)}
                                                                        disabled={updatingStatus}
                                                                        placeholder="Mis. 30 koli turun di Malang, sisa lanjut ke Ponorogo"
                                                                    />
                                                                </div>
                                                            </div>
                                                                );
                                                            })()
                                                        ))}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '1rem', padding: '1rem', background: 'var(--color-white)' }}>
                                            <div style={{ marginBottom: '0.75rem' }}>
                                                <div className="text-muted text-sm" style={{ marginBottom: '0.2rem' }}>Langkah 2</div>
                                                <label className="form-label" style={{ marginBottom: 0 }}>Review Muatan Aktual per Item <span className="required">*</span></label>
                                            </div>
                                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                                Setelah titik drop ditentukan, muatan aktual per item dihitung otomatis dari titik Drop / Extra Drop. Baris Hold / Transit / Retur tidak masuk angka terkirim agar bisa dilanjutkan lagi nanti.
                                            </div>
                                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                                {(selectedDerivedActualCargoGroups.length > 0
                                                    ? selectedDerivedActualCargoGroups
                                                    : [{ key: 'selected-items', label: 'Surat Jalan', items: selectedDerivedActualCargoItems }]
                                                ).map(group => (
                                                    <div key={group.key} style={{ display: 'grid', gap: '0.75rem' }}>
                                                        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{group.label}</div>
                                                        {group.items.map(item => (
                                                            <div key={item.deliveryOrderItemRef} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                                                <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>{item.description}</div>
                                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                                                                    Rencana Trip (estimasi): {formatCargoSummary({
                                                                        qtyKoli: item.plannedQtyKoli,
                                                                        weightKg: item.plannedWeightKg,
                                                                        weightInputValue: item.plannedWeightInputValue,
                                                                        weightInputUnit: item.plannedWeightInputUnit,
                                                                        volumeM3: item.plannedVolumeM3,
                                                                        volumeInputValue: item.plannedVolumeInputValue,
                                                                        volumeInputUnit: item.plannedVolumeInputUnit,
                                                                    })}
                                                                </div>
                                                                {!item.requireQty && (
                                                                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                                                                        Item ini tidak memakai basis koli. Isi realisasi berat dan/atau volume aktual lapangan.
                                                                    </div>
                                                                )}
                                                                <div className="form-row">
                                                                    <div className="form-group">
                                                                        <label className="form-label">Koli Aktual {item.requireQty && <span className="required">*</span>}</label>
                                                                        <FormattedNumberInput
                                                                            min={0}
                                                                            maxFractionDigits={2}
                                                                           value={parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 })}
                                                                           onValueChange={value => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualQtyKoli', String(value))}
                                                                            disabled={updatingStatus || !item.requireQty}
                                                                        />
                                                                    </div>
                                                                    <div className="form-group">
                                                                        <label className="form-label">Berat Aktual {item.requireWeight && <span className="required">*</span>}</label>
                                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                            <FormattedNumberInput
                                                                                min={0}
                                                                                maxFractionDigits={item.actualWeightInputUnit === 'TON' ? 3 : 2}
                                                                                value={parseFormattedNumberish(item.actualWeightInputValue || 0, {
                                                                                    maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
                                                                                })}
                                                                                onValueChange={value => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualWeightInputValue', String(value))}
                                                                                disabled={updatingStatus}
                                                                            />
                                                                            <select
                                                                                className="form-select"
                                                                                value={item.actualWeightInputUnit}
                                                                                onChange={e => updateActualCargoWeightUnit(item.deliveryOrderItemRef, e.target.value as ActualCargoDraft['actualWeightInputUnit'])}
                                                                                disabled={updatingStatus}
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
                                                                        <label className="form-label">Volume Aktual {item.requireVolume && <span className="required">*</span>}</label>
                                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                            <FormattedNumberInput
                                                                                min={0}
                                                                                maxFractionDigits={item.actualVolumeInputUnit === 'LITER' ? 0 : 3}
                                                                                value={parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                                                                                    maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                                                                                })}
                                                                                onValueChange={value => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualVolumeInputValue', String(value))}
                                                                                disabled={updatingStatus}
                                                                            />
                                                                            <select
                                                                                className="form-select"
                                                                                value={item.actualVolumeInputUnit}
                                                                                onChange={e => updateActualCargoVolumeUnit(item.deliveryOrderItemRef, e.target.value as ActualCargoDraft['actualVolumeInputUnit'])}
                                                                                disabled={updatingStatus}
                                                                            >
                                                                                {VOLUME_INPUT_UNIT_OPTIONS.map(option => (
                                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={3} value={statusNote} onChange={e => setStatusNote(e.target.value)} placeholder={isCompletingDelivery ? 'Catatan finalisasi batch SJ...' : 'Catatan progres batch SJ...'} disabled={updatingStatus} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowStatusModal(false); setReviewingDriverRequest(false); }} disabled={updatingStatus}>Batal</button>
                            <button className={`btn ${isCompletingDelivery ? 'btn-success' : 'btn-primary'}`} onClick={updateDOStatus} disabled={!newStatus || updatingStatus || selectedStatusSuratJalanRefs.length === 0 || (isCompletingDelivery && (!podName.trim() || !podDate))}>
                                <Save size={16} /> {updatingStatus ? 'Menyimpan...' : (reviewingDriverRequest ? 'Approve Batch SJ' : (isCompletingDelivery ? 'Finalkan Batch SJ' : 'Simpan Batch SJ'))}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showRejectRequestModal && (
                <div className="modal-overlay" onClick={() => { if (!rejectingRequest) setShowRejectRequestModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Tolak Permintaan Driver</h3>
                            <button className="modal-close" onClick={() => setShowRejectRequestModal(false)} disabled={rejectingRequest}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Alasan Penolakan <span className="required">*</span></label>
                                <textarea
                                    className="form-textarea"
                                    rows={3}
                                    value={rejectRequestNote}
                                    onChange={e => setRejectRequestNote(e.target.value)}
                                    disabled={rejectingRequest}
                                    placeholder="Mis. POD belum lengkap atau barang belum benar-benar diterima."
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowRejectRequestModal(false)} disabled={rejectingRequest}>Batal</button>
                            <button className="btn btn-danger" onClick={rejectDriverStatusRequest} disabled={rejectingRequest || !rejectRequestNote.trim()}>
                                <Save size={16} /> {rejectingRequest ? 'Menyimpan...' : 'Tolak Permintaan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showTargetModal && (
                <div className="modal-overlay" onClick={() => { if (!savingTarget) setShowTargetModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Edit Tujuan / Penerima Trip</h3>
                            <button className="modal-close" onClick={() => setShowTargetModal(false)} disabled={savingTarget}>&times;</button>
                        </div>
                        <div className="modal-body">
                            {getCustomerRecipientOptions(doData?.customerRef).length > 0 && (
                                <div className="form-group">
                                    <label className="form-label">Ambil dari Master Tujuan</label>
                                    <select
                                        className="form-select"
                                        value={selectedTargetRecipientId}
                                        onChange={event => applyTargetRecipient(event.target.value)}
                                        disabled={savingTarget}
                                    >
                                        <option value="">Pilih tujuan customer...</option>
                                        {getCustomerRecipientOptions(doData?.customerRef).map(recipient => (
                                            <option key={recipient._id} value={recipient._id}>
                                                {formatCustomerRecipientLabel(recipient)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Nama Penerima / PIC</label>
                                    <input className="form-input" value={targetReceiverName} onChange={e => { setSelectedTargetRecipientId(''); setTargetReceiverName(e.target.value); }} disabled={savingTarget} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Telepon</label>
                                    <input className="form-input" value={targetReceiverPhone} onChange={e => { setSelectedTargetRecipientId(''); setTargetReceiverPhone(e.target.value); }} disabled={savingTarget} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Perusahaan</label>
                                <input className="form-input" value={targetReceiverCompany} onChange={e => { setSelectedTargetRecipientId(''); setTargetReceiverCompany(e.target.value); }} disabled={savingTarget} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Tujuan</label>
                                <textarea className="form-textarea" rows={3} value={targetReceiverAddress} onChange={e => { setSelectedTargetRecipientId(''); setTargetReceiverAddress(e.target.value); }} disabled={savingTarget} placeholder="Boleh dikosongkan jika tujuan final belum turun" />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowTargetModal(false)} disabled={savingTarget}>Batal</button>
                            <button className="btn btn-primary" onClick={saveDeliveryTarget} disabled={savingTarget}>
                                <Save size={16} /> {savingTarget ? 'Menyimpan...' : 'Simpan Tujuan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showShipperReferenceModal && (
                <div className="modal-overlay" onClick={() => { if (!savingShipperReference) setShowShipperReferenceModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{isCreatingNewShipperReference ? 'Tambah Surat Jalan' : 'Edit Surat Jalan'}</h3>
                            <button className="modal-close" onClick={() => { setShowShipperReferenceModal(false); setShipperReferenceItemDraftMap({}); setShipperReferenceExistingItemDraftMap({}); }} disabled={savingShipperReference}>&times;</button>
                        </div>
                        <div className="modal-body">
                            {!isCreatingNewShipperReference && (
                                <div className="form-group">
                                    <label className="form-label">Pilih Surat Jalan</label>
                                    <select
                                        className="form-select"
                                        value={selectedShipperReferenceDraft?.draftKey || ''}
                                        onChange={event => setSelectedShipperReferenceDraftKey(event.target.value)}
                                        disabled={savingShipperReference || shipperReferenceDrafts.length === 0}
                                    >
                                        <option value="">Pilih Surat Jalan...</option>
                                        {shipperReferenceDrafts.map((entry, index) => (
                                            <option
                                                key={entry.draftKey}
                                                value={entry.draftKey}
                                                disabled={getSuratJalanOperationalStatus(entry.referenceKey).status === 'DELIVERED'}
                                            >
                                                {entry.referenceNumber || `SJ ${index + 1}`}{getSuratJalanOperationalStatus(entry.referenceKey).status === 'DELIVERED' ? ' (Delivered)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        Pilih nomor SJ yang ingin dibetulkan. SJ yang sudah delivered tetap terlihat, tapi dikunci dari dropdown.
                                    </div>
                                </div>
                            )}
                            {!isCreatingNewShipperReference && !selectedShipperReferenceDraft && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                                    Belum ada SJ yang bisa diedit dari daftar ini.
                                </div>
                            )}
                            {isCreatingNewShipperReference && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                                    Lengkapi form di bawah untuk membuat Surat Jalan baru pada trip ini.
                                </div>
                            )}
                            {selectedShipperReferenceDraft && (
                                <div style={{ display: 'grid', gap: '0.75rem', padding: '0.85rem', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', background: 'var(--color-gray-50)' }}>
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <input
                                            className="form-input"
                                            value={selectedShipperReferenceDraft.referenceNumber}
                                            onChange={event => {
                                                const nextValue = event.target.value.toUpperCase();
                                                updateShipperReferenceDraft(selectedShipperReferenceDraft.draftKey, { referenceNumber: nextValue });
                                            }}
                                            placeholder={`Contoh: ${shipperReferenceExample}`}
                                            disabled={savingShipperReference}
                                        />
                                        {!isCreatingNewShipperReference && shipperReferenceDrafts.length > 1 && (
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-icon-only"
                                                onClick={() => removeShipperReferenceDraft(selectedShipperReferenceDraft.draftKey)}
                                                disabled={savingShipperReference}
                                                title="Hapus SJ pengirim"
                                            >
                                                &times;
                                            </button>
                                        )}
                                    </div>
                                    {pickupStopList.length > 1 && (
                                        <div>
                                            <label className="form-label">Titik Pickup</label>
                                            <select
                                                className="form-select"
                                                value={selectedShipperReferenceDraft.pickupStopKey}
                                                onChange={event => updateShipperReferenceDraft(selectedShipperReferenceDraft.draftKey, { pickupStopKey: event.target.value })}
                                                disabled={savingShipperReference}
                                            >
                                                <option value="">Pilih pickup untuk SJ ini</option>
                                                {pickupStopList.map(stop => (
                                                    <option key={stop._key} value={stop._key}>
                                                        {`Pickup ${stop.sequence}${stop.pickupLabel ? ` - ${stop.pickupLabel}` : ''}`}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    {pickupStopList.length === 1 && (
                                        <div className="text-muted text-sm">
                                            Pickup: {`Pickup ${pickupStopList[0].sequence}${pickupStopList[0].pickupLabel ? ` - ${pickupStopList[0].pickupLabel}` : ''}`}
                                        </div>
                                    )}
                                    {selectedShipperReferenceDraft.pickupStopKey && pickupStopMap.get(selectedShipperReferenceDraft.pickupStopKey)?.pickupAddress && (
                                        <div className="text-muted text-sm">
                                            {pickupStopMap.get(selectedShipperReferenceDraft.pickupStopKey)?.pickupAddress}
                                        </div>
                                    )}
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Customer Invoice</label>
                                        <select
                                            className="form-select"
                                            value={selectedShipperReferenceDraft.billingCustomerRef}
                                            onChange={event => {
                                                const nextCustomerRef = event.target.value;
                                                const nextCustomerName = billingCustomers.find(customer => customer._id === nextCustomerRef)?.name || '';
                                                updateShipperReferenceDraft(selectedShipperReferenceDraft.draftKey, {
                                                    selectedRecipientId: resolveMatchingRecipientId(nextCustomerRef || doData?.customerRef, {
                                                        receiverName: selectedShipperReferenceDraft.receiverName,
                                                        receiverPhone: selectedShipperReferenceDraft.receiverPhone,
                                                        receiverCompany: selectedShipperReferenceDraft.receiverCompany,
                                                        receiverAddress: selectedShipperReferenceDraft.receiverAddress,
                                                    }),
                                                    billingCustomerRef: nextCustomerRef,
                                                    billingCustomerName: nextCustomerName,
                                                });
                                            }}
                                            disabled={savingShipperReference}
                                        >
                                            <option value="">Ikuti customer order / resi</option>
                                            {billingCustomers.map(customer => (
                                                <option key={customer._id} value={customer._id}>
                                                    {customer.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    {(() => {
                                        const recipientOptions = getCustomerRecipientOptions(selectedShipperReferenceDraft.billingCustomerRef || doData?.customerRef);
                                        return recipientOptions.length > 0 ? (
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">Tujuan dari Master Customer</label>
                                                <select
                                                    className="form-select"
                                                    value={selectedShipperReferenceDraft.selectedRecipientId}
                                                    onChange={event => applyShipperReferenceRecipient(selectedShipperReferenceDraft.draftKey, event.target.value)}
                                                    disabled={savingShipperReference}
                                                >
                                                    <option value="">Pilih tujuan untuk SJ ini...</option>
                                                    {recipientOptions.map(recipient => (
                                                        <option key={recipient._id} value={recipient._id}>
                                                            {formatCustomerRecipientLabel(recipient)}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        ) : null;
                                    })()}
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Nama Penerima</label>
                                            <input
                                                className="form-input"
                                                value={selectedShipperReferenceDraft.receiverName}
                                                onChange={event => updateShipperReferenceDraft(selectedShipperReferenceDraft.draftKey, { selectedRecipientId: '', receiverName: event.target.value })}
                                                disabled={savingShipperReference}
                                                placeholder="Opsional"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Telepon</label>
                                            <input
                                                className="form-input"
                                                value={selectedShipperReferenceDraft.receiverPhone}
                                                onChange={event => updateShipperReferenceDraft(selectedShipperReferenceDraft.draftKey, { selectedRecipientId: '', receiverPhone: event.target.value })}
                                                disabled={savingShipperReference}
                                                placeholder="Opsional"
                                            />
                                        </div>
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Perusahaan / Tujuan</label>
                                        <input
                                            className="form-input"
                                            value={selectedShipperReferenceDraft.receiverCompany}
                                            onChange={event => updateShipperReferenceDraft(selectedShipperReferenceDraft.draftKey, { selectedRecipientId: '', receiverCompany: event.target.value })}
                                            disabled={savingShipperReference}
                                            placeholder="Opsional"
                                        />
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Alamat Tujuan SJ</label>
                                        <textarea
                                            className="form-textarea"
                                            rows={2}
                                            value={selectedShipperReferenceDraft.receiverAddress}
                                            onChange={event => updateShipperReferenceDraft(selectedShipperReferenceDraft.draftKey, { selectedRecipientId: '', receiverAddress: event.target.value })}
                                            disabled={savingShipperReference}
                                            placeholder="Alamat tujuan untuk invoice / dokumen SJ ini"
                                        />
                                    </div>

                                    <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.35rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                            <div>
                                                <div className="form-label" style={{ marginBottom: 0 }}>Item Surat Jalan</div>
                                                <div className="text-muted text-sm">
                                                    {isCreatingNewShipperReference
                                                        ? 'Isi barang untuk SJ baru ini langsung dari form di bawah.'
                                                        : 'Barang tersimpan tampil di bawah. Tambahkan item baru langsung dari form ini.'}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={addSelectedShipperReferenceItemDraft}
                                                disabled={savingShipperReference}
                                            >
                                                <Plus size={14} /> Tambah Item
                                            </button>
                                        </div>

                                        {!isCreatingNewShipperReference && selectedShipperReferenceExistingItemDrafts.length > 0 && (
                                            <div style={{ display: 'grid', gap: '0.45rem', padding: '0.75rem', background: 'var(--color-white)', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem' }}>
                                                <div className="text-muted text-sm">Barang tersimpan di dokumen ini. Ubah langsung dari form ini atau hapus jika tidak dipakai.</div>
                                                {selectedShipperReferenceExistingItemDrafts.map((item, itemIndex) => (
                                                    <div key={item.deliveryOrderItemId} style={{ display: 'grid', gap: 12, padding: 12, background: 'var(--color-white)', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                                                                Barang Tersimpan {itemIndex + 1}
                                                            </div>
                                                            {editableCargoItemMap[item.deliveryOrderItemId] ? (
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-ghost btn-sm"
                                                                    onClick={() => void removeCargoItem(item.deliveryOrderItemId, item.description || 'barang ini')}
                                                                    disabled={Boolean(removingCargoItemId) || savingCargo || savingShipperReference}
                                                                    style={{ color: 'var(--color-danger-700)' }}
                                                                    title="Hapus barang ini dari Surat Jalan"
                                                                >
                                                                    {removingCargoItemId === item.deliveryOrderItemId ? 'Menghapus...' : 'Hapus'}
                                                                </button>
                                                            ) : (
                                                                <span className="text-muted text-sm">Tidak bisa dihapus</span>
                                                            )}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                            <div style={{ flex: '1 1 240px' }}>
                                                                <label className="form-label">Barang Customer</label>
                                                                <select
                                                                    className="form-select"
                                                                    value={item.customerProductRef}
                                                                    onChange={e => applySelectedExistingShipperReferenceItemProduct(itemIndex, e.target.value)}
                                                                    disabled={savingShipperReference || !doData?.customerRef}
                                                                >
                                                                    <option value="">{deliveryOrderCustomerProducts.length > 0 ? 'Pilih master barang' : 'Belum ada master barang'}</option>
                                                                    {deliveryOrderCustomerProducts.map(product => (
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
                                                                    onChange={e => updateSelectedExistingShipperReferenceItemDraft(itemIndex, 'description', e.target.value)}
                                                                    placeholder="Mis. Oli Diesel 10W-40 / Beras 50 kg / Keramik"
                                                                    disabled={savingShipperReference}
                                                                />
                                                            </div>
                                                            <div style={{ flex: '0 1 110px' }}>
                                                                <label className="form-label">Koli</label>
                                                                <FormattedNumberInput
                                                                    min={0}
                                                                    allowDecimal={false}
                                                                    value={item.qtyKoli}
                                                                    onValueChange={value => updateSelectedExistingShipperReferenceItemDraft(itemIndex, 'qtyKoli', value)}
                                                                    disabled={savingShipperReference}
                                                                />
                                                            </div>
                                                            <div style={{ flex: '1 1 180px' }}>
                                                                <label className="form-label">Berat</label>
                                                                <div style={{ display: 'flex', gap: 8 }}>
                                                                    <FormattedNumberInput
                                                                        min={0}
                                                                        maxFractionDigits={item.weightInputUnit === 'TON' ? 3 : 2}
                                                                        value={item.weightInputValue}
                                                                        onValueChange={value => updateSelectedExistingShipperReferenceItemDraft(itemIndex, 'weightInputValue', value)}
                                                                        disabled={savingShipperReference || shouldLockOrderItemWeight(item)}
                                                                    />
                                                                    <select
                                                                        className="form-select"
                                                                        value={item.weightInputUnit}
                                                                        onChange={e => updateSelectedExistingShipperReferenceItemWeightUnit(itemIndex, e.target.value as DeliveryOrderCargoDraftItem['weightInputUnit'])}
                                                                        style={{ width: 92 }}
                                                                        disabled={savingShipperReference || shouldLockOrderItemWeight(item)}
                                                                    >
                                                                        {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                            <div style={{ flex: '1 1 180px' }}>
                                                                <label className="form-label">Volume</label>
                                                                <div style={{ display: 'flex', gap: 8 }}>
                                                                    <FormattedNumberInput
                                                                        min={0}
                                                                        maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3}
                                                                        value={item.volumeInputValue}
                                                                        onValueChange={value => updateSelectedExistingShipperReferenceItemDraft(itemIndex, 'volumeInputValue', value)}
                                                                        disabled={savingShipperReference}
                                                                    />
                                                                    <select
                                                                        className="form-select"
                                                                        value={item.volumeInputUnit}
                                                                        onChange={e => updateSelectedExistingShipperReferenceItemVolumeUnit(itemIndex, e.target.value as DeliveryOrderCargoDraftItem['volumeInputUnit'])}
                                                                        style={{ width: 92 }}
                                                                        disabled={savingShipperReference}
                                                                    >
                                                                        {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {selectedShipperReferenceItemDrafts.length === 0 && (
                                            <div className="text-muted text-sm" style={{ padding: '0.75rem', border: '1px dashed var(--color-gray-300)', borderRadius: '0.75rem', background: 'var(--color-white)' }}>
                                                {isCreatingNewShipperReference
                                                    ? <>Belum ada barang untuk SJ baru ini. Klik <strong>Tambah Item</strong> untuk mulai isi barang.</>
                                                    : <>Belum ada item baru. Klik <strong>Tambah Item</strong> jika dokumen ini perlu tambahan barang.</>}
                                            </div>
                                        )}

                                        {selectedShipperReferenceItemDrafts.map((item, itemIndex) => (
                                            <div key={`${selectedShipperReferenceDraft.draftKey}-new-item-${itemIndex}`} style={{ display: 'grid', gap: 12, padding: 12, background: 'var(--color-white)', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                                                        Barang Baru {itemIndex + 1}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => removeSelectedShipperReferenceItemDraft(itemIndex)}
                                                        disabled={savingShipperReference}
                                                        title="Hapus item ini"
                                                        style={{
                                                            color: 'var(--color-danger-700)',
                                                            borderColor: 'var(--color-danger-200)',
                                                            background: 'var(--color-danger-50)',
                                                        }}
                                                    >
                                                        <Trash2 size={14} /> Hapus Item
                                                    </button>
                                                </div>
                                                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                <div style={{ flex: '1 1 240px' }}>
                                                    <label className="form-label">Barang Customer</label>
                                                    <select
                                                        className="form-select"
                                                        value={item.customerProductRef}
                                                        onChange={e => applySelectedShipperReferenceItemProduct(itemIndex, e.target.value)}
                                                        disabled={savingShipperReference || !doData?.customerRef}
                                                    >
                                                        <option value="">{deliveryOrderCustomerProducts.length > 0 ? 'Pilih master barang' : 'Belum ada master barang'}</option>
                                                        {deliveryOrderCustomerProducts.map(product => (
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
                                                        onChange={e => updateSelectedShipperReferenceItemDraft(itemIndex, 'description', e.target.value)}
                                                        placeholder="Mis. Oli Diesel 10W-40 / Beras 50 kg / Keramik"
                                                        disabled={savingShipperReference}
                                                    />
                                                </div>
                                                <div style={{ flex: '0 1 110px' }}>
                                                    <label className="form-label">Koli</label>
                                                    <FormattedNumberInput
                                                        min={0}
                                                        allowDecimal={false}
                                                        value={item.qtyKoli}
                                                        onValueChange={value => updateSelectedShipperReferenceItemDraft(itemIndex, 'qtyKoli', value)}
                                                        disabled={savingShipperReference}
                                                    />
                                                </div>
                                                <div style={{ flex: '1 1 180px' }}>
                                                    <label className="form-label">Berat</label>
                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                        <FormattedNumberInput
                                                            min={0}
                                                            maxFractionDigits={item.weightInputUnit === 'TON' ? 3 : 2}
                                                            value={item.weightInputValue}
                                                            onValueChange={value => updateSelectedShipperReferenceItemDraft(itemIndex, 'weightInputValue', value)}
                                                            disabled={savingShipperReference || shouldLockOrderItemWeight(item)}
                                                        />
                                                        <select
                                                            className="form-select"
                                                            value={item.weightInputUnit}
                                                            onChange={e => updateSelectedShipperReferenceItemWeightUnit(itemIndex, e.target.value as DeliveryOrderCargoDraftItem['weightInputUnit'])}
                                                            style={{ width: 92 }}
                                                            disabled={savingShipperReference || shouldLockOrderItemWeight(item)}
                                                        >
                                                            {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                                <div style={{ flex: '1 1 180px' }}>
                                                    <label className="form-label">Volume</label>
                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                        <FormattedNumberInput
                                                            min={0}
                                                            maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3}
                                                            value={item.volumeInputValue}
                                                            onValueChange={value => updateSelectedShipperReferenceItemDraft(itemIndex, 'volumeInputValue', value)}
                                                            disabled={savingShipperReference}
                                                        />
                                                        <select
                                                            className="form-select"
                                                            value={item.volumeInputUnit}
                                                            onChange={e => updateSelectedShipperReferenceItemVolumeUnit(itemIndex, e.target.value as DeliveryOrderCargoDraftItem['volumeInputUnit'])}
                                                            style={{ width: 92 }}
                                                            disabled={savingShipperReference}
                                                        >
                                                            {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowShipperReferenceModal(false); setShipperReferenceItemDraftMap({}); setShipperReferenceExistingItemDraftMap({}); }} disabled={savingShipperReference}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={saveShipperReference}
                                disabled={
                                    savingShipperReference
                                    || shipperReferenceDrafts.every(entry => !entry.referenceNumber.trim())
                                    || (!isCreatingNewShipperReference && (!selectedShipperReferenceDraft || selectedShipperReferenceDraftStatus === 'DELIVERED'))
                                }
                            >
                                <Save size={16} /> {savingShipperReference ? 'Menyimpan...' : (isCreatingNewShipperReference ? 'Buat SJ' : 'Simpan')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {pendingDeleteAction && (
                <div className="modal-overlay" onClick={() => {
                    if (!removingCargoItemId && !deletingShipperReferenceKey) {
                        setPendingDeleteAction(null);
                    }
                }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">
                                {pendingDeleteAction.type === 'cargo-item' ? 'Hapus Barang Surat Jalan' : 'Hapus Surat Jalan'}
                            </h3>
                            <button
                                className="modal-close"
                                onClick={() => setPendingDeleteAction(null)}
                                disabled={Boolean(removingCargoItemId) || Boolean(deletingShipperReferenceKey)}
                            >
                                &times;
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="text-muted text-sm">
                                {pendingDeleteAction.type === 'cargo-item'
                                    ? `Barang "${pendingDeleteAction.itemLabel}" akan dihapus dari Surat Jalan ini.`
                                    : `SJ ${pendingDeleteAction.reference.referenceNumber || 'ini'}${pendingDeleteAction.itemCount > 0 ? ` beserta ${pendingDeleteAction.itemCount} barangnya` : ''} akan dihapus dari trip ini.`}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setPendingDeleteAction(null)}
                                disabled={Boolean(removingCargoItemId) || Boolean(deletingShipperReferenceKey)}
                            >
                                Batal
                            </button>
                            <button
                                className="btn btn-danger"
                                onClick={() => void confirmPendingDeleteAction()}
                                disabled={Boolean(removingCargoItemId) || Boolean(deletingShipperReferenceKey)}
                            >
                                <Trash2 size={16} /> Hapus
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showCargoModal && (
                <div className="modal-overlay" onClick={closeCargoModal}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">{isEditingCargoItem ? 'Edit Barang / SJ' : 'Tambah Barang / SJ'}</h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>
                                    {isEditingCargoItem
                                        ? 'Koreksi 1 barang yang sudah tersimpan.'
                                        : 'Input SJ pengirim lalu isi barangnya.'}
                                </div>
                            </div>
                            <button className="modal-close" onClick={closeCargoModal} disabled={savingCargo}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">Draft SJ</div>
                                    <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{cargoDraftGroups.length} SJ</div>
                                </div>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">Barang dicatat</div>
                                    <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{cargoDraftItemCount} barang</div>
                                </div>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">Muatan tambahan</div>
                                    <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                        {cargoDraftItemCount > 0 ? formatCargoSummary(cargoDraftSummary) : 'Belum ada barang'}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gap: '0.85rem' }}>
                                {cargoDraftGroups.map((group, groupIndex) => {
                                    const draftItemsInGroup = getDeliveryOrderCargoDraftItems(group);
                                    const normalizedGroupReference = group.shipperReferenceNumber.trim().toUpperCase();
                                    const existingItemsInGroup = normalizedGroupReference
                                        ? doItems.filter(item => (item.shipperReferenceNumber || doData?.customerDoNumber || '').trim().toUpperCase() === normalizedGroupReference)
                                        : [];
                                    const finalizedItemsInGroup = existingItemsInGroup.filter(existingItem =>
                                        existingItem.actualQtyKoli !== undefined || existingItem.actualWeightKg !== undefined
                                    );
                                    return (
                                        <div key={group.id} style={{ display: 'grid', gap: '0.85rem', padding: '1rem', background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <div>
                                                    <div className="font-semibold">SJ {groupIndex + 1}</div>
                                                    <div className="text-muted text-sm">{draftItemsInGroup.length} barang</div>
                                                    {existingItemsInGroup.length > 0 && (
                                                        <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                            {existingItemsInGroup.length} barang tersimpan • {finalizedItemsInGroup.length} final • {existingItemsInGroup.length - finalizedItemsInGroup.length} belum final
                                                        </div>
                                                    )}
                                                </div>
                                                {!isEditingCargoItem && cargoDraftGroups.length > 1 && (
                                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeCargoDraftGroup(group.id)} disabled={savingCargo}>
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

                                            {pickupStopList.length > 0 && (
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <label className="form-label">Titik Pickup</label>
                                                    <select
                                                        className="form-select"
                                                        value={group.pickupStopKey}
                                                        onChange={e => updateCargoDraftGroup(group.id, 'pickupStopKey', e.target.value)}
                                                        disabled={savingCargo}
                                                    >
                                                        <option value="">Pilih titik pickup</option>
                                                        {pickupStopList.map(stop => (
                                                            <option key={stop._key} value={stop._key}>
                                                                {`Pickup ${stop.sequence}${stop.pickupLabel ? ` - ${stop.pickupLabel}` : ''}`}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}

                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">No. SJ Pengirim</label>
                                                <input
                                                    className="form-input"
                                                    value={group.shipperReferenceNumber}
                                                    onChange={e => updateCargoDraftGroup(group.id, 'shipperReferenceNumber', e.target.value.toUpperCase())}
                                                    placeholder={`Mis. ${shipperReferenceExample}`}
                                                    disabled={savingCargo}
                                                />
                                            </div>

                                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                                {group.items.map((item, itemIndex) => (
                                                    (() => {
                                                        const selectedProductRefsInGroup = getSelectedProductRefsForCargoDraftGroup(group.id, itemIndex);
                                                        return (
                                                    <div key={`${group.id}-item-${itemIndex}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', padding: 12, background: 'var(--color-white)', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)' }}>
                                                        <div style={{ flex: '1 1 240px' }}>
                                                            <label className="form-label">Barang Customer</label>
                                                            <select
                                                                className="form-select"
                                                                value={item.customerProductRef}
                                                                onChange={e => applyCargoDraftProductSelection(group.id, itemIndex, e.target.value)}
                                                                disabled={savingCargo || !doData?.customerRef}
                                                            >
                                                                <option value="">{deliveryOrderCustomerProducts.length > 0 ? 'Pilih master barang' : 'Belum ada master barang'}</option>
                                                                {deliveryOrderCustomerProducts.map(product => (
                                                                    <option
                                                                        key={product._id}
                                                                        value={product._id}
                                                                        disabled={selectedProductRefsInGroup.has(product._id)}
                                                                    >
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
                                                                onChange={e => updateCargoDraftItem(group.id, itemIndex, 'description', e.target.value)}
                                                                placeholder="Mis. Oli Diesel 10W-40 / Beras 50 kg / Keramik"
                                                                disabled={savingCargo}
                                                            />
                                                        </div>
                                                        <div style={{ flex: '0 1 110px' }}>
                                                            <label className="form-label">Koli</label>
                                                            <FormattedNumberInput
                                                                min={0}
                                                                allowDecimal={false}
                                                                value={item.qtyKoli}
                                                                onValueChange={value => updateCargoDraftItem(group.id, itemIndex, 'qtyKoli', value)}
                                                                disabled={savingCargo}
                                                            />
                                                        </div>
                                                        <div style={{ flex: '1 1 180px' }}>
                                                            <label className="form-label">Berat</label>
                                                            <div style={{ display: 'flex', gap: 8 }}>
                                                                <FormattedNumberInput
                                                                    min={0}
                                                                    maxFractionDigits={item.weightInputUnit === 'TON' ? 3 : 2}
                                                                    value={item.weightInputValue}
                                                                    onValueChange={value => updateCargoDraftItem(group.id, itemIndex, 'weightInputValue', value)}
                                                                    disabled={savingCargo || shouldLockOrderItemWeight(item)}
                                                                />
                                                                <select
                                                                    className="form-select"
                                                                    value={item.weightInputUnit}
                                                                    onChange={e => setCargoDraftGroups(previous => previous.map(entry => (
                                                                        entry.id === group.id
                                                                            ? {
                                                                                ...entry,
                                                                                items: entry.items.map((groupItem, currentItemIndex) => (
                                                                                    currentItemIndex === itemIndex
                                                                                        ? toDeliveryOrderCargoDraftItem(updateOrderItemWeightUnit({
                                                                                            ...groupItem,
                                                                                            pickupStopKey: entry.pickupStopKey,
                                                                                            shipperReferenceNumber: entry.shipperReferenceNumber,
                                                                                        }, e.target.value as DeliveryOrderCargoDraftItem['weightInputUnit']))
                                                                                        : groupItem
                                                                                )),
                                                                            }
                                                                            : entry
                                                                    )))}
                                                                    style={{ width: 92 }}
                                                                    disabled={savingCargo || shouldLockOrderItemWeight(item)}
                                                                >
                                                                    {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        <div style={{ flex: '1 1 180px' }}>
                                                            <label className="form-label">Volume</label>
                                                            <div style={{ display: 'flex', gap: 8 }}>
                                                                <FormattedNumberInput
                                                                    min={0}
                                                                    maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3}
                                                                    value={item.volumeInputValue}
                                                                    onValueChange={value => updateCargoDraftItem(group.id, itemIndex, 'volumeInputValue', value)}
                                                                    disabled={savingCargo}
                                                                />
                                                                <select
                                                                    className="form-select"
                                                                    value={item.volumeInputUnit}
                                                                    onChange={e => setCargoDraftGroups(previous => previous.map(entry => (
                                                                        entry.id === group.id
                                                                            ? {
                                                                                ...entry,
                                                                                items: entry.items.map((groupItem, currentItemIndex) => (
                                                                                    currentItemIndex === itemIndex
                                                                                        ? toDeliveryOrderCargoDraftItem(updateOrderItemVolumeUnit({
                                                                                            ...groupItem,
                                                                                            pickupStopKey: entry.pickupStopKey,
                                                                                            shipperReferenceNumber: entry.shipperReferenceNumber,
                                                                                        }, e.target.value as DeliveryOrderCargoDraftItem['volumeInputUnit']))
                                                                                        : groupItem
                                                                                )),
                                                                            }
                                                                            : entry
                                                                    )))}
                                                                    style={{ width: 92 }}
                                                                    disabled={savingCargo}
                                                                >
                                                                    {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        {!isEditingCargoItem && group.items.length > 1 && (
                                                            <button type="button" className="btn btn-ghost btn-icon-only" onClick={() => removeCargoDraftItem(group.id, itemIndex)} disabled={savingCargo} style={{ marginBottom: 4 }}>
                                                                <X size={18} />
                                                            </button>
                                                        )}
                                                    </div>
                                                        );
                                                    })()
                                                ))}
                                            </div>

                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                {!isEditingCargoItem ? (
                                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => addCargoDraftItem(group.id)} disabled={savingCargo}>
                                                        <Plus size={14} /> Tambah Barang di SJ Ini
                                                    </button>
                                                ) : <span />}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                                <div className="text-muted text-sm">
                                    {isEditingCargoItem
                                        ? 'Perubahan langsung sinkron ke manifest trip dan penagihan per SJ.'
                                        : 'Satu trip bisa memuat beberapa SJ.'}
                                </div>
                                {!isEditingCargoItem && (
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={addCargoDraftGroup} disabled={savingCargo}>
                                        <Plus size={14} /> Tambah Pickup / SJ
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeCargoModal} disabled={savingCargo}>Batal</button>
                            <button className="btn btn-primary" onClick={saveCargoDrafts} disabled={savingCargo}>
                                <Save size={16} /> {savingCargo ? 'Menyimpan...' : (isEditingCargoItem ? 'Simpan Perubahan' : 'Simpan Barang')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showPODModal && (
                <div className="modal-overlay" onClick={() => { if (!savingPOD) setShowPODModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Lengkapi Proof of Delivery</h3>
                            <button className="modal-close" onClick={() => setShowPODModal(false)} disabled={savingPOD}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Nama Penerima POD <span className="required">*</span></label>
                                <input className="form-input" value={podName} onChange={e => setPodName(e.target.value)} disabled={savingPOD} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Tanggal Terima POD <span className="required">*</span></label>
                                <input type="date" className="form-input" value={podDate} onChange={e => setPodDate(e.target.value)} disabled={savingPOD} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan POD</label>
                                <textarea className="form-textarea" rows={2} value={podNote} onChange={e => setPodNote(e.target.value)} disabled={savingPOD} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPODModal(false)} disabled={savingPOD}>Batal</button>
                            <button className="btn btn-success" onClick={savePOD} disabled={savingPOD || !podName.trim() || !podDate}>
                                <Upload size={16} /> {savingPOD ? 'Menyimpan...' : 'Simpan POD'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
