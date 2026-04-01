'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useApp, useToast } from '../../layout';
import { Printer, FileDown, Truck, Upload, Save, MapPin, Radio, Edit, Wallet } from 'lucide-react';
import CurrencyInput from '@/components/CurrencyInput';
import CollapsibleCard from '@/components/CollapsibleCard';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { parseFormattedNumberish } from '@/lib/formatted-number';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData, fetchAdminData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import {
    buildDeliveryOrderDetailState,
    buildDeliveryOrderPrintHtml,
    buildActualCargoDraft,
    buildTripResourceBusyIds,
    buildDeliveryOrderPodUpdateData,
    buildDeliveryOrderStatusUpdateData,
    buildDeliveryOrderTripFeeUpdateData,
    buildResolvedDeliveryOrder,
    buildDefaultActualDropDrafts,
    createEmptyActualDropDraft,
    getAssignableTripDrivers,
    getAssignableTripVehicles,
    getNextDeliveryOrderStatuses,
    getTripResourceActionLabel,
    shouldRequireTripVehicleOverrideReason,
    shouldOpenAdvancedDropEditor,
    sortTrackingLogs,
    updateActualCargoDraftVolumeUnit,
    updateActualCargoDraftWeightUnit,
    type ActualCargoDraft,
    type ActualDropDraft,
} from '@/lib/delivery-order-detail-support';
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
    formatCargoSummary,
    VOLUME_INPUT_UNIT_OPTIONS,
    WEIGHT_INPUT_UNIT_OPTIONS,
} from '@/lib/measurement';
import { generateDOPdf } from '@/lib/pdf/doTemplate';
import { hasPageAccess, hasPermission, normalizeUserRole } from '@/lib/rbac';
import { buildTripRateAreaOptions, findMatchingTripRouteRate, formatTripRouteRateLabel } from '@/lib/trip-route-rate-support';
import type { Customer, DeliveryOrder, DeliveryOrderItem, TrackingLog, CompanyProfile, Order, Driver, DriverVoucher, TripRouteRate, Vehicle } from '@/lib/types';

type DeliveryOrderTripCashLink = {
    hasVoucher: true;
    voucherId: string;
    bonNumber: string;
    status: DriverVoucher['status'];
    issuedDate?: string;
};

export default function DODetailPage() {
    const params = useParams();
    const { addToast } = useToast();
    const { user } = useApp();
    const doId = params.id as string;
    const [doData, setDoData] = useState<DeliveryOrder | null>(null);
    const [doItems, setDoItems] = useState<DeliveryOrderItem[]>([]);
    const [trackingLogs, setTrackingLogs] = useState<TrackingLog[]>([]);
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [activeDeliveryOrders, setActiveDeliveryOrders] = useState<DeliveryOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [showPODModal, setShowPODModal] = useState(false);
    const [showRejectRequestModal, setShowRejectRequestModal] = useState(false);
    const [showTripResourcesModal, setShowTripResourcesModal] = useState(false);
    const [showShipperReferenceModal, setShowShipperReferenceModal] = useState(false);
    const [newStatus, setNewStatus] = useState('');
    const [statusNote, setStatusNote] = useState('');
    const [reviewingDriverRequest, setReviewingDriverRequest] = useState(false);
    const [rejectRequestNote, setRejectRequestNote] = useState('');
    const [podName, setPodName] = useState('');
    const [podDate, setPodDate] = useState(getBusinessDateValue());
    const [podNote, setPodNote] = useState('');
    const [actualCargoItems, setActualCargoItems] = useState<ActualCargoDraft[]>([]);
    const [actualDropPoints, setActualDropPoints] = useState<ActualDropDraft[]>([]);
    const [showAdvancedDropEditor, setShowAdvancedDropEditor] = useState(false);
    const [editingTarip, setEditingTarip] = useState(false);
    const [taripBorongan, setTaripBorongan] = useState<number>(0);
    const [keteranganBorongan, setKeteranganBorongan] = useState('');
    const [tripRouteRates, setTripRouteRates] = useState<TripRouteRate[]>([]);
    const [tripRouteRateRef, setTripRouteRateRef] = useState('');
    const [tripOriginArea, setTripOriginArea] = useState('');
    const [tripDestinationArea, setTripDestinationArea] = useState('');
    const [linkedVoucher, setLinkedVoucher] = useState<DriverVoucher | null>(null);
    const [linkedTripCashLink, setLinkedTripCashLink] = useState<DeliveryOrderTripCashLink | null>(null);
    const [linkedVoucherBonNumber, setLinkedVoucherBonNumber] = useState('');
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [savingPOD, setSavingPOD] = useState(false);
    const [savingTarip, setSavingTarip] = useState(false);
    const [rejectingRequest, setRejectingRequest] = useState(false);
    const [loadingTripResources, setLoadingTripResources] = useState(false);
    const [savingTripResources, setSavingTripResources] = useState(false);
    const [savingShipperReference, setSavingShipperReference] = useState(false);
    const [tripVehicleRef, setTripVehicleRef] = useState('');
    const [tripDriverRef, setTripDriverRef] = useState('');
    const [tripVehicleOverrideReason, setTripVehicleOverrideReason] = useState('');
    const [shipperReferenceValue, setShipperReferenceValue] = useState('');
    const [shipperReferenceFormat, setShipperReferenceFormat] = useState('SJ');
    const editingTaripRef = useRef(false);
    const normalizedRole = user ? normalizeUserRole(user.role) : null;
    const canManageDeliveryStatus = user ? hasPermission(user.role, 'deliveryOrders', 'update') : false;
    const canExportDeliveryOrder = user ? hasPermission(user.role, 'deliveryOrders', 'export') : false;
    const canPrintDeliveryOrder = user ? hasPermission(user.role, 'deliveryOrders', 'print') : false;
    const canViewCustomerDetails = user ? hasPermission(user.role, 'customers', 'view') : false;
    const canOpenSourceOrderPage = user ? hasPageAccess(user.role, 'orders') : false;
    const canViewTripCash = user ? hasPermission(user.role, 'driverVouchers', 'view') : false;
    const canCreateTripCash = user ? hasPermission(user.role, 'driverVouchers', 'create') : false;
    const canOpenTripCashPage = user ? hasPageAccess(user.role, 'driverVouchers') : false;
    const canAssignTripResources = normalizedRole === 'OWNER' || normalizedRole === 'OPERASIONAL' || normalizedRole === 'ARMADA';
    const canEditShipperReference = normalizedRole === 'OWNER' || normalizedRole === 'OPERASIONAL' || normalizedRole === 'FINANCE';
    const canReviewDriverRequest = canManageDeliveryStatus;
    const canManageTripFee = canManageDeliveryStatus;
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

    const loadDO = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
        if (mode === 'initial') {
            setLoading(true);
        }

        try {
            const deliveryOrder = await fetchAdminData<DeliveryOrder | null>(`/api/data?entity=delivery-orders&id=${doId}`, 'Gagal memuat detail surat jalan');
            const [itemRows, logRows, sourceOrder, customerData, tripRateRows, linkedVoucherRows, tripCashLink] = await Promise.all([
                fetchAllAdminCollectionData<DeliveryOrderItem>(`/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: doId }))}`, 'Gagal memuat detail surat jalan'),
                fetchAllAdminCollectionData<TrackingLog>(`/api/data?entity=tracking-logs&filter=${encodeURIComponent(JSON.stringify({ refRef: doId, refType: 'DO' }))}`, 'Gagal memuat detail surat jalan'),
                deliveryOrder?.orderRef
                    ? fetchAdminData<Order | null>(`/api/data?entity=orders&id=${deliveryOrder.orderRef}`, 'Gagal memuat detail surat jalan')
                    : Promise.resolve(null),
                deliveryOrder?.customerRef && canViewCustomerDetails
                    ? fetchAdminData<Pick<Customer, 'deliveryOrderPrefix'> | null>(`/api/data?entity=customers&id=${deliveryOrder.customerRef}`, 'Gagal memuat detail surat jalan')
                    : Promise.resolve(null),
                canManageTripFee
                    ? fetchAdminCollectionData<TripRouteRate[]>(`/api/data?entity=trip-route-rates&filter=${encodeURIComponent(JSON.stringify({ active: true }))}`, 'Gagal memuat detail surat jalan')
                    : Promise.resolve([] as TripRouteRate[]),
                (canViewTripCash || canCreateTripCash || canManageTripFee)
                    ? fetchAdminCollectionData<DriverVoucher[]>(`/api/data?entity=driver-vouchers&pageSize=1&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: doId }))}`, 'Gagal memuat detail surat jalan')
                    : Promise.resolve([] as DriverVoucher[]),
                fetchAdminData<DeliveryOrderTripCashLink | null>(
                    `/api/data?entity=delivery-order-trip-cash-link&deliveryOrderRef=${encodeURIComponent(doId)}`,
                    'Gagal memuat detail surat jalan'
                ),
            ]);

            const resolvedDeliveryOrder = buildResolvedDeliveryOrder(deliveryOrder, sourceOrder);

            setDoData(resolvedDeliveryOrder);
            setShipperReferenceFormat((customerData?.deliveryOrderPrefix || 'SJ').toUpperCase());
            setTripRouteRates((tripRateRows || []).filter(rate => rate.active !== false));
            setLinkedVoucher(linkedVoucherRows?.[0] || null);
            setLinkedTripCashLink(tripCashLink || null);
            setLinkedVoucherBonNumber(linkedVoucherRows?.[0]?.bonNumber || tripCashLink?.bonNumber || '');
            if (!editingTaripRef.current) {
                setTaripBorongan(resolvedDeliveryOrder?.taripBorongan || 0);
                setKeteranganBorongan(resolvedDeliveryOrder?.keteranganBorongan || '');
                setTripRouteRateRef(resolvedDeliveryOrder?.tripRouteRateRef || '');
                setTripOriginArea(resolvedDeliveryOrder?.tripOriginArea || '');
                setTripDestinationArea(resolvedDeliveryOrder?.tripDestinationArea || '');
            }
            setDoItems(itemRows || []);
            setTrackingLogs(sortTrackingLogs(logRows || []));
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail surat jalan');
        } finally {
            if (mode === 'initial') {
                setLoading(false);
            }
        }
    }, [addToast, canCreateTripCash, canManageTripFee, canViewCustomerDetails, canViewTripCash, doId]);

    const loadTripResources = useCallback(async () => {
        setLoadingTripResources(true);
        try {
            const [driverRows, vehicleRows, deliveryOrders] = await Promise.all([
                fetchAdminCollectionData<Driver[]>('/api/data?entity=drivers', 'Gagal memuat opsi armada trip'),
                fetchAdminCollectionData<Vehicle[]>('/api/data?entity=vehicles', 'Gagal memuat opsi armada trip'),
                fetchAdminCollectionData<DeliveryOrder[]>('/api/data?entity=delivery-orders', 'Gagal memuat opsi armada trip'),
            ]);

            setDrivers(driverRows || []);
            setVehicles(vehicleRows || []);
            setActiveDeliveryOrders(
                (deliveryOrders || []).filter(item => ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(item.status))
            );
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat opsi armada trip');
        } finally {
            setLoadingTripResources(false);
        }
    }, [addToast]);

    const openTripResourcesModal = async () => {
        if (!canAssignTripResources) return;
        setTripVehicleRef(doData?.vehicleRef || '');
        setTripDriverRef(doData?.driverRef || '');
        setTripVehicleOverrideReason(doData?.vehicleCategoryOverrideReason || '');
        setShowTripResourcesModal(true);
        await loadTripResources();
    };

    const openShipperReferenceModal = () => {
        if (!canEditShipperReference) return;
        const normalizedFormat = shipperReferenceFormat.trim().toUpperCase() || 'SJ';
        setShipperReferenceValue(doData?.customerDoNumber || (normalizedFormat !== 'SJ' ? normalizedFormat : ''));
        setShowShipperReferenceModal(true);
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

    const openStatusModal = (requestedStatus?: string, fromDriverRequest: boolean = false) => {
        if (!canManageDeliveryStatus) return;
        setNewStatus(requestedStatus || '');
        setStatusNote(fromDriverRequest ? (doData?.pendingDriverStatusNote || '') : '');
        setReviewingDriverRequest(fromDriverRequest);
        setPodName('');
        setPodDate(getBusinessDateValue());
        setPodNote('');
        const nextActualCargoItems = doItems.map(buildActualCargoDraft);
        const nextActualDropPoints = buildDefaultActualDropDrafts(doData, nextActualCargoItems);
        setActualCargoItems(nextActualCargoItems);
        setActualDropPoints(nextActualDropPoints);
        setShowAdvancedDropEditor(shouldOpenAdvancedDropEditor(doData, nextActualDropPoints));
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
            await loadDO();
            setShowRejectRequestModal(false);
            setRejectRequestNote('');
            addToast('success', 'Permintaan driver ditolak');
        } catch {
            addToast('error', 'Gagal menolak permintaan driver');
        } finally {
            setRejectingRequest(false);
        }
    };

    const updateActualCargoDraft = (
        deliveryOrderItemRef: string,
        field: keyof Pick<ActualCargoDraft, 'actualQtyKoli' | 'actualWeightInputValue' | 'actualWeightInputUnit' | 'actualVolumeInputValue' | 'actualVolumeInputUnit'>,
        value: string
    ) => {
        setActualCargoItems(previous =>
            previous.map(item =>
                item.deliveryOrderItemRef === deliveryOrderItemRef
                    ? { ...item, [field]: value }
                    : item
            )
        );
    };

    const updateActualCargoWeightUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualWeightInputUnit']) => {
        setActualCargoItems(previous =>
            previous.map(item =>
                item.deliveryOrderItemRef === deliveryOrderItemRef
                    ? updateActualCargoDraftWeightUnit(item, nextUnit)
                    : item
            )
        );
    };

    const updateActualCargoVolumeUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualVolumeInputUnit']) => {
        setActualCargoItems(previous =>
            previous.map(item =>
                item.deliveryOrderItemRef === deliveryOrderItemRef
                    ? updateActualCargoDraftVolumeUnit(item, nextUnit)
                    : item
            )
        );
    };

    const updateActualDropDraft = (
        draftKey: string,
        field: keyof Pick<ActualDropDraft, 'stopType' | 'locationName' | 'locationAddress' | 'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit' | 'note'>,
        value: string
    ) => {
        setActualDropPoints(previous =>
            previous.map(item => (item.draftKey === draftKey ? { ...item, [field]: value } : item))
        );
    };

    const addActualDropDraft = () => {
        setActualDropPoints(previous => [
            ...previous,
            createEmptyActualDropDraft(),
        ]);
    };

    const removeActualDropDraft = (draftKey: string) => {
        setActualDropPoints(previous => previous.filter(item => item.draftKey !== draftKey));
    };

    useEffect(() => {
        void loadDO('initial');
    }, [loadDO]);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            if (editingTaripRef.current) {
                return;
            }
            void loadDO();
        }, 15000);

        return () => window.clearInterval(intervalId);
    }, [loadDO]);

    const updateDOStatus = async () => {
        if (!newStatus) return;
        const completingDelivery = newStatus === 'DELIVERED';
        setUpdatingStatus(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'set-status',
                    data: buildDeliveryOrderStatusUpdateData({
                        id: doData?._id,
                        status: newStatus,
                        note: statusNote,
                        actualCargoItems,
                        actualDropPoints,
                        effectiveActualDropPoints,
                        podName,
                        podDate,
                        podNote,
                    }),
                }),
            });
            const d = await res.json();
            if (!res.ok) {
                addToast('error', d.error || 'Gagal memperbarui status surat jalan');
                return;
            }

            setTrackingLogs(prev => [...prev, {
                _id: 'new-' + Date.now(),
                _type: 'trackingLog',
                refType: 'DO',
                refRef: doData?._id || '',
                status: newStatus,
                note: statusNote || undefined,
                timestamp: new Date().toISOString(),
            }]);
            await loadDO();
            setShowStatusModal(false);
            setNewStatus('');
            setStatusNote('');
            setReviewingDriverRequest(false);
            if (completingDelivery) {
                setPodName('');
                setPodDate(getBusinessDateValue());
                setPodNote('');
                setActualCargoItems([]);
                setActualDropPoints([]);
                addToast('success', 'Surat jalan diselesaikan dan POD tersimpan');
            } else {
                addToast('success', `Status DO diperbarui ke ${DO_STATUS_MAP[newStatus]?.label || newStatus}`);
            }
        } catch {
            addToast('error', 'Gagal memperbarui status surat jalan');
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
            setDoData(prev => prev ? { ...prev, podReceiverName: podName, podReceivedDate: podDate, podNote } : prev);
            setShowPODModal(false);
            setPodName('');
            setPodDate(getBusinessDateValue());
            setPodNote('');
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
                subtitle: formatInternalDeliveryOrderNumber(doData || {}),
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
            setDoData(prev => prev ? {
                ...prev,
                tripRouteRateRef: tripRouteRateRef || undefined,
                tripOriginArea: tripOriginArea || undefined,
                tripDestinationArea: tripDestinationArea || undefined,
                taripBorongan,
                keteranganBorongan,
            } : prev);
            setEditingTarip(false);
            await loadDO();
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

            setDoData(prev => (prev ? buildResolvedDeliveryOrder(result.data, null) : prev));
            setShowTripResourcesModal(false);
            addToast('success', 'Armada trip berhasil diperbarui');
            await loadDO();
        } catch {
            addToast('error', 'Gagal melengkapi armada trip');
        } finally {
            setSavingTripResources(false);
        }
    };

    const saveShipperReference = async () => {
        const normalizedReference = shipperReferenceValue.trim().toUpperCase();
        if (!normalizedReference) {
            addToast('error', 'No. SJ pengirim wajib diisi');
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
                        customerDoNumber: normalizedReference,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan SJ pengirim');
                return;
            }

            setDoData(prev => (prev ? buildResolvedDeliveryOrder(result.data, null) : prev));
            setShowShipperReferenceModal(false);
            addToast('success', 'SJ pengirim berhasil diperbarui');
            await loadDO();
        } catch {
            addToast('error', 'Gagal menyimpan SJ pengirim');
        } finally {
            setSavingShipperReference(false);
        }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!doData) return <div className="empty-state"><div className="empty-state-title">Surat Jalan tidak ditemukan</div></div>;

    const nextStatuses = getNextDeliveryOrderStatuses(doData.status);
    const tripResourceActionLabel = getTripResourceActionLabel(doData);
    const tripResourceBusyIds = buildTripResourceBusyIds(activeDeliveryOrders, doData._id);
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
    const selectedTripVehicle = assignableVehicles.find(vehicle => vehicle._id === tripVehicleRef) || null;
    const requiresTripVehicleOverrideReason = shouldRequireTripVehicleOverrideReason(doData, selectedTripVehicle);
    const isCompletingDelivery = newStatus === 'DELIVERED';
    const pendingDriverStatusMeta = doData.pendingDriverStatus ? DO_STATUS_MAP[doData.pendingDriverStatus] : null;
    const hasShipperReference = Boolean(doData.customerDoNumber?.trim());
    const normalizedShipperReferenceFormat = shipperReferenceFormat.trim().toUpperCase() || 'SJ';
    const shipperReferenceExample = `${normalizedShipperReferenceFormat}/27032026/001`;
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
    const voucherIssueBlockingReasons = [
        !doData.driverRef ? 'supir trip belum diisi' : null,
        !doData.vehicleRef && !doData.vehiclePlate ? 'kendaraan trip belum diisi' : null,
        !doData.taripBorongan || doData.taripBorongan <= 0 ? 'upah trip belum diisi di Surat Jalan' : null,
        !['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED'].includes(doData.status)
            ? 'status Surat Jalan tidak bisa diterbitkan ke uang jalan trip'
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
        (canManageDeliveryStatus && nextStatuses.includes('CANCELLED'));
    const {
        actualCargoTotals,
        autoActualDropDraft,
        effectiveActualDropPoints,
        actualCargoReady,
        actualDropReady,
        actualDropPointCount,
        actualDropSummary,
        hasLiveCoordinates,
        trackingMapUrl,
        mapEmbedUrl,
    } = buildDeliveryOrderDetailState({
        doData,
        actualCargoItems,
        actualDropPoints,
        showAdvancedDropEditor,
    });

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/delivery-orders" />
                    <div>
                        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {formatInternalDeliveryOrderNumber(doData)}
                            <span className={`badge badge-${DO_STATUS_MAP[doData.status]?.color}`}>
                                <span className="badge-dot" /> {DO_STATUS_MAP[doData.status]?.label}
                            </span>
                        </h1>
                    </div>
                </div>
                <div className="page-actions">
                    {linkedTripCashVoucherId && canOpenTripCashPage && (
                        <Link className="btn btn-secondary" href={`/driver-vouchers/${linkedTripCashVoucherId}`}>
                            <Wallet size={16} /> Buka Uang Jalan
                        </Link>
                    )}
                    {!hasLinkedTripCash && canIssueVoucherFromDo && (
                        <Link className="btn btn-secondary" href={`/driver-vouchers/new?deliveryOrderRef=${encodeURIComponent(doData._id)}`}>
                            <Wallet size={16} /> Terbitkan Uang Jalan
                        </Link>
                    )}
                    {doData.status === 'CREATED' && canAssignTripResources && !hasLinkedTripCash && (
                        <button className="btn btn-secondary" onClick={() => void openTripResourcesModal()}>
                            <Truck size={16} /> {tripResourceActionLabel}
                        </button>
                    )}
                    {nextStatuses.length > 0 && canManageDeliveryStatus && (
                        <button className="btn btn-primary" onClick={() => openStatusModal()}>
                            <Truck size={16} /> {nextStatuses.includes('DELIVERED') ? 'Lanjut / Selesaikan DO' : 'Ubah Status'}
                        </button>
                    )}
                    {doData.status === 'DELIVERED' && !doData.podReceiverName && canManageDeliveryStatus && (
                        <button
                            className="btn btn-success"
                            onClick={() => {
                                setPodName('');
                                setPodDate(getBusinessDateValue());
                                setPodNote('');
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
                            {canAssignTripResources && (
                                <button className="btn btn-secondary btn-sm" onClick={() => void openTripResourcesModal()}>
                                    <Truck size={14} /> {tripResourceActionLabel}
                                </button>
                            )}
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
                                    Driver mengajukan status{' '}
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
                        <span className="card-header-title">Kelola Trip dari Surat Jalan</span>
                    </div>
                    <div className="card-body" style={{ display: 'grid', gap: '0.85rem' }}>
                        <div className="text-muted text-sm">
                            Surat Jalan adalah anchor trip. Armada, SJ pengirim, upah trip, dan uang jalan dikelola dari sini.
                            Hard delete sengaja tidak dibuka agar histori tracking, bon, dan dokumen turunannya tetap utuh. Untuk membatalkan trip, gunakan workflow status.
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {doData.status === 'CREATED' && canAssignTripResources && !hasLinkedTripCash && (
                                <button className="btn btn-secondary btn-sm" onClick={() => void openTripResourcesModal()}>
                                    <Truck size={14} /> {tripResourceActionLabel}
                                </button>
                            )}
                            {canEditShipperReference && (
                                <button className="btn btn-secondary btn-sm" onClick={openShipperReferenceModal}>
                                    <Edit size={14} /> {hasShipperReference ? 'Edit SJ Pengirim' : 'Isi SJ Pengirim'}
                                </button>
                            )}
                            {canManageTripFee && !hasLinkedTripCash && !editingTarip && (
                                <button className="btn btn-secondary btn-sm" onClick={openTripFeeEditor}>
                                    <Edit size={14} /> {doData.taripBorongan ? 'Edit Upah Trip' : 'Isi Upah Trip'}
                                </button>
                            )}
                            {linkedTripCashVoucherId && canOpenTripCashPage && (
                                <Link className="btn btn-secondary btn-sm" href={`/driver-vouchers/${linkedTripCashVoucherId}`}>
                                    <Wallet size={14} /> Buka Uang Jalan
                                </Link>
                            )}
                            {!hasLinkedTripCash && canIssueVoucherFromDo && (
                                <Link className="btn btn-primary btn-sm" href={`/driver-vouchers/new?deliveryOrderRef=${encodeURIComponent(doData._id)}`}>
                                    <Wallet size={14} /> Terbitkan Uang Jalan
                                </Link>
                            )}
                            {canManageDeliveryStatus && nextStatuses.includes('CANCELLED') && (
                                <button className="btn btn-secondary btn-sm" onClick={() => openStatusModal('CANCELLED')}>
                                    Batalkan Surat Jalan
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
                                Surat jalan ini sudah terhubung ke uang jalan trip {linkedTripCashBonNumber}. Armada trip dan upah trip dikunci supaya settlement tidak berubah diam-diam.
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
                            <Link className="btn btn-secondary btn-sm" href={`/driver-vouchers/${linkedTripCashVoucherId}`}>
                                <Wallet size={14} /> Buka Detail Bon
                            </Link>
                        )}
                        {!hasLinkedTripCash && canIssueVoucherFromDo && (
                            <Link className="btn btn-primary btn-sm" href={`/driver-vouchers/new?deliveryOrderRef=${encodeURIComponent(doData._id)}`}>
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
                                        <div className="detail-value font-mono">{linkedVoucher.bonNumber}</div>
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
                                        <div className="detail-value">{formatCurrency(linkedVoucherSummary.balance)}</div>
                                    </div>
                                </div>
                                <div className="text-muted text-sm">
                                    Bon ini melekat ke Surat Jalan ini. Detail biaya perjalanan, top up, dan settlement akhir dibuka dari modul Uang Jalan Trip.
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
                                    Surat Jalan ini sudah punya uang jalan trip. Detail nominal, biaya perjalanan, top up, dan settlement akhir hanya dibuka dari modul Uang Jalan Trip oleh role yang memang berwenang.
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                <div className="detail-value">Belum ada uang jalan trip yang terbit untuk Surat Jalan ini.</div>
                                <div className="text-muted text-sm">
                                    Setelah trip siap jalan, terbitkan uang jalan dari Surat Jalan ini agar bon, biaya perjalanan, upah trip, dan settlement akhir tetap terkunci ke DO yang benar.
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
                        <span className="card-header-title">Informasi Surat Jalan</span>
                        {canEditShipperReference && (
                            <button className="btn btn-secondary btn-sm" onClick={openShipperReferenceModal}>
                                <Edit size={14} /> {hasShipperReference ? 'Edit SJ Pengirim' : 'Isi SJ Pengirim'}
                            </button>
                        )}
                    </div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">No. SJ Pengirim</div><div className="detail-value font-mono">{formatShipperDeliveryOrderNumber(doData)}</div></div>
                            <div className="detail-item"><div className="detail-label">Tanggal</div><div className="detail-value">{formatDate(doData.date)}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">No. DO Internal</div><div className="detail-value font-mono">{doData.doNumber}</div></div>
                            <div className="detail-item"><div className="detail-label">Kendaraan</div><div className="detail-value">{doData.vehiclePlate || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Master Resi</div><div className="detail-value">{canOpenSourceOrderPage ? <Link href={`/orders/${doData.orderRef}`}>{doData.masterResi}</Link> : doData.masterResi}</div></div>
                            <div className="detail-item"><div className="detail-label">Customer</div><div className="detail-value">{doData.customerName || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Driver</div><div className="detail-value">{doData.driverName || '-'}</div></div>
                            <div className="detail-item"><div className="detail-label">Telepon Penerima</div><div className="detail-value">{doData.receiverPhone || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Armada Diminta</div><div className="detail-value">{doData.serviceName || '-'}</div></div>
                            <div className="detail-item"><div className="detail-label">Penerima</div><div className="detail-value">{doData.receiverName || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Armada Aktual</div><div className="detail-value">{doData.vehicleServiceName || doData.serviceName || '-'}</div></div>
                            <div className="detail-item"><div className="detail-label">Alasan Override Armada</div><div className="detail-value">{doData.vehicleCategoryOverrideReason || '-'}</div></div>
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
                        <div className="mt-2"><div className="detail-label">Alamat Pickup</div><div className="detail-value">{doData.pickupAddress || '-'}</div></div>
                        {doData.notes && <div className="mt-2"><div className="detail-label">Catatan</div><div className="detail-value">{doData.notes}</div></div>}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Penerima</span></div>
                    <div className="card-body">
                        <div className="detail-item"><div className="detail-label">Nama</div><div className="detail-value">{doData.receiverName || '-'}</div></div>
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
                    <div className="detail-row">
                        <div className="detail-item">
                            <div className="detail-label">Asal Tagihan</div>
                            <div className="detail-value">{doData.pickupAddress || '-'}</div>
                        </div>
                        <div className="detail-item">
                            <div className="detail-label">Tujuan Tagihan</div>
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
                                                <span className={`badge badge-${DO_ACTUAL_DROP_TYPE_MAP[point.stopType]?.color || 'gray'}`}>
                                                    {DO_ACTUAL_DROP_TYPE_MAP[point.stopType]?.label || point.stopType}
                                                </span>
                                            </div>
                                            {point.locationAddress && (
                                                <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                                    {point.locationAddress}
                                                </div>
                                            )}
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
            <CollapsibleCard title="Upah Trip Driver" defaultOpen={!doData.taripBorongan}>
                    {!editingTarip ? (
                        <div>
                            <div className="detail-row">
                                <div className="detail-item">
                                    <div className="detail-label">Upah Trip per DO</div>
                                    <div className="detail-value font-semibold" style={{ color: doData.taripBorongan ? 'var(--color-primary)' : 'var(--color-gray-400)' }}>
                                        {doData.taripBorongan ? formatCurrency(doData.taripBorongan) : 'Belum diisi'}
                                    </div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Keterangan</div>
                                    <div className="detail-value">{doData.keteranganBorongan || '-'}</div>
                                </div>
                                {canManageTripFee && !hasLinkedTripCash && (
                                    <div className="detail-item" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end' }}>
                                        <button className="btn btn-secondary btn-sm" onClick={openTripFeeEditor}>
                                            <Edit size={14} /> {doData.taripBorongan ? 'Edit Upah' : 'Isi Upah'}
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="detail-row" style={{ marginTop: '0.75rem' }}>
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
                            {linkedTripCashBonNumber && (
                                <div className="text-muted text-sm" style={{ marginTop: '0.75rem' }}>
                                    Upah trip sudah terkunci karena DO ini sudah punya uang jalan trip {linkedTripCashBonNumber}. Untuk menjaga settlement tetap konsisten, nominal dan master rute tidak bisa diubah lagi dari DO.
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
                                    <label className="form-label">Upah Trip per DO (Rp) <span className="required">*</span></label>
                                    <CurrencyInput
                                        value={matchedTripRouteRate?.rate ?? taripBorongan}
                                        onValueChange={value => setTaripBorongan(value)}
                                        placeholder={isTripFeeLockedToMaster ? 'Mengikuti master biaya rute trip' : 'Ketik upah trip per DO'}
                                        disabled={isTripFeeLockedToMaster}
                                    />
                                    <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                        {isTripFeeLockedToMaster
                                            ? 'Upah trip terkunci mengikuti master biaya rute trip yang dipilih.'
                                            : 'Jika belum ada master rute yang cocok, upah trip masih boleh diisi manual sebelum voucher diterbitkan.'}
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
                                        setTaripBorongan(doData.taripBorongan || 0);
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
                <div className="card-header"><span className="card-header-title">Item dalam DO ({doItems.length})</span></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Deskripsi</th><th>Koli</th><th>Muatan</th></tr></thead>
                        <tbody>
                            {doItems.map(item => (
                                <tr key={item._id}>
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
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
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
                                Perubahan armada hanya diizinkan saat status surat jalan masih <strong>Dibuat</strong> dan belum masuk uang jalan / settlement trip.
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
                            <h3 className="modal-title">{isCompletingDelivery ? (reviewingDriverRequest ? 'Review Permintaan Selesai Driver' : 'Selesaikan Surat Jalan') : 'Ubah Status DO'}</h3>
                            <button className="modal-close" onClick={() => { setShowStatusModal(false); setReviewingDriverRequest(false); }} disabled={updatingStatus}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Status Baru</label>
                                {reviewingDriverRequest && doData.pendingDriverStatus ? (
                                    <div className="detail-value">
                                        <span className={`badge badge-${pendingDriverStatusMeta?.color || 'warning'}`}>
                                            <span className="badge-dot" /> {pendingDriverStatusMeta?.label || doData.pendingDriverStatus}
                                        </span>
                                    </div>
                                ) : (
                                    <select className="form-select" value={newStatus} onChange={e => setNewStatus(e.target.value)} disabled={updatingStatus}>
                                        <option value="">Pilih status</option>
                                        {nextStatuses.map(s => <option key={s} value={s}>{DO_STATUS_MAP[s]?.label || s}</option>)}
                                    </select>
                                )}
                            </div>
                            {reviewingDriverRequest && doData.pendingDriverStatusNote && (
                                <div className="form-group">
                                    <label className="form-label">Catatan Driver</label>
                                    <div className="detail-value">{doData.pendingDriverStatusNote}</div>
                                </div>
                            )}
                            {isCompletingDelivery && (
                                <>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Item dalam trip</div>
                                            <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{actualCargoItems.length} item</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Muatan aktual sementara</div>
                                            <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                                {actualCargoItems.length > 0 ? formatCargoSummary(actualCargoTotals) : 'Belum diisi'}
                                            </div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Mode drop</div>
                                            <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                                {showAdvancedDropEditor ? `${actualDropPointCount} titik aktual` : 'Trip normal / 1 tujuan'}
                                            </div>
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
                                    <div className="form-group">
                                        <label className="form-label">Muatan Aktual per Item <span className="required">*</span></label>
                                        <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                            Untuk trip normal, cukup isi realisasi lapangan tiap item. <strong>Rencana Trip</strong> di DO ini masih estimasi proporsional dari target order/resi. Qty aktual boleh lebih kecil atau lebih besar dari rencana trip selama total order/resi belum terlampaui. Berat dan volume aktual juga boleh berbeda dari rencana trip, tetapi kalau total target order/resi memang bertambah, revisi order/resi dulu.
                                        </div>
                                        <div style={{ display: 'grid', gap: '0.75rem' }}>
                                            {actualCargoItems.map(item => (
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
                                    </div>
                                    <div className="form-group">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                            <label className="form-label" style={{ marginBottom: 0 }}>Realisasi Titik Drop <span className="required">*</span></label>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => setShowAdvancedDropEditor(previous => !previous)}
                                                disabled={updatingStatus}
                                            >
                                                {showAdvancedDropEditor ? 'Tutup Detail Drop' : 'Ada Multi-drop / Hold / Extra Drop'}
                                            </button>
                                        </div>
                                        <div style={{ background: 'var(--color-info-light)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-info)' }}>
                                            Untuk trip normal, sistem otomatis menganggap semua muatan aktual turun di tujuan tagihan: <strong>{autoActualDropDraft.locationName || 'Tujuan Tagihan'}</strong>. Buka detail ini hanya jika ada multi-drop, hold/inap, return, atau extra drop.
                                        </div>
                                        {!showAdvancedDropEditor ? (
                                            <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                                <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Realisasi Default</div>
                                                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'grid', gap: '0.2rem' }}>
                                                    <div>Lokasi: {autoActualDropDraft.locationName || 'Tujuan Tagihan'}</div>
                                                    {autoActualDropDraft.locationAddress && <div>Alamat: {autoActualDropDraft.locationAddress}</div>}
                                                    <div>Muatan: {formatCargoSummary({ qtyKoli: actualCargoTotals.qtyKoli, weightKg: actualCargoTotals.weightKg, volumeM3: actualCargoTotals.volumeM3 })}</div>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
                                                    <button type="button" className="btn btn-secondary btn-sm" onClick={addActualDropDraft} disabled={updatingStatus}>
                                                        + Tambah Titik Drop
                                                    </button>
                                                </div>
                                                <div style={{ display: 'grid', gap: '0.75rem' }}>
                                                    {actualDropPoints.map((item, index) => (
                                                        <div key={item.draftKey} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                                                <div style={{ fontWeight: 600 }}>Titik Drop {index + 1}</div>
                                                                {actualDropPoints.length > 1 && (
                                                                    <button type="button" className="btn btn-danger btn-sm" onClick={() => removeActualDropDraft(item.draftKey)} disabled={updatingStatus}>
                                                                        Hapus
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <div className="form-row">
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
                                                                <label className="form-label">Alamat Lokasi</label>
                                                                <input
                                                                    className="form-input"
                                                                    value={item.locationAddress}
                                                                    onChange={e => updateActualDropDraft(item.draftKey, 'locationAddress', e.target.value)}
                                                                    disabled={updatingStatus}
                                                                    placeholder="Opsional, isi jika berbeda dari tujuan tagihan"
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
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </>
                            )}
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={3} value={statusNote} onChange={e => setStatusNote(e.target.value)} placeholder={isCompletingDelivery ? 'Catatan penyelesaian DO...' : 'Catatan tracking...'} disabled={updatingStatus} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowStatusModal(false); setReviewingDriverRequest(false); }} disabled={updatingStatus}>Batal</button>
                            <button className={`btn ${isCompletingDelivery ? 'btn-success' : 'btn-primary'}`} onClick={updateDOStatus} disabled={!newStatus || updatingStatus || (isCompletingDelivery && (!podName.trim() || !podDate || !actualCargoReady || !actualDropReady))}>
                                <Save size={16} /> {updatingStatus ? 'Menyimpan...' : (reviewingDriverRequest ? 'Approve & Selesaikan' : (isCompletingDelivery ? 'Selesaikan DO' : 'Simpan'))}
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

            {showShipperReferenceModal && (
                <div className="modal-overlay" onClick={() => { if (!savingShipperReference) setShowShipperReferenceModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{hasShipperReference ? 'Edit SJ Pengirim' : 'Isi SJ Pengirim'}</h3>
                            <button className="modal-close" onClick={() => setShowShipperReferenceModal(false)} disabled={savingShipperReference}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">No. SJ Pengirim</label>
                                <input
                                    className="form-input"
                                    value={shipperReferenceValue}
                                    onChange={e => setShipperReferenceValue(e.target.value.toUpperCase())}
                                    placeholder={`Contoh: ${shipperReferenceExample}`}
                                    disabled={savingShipperReference}
                                />
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                    Format referensi customer: <strong>{normalizedShipperReferenceFormat}</strong>. Nomor final tetap diisi manual mengikuti surat jalan dari pengirim.
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowShipperReferenceModal(false)} disabled={savingShipperReference}>Batal</button>
                            <button className="btn btn-primary" onClick={saveShipperReference} disabled={savingShipperReference || !shipperReferenceValue.trim()}>
                                <Save size={16} /> {savingShipperReference ? 'Menyimpan...' : 'Simpan'}
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


