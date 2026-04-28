'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Eye, FileText, MapPin, Plus, Save, Truck, X } from 'lucide-react';
import PageBackButton from '@/components/PageBackButton';
import CollapsibleCard from '@/components/CollapsibleCard';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { fetchAdminCollectionData, fetchAdminData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import { getDeliveryOrderDisplayStatusMeta, isDeliveryOrderBillableDropType, isDeliveryOrderHoldDropType, isDeliveryOrderReturnDropType } from '@/lib/delivery-order-completion';
import {
    applyActualCargoAutoWeightFromQty,
    applyActualDropAutoWeightFromQty,
    buildActualCargoDrafts,
    buildDefaultActualDropDrafts,
    buildDeliveryOrderDetailState,
    createEmptyActualDropDraft,
    getActualCargoDraftsForDrop,
    getNextDeliveryOrderStatuses,
    shouldLockActualDropWeight,
    shouldLockActualCargoWeight,
    shouldOpenAdvancedDropEditor,
    summarizeActualCargoDraftDescriptions,
    type ActualCargoDraft,
    type ActualDropDraft,
} from '@/lib/delivery-order-detail-support';
import { deriveSuratJalanDocumentStatus } from '@/lib/trip-document-mappers';
import { convertKgToWeightInputValue, convertM3ToVolumeInputValue, convertVolumeToM3, convertWeightToKg, formatCargoSummary, formatWeightDisplay, VOLUME_INPUT_UNIT_OPTIONS, WEIGHT_INPUT_UNIT_OPTIONS } from '@/lib/measurement';
import { parseFormattedNumberish } from '@/lib/formatted-number';
import type { DeliveryOrder, DeliveryOrderItem, Order } from '@/lib/types';
import type { SuratJalanDetailSnapshot, SuratJalanDocument, SuratJalanDocumentItem } from '@/lib/trip-document-types';
import { DO_ACTUAL_DROP_TYPE_MAP, DO_STATUS_MAP, formatDate, formatInternalDeliveryOrderNumber } from '@/lib/utils';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import { useApp, useToast } from '../../layout';

type ActualDropItemValueDraft = Pick<
    ActualDropDraft,
    'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit'
>;

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

export default function SuratJalanDetailPage() {
    const params = useParams();
    const pathname = usePathname();
    const { addToast } = useToast();
    const { user } = useApp();
    const id = decodeURIComponent((params.id as string) || '');
    const [suratJalanDocument, setSuratJalanDocument] = useState<SuratJalanDocument | null>(null);
    const [deliveryOrder, setDeliveryOrder] = useState<DeliveryOrder | null>(null);
    const [sourceOrder, setSourceOrder] = useState<Order | null>(null);
    const [documentItems, setDocumentItems] = useState<SuratJalanDocumentItem[]>([]);
    const [deliveryOrderItems, setDeliveryOrderItems] = useState<DeliveryOrderItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [newStatus, setNewStatus] = useState('');
    const [statusNote, setStatusNote] = useState('');
    const [podName, setPodName] = useState('');
    const [podDate, setPodDate] = useState(getBusinessDateValue());
    const [podNote, setPodNote] = useState('');
    const [actualCargoItems, setActualCargoItems] = useState<ActualCargoDraft[]>([]);
    const [actualDropPoints, setActualDropPoints] = useState<ActualDropDraft[]>([]);
    const [actualDropItemValueMap, setActualDropItemValueMap] = useState<Record<string, ActualDropItemValueDraft>>({});
    const [showAdvancedDropEditor, setShowAdvancedDropEditor] = useState(false);
    const [continuingHeldCargo, setContinuingHeldCargo] = useState(false);
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const canOpenTripPage = user ? hasPageAccess(user.role, 'deliveryOrders') : false;
    const canOpenOrderPage = user ? hasPageAccess(user.role, 'orders') : false;
    const canOpenCustomerPage = user ? hasPageAccess(user.role, 'customers') : false;
    const canManageDeliveryStatus = user ? hasPermission(user.role, 'deliveryOrders', 'update') : false;
    const currentPath = pathname || `/surat-jalan/${encodeURIComponent(id)}`;
    const withReturnTo = (href: string) => `${href}${href.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(currentPath)}`;
    const resolveDocumentItemDeliveryOrderItemRef = (item: SuratJalanDocumentItem) => {
        if (item.sourceDeliveryOrderItemRef?.trim()) {
            return item.sourceDeliveryOrderItemRef.trim();
        }
        const rawId = item._id || '';
        const separatorIndex = rawId.lastIndexOf(':');
        if (separatorIndex >= 0 && separatorIndex < rawId.length - 1) {
            return rawId.slice(separatorIndex + 1).trim();
        }
        return '';
    };

    const loadDocument = useCallback(async () => {
        setLoading(true);
        try {
            const detail = await fetchAdminData<SuratJalanDetailSnapshot | null>(
                `/api/data?entity=surat-jalan-detail&id=${encodeURIComponent(id)}`,
                'Gagal memuat detail surat jalan'
            );
            if (!detail?.suratJalanDocument || !detail.deliveryOrder) {
                setSuratJalanDocument(null);
                setDeliveryOrder(null);
                setSourceOrder(null);
                setDocumentItems([]);
                setDeliveryOrderItems([]);
                return;
            }
            const loadedDeliveryOrderItems = await fetchAdminCollectionData<DeliveryOrderItem[]>(
                `/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: detail.deliveryOrder._id }))}`,
                'Gagal memuat detail surat jalan'
            );
            setSuratJalanDocument(detail.suratJalanDocument);
            setDeliveryOrder(detail.deliveryOrder);
            setSourceOrder(detail.sourceOrder);
            setDocumentItems(detail.documentItems || []);
            setDeliveryOrderItems(loadedDeliveryOrderItems || []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail surat jalan');
        } finally {
            setLoading(false);
        }
    }, [addToast, id]);

    useEffect(() => {
        void loadDocument();
    }, [loadDocument]);

    if (loading) {
        return <div className="empty-state"><div className="empty-state-title">Memuat detail surat jalan...</div></div>;
    }

    if (!deliveryOrder || !suratJalanDocument) {
        return <div className="empty-state"><div className="empty-state-title">Surat jalan tidak ditemukan</div></div>;
    }

    const effectiveSuratJalanStatus = suratJalanDocument.tripStatus || deriveSuratJalanDocumentStatus(deliveryOrder.status || 'CREATED', suratJalanDocument);
    const tripStatusMeta = DO_STATUS_MAP[effectiveSuratJalanStatus] || getDeliveryOrderDisplayStatusMeta(deliveryOrder);
    const availableStatuses = getNextDeliveryOrderStatuses(effectiveSuratJalanStatus).filter(status =>
        status === 'CREATED' ||
        status === 'CANCELLED' ||
        Boolean(deliveryOrder.vehicleRef && deliveryOrder.driverRef)
    );
    const isDeliveredStatus = effectiveSuratJalanStatus === 'DELIVERED';
    const deliveredItemCount = documentItems.filter(item =>
        (item.actualCargo?.qtyKoli || 0) > 0 ||
        (item.actualCargo?.weightKg || 0) > 0 ||
        (item.actualCargo?.volumeM3 || 0) > 0
    ).length;
    const deliveredActualCargoSummary = documentItems.reduce((sum, item) => ({
        qtyKoli: sum.qtyKoli + (item.actualCargo?.qtyKoli || 0),
        weightKg: sum.weightKg + (item.actualCargo?.weightKg || 0),
        volumeM3: sum.volumeM3 + (item.actualCargo?.volumeM3 || 0),
    }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
    const isCompletingDelivery = newStatus === 'DELIVERED';
    const selectedDocumentItemRefs = new Set(
        documentItems
            .map(item => resolveDocumentItemDeliveryOrderItemRef(item))
            .filter(Boolean)
    );
    const selectedDeliveryOrderItems = deliveryOrderItems.filter(item => selectedDocumentItemRefs.has(item._id));
    const matchesSelectedSuratJalan = (shipperReferenceKey?: string, shipperReferenceNumber?: string) => {
        const normalizedKey = (shipperReferenceKey || '').trim();
        const normalizedNumber = (shipperReferenceNumber || '').trim().toUpperCase();
        const documentKey = (suratJalanDocument.referenceKey || '').trim();
        const documentNumber = (suratJalanDocument.suratJalanNumber || '').trim().toUpperCase();
        return (
            (documentKey && normalizedKey === documentKey) ||
            (documentNumber && normalizedNumber === documentNumber) ||
            (!documentKey && !documentNumber && !normalizedKey && !normalizedNumber)
        );
    };
    const actualDropShipperReference = {
        referenceKey: suratJalanDocument.referenceKey || '',
        referenceNumber: suratJalanDocument.suratJalanNumber || '',
        receiverName: suratJalanDocument.receiverName || deliveryOrder.receiverName || '',
        receiverCompany: suratJalanDocument.receiverCompany || deliveryOrder.receiverCompany || '',
        receiverAddress: suratJalanDocument.receiverAddress || deliveryOrder.receiverAddress || '',
    };
    const getActualDropItemOptions = (_drop: Pick<ActualDropDraft, 'deliveryOrderItemRef' | 'shipperReferenceKey' | 'shipperReferenceNumber'>) =>
        actualCargoItems.filter(item => matchesSelectedSuratJalan(item.shipperReferenceKey, item.shipperReferenceNumber));
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
    const selectedActualCargoItems = actualCargoItems.filter(item => selectedDocumentItemRefs.has(item.deliveryOrderItemRef));
    const selectedActualDropPoints = actualDropPoints.filter(drop =>
        selectedDocumentItemRefs.has(drop.deliveryOrderItemRef) || matchesSelectedSuratJalan(drop.shipperReferenceKey, drop.shipperReferenceNumber)
    );
    const selectedActualCargoItemRefs = new Set(selectedActualCargoItems.map(item => item.deliveryOrderItemRef));
    const selectedActualCargoItemByRef = new Map(
        selectedActualCargoItems.map(item => [item.deliveryOrderItemRef, item])
    );
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
    const selectedAutoDerivedActualCargoItems = selectedActualCargoItems.map(item => {
        if (!showAdvancedDropEditor) {
            return item;
        }
        const itemSpecificDrops = selectedWorkingActualDropPoints.filter(drop => drop.deliveryOrderItemRef === item.deliveryOrderItemRef);
        const billableItemDrops = itemSpecificDrops.filter(drop => isDeliveryOrderBillableDropType(drop.stopType));
        const nonBillableItemDrops = itemSpecificDrops.filter(drop => !isDeliveryOrderBillableDropType(drop.stopType));
        if (billableItemDrops.length === 0 && nonBillableItemDrops.length === 0) {
            return item;
        }
        const actualQtyKoli = billableItemDrops.reduce((sum, drop) => sum + parseFormattedNumberish(drop.qtyKoli || 0, { maxFractionDigits: 2 }), 0);
        const actualWeightKg = billableItemDrops.reduce((sum, drop) => sum + getActualDropWeightKg(drop), 0);
        const actualVolumeM3 = billableItemDrops.reduce((sum, drop) => sum + getActualDropVolumeM3(drop), 0);
        return {
            ...item,
            actualQtyKoli: actualQtyKoli > 0 ? String(actualQtyKoli) : '',
            actualWeightInputValue: actualWeightKg > 0 ? String(convertKgToWeightInputValue(actualWeightKg, item.actualWeightInputUnit)) : '',
            actualVolumeInputValue: actualVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(actualVolumeM3, item.actualVolumeInputUnit)) : '',
        };
    });
    const selectedDerivedActualCargoItems = selectedAutoDerivedActualCargoItems;
    const selectedEffectiveActualDropPoints = (() => {
        if (!showAdvancedDropEditor) {
            return selectedActualDropPoints;
        }
        const explicitItemRefs = new Set(selectedWorkingActualDropPoints.map(drop => drop.deliveryOrderItemRef.trim()).filter(Boolean));
        const fallbackBillableDrop = selectedWorkingActualDropPoints.find(drop => isDeliveryOrderBillableDropType(drop.stopType));
        const inferredDropPoints = selectedDerivedActualCargoItems
            .filter(item => !explicitItemRefs.has(item.deliveryOrderItemRef))
            .filter(item =>
                parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }) > 0 ||
                parseFormattedNumberish(item.actualWeightInputValue || 0, { maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2 }) > 0 ||
                parseFormattedNumberish(item.actualVolumeInputValue || 0, { maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3 }) > 0
            )
            .map((item): ActualDropDraft => ({
                draftKey: `auto-drop-${item.deliveryOrderItemRef}`,
                stopType: 'DROP',
                deliveryOrderItemRef: item.deliveryOrderItemRef,
                shipperReferenceKey: item.shipperReferenceKey,
                shipperReferenceNumber: item.shipperReferenceNumber,
                locationName: fallbackBillableDrop?.locationName || actualDropShipperReference.receiverCompany || actualDropShipperReference.receiverName || 'Tujuan Dokumen',
                locationAddress: fallbackBillableDrop?.locationAddress || actualDropShipperReference.receiverAddress,
                qtyKoli: item.actualQtyKoli,
                weightInputValue: item.actualWeightInputValue,
                weightInputUnit: item.actualWeightInputUnit,
                volumeInputValue: item.actualVolumeInputValue,
                volumeInputUnit: item.actualVolumeInputUnit,
                note: 'Auto dari item SJ tanpa titik khusus',
            }));
        return [...selectedWorkingActualDropPoints, ...inferredDropPoints];
    })();
    const selectedDetailState = buildDeliveryOrderDetailState({
        doData: deliveryOrder,
        actualCargoItems: selectedDerivedActualCargoItems,
        actualDropPoints: selectedEffectiveActualDropPoints,
        showAdvancedDropEditor,
    });
    const selectedActualCargoTotals = selectedDetailState.actualCargoTotals;
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
    const selectedDropModeLabel = showAdvancedDropEditor ? `${selectedActualDropPoints.length} titik aktual` : 'Trip normal / 1 tujuan';
    const selectedDropOutcomeSummary = [
        selectedBillableDropCount > 0 ? `${selectedBillableDropCount} drop invoice` : null,
        selectedHoldDropCount > 0 ? `${selectedHoldDropCount} hold` : null,
        selectedReturnDropCount > 0 ? `${selectedReturnDropCount} return` : null,
    ].filter(Boolean).join(' • ') || 'Semua muatan mengikuti tujuan default';

    const canContinueHeldCargoOnSameSj =
        canManageDeliveryStatus &&
        (effectiveSuratJalanStatus === 'DELIVERED' || effectiveSuratJalanStatus === 'PARTIAL_HOLD') &&
        !deliveryOrder.pendingDriverStatus &&
        (
            (suratJalanDocument.holdCargo?.qtyKoli || 0) > 0 ||
            (suratJalanDocument.holdCargo?.weightKg || 0) > 0 ||
            (suratJalanDocument.holdCargo?.volumeM3 || 0) > 0
        );

    const buildPartialHoldContinuationDrafts = (
        sourceDOData: DeliveryOrder | null,
        sourceDoItems: DeliveryOrderItem[],
        baseCargoItems: ActualCargoDraft[]
    ) => {
        const actualDropPointSource = sourceDOData?.actualDropPoints || [];
        if (effectiveSuratJalanStatus !== 'PARTIAL_HOLD' || !sourceDOData?._id || actualDropPointSource.length === 0) {
            return {
                actualCargoItems: baseCargoItems,
                sourceDropPoints: undefined as DeliveryOrder['actualDropPoints'] | undefined,
                itemRefs: [] as string[],
            };
        }

        const itemsById = new Map(sourceDoItems.map(item => [item._id, item]));
        const selectedItemIds = new Set(sourceDoItems.map(item => item._id));
        const getPointItemIds = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) => {
            const explicitItemRefs = [
                point.deliveryOrderItemRef,
                ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
            ].filter((value): value is string => Boolean(value));
            if (explicitItemRefs.length > 0) {
                return explicitItemRefs.filter(itemId => selectedItemIds.has(itemId));
            }

            const pointReferenceKey = (point.shipperReferenceKey || '').trim();
            const pointReferenceNumber = (point.shipperReferenceNumber || '').trim().toUpperCase();
            const matchingItems = sourceDoItems.filter(item => (
                (pointReferenceKey && (item.shipperReferenceKey || '').trim() === pointReferenceKey) ||
                (pointReferenceNumber && (item.shipperReferenceNumber || '').trim().toUpperCase() === pointReferenceNumber)
            ));
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

        const holdDraftByItemId = new Map<string, ActualDropItemValueDraft>();
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
                    ? convertWeightToKg(parseFormattedNumberish(current.weightInputValue || 0), current.weightInputUnit)
                    : 0;
                const currentVolumeM3 = current
                    ? convertVolumeToM3(parseFormattedNumberish(current.volumeInputValue || 0), current.volumeInputUnit)
                    : 0;
                const nextWeightKg = currentWeightKg + convertWeightToKg(point.weightInputValue ?? point.weightKg ?? 0, weightInputUnit);
                const nextVolumeM3 = currentVolumeM3 + convertVolumeToM3(point.volumeInputValue ?? point.volumeM3 ?? 0, volumeInputUnit);
                holdDraftByItemId.set(itemId, {
                    qtyKoli: String(parseFormattedNumberish(current?.qtyKoli || 0) + parseFormattedNumberish(point.qtyKoli || 0)),
                    weightInputValue: nextWeightKg > 0 ? String(convertKgToWeightInputValue(nextWeightKg, weightInputUnit)) : '',
                    weightInputUnit,
                    volumeInputValue: nextVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(nextVolumeM3, volumeInputUnit)) : '',
                    volumeInputUnit,
                });
            });
        });

        const continuationCargoItems = baseCargoItems.map(item => {
            const holdDraft = holdDraftByItemId.get(item.deliveryOrderItemRef);
            return holdDraft
                ? {
                    ...item,
                    actualQtyKoli: holdDraft.qtyKoli,
                    actualWeightInputValue: holdDraft.weightInputValue,
                    actualWeightInputUnit: holdDraft.weightInputUnit,
                    actualVolumeInputValue: holdDraft.volumeInputValue,
                    actualVolumeInputUnit: holdDraft.volumeInputUnit,
                }
                : item;
        });
        return {
            actualCargoItems: continuationCargoItems,
            sourceDropPoints: [] as DeliveryOrder['actualDropPoints'],
            itemRefs: Array.from(holdDraftByItemId.keys()),
        };
    };

    const updateActualCargoDraft = (
        deliveryOrderItemRef: string,
        field: keyof Pick<ActualCargoDraft, 'actualQtyKoli' | 'actualWeightInputValue' | 'actualWeightInputUnit' | 'actualVolumeInputValue' | 'actualVolumeInputUnit'>,
        value: string
    ) => {
        setActualCargoItems(previous =>
            previous.map(item => {
                if (item.deliveryOrderItemRef !== deliveryOrderItemRef) {
                    return item;
                }
                if (field === 'actualQtyKoli') {
                    return applyActualCargoAutoWeightFromQty(item, value);
                }
                return { ...item, [field]: value };
            })
        );
    };

    const updateActualCargoWeightUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualWeightInputUnit']) => {
        setActualCargoItems(previous => previous.map(item =>
            item.deliveryOrderItemRef === deliveryOrderItemRef
                ? {
                    ...item,
                    actualWeightInputUnit: nextUnit,
                    actualWeightInputValue: (() => {
                        const currentWeightKg = getActualCargoItemWeightKg(item);
                        return currentWeightKg > 0 ? String(convertKgToWeightInputValue(currentWeightKg, nextUnit)) : '';
                    })(),
                }
                : item
        ));
    };

    const updateActualCargoVolumeUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualVolumeInputUnit']) => {
        setActualCargoItems(previous => previous.map(item =>
            item.deliveryOrderItemRef === deliveryOrderItemRef
                ? {
                    ...item,
                    actualVolumeInputUnit: nextUnit,
                    actualVolumeInputValue: (() => {
                        const currentVolumeM3 = getActualCargoItemVolumeM3(item);
                        return currentVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(currentVolumeM3, nextUnit)) : '';
                    })(),
                }
                : item
        ));
    };

    const getRemainingActualDropValuesForCargoItem = (
        cargoItem: ActualCargoDraft,
        excludeDraftKey = ''
    ) => {
        const visibleValueKeys = new Set(
            actualDropPoints
                .filter(drop => drop.deliveryOrderItemRef)
                .map(drop => buildActualDropItemValueKey(drop.draftKey, drop.deliveryOrderItemRef))
        );
        const usedFromVisibleDrops = actualDropPoints
            .filter(drop => drop.draftKey !== excludeDraftKey && drop.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef)
            .reduce((sum, drop) => ({
                qtyKoli: sum.qtyKoli + parseFormattedNumberish(drop.qtyKoli || 0, { maxFractionDigits: 2 }),
                weightKg: sum.weightKg + getActualDropWeightKg(drop),
                volumeM3: sum.volumeM3 + getActualDropVolumeM3(drop),
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
        const remainingQtyKoli = Math.max(parseFormattedNumberish(cargoItem.actualQtyKoli || 0, { maxFractionDigits: 2 }) - used.qtyKoli, 0);
        const remainingWeightKg = Math.max(getActualCargoItemWeightKg(cargoItem) - used.weightKg, 0);
        const remainingVolumeM3 = Math.max(getActualCargoItemVolumeM3(cargoItem) - used.volumeM3, 0);
        return {
            qtyKoli: remainingQtyKoli > 0 ? String(remainingQtyKoli) : '',
            weightInputValue: remainingWeightKg > 0 ? String(convertKgToWeightInputValue(remainingWeightKg, cargoItem.actualWeightInputUnit)) : '',
            weightInputUnit: cargoItem.actualWeightInputUnit,
            volumeInputValue: remainingVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(remainingVolumeM3, cargoItem.actualVolumeInputUnit)) : '',
            volumeInputUnit: cargoItem.actualVolumeInputUnit,
        };
    };

    const updateActualDropDraft = (
        draftKey: string,
        field: keyof Pick<ActualDropDraft, 'stopType' | 'locationName' | 'locationAddress' | 'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit' | 'note'>,
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
        setActualDropPoints(previous => previous.map(item => item.draftKey === draftKey ? buildNextDrop(item) : item));
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
            if (item.draftKey !== draftKey || !selectedCargoItem) {
                return item;
            }
            const selectedValueKey = buildActualDropItemValueKey(draftKey, selectedCargoItem.deliveryOrderItemRef);
            return {
                ...item,
                deliveryOrderItemRef,
                shipperReferenceKey: selectedCargoItem.shipperReferenceKey || item.shipperReferenceKey,
                shipperReferenceNumber: selectedCargoItem.shipperReferenceNumber || item.shipperReferenceNumber,
                ...(actualDropItemValueMap[selectedValueKey] || getRemainingActualDropValuesForCargoItem(selectedCargoItem, draftKey)),
            };
        }));
    };

    const expandActualDropDraftsBySelectedItems = (dropDrafts: ActualDropDraft[]) =>
        dropDrafts.map(drop => {
            if (drop.deliveryOrderItemRef) {
                return drop;
            }
            const firstItem = getActualDropItemOptions(drop)[0];
            return firstItem
                ? {
                    ...drop,
                    deliveryOrderItemRef: firstItem.deliveryOrderItemRef,
                    shipperReferenceKey: firstItem.shipperReferenceKey || drop.shipperReferenceKey,
                    shipperReferenceNumber: firstItem.shipperReferenceNumber || drop.shipperReferenceNumber,
                    ...getRemainingActualDropValuesForCargoItem(firstItem),
                }
                : drop;
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
        const firstCargoItem = selectedActualCargoItems[0];
        const emptyDraft = createEmptyActualDropDraft();
        setActualDropPoints(previous => [
            ...previous,
            firstCargoItem
                ? {
                    ...emptyDraft,
                    deliveryOrderItemRef: firstCargoItem.deliveryOrderItemRef,
                    shipperReferenceKey: firstCargoItem.shipperReferenceKey || actualDropShipperReference.referenceKey,
                    shipperReferenceNumber: firstCargoItem.shipperReferenceNumber || actualDropShipperReference.referenceNumber,
                    locationName: actualDropShipperReference.receiverCompany || actualDropShipperReference.receiverName || 'Tujuan Dokumen',
                    locationAddress: actualDropShipperReference.receiverAddress,
                    ...getRemainingActualDropValuesForCargoItem(firstCargoItem),
                }
                : {
                    ...emptyDraft,
                    shipperReferenceKey: actualDropShipperReference.referenceKey,
                    shipperReferenceNumber: actualDropShipperReference.referenceNumber,
                    locationName: actualDropShipperReference.receiverCompany || actualDropShipperReference.receiverName || 'Tujuan Dokumen',
                    locationAddress: actualDropShipperReference.receiverAddress,
                },
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

    const openStatusModal = (requestedStatus?: string, continuationHold: boolean = false) => {
        setNewStatus(requestedStatus || '');
        setStatusNote('');
        setPodName(deliveryOrder.podReceiverName?.trim() || suratJalanDocument.receiverName || suratJalanDocument.receiverCompany || '');
        setPodDate(deliveryOrder.podReceivedDate?.trim()?.slice(0, 10) || getBusinessDateValue());
        setPodNote(deliveryOrder.podNote || '');
        const baseActualCargoItems = buildActualCargoDrafts(selectedDeliveryOrderItems);
        const continuationDrafts = continuationHold
            ? buildPartialHoldContinuationDrafts(deliveryOrder, selectedDeliveryOrderItems, baseActualCargoItems)
            : {
                actualCargoItems: baseActualCargoItems,
                sourceDropPoints: (deliveryOrder.actualDropPoints || []).filter(point =>
                    matchesSelectedSuratJalan(point.shipperReferenceKey, point.shipperReferenceNumber)
                ) as DeliveryOrder['actualDropPoints'],
                itemRefs: [] as string[],
            };
        const nextActualCargoItems = continuationDrafts.actualCargoItems;
        const isPartialHoldContinuation = continuationHold && continuationDrafts.itemRefs.length > 0;
        const nextActualDropPoints = isPartialHoldContinuation
            ? []
            : buildDefaultActualDropDrafts(deliveryOrder, nextActualCargoItems, continuationDrafts.sourceDropPoints);
        const nextShowAdvancedDropEditor = isPartialHoldContinuation || shouldOpenAdvancedDropEditor(deliveryOrder, nextActualDropPoints);
        setActualCargoItems(nextActualCargoItems);
        setActualDropPoints(nextShowAdvancedDropEditor ? expandActualDropDraftsBySelectedItems(nextActualDropPoints) : nextActualDropPoints);
        setActualDropItemValueMap({});
        setContinuingHeldCargo(isPartialHoldContinuation);
        setShowAdvancedDropEditor(nextShowAdvancedDropEditor);
        setShowStatusModal(true);
    };

    const updateStatus = async () => {
        if (!newStatus) return;
        setUpdatingStatus(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'set-surat-jalan-status-batch',
                    data: {
                        id: deliveryOrder._id,
                        status: newStatus,
                        note: statusNote,
                        targetSuratJalanRefs: [suratJalanDocument._id],
                        ...(newStatus === 'DELIVERED'
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
                                actualDropPoints: (showAdvancedDropEditor ? selectedEffectiveActualDropPoints : [selectedDetailState.autoActualDropDraft]).map(item => ({
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
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal memperbarui status SJ');
                return;
            }
            setShowStatusModal(false);
            setContinuingHeldCargo(false);
            await loadDocument();
            addToast('success', newStatus === 'DELIVERED' ? 'SJ berhasil difinalkan' : `Status SJ diperbarui ke ${DO_STATUS_MAP[newStatus]?.label || newStatus}`);
        } catch {
            addToast('error', 'Gagal memperbarui status SJ');
        } finally {
            setUpdatingStatus(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/surat-jalan" />
                    <div>
                        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            {suratJalanDocument.suratJalanNumber}
                            <span className={`badge badge-${tripStatusMeta.color}`}>
                                <span className="badge-dot" /> {tripStatusMeta.label}
                            </span>
                        </h1>
                    </div>
                </div>
                <div className="page-actions">
                    {canManageDeliveryStatus && availableStatuses.length > 0 && (
                        <button className="btn btn-primary" onClick={() => openStatusModal()}>
                            <Truck size={16} /> Update SJ Ini
                        </button>
                    )}
                    {canContinueHeldCargoOnSameSj && (
                        <button className="btn btn-secondary" onClick={() => openStatusModal('DELIVERED', true)}>
                            <Truck size={16} /> Finalisasi Sisa Hold
                        </button>
                    )}
                    {canOpenTripPage && (
                        <Link className="btn btn-secondary" href={withReturnTo(`/trips/${deliveryOrder._id}`)}>
                            <Eye size={16} /> Lihat Trip
                        </Link>
                    )}
                </div>
            </div>

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header">
                        <span className="card-header-title">Dokumen Surat Jalan</span>
                    </div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">No. Surat Jalan</div><div className="detail-value font-mono"><Link href={`/surat-jalan/${encodeURIComponent(suratJalanDocument._id)}`}>{suratJalanDocument.suratJalanNumber}</Link></div></div>
                            <div className="detail-item"><div className="detail-label">Trip</div><div className="detail-value">{canOpenTripPage ? <Link href={withReturnTo(`/trips/${deliveryOrder._id}`)}>{suratJalanDocument.tripNumber}</Link> : suratJalanDocument.tripNumber}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Tanggal Trip</div><div className="detail-value">{formatDate(suratJalanDocument.tripDate)}</div></div>
                            <div className="detail-item"><div className="detail-label">Customer</div><div className="detail-value">{canOpenCustomerPage && suratJalanDocument.customerRef ? <Link href={withReturnTo(`/customers/${suratJalanDocument.customerRef}`)}>{suratJalanDocument.customerName || '-'}</Link> : (suratJalanDocument.customerName || '-')}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Order / Resi</div><div className="detail-value">{canOpenOrderPage && suratJalanDocument.orderRef ? <Link href={withReturnTo(`/orders/${suratJalanDocument.orderRef}`)}>{suratJalanDocument.masterResi || '-'}</Link> : (suratJalanDocument.masterResi || '-')}</div></div>
                            <div className="detail-item"><div className="detail-label">Pickup</div><div className="detail-value">{suratJalanDocument.pickupAddress || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Kendaraan / Driver</div><div className="detail-value">{`${suratJalanDocument.vehiclePlate || '-'} / ${suratJalanDocument.driverName || '-'}`}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Penerima / Tujuan</div><div className="detail-value">{suratJalanDocument.receiverCompany || suratJalanDocument.receiverName || suratJalanDocument.receiverAddress || '-'}</div></div>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <span className="card-header-title">Ringkasan Muatan Dokumen</span>
                    </div>
                    <div className="card-body" style={{ display: 'grid', gap: '0.75rem' }}>
                        <div className="detail-item"><div className="detail-label">Muatan Dokumen</div><div className="detail-value">{formatCargoSummary(suratJalanDocument.cargoSummary)}</div></div>
                        {isDeliveredStatus && (
                            <>
                                <div className="detail-item"><div className="detail-label">Item Terkirim Aktual</div><div className="detail-value">{deliveredItemCount} item</div></div>
                                <div className="detail-item"><div className="detail-label">Muatan Terkirim Aktual</div><div className="detail-value">{formatCargoSummary(deliveredActualCargoSummary)}</div></div>
                            </>
                        )}
                        <div className="detail-item"><div className="detail-label">Masuk Invoice</div><div className="detail-value">{formatCargoSummary(suratJalanDocument.billableCargo)}</div></div>
                        <div className="detail-item"><div className="detail-label">Hold / Transit</div><div className="detail-value">{formatCargoSummary(suratJalanDocument.holdCargo)}</div></div>
                        <div className="detail-item"><div className="detail-label">Retur</div><div className="detail-value">{formatCargoSummary(suratJalanDocument.returnCargo)}</div></div>
                    </div>
                </div>
            </div>

            <div style={{ marginTop: 'var(--space-4)' }}>
                <CollapsibleCard title={`Item Dokumen (${documentItems.length})`}>
                    {documentItems.length === 0 ? (
                        <div className="empty-state">
                            <FileText size={40} className="empty-state-icon" />
                            <div className="empty-state-title">Belum ada item pada dokumen ini</div>
                        </div>
                    ) : (
                        <div className="table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Deskripsi</th>
                                        <th>Muatan Rencana</th>
                                        {isDeliveredStatus && <th>Muatan Aktual Terkirim</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {documentItems.map(item => (
                                        <tr key={item._id}>
                                            <td>{item.orderItemDescription || '-'}</td>
                                            <td>{formatCargoSummary(item.plannedCargo)}</td>
                                            {isDeliveredStatus && <td>{formatCargoSummary(item.actualCargo)}</td>}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CollapsibleCard>
            </div>

            {sourceOrder && (
                <div className="card" style={{ marginTop: 'var(--space-4)' }}>
                    <div className="card-header">
                        <span className="card-header-title">Konteks Order</span>
                    </div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">No. Trip Internal</div><div className="detail-value">{canOpenTripPage ? <Link href={withReturnTo(`/trips/${deliveryOrder._id}`)}>{formatInternalDeliveryOrderNumber(deliveryOrder)}</Link> : formatInternalDeliveryOrderNumber(deliveryOrder)}</div></div>
                            <div className="detail-item"><div className="detail-label">Status Order</div><div className="detail-value">{sourceOrder.status || '-'}</div></div>
                        </div>
                    </div>
                </div>
            )}

            {showStatusModal && (
                <div className="modal-overlay" onClick={() => { if (!updatingStatus) { setShowStatusModal(false); setContinuingHeldCargo(false); } }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{isCompletingDelivery ? (continuingHeldCargo ? 'Finalisasi Sisa Hold SJ' : 'Finalisasi SJ') : 'Update Status SJ'}</h3>
                            <button className="modal-close" onClick={() => { setShowStatusModal(false); setContinuingHeldCargo(false); }} disabled={updatingStatus}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Status Tujuan</label>
                                <select className="form-select" value={newStatus} onChange={event => setNewStatus(event.target.value)} disabled={updatingStatus}>
                                    <option value="">Pilih status</option>
                                    {availableStatuses.map(status => (
                                        <option key={status} value={status}>{DO_STATUS_MAP[status]?.label || status}</option>
                                    ))}
                                </select>
                            </div>
                            {isCompletingDelivery && (
                                <>
                                    <div style={{ background: 'var(--color-info-light)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-info)' }}>
                                        {continuingHeldCargo
                                            ? <>Lanjutan hold ini hanya berlaku untuk <strong>{suratJalanDocument.suratJalanNumber}</strong>. Muatan aktual diisi otomatis dari sisa hold SJ ini, lalu Anda bisa membagi ulang drop lanjutan seperti finalisasi hold di Trip Detail.</>
                                            : <>Finalisasi ini hanya berlaku untuk <strong>{suratJalanDocument.suratJalanNumber}</strong>. Flow, hitungan, dan review-nya sama seperti finalisasi batch SJ di Trip Detail, hanya tanpa pilih batch karena di sini fokusnya satu SJ.</>}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">SJ yang difinalkan</div>
                                            <div className="font-semibold" style={{ fontSize: '1.05rem', marginTop: '0.2rem' }}>{suratJalanDocument.suratJalanNumber}</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Item dalam batch SJ</div>
                                            <div className="font-semibold" style={{ fontSize: '1.05rem', marginTop: '0.2rem' }}>{selectedActualCargoItems.length} item</div>
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
                                        <input className="form-input" value={podName} onChange={event => setPodName(event.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Tanggal Terima POD <span className="required">*</span></label>
                                        <input type="date" className="form-input" value={podDate} onChange={event => setPodDate(event.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Catatan POD</label>
                                        <textarea className="form-textarea" rows={2} value={podNote} onChange={event => setPodNote(event.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group">
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '1rem', padding: '1rem', background: 'var(--color-white)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                                <div>
                                                    <div className="text-muted text-sm" style={{ marginBottom: '0.2rem' }}>Langkah 1</div>
                                                    <label className="form-label" style={{ marginBottom: 0 }}>Tentukan Realisasi Titik Drop <span className="required">*</span></label>
                                                </div>
                                                <button type="button" className="btn btn-secondary btn-sm" onClick={toggleAdvancedDropEditor} disabled={updatingStatus}>
                                                    <MapPin size={14} /> {showAdvancedDropEditor ? 'Tutup Detail Drop' : 'Ada Multi-drop / Hold / Extra Drop'}
                                                </button>
                                            </div>
                                            <div style={{ background: 'var(--color-info-light)', borderRadius: '0.75rem', padding: '0.85rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-info)' }}>
                                                Pilih dulu barang SJ ini turun ke mana. Kalau semua selesai di satu tujuan, sistem otomatis pakai <strong>{selectedDetailState.autoActualDropDraft.locationName || 'Tujuan Invoice'}</strong>. Buka detail ini hanya kalau ada multi-drop, hold, return, atau extra drop.
                                            </div>
                                            {selectedActualDropMismatchMessage && (
                                                <div style={{ background: 'var(--color-danger-light)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-danger)' }}>
                                                    {selectedActualDropMismatchMessage} Muatan aktual {formatCargoSummary(selectedActualCargoTotals)} tetapi alokasi drop baru {formatCargoSummary(selectedActualDropTotals)}.
                                                </div>
                                            )}
                                            {selectedDetailState.actualDropAmbiguityMessage && (
                                                <div style={{ background: 'var(--color-warning-light)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-warning-dark)' }}>
                                                    {selectedDetailState.actualDropAmbiguityMessage}
                                                </div>
                                            )}
                                            {!showAdvancedDropEditor ? (
                                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                                    <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Realisasi Default</div>
                                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'grid', gap: '0.2rem' }}>
                                                        <div>Lokasi: {selectedDetailState.autoActualDropDraft.locationName || 'Tujuan Invoice'}</div>
                                                        {selectedDetailState.autoActualDropDraft.locationAddress && <div>Alamat: {selectedDetailState.autoActualDropDraft.locationAddress}</div>}
                                                        <div>Barang: {summarizeActualCargoDraftDescriptions(getActualCargoDraftsForDrop(selectedDetailState.autoActualDropDraft, selectedActualCargoItems))}</div>
                                                        <div>Muatan: {formatCargoSummary(selectedActualCargoTotals)}</div>
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
                                                    {selectedActualDropPoints.map((drop, index) => {
                                                        const itemOptions = getActualDropItemOptions(drop);
                                                        const selectedCargoItem = actualCargoItems.find(item => item.deliveryOrderItemRef === drop.deliveryOrderItemRef);
                                                        const lockedDropWeight = shouldLockActualDropWeight(selectedCargoItem);
                                                        return (
                                                            <div key={drop.draftKey} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.9rem', padding: '0.9rem', background: 'var(--color-gray-50)', display: 'grid', gap: '0.75rem' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                                    <div style={{ fontWeight: 600 }}>Titik Drop {index + 1}</div>
                                                                    {selectedActualDropPoints.length > 1 && (
                                                                        <button type="button" className="btn btn-danger btn-sm" onClick={() => removeActualDropDraft(drop.draftKey)} disabled={updatingStatus}>
                                                                            Hapus
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <div className="form-row">
                                                                    <div className="form-group">
                                                                        <label className="form-label">Tipe Titik</label>
                                                                        <select className="form-select" value={drop.stopType} onChange={event => updateActualDropDraft(drop.draftKey, 'stopType', event.target.value)} disabled={updatingStatus}>
                                                                            {Object.entries(DO_ACTUAL_DROP_TYPE_MAP).map(([value, meta]) => (
                                                                                <option key={value} value={value}>{meta.label}</option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                    <div className="form-group">
                                                                        <label className="form-label">Nama Lokasi <span className="required">*</span></label>
                                                                        <input
                                                                            className="form-input"
                                                                            value={drop.locationName}
                                                                            onChange={event => updateActualDropDraft(drop.draftKey, 'locationName', event.target.value)}
                                                                            disabled={updatingStatus}
                                                                            placeholder="Mis. Gudang Transit Malang"
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Barang di SJ</label>
                                                                        <select className="form-select" value={drop.deliveryOrderItemRef} onChange={event => applyActualDropItem(drop.draftKey, event.target.value)} disabled={updatingStatus}>
                                                                            <option value="">{itemOptions.length > 0 ? 'Pilih barang di SJ ini' : 'Belum ada barang yang bisa dialokasikan'}</option>
                                                                            {itemOptions.map(item => (
                                                                                <option key={item.deliveryOrderItemRef} value={item.deliveryOrderItemRef}>
                                                                                    {item.description} - {formatCargoSummary({
                                                                                        qtyKoli: parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }),
                                                                                        weightInputValue: parseFormattedNumberish(item.actualWeightInputValue || 0, {
                                                                                            maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
                                                                                        }),
                                                                                        weightInputUnit: item.actualWeightInputUnit,
                                                                                        volumeInputValue: parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                                                                                            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                                                                                        }),
                                                                                        volumeInputUnit: item.actualVolumeInputUnit,
                                                                                    })}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                        <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                                                            {drop.deliveryOrderItemRef
                                                                                ? `Barang dipakai di baris ini: ${summarizeActualCargoDraftDescriptions(getActualCargoDraftsForDrop(drop, selectedActualCargoItems))}. Perubahan qty, berat, dan volume disimpan di modal sampai finalisasi disimpan.`
                                                                                : 'Belum ada barang yang bisa dialokasikan untuk titik ini.'}
                                                                        </div>
                                                                    </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Alamat Lokasi</label>
                                                                    <input
                                                                        className="form-input"
                                                                        value={drop.locationAddress}
                                                                        onChange={event => updateActualDropDraft(drop.draftKey, 'locationAddress', event.target.value)}
                                                                        disabled={updatingStatus}
                                                                        placeholder="Opsional, isi jika berbeda dari tujuan invoice"
                                                                    />
                                                                </div>
                                                                <div className="form-row">
                                                                    <div className="form-group">
                                                                        <label className="form-label">Qty Drop</label>
                                                                        <FormattedNumberInput min={0} maxFractionDigits={2} value={parseFormattedNumberish(drop.qtyKoli || 0, { maxFractionDigits: 2 })} onValueChange={value => updateActualDropDraft(drop.draftKey, 'qtyKoli', String(value))} disabled={updatingStatus} />
                                                                    </div>
                                                                    <div className="form-group">
                                                                        <label className="form-label">Berat Drop</label>
                                                                        {lockedDropWeight ? (
                                                                            <div className="form-input" style={{ display: 'flex', alignItems: 'center', background: 'var(--color-gray-100)', color: 'var(--color-gray-900)' }}>
                                                                                {formatWeightDisplay({
                                                                                    weightInputValue: drop.weightInputValue,
                                                                                    weightInputUnit: drop.weightInputUnit,
                                                                                })}
                                                                            </div>
                                                                        ) : (
                                                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                                <FormattedNumberInput min={0} maxFractionDigits={drop.weightInputUnit === 'TON' ? 3 : 2} value={parseFormattedNumberish(drop.weightInputValue || 0, { maxFractionDigits: drop.weightInputUnit === 'TON' ? 3 : 2 })} onValueChange={value => updateActualDropDraft(drop.draftKey, 'weightInputValue', String(value))} disabled={updatingStatus} />
                                                                                <select className="form-select" value={drop.weightInputUnit} onChange={event => updateActualDropDraft(drop.draftKey, 'weightInputUnit', event.target.value)} disabled={updatingStatus}>
                                                                                    {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                                </select>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="form-row">
                                                                    <div className="form-group">
                                                                        <label className="form-label">Volume Drop</label>
                                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                            <FormattedNumberInput min={0} maxFractionDigits={drop.volumeInputUnit === 'LITER' ? 0 : 3} value={parseFormattedNumberish(drop.volumeInputValue || 0, { maxFractionDigits: drop.volumeInputUnit === 'LITER' ? 0 : 3 })} onValueChange={value => updateActualDropDraft(drop.draftKey, 'volumeInputValue', String(value))} disabled={updatingStatus} />
                                                                            <select className="form-select" value={drop.volumeInputUnit} onChange={event => updateActualDropDraft(drop.draftKey, 'volumeInputUnit', event.target.value)} disabled={updatingStatus}>
                                                                                {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                            </select>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Catatan Titik Drop</label>
                                                                    <textarea className="form-textarea" rows={2} value={drop.note} onChange={event => updateActualDropDraft(drop.draftKey, 'note', event.target.value)} disabled={updatingStatus} placeholder="Mis. 30 koli turun di Malang, sisa lanjut ke Ponorogo" />
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '1rem', padding: '1rem', background: 'var(--color-white)' }}>
                                            <div style={{ marginBottom: '0.75rem' }}>
                                                <div className="text-muted text-sm" style={{ marginBottom: '0.2rem' }}>Langkah 2</div>
                                                <label className="form-label" style={{ marginBottom: 0 }}>Review Muatan Aktual per Item</label>
                                            </div>
                                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                                Setelah titik drop ditentukan, muatan aktual per item dihitung otomatis dari titik Drop / Extra Drop. Baris Hold / Transit / Retur tidak masuk angka terkirim agar bisa dilanjutkan lagi nanti.
                                            </div>
                                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                                {selectedDerivedActualCargoItems.map(item => (
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
                                                                <FormattedNumberInput min={0} maxFractionDigits={2} value={parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 })} onValueChange={value => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualQtyKoli', String(value))} disabled={updatingStatus || !item.requireQty} />
                                                            </div>
                                                            <div className="form-group">
                                                                <label className="form-label">Berat Aktual {item.requireWeight && <span className="required">*</span>}</label>
                                                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                    <FormattedNumberInput min={0} maxFractionDigits={item.actualWeightInputUnit === 'TON' ? 3 : 2} value={parseFormattedNumberish(item.actualWeightInputValue || 0, { maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2 })} onValueChange={value => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualWeightInputValue', String(value))} disabled={updatingStatus} />
                                                                    <select className="form-select" value={item.actualWeightInputUnit} onChange={event => updateActualCargoWeightUnit(item.deliveryOrderItemRef, event.target.value as ActualCargoDraft['actualWeightInputUnit'])} disabled={updatingStatus}>
                                                                        {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="form-row">
                                                            <div className="form-group">
                                                                <label className="form-label">Volume Aktual {item.requireVolume && <span className="required">*</span>}</label>
                                                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                    <FormattedNumberInput min={0} maxFractionDigits={item.actualVolumeInputUnit === 'LITER' ? 0 : 3} value={parseFormattedNumberish(item.actualVolumeInputValue || 0, { maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3 })} onValueChange={value => updateActualCargoDraft(item.deliveryOrderItemRef, 'actualVolumeInputValue', String(value))} disabled={updatingStatus} />
                                                                    <select className="form-select" value={item.actualVolumeInputUnit} onChange={event => updateActualCargoVolumeUnit(item.deliveryOrderItemRef, event.target.value as ActualCargoDraft['actualVolumeInputUnit'])} disabled={updatingStatus}>
                                                                        {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--color-gray-700)', border: '1px solid var(--color-gray-200)' }}>
                                        Setelah disimpan, progres <strong>Trip {suratJalanDocument.tripNumber}</strong> akan mengikuti hasil SJ ini. Kalau masih ada SJ lain yang belum terkirim, trip belum dibaca sebagai tuntas penuh.
                                    </div>
                                </>
                            )}
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={3} value={statusNote} onChange={event => setStatusNote(event.target.value)} placeholder={isCompletingDelivery ? 'Catatan finalisasi batch SJ...' : 'Catatan progres batch SJ...'} disabled={updatingStatus} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowStatusModal(false)} disabled={updatingStatus}>Batal</button>
                            <button className={`btn ${isCompletingDelivery ? 'btn-success' : 'btn-primary'}`} onClick={updateStatus} disabled={!newStatus || updatingStatus || (isCompletingDelivery && (!podName.trim() || !podDate))}>
                                <Save size={16} /> {updatingStatus ? 'Menyimpan...' : (isCompletingDelivery ? 'Finalkan Batch SJ' : 'Simpan Batch SJ')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
