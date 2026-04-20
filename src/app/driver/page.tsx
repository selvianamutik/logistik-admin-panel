'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    AlertCircle,
    Loader2,
    LogOut,
    MapPin,
    Plus,
    PlayCircle,
    RefreshCw,
    Smartphone,
    Truck,
    X,
} from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import {
    buildActualCargoDrafts,
    buildDefaultActualDropDrafts,
    buildDeliveryOrderDetailState,
    createEmptyActualDropDraft,
    getActualCargoDraftsForDrop,
    shouldOpenAdvancedDropEditor,
    summarizeActualCargoDraftDescriptions,
    updateActualCargoDraftVolumeUnit,
    updateActualCargoDraftWeightUnit,
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
import { parseFormattedNumberish } from '@/lib/formatted-number';
import { VOLUME_INPUT_UNIT_OPTIONS, WEIGHT_INPUT_UNIT_OPTIONS, formatCargoSummary } from '@/lib/measurement';
import {
    applyCustomerProductToOrderItem,
    summarizeDraftOrderCargo,
    updateOrderItemVolumeUnit,
    updateOrderItemWeightUnit,
} from '@/lib/order-create-page-support';
import { DO_STATUS_MAP, formatCurrency, formatDate, formatDateTime, formatShipperDeliveryOrderNumber, formatShipperReceiverSummary, getShipperReferenceCount } from '@/lib/utils';
import type { CustomerProduct, Driver, SessionUser } from '@/lib/types';
import type { DriverAssignedDeliveryOrder, DriverAssignedTripPlan } from '@/lib/api/driver-portal';

type DriverSessionResponse = {
    user: SessionUser;
    driver: Driver;
    company: { _id: string; name: string; phone?: string; themeColor?: string } | null;
};

type DriverDeliveryOrdersResponse = {
    data?: DriverAssignedDeliveryOrder[];
    plannedTrips?: DriverAssignedTripPlan[];
    customerProducts?: CustomerProduct[];
    error?: string;
};

type DriverPortalError = Error & { status?: number };
type DriverProgressStatus = Extract<DriverAssignedDeliveryOrder['status'], 'ON_DELIVERY' | 'ARRIVED' | 'DELIVERED'>;

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

function getNextDriverProgressStatus(order: DriverAssignedDeliveryOrder): DriverProgressStatus | null {
    if (
        order.trackingState !== 'ACTIVE' ||
        order.status === 'DELIVERED' ||
        order.status === 'CANCELLED' ||
        order.pendingDriverStatus === 'DELIVERED'
    ) {
        return null;
    }

    switch (order.status) {
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

function getDriverProgressButtonLabel(nextStatus: DriverProgressStatus) {
    switch (nextStatus) {
        case 'ON_DELIVERY':
            return 'Tandai Dalam Pengiriman';
        case 'ARRIVED':
            return 'Tandai Sudah Tiba';
        case 'DELIVERED':
            return 'Ajukan Selesai';
        default:
            return 'Lanjutkan Trip';
    }
}

function getDriverProgressSuccessMessage(nextStatus: DriverProgressStatus) {
    switch (nextStatus) {
        case 'ON_DELIVERY':
            return 'Status DO diperbarui menjadi dalam pengiriman.';
        case 'ARRIVED':
            return 'Status DO diperbarui menjadi sudah tiba.';
        case 'DELIVERED':
            return 'Permintaan selesai dikirim. Menunggu approval admin.';
        default:
            return 'Status DO berhasil diperbarui.';
    }
}

function areActualCargoDraftsReady(items: ActualCargoDraft[]) {
    return items.every(item => {
        const qty = parseFormattedNumberish(item.actualQtyKoli || 0);
        const weight = parseFormattedNumberish(item.actualWeightInputValue || 0, {
            maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
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

function summarizeDriverOrderCargo(order: DriverAssignedDeliveryOrder) {
    return formatCargoSummary({
        qtyKoli: (order.driverCargoItems || []).reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0), 0),
        weightKg: (order.driverCargoItems || []).reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemWeight ?? item.shippedWeight ?? 0, { maxFractionDigits: 2 }), 0),
        volumeM3: (order.driverCargoItems || []).reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 }), 0),
    });
}

export default function DriverPortalPage() {
    const router = useRouter();
    const intervalRef = useRef<number | null>(null);
    const heartbeatInFlightRef = useRef(false);

    const [user, setUser] = useState<SessionUser | null>(null);
    const [driver, setDriver] = useState<Driver | null>(null);
    const [companyName, setCompanyName] = useState('PT Gading Mas Surya');
    const [orders, setOrders] = useState<DriverAssignedDeliveryOrder[]>([]);
    const [plannedTrips, setPlannedTrips] = useState<DriverAssignedTripPlan[]>([]);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [portalLoadError, setPortalLoadError] = useState<string | null>(null);
    const [loggingOut, setLoggingOut] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'error' | 'success' | 'info'; message: string } | null>(null);
    const [showDeliveredRequestModal, setShowDeliveredRequestModal] = useState(false);
    const [completionOrderId, setCompletionOrderId] = useState<string | null>(null);
    const [completionNote, setCompletionNote] = useState('');
    const [completionCargoItems, setCompletionCargoItems] = useState<ActualCargoDraft[]>([]);
    const [completionDropPoints, setCompletionDropPoints] = useState<ActualDropDraft[]>([]);
    const [showCompletionAdvancedDropEditor, setShowCompletionAdvancedDropEditor] = useState(false);
    const [showCargoInputModal, setShowCargoInputModal] = useState(false);
    const [cargoInputOrderId, setCargoInputOrderId] = useState<string | null>(null);
    const [cargoInputGroups, setCargoInputGroups] = useState<DeliveryOrderCargoDraftGroup[]>([createDefaultDeliveryOrderCargoDraftGroup()]);
    const [showTripCreateModal, setShowTripCreateModal] = useState(false);
    const [tripCreateTargetId, setTripCreateTargetId] = useState<string | null>(null);
    const [tripCreateGroups, setTripCreateGroups] = useState<DeliveryOrderCargoDraftGroup[]>([createDefaultDeliveryOrderCargoDraftGroup()]);

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
    const isActionInFlight = Boolean(actionLoadingId);
    const completionOrder = useMemo(
        () => orders.find(item => item._id === completionOrderId) || null,
        [completionOrderId, orders]
    );
    const completionDetailState = useMemo(
        () => buildDeliveryOrderDetailState({
            doData: completionOrder,
            actualCargoItems: completionCargoItems,
            actualDropPoints: completionDropPoints,
            showAdvancedDropEditor: showCompletionAdvancedDropEditor,
        }),
        [completionCargoItems, completionDropPoints, completionOrder, showCompletionAdvancedDropEditor]
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
    const tripCreateAllowsDirectCargoInput = tripCreateTarget?.allowsDirectCargoInput !== false;
    const tripCreateCustomerProducts = useMemo(
        () => customerProducts.filter(product => product.customerRef === tripCreateTarget?.customerRef),
        [customerProducts, tripCreateTarget?.customerRef]
    );
    const completionCargoReady = useMemo(
        () => areActualCargoDraftsReady(completionCargoItems),
        [completionCargoItems]
    );
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
    const completionCargoSummary = useMemo(
        () => formatCargoSummary({
            qtyKoli: completionCargoItems.reduce((sum, item) => sum + parseFormattedNumberish(item.actualQtyKoli || 0), 0),
            weightKg: completionCargoItems.reduce((sum, item) => {
                const value = parseFormattedNumberish(item.actualWeightInputValue || 0, {
                    maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
                });
                return sum + (item.actualWeightInputUnit === 'TON' ? value * 1000 : value);
            }, 0),
            volumeM3: completionCargoItems.reduce((sum, item) => {
                const value = parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                    maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                });
                if (item.actualVolumeInputUnit === 'LITER') return sum + value / 1000;
                if (item.actualVolumeInputUnit === 'KL') return sum + value;
                return sum + value;
            }, 0),
        }),
        [completionCargoItems]
    );
    const completionShipperReferences = completionOrder?.shipperReferences || [];
    const resolveCompletionDropShipperReferenceValue = (drop: Pick<ActualDropDraft, 'shipperReferenceKey' | 'shipperReferenceNumber'>) => {
        const matchedReference = completionShipperReferences.find(reference =>
            (drop.shipperReferenceKey && reference._key === drop.shipperReferenceKey) ||
            (drop.shipperReferenceNumber && reference.referenceNumber === drop.shipperReferenceNumber)
        );
        return matchedReference?._key || matchedReference?.referenceNumber || '';
    };
    const getCompletionDropCargoSummary = (drop: Pick<ActualDropDraft, 'shipperReferenceKey' | 'shipperReferenceNumber'>) =>
        summarizeActualCargoDraftDescriptions(getActualCargoDraftsForDrop(drop, completionCargoItems));

    const applyOrderUpdate = useCallback((updated: DriverAssignedDeliveryOrder) => {
        setOrders(prev => prev.map(item => (item._id === updated._id ? { ...item, ...updated } : item)));
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
            setOrders(payload.data || []);
            setPlannedTrips(payload.plannedTrips || []);
            setCustomerProducts((payload.customerProducts || []).filter(product => product.active !== false));
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

    useEffect(() => {
        void loadDriverPortal();
    }, [loadDriverPortal]);

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
                    locationName: string;
                    locationAddress: string;
                    qtyKoli: number;
                    weightInputValue: number;
                    weightInputUnit: ActualDropDraft['weightInputUnit'];
                    volumeInputValue: number;
                    volumeInputUnit: ActualDropDraft['volumeInputUnit'];
                    note?: string;
                }>;
            }
        ) => {
            const res = await fetch('/api/driver/delivery-orders/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: deliveryOrderRef,
                    status,
                    note: options?.note,
                    actualItems: options?.actualItems,
                    actualDropPoints: options?.actualDropPoints,
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
        intervalRef.current = window.setInterval(sendHeartbeat, 15000);

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

    const openDeliveredRequestModal = useCallback((order: DriverAssignedDeliveryOrder) => {
        const nextCargoItems = buildActualCargoDrafts(order.driverCargoItems || [], order.pendingDriverActualCargoItems);
        const nextDropPoints = buildDefaultActualDropDrafts(
            order,
            nextCargoItems,
            order.pendingDriverActualDropPoints
        );
        setCompletionOrderId(order._id);
        setCompletionNote(order.pendingDriverStatusNote || '');
        setCompletionCargoItems(nextCargoItems);
        setCompletionDropPoints(nextDropPoints);
        setShowCompletionAdvancedDropEditor(
            shouldOpenAdvancedDropEditor(order, nextDropPoints)
        );
        setShowDeliveredRequestModal(true);
    }, []);

    const closeDeliveredRequestModal = useCallback(() => {
        if (actionLoadingId) {
            return;
        }
        setShowDeliveredRequestModal(false);
        setCompletionOrderId(null);
        setCompletionNote('');
        setCompletionCargoItems([]);
        setCompletionDropPoints([]);
        setShowCompletionAdvancedDropEditor(false);
    }, [actionLoadingId]);

    const openCargoInputModal = useCallback((order: DriverAssignedDeliveryOrder) => {
        setCargoInputOrderId(order._id);
        setCargoInputGroups(buildInitialDeliveryOrderCargoDraftGroups({
            pickupStops: order.pickupStops,
            shipperReferences: (order.shipperReferences && order.shipperReferences.length > 0)
                ? order.shipperReferences
                : order.customerDoNumber
                    ? [{ referenceNumber: order.customerDoNumber, pickupStopKey: order.pickupStops?.[0]?._key }]
                    : undefined,
        }));
        setShowCargoInputModal(true);
    }, []);

    const closeCargoInputModal = useCallback(() => {
        if (actionLoadingId) {
            return;
        }
        setShowCargoInputModal(false);
        setCargoInputOrderId(null);
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
                            ? { ...item, [field]: value }
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
                            ? { ...item, [field]: value }
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
                    ? { ...item, [field]: value }
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
        field: keyof Pick<ActualDropDraft, 'stopType' | 'shipperReferenceKey' | 'shipperReferenceNumber' | 'locationName' | 'locationAddress' | 'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit' | 'note'>,
        value: string
    ) => {
        setCompletionDropPoints(previous =>
            previous.map(item => (item.draftKey === draftKey ? { ...item, [field]: value } : item))
        );
    }, []);

    const applyCompletionDropShipperReference = useCallback((draftKey: string, optionValue: string) => {
        const selectedReference = (completionOrder?.shipperReferences || []).find(reference => {
            const referenceOptionValue = reference._key || reference.referenceNumber || '';
            return referenceOptionValue === optionValue;
        });
        setCompletionDropPoints(previous => previous.map(item => {
            if (item.draftKey !== draftKey) {
                return item;
            }
            if (!selectedReference) {
                return {
                    ...item,
                    shipperReferenceKey: '',
                    shipperReferenceNumber: '',
                };
            }
            return {
                ...item,
                shipperReferenceKey: selectedReference._key || '',
                shipperReferenceNumber: selectedReference.referenceNumber || '',
                locationName:
                    selectedReference.receiverCompany?.trim()
                    || selectedReference.receiverName?.trim()
                    || selectedReference.receiverAddress?.trim()
                    || item.locationName,
                locationAddress: selectedReference.receiverAddress || item.locationAddress,
            };
        }));
    }, [completionOrder?.shipperReferences]);

    const addCompletionDropDraft = useCallback(() => {
        setCompletionDropPoints(previous => [...previous, createEmptyActualDropDraft()]);
    }, []);

    const removeCompletionDropDraft = useCallback((draftKey: string) => {
        setCompletionDropPoints(previous => previous.filter(item => item.draftKey !== draftKey));
    }, []);

    const submitDeliveredRequest = useCallback(async () => {
        if (!completionOrder) {
            return;
        }

        setActionLoadingId(completionOrder._id);
        try {
            await postDeliveryProgress(completionOrder._id, 'DELIVERED', {
                note: completionNote,
                actualItems: completionCargoItems.map(item => ({
                    deliveryOrderItemRef: item.deliveryOrderItemRef,
                    actualQtyKoli: parseFormattedNumberish(item.actualQtyKoli || 0),
                    actualWeightInputValue: parseFormattedNumberish(item.actualWeightInputValue || 0, {
                        maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
                    }),
                    actualWeightInputUnit: item.actualWeightInputUnit,
                    actualVolumeInputValue: parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                        maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                    }),
                    actualVolumeInputUnit: item.actualVolumeInputUnit,
                })),
                actualDropPoints: completionDetailState.effectiveActualDropPoints.map(item => ({
                    stopType: item.stopType,
                    shipperReferenceKey: item.shipperReferenceKey || undefined,
                    shipperReferenceNumber: item.shipperReferenceNumber || undefined,
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
                    note: item.note.trim() || undefined,
                })),
            });
            setFeedback({ type: 'success', message: getDriverProgressSuccessMessage('DELIVERED') });
            await loadOrders();
            setShowDeliveredRequestModal(false);
            setCompletionOrderId(null);
            setCompletionNote('');
            setCompletionCargoItems([]);
            setCompletionDropPoints([]);
            setShowCompletionAdvancedDropEditor(false);
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
        completionCargoItems,
        completionDetailState.effectiveActualDropPoints,
        completionNote,
        completionOrder,
        handleDriverAuthFailure,
        loadOrders,
        postDeliveryProgress,
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

        setActionLoadingId(cargoInputOrder._id);
        try {
            const response = await fetch('/api/driver/delivery-orders/cargo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: cargoInputOrder._id,
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
                throw createDriverPortalError(response.status, payload?.error || 'Gagal menambah barang ke surat jalan');
            }

            setFeedback({
                type: 'success',
                message:
                    normalizedGroups.length > 0 && (payload?.data?.appendedCount || 0) === 0
                        ? `${payload?.data?.shipperReferenceCount || normalizedGroups.length} SJ disimpan. Barang bisa ditambah menyusul.`
                        : `${payload?.data?.appendedCount || cargoInputDraftItems.length} barang ditambahkan ke surat jalan.`,
            });
            setShowCargoInputModal(false);
            setCargoInputOrderId(null);
            setCargoInputGroups([createDefaultDeliveryOrderCargoDraftGroup()]);
            await loadOrders();
        } catch (error) {
            if (isDriverUnauthorizedError(error)) {
                handleDriverAuthFailure(error instanceof Error ? error.message : undefined);
                return;
            }
            setFeedback({
                type: 'error',
                message: error instanceof Error ? error.message : 'Gagal menambah barang ke surat jalan',
            });
        } finally {
            setActionLoadingId(null);
        }
    }, [cargoInputDraftGroups, cargoInputDraftItems, cargoInputOrder, handleDriverAuthFailure, loadOrders]);

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

    const handleDeliveryProgress = useCallback(
        async (deliveryOrderRef: string, nextStatus: DriverProgressStatus) => {
            if (nextStatus === 'DELIVERED') {
                const targetOrder = orders.find(item => item._id === deliveryOrderRef);
                if (!targetOrder) {
                    setFeedback({ type: 'error', message: 'Surat jalan tidak ditemukan untuk diajukan selesai.' });
                    return;
                }
                openDeliveredRequestModal(targetOrder);
                return;
            }
            setActionLoadingId(deliveryOrderRef);
            try {
                await postDeliveryProgress(deliveryOrderRef, nextStatus);
                setFeedback({ type: 'success', message: getDriverProgressSuccessMessage(nextStatus) });
                await loadOrders();
            } catch (error) {
                if (isDriverUnauthorizedError(error)) {
                    handleDriverAuthFailure(error instanceof Error ? error.message : undefined);
                    return;
                }
                setFeedback({
                    type: 'error',
                    message: error instanceof Error ? error.message : 'Gagal memperbarui progres perjalanan',
                });
            } finally {
                setActionLoadingId(null);
            }
        },
        [handleDriverAuthFailure, loadOrders, openDeliveredRequestModal, orders, postDeliveryProgress]
    );

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

            <section className="driver-toolbar">
                <div className="driver-toolbar-text">
                    {lockedTrackingDo ? (
                        <>DO terkunci di <strong>{lockedTrackingDo.doNumber}</strong></>
                    ) : (
                        <>Belum ada DO yang mengunci tracking</>
                    )}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => void loadOrders()} disabled={refreshing || isActionInFlight}>
                    <RefreshCw size={15} className={refreshing ? 'spin' : ''} /> Refresh
                </button>
            </section>

            {plannedTrips.length > 0 && (
                <section className="driver-do-grid" style={{ marginBottom: '1rem' }}>
                    {plannedTrips.map(item => {
                        const tripId = getDriverTripPlanId(item);
                        const isBusy = actionLoadingId === tripId;
                        const tripAllowsDirectCargoInput = item.allowsDirectCargoInput !== false;
                        const pickupLabel = item.pickupStops.length > 0
                            ? `${item.pickupStops.length} titik pickup`
                            : (item.pickupAddress || '-');

                        return (
                            <div key={tripId} className="card driver-do-card">
                                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                                    <div>
                                        <div className="card-header-title">Trip {item.tripSequence} Siap Input Surat Jalan</div>
                                        <div className="text-muted text-sm">{item.masterResi || '-'} | {formatDate(item.date || '')}</div>
                                    </div>
                                    <span className="badge badge-warning">Belum jadi SJ</span>
                                </div>
                                <div className="card-body">
                                    <div className="driver-do-meta"><span>Customer</span><strong>{item.customerName || '-'}</strong></div>
                                    <div className="driver-do-meta"><span>Kendaraan</span><strong>{item.vehiclePlate || '-'}</strong></div>
                                    <div className="driver-do-meta"><span>Pickup</span><strong>{pickupLabel}</strong></div>
                                    <div className="driver-do-meta"><span>Uang Jalan</span><strong>{formatCurrency(item.cashGiven || 0)}</strong></div>
                                    <div className="driver-do-meta"><span>Borongan</span><strong>{formatCurrency(item.taripBorongan || 0)}</strong></div>
                                    <div className="driver-action-row">
                                        <button
                                            className="btn btn-primary btn-sm"
                                            onClick={() => openTripCreateModal(item)}
                                            disabled={isActionInFlight}
                                        >
                                            <Plus size={15} /> {isBusy ? 'Memproses...' : (tripAllowsDirectCargoInput ? 'Input Surat Jalan' : 'Input SJ')}
                                        </button>
                                        {item.tripOriginArea && item.tripDestinationArea && (
                                            <div className="text-muted text-sm" style={{ flex: 1, lineHeight: 1.5 }}>
                                                Rute {item.tripOriginArea} - {item.tripDestinationArea}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </section>
            )}

            <section className="driver-do-grid">
                {orders.length === 0 ? (
                    <div className="card">
                        <div className="card-body">
                            <div className="empty-state" style={{ padding: '1rem 0' }}>
                                <Truck size={40} className="empty-state-icon" />
                                <div className="empty-state-title">{plannedTrips.length > 0 ? 'Belum ada Surat Jalan aktif' : 'Belum ada surat jalan untuk akun driver ini'}</div>
                                <div className="empty-state-text">
                                    {plannedTrips.length > 0
                                        ? 'Trip yang sudah di-assign ada di kartu atas. Input Surat Jalan dulu supaya perjalanan aktif.'
                                        : 'Hubungi admin jika seharusnya kamu sudah mendapat penugasan DO.'}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    orders.map(item => {
                        const trackingBadge = formatTrackingState(item.trackingState);
                        const isBusy = actionLoadingId === item._id;
                        const canStart = canDriverStartTracking(item.status);
                        const nextProgressStatus = getNextDriverProgressStatus(item);
                        const allowsDirectCargoInput = item.allowsDirectCargoInput !== false;
                        const canManageCargo =
                            item.status !== 'DELIVERED' &&
                            item.status !== 'CANCELLED' &&
                            item.pendingDriverStatus !== 'DELIVERED';
                        const cargoItemCount = item.driverCargoItems?.length || 0;
                        const cargoButtonLabel = allowsDirectCargoInput
                            ? (cargoItemCount > 0 ? 'Tambah Barang' : 'Input Barang')
                            : 'Kelola SJ';
                        const mapsUrl =
                            typeof item.trackingLastLat === 'number' && typeof item.trackingLastLng === 'number'
                                ? `https://www.google.com/maps?q=${item.trackingLastLat},${item.trackingLastLng}`
                                : null;

                        return (
                            <div key={item._id} className={`card driver-do-card ${item.trackingState === 'ACTIVE' ? 'live' : ''}`}>
                                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                                    <div>
                                        <div className="card-header-title">{item.doNumber}</div>
                                        <div className="text-muted text-sm">{item.masterResi || '-'} | {formatDate(item.date)}</div>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'flex-end' }}>
                                        <span className={`badge badge-${DO_STATUS_MAP[item.status]?.color || 'gray'}`}>{DO_STATUS_MAP[item.status]?.label || item.status}</span>
                                        <span className={`badge ${trackingBadge.color}`}>{trackingBadge.label}</span>
                                    </div>
                                </div>
                                <div className="card-body">
                                    <div className="driver-do-meta"><span>Customer</span><strong>{item.customerName || '-'}</strong></div>
                                    <div className="driver-do-meta"><span>SJ Pengirim</span><strong>{getShipperReferenceCount(item) > 0 ? formatShipperDeliveryOrderNumber(item) : '-'}</strong></div>
                                    <div className="driver-do-meta"><span>Tujuan</span><strong>{formatShipperReceiverSummary(item, { fallback: item.receiverAddress || '-' })}</strong></div>
                                    <div className="driver-do-meta"><span>Kendaraan</span><strong>{item.vehiclePlate || '-'}</strong></div>
                                    <div className="driver-do-meta"><span>Muatan</span><strong>{cargoItemCount > 0 ? summarizeDriverOrderCargo(item) : 'Belum diisi'}</strong></div>
                                    <div className="driver-do-meta"><span>Posisi terakhir</span><strong>{item.trackingLastSeenAt ? formatDateTime(item.trackingLastSeenAt) : '-'}</strong></div>
                                    <div className="driver-do-meta"><span>Koordinat</span><strong>{typeof item.trackingLastLat === 'number' && typeof item.trackingLastLng === 'number' ? `${item.trackingLastLat.toFixed(6)}, ${item.trackingLastLng.toFixed(6)}` : '-'}</strong></div>
                                    <div className="driver-do-meta"><span>Akurasi</span><strong>{typeof item.trackingLastAccuracyM === 'number' ? `${Math.round(item.trackingLastAccuracyM)} m` : '-'}</strong></div>

                                    <div className="driver-action-row">
                                        {item.trackingState === 'ACTIVE' ? (
                                            <>
                                                {item.pendingDriverStatus === 'DELIVERED' ? (
                                                    <div className="text-muted text-sm" style={{ flex: 1, lineHeight: 1.5 }}>
                                                        Driver sudah mengajukan selesai. Menunggu approval admin sebelum trip benar-benar ditutup.
                                                    </div>
                                                ) : nextProgressStatus && (
                                                    <button
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => void handleDeliveryProgress(item._id, nextProgressStatus)}
                                                        disabled={isActionInFlight}
                                                    >
                                                        <Truck size={15} /> {isBusy ? 'Memproses...' : getDriverProgressButtonLabel(nextProgressStatus)}
                                                    </button>
                                                )}
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
                                                onClick={() => openCargoInputModal(item)}
                                                disabled={isActionInFlight}
                                            >
                                                <Plus size={15} /> {cargoButtonLabel}
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

            {showTripCreateModal && tripCreateTarget && (
                <div className="modal-overlay" onClick={closeTripCreateModal}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
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
                                                                    maxFractionDigits={item.weightInputUnit === 'TON' ? 3 : 2}
                                                                    value={item.weightInputValue}
                                                                    onValueChange={value => updateTripCreateItem(group.id, itemIndex, 'weightInputValue', value)}
                                                                    disabled={isActionInFlight}
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
                                                        {group.items.length > 1 && (
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
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">
                                    {cargoInputAllowsDirectCargoInput
                                        ? `${(cargoInputOrder.driverCargoItems?.length || 0) > 0 ? 'Tambah Barang' : 'Input Barang'} ${cargoInputOrder.doNumber}`
                                        : `Kelola SJ ${cargoInputOrder.doNumber}`}
                                </h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>
                                    {cargoInputAllowsDirectCargoInput
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
                                    <span>Tujuan</span>
                                    <strong>{formatShipperReceiverSummary(cargoInputOrder, { fallback: cargoInputOrder.receiverName || cargoInputOrder.receiverAddress || '-' })}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Pickup</span>
                                    <strong>{cargoInputOrder.pickupStops?.length ? `${cargoInputOrder.pickupStops.length} titik` : (cargoInputOrder.pickupAddress || '-')}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>{cargoInputAllowsDirectCargoInput ? 'Ringkasan Tambahan' : 'Muatan DO'}</span>
                                    <strong>
                                        {cargoInputDraftItems.length > 0
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
                                    <span>{cargoInputAllowsDirectCargoInput ? 'Barang Dicatat' : 'Input Barang'}</span>
                                    <strong>{cargoInputAllowsDirectCargoInput ? `${cargoInputDraftItems.length} barang` : 'Ikut order'}</strong>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gap: '0.85rem' }}>
                                {cargoInputGroups.map((group, groupIndex) => {
                                    const draftItemsInGroup = getDeliveryOrderCargoDraftItems(group);
                                    return (
                                        <div key={group.id} style={{ display: 'grid', gap: '0.85rem', padding: 12, background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <div>
                                                    <div className="font-semibold">SJ {groupIndex + 1}</div>
                                                    <div className="text-muted text-sm">
                                                        {cargoInputAllowsDirectCargoInput ? `${draftItemsInGroup.length} barang` : 'Muatan ikut order'}
                                                    </div>
                                                </div>
                                                {cargoInputGroups.length > 1 && (
                                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeCargoInputGroup(group.id)} disabled={isActionInFlight}>
                                                        <X size={14} /> Hapus SJ
                                                    </button>
                                                )}
                                            </div>

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

                                            {cargoInputAllowsDirectCargoInput ? (
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
                                                                    maxFractionDigits={item.weightInputUnit === 'TON' ? 3 : 2}
                                                                    value={item.weightInputValue}
                                                                    onValueChange={value => updateCargoInputItem(group.id, itemIndex, 'weightInputValue', value)}
                                                                    disabled={isActionInFlight}
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
                                                    {cargoInputAllowsDirectCargoInput
                                                        ? 'Satu SJ boleh ditambah bertahap selama trip masih aktif.'
                                                        : 'SJ bisa ditambah atau diperbarui selama trip masih aktif.'}
                                                </div>
                                                {cargoInputAllowsDirectCargoInput && (
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
                                    {cargoInputAllowsDirectCargoInput
                                        ? 'Barang boleh ditambah bertahap. Pastikan deskripsi dan muatan sesuai surat jalan yang driver pegang.'
                                        : 'Lengkapi daftar SJ pengirim yang dibawa.'}
                                </div>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={addCargoInputGroup} disabled={isActionInFlight}>
                                    <Plus size={14} /> Tambah SJ
                                </button>
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
                                <Truck size={15} /> {actionLoadingId === cargoInputOrder._id ? 'Menyimpan...' : (cargoInputDraftItems.length > 0 ? 'Simpan SJ & Barang' : 'Simpan SJ')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDeliveredRequestModal && completionOrder && (
                <div className="modal-overlay" onClick={closeDeliveredRequestModal}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">Ajukan Selesai {completionOrder.doNumber}</h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>
                                    Isi barang aktual yang benar-benar sampai supaya admin tinggal review.
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
                                    <span>SJ Pengirim</span>
                                    <strong>{getShipperReferenceCount(completionOrder) > 0 ? formatShipperDeliveryOrderNumber(completionOrder) : '-'}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Tujuan</span>
                                    <strong>{formatShipperReceiverSummary(completionOrder, { fallback: completionOrder.receiverName || completionOrder.receiverAddress || '-' })}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Ringkasan Aktual</span>
                                    <strong>{completionCargoItems.length > 0 ? completionCargoSummary : 'Belum ada item'}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Mode Drop</span>
                                    <strong>{showCompletionAdvancedDropEditor ? `${completionDetailState.actualDropPointCount} titik` : 'Trip normal / 1 tujuan'}</strong>
                                </div>
                            </div>

                            <div className="driver-completion-list">
                                {completionCargoItems.length === 0 ? (
                                    <div className="driver-completion-empty">
                                        Belum ada item muatan di surat jalan ini. Isi barang dulu dari tombol Input Barang sebelum mengajukan selesai.
                                    </div>
                                ) : (
                                    completionCargoItems.map(item => (
                                        <div key={item.deliveryOrderItemRef} className="driver-completion-item">
                                            <div className="driver-completion-item-header">
                                                <div>
                                                    <div className="driver-completion-item-title">{item.description}</div>
                                                    <div className="text-muted text-sm">
                                                        Rencana: {formatCargoSummary({
                                                            qtyKoli: item.plannedQtyKoli,
                                                            weightKg: item.plannedWeightKg,
                                                            weightInputValue: item.plannedWeightInputValue,
                                                            weightInputUnit: item.plannedWeightInputUnit,
                                                            volumeM3: item.plannedVolumeM3,
                                                            volumeInputValue: item.plannedVolumeInputValue,
                                                            volumeInputUnit: item.plannedVolumeInputUnit,
                                                        })}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="driver-completion-metrics">
                                                {item.requireQty && (
                                                    <div className="form-group">
                                                        <label className="form-label">Qty Aktual</label>
                                                        <FormattedNumberInput
                                                            min={0}
                                                            maxFractionDigits={2}
                                                            value={parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 })}
                                                            onValueChange={value => updateCompletionCargoDraft(item.deliveryOrderItemRef, 'actualQtyKoli', String(value))}
                                                            disabled={isActionInFlight}
                                                        />
                                                    </div>
                                                )}

                                                {(item.requireWeight || item.plannedWeightKg > 0) && (
                                                    <div className="form-group">
                                                        <label className="form-label">Berat Aktual</label>
                                                        <div className="driver-completion-unit-row">
                                                            <FormattedNumberInput
                                                                min={0}
                                                                maxFractionDigits={item.actualWeightInputUnit === 'TON' ? 3 : 2}
                                                                value={parseFormattedNumberish(item.actualWeightInputValue || 0, {
                                                                    maxFractionDigits: item.actualWeightInputUnit === 'TON' ? 3 : 2,
                                                                })}
                                                                onValueChange={value => updateCompletionCargoDraft(item.deliveryOrderItemRef, 'actualWeightInputValue', String(value))}
                                                                disabled={isActionInFlight}
                                                            />
                                                            <select
                                                                className="form-select"
                                                                value={item.actualWeightInputUnit}
                                                                onChange={event => updateCompletionCargoWeightUnit(item.deliveryOrderItemRef, event.target.value as ActualCargoDraft['actualWeightInputUnit'])}
                                                                disabled={isActionInFlight}
                                                            >
                                                                {WEIGHT_INPUT_UNIT_OPTIONS.map(option => (
                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                )}

                                                {(item.requireVolume || (item.plannedVolumeM3 || 0) > 0) && (
                                                    <div className="form-group">
                                                        <label className="form-label">Volume Aktual</label>
                                                        <div className="driver-completion-unit-row">
                                                            <FormattedNumberInput
                                                                min={0}
                                                                maxFractionDigits={item.actualVolumeInputUnit === 'LITER' ? 0 : 3}
                                                                value={parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                                                                    maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                                                                })}
                                                                onValueChange={value => updateCompletionCargoDraft(item.deliveryOrderItemRef, 'actualVolumeInputValue', String(value))}
                                                                disabled={isActionInFlight}
                                                            />
                                                            <select
                                                                className="form-select"
                                                                value={item.actualVolumeInputUnit}
                                                                onChange={event => updateCompletionCargoVolumeUnit(item.deliveryOrderItemRef, event.target.value as ActualCargoDraft['actualVolumeInputUnit'])}
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
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="form-group" style={{ marginTop: '1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                    <label className="form-label" style={{ marginBottom: 0 }}>Realisasi Titik Drop <span className="required">*</span></label>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setShowCompletionAdvancedDropEditor(previous => !previous)}
                                        disabled={isActionInFlight}
                                    >
                                        {showCompletionAdvancedDropEditor ? 'Tutup Detail Drop' : 'Ada Multi-drop / Hold / Extra Drop'}
                                    </button>
                                </div>
                                <div className="text-muted text-sm" style={{ marginBottom: '0.75rem' }}>
                                    Untuk trip normal, semua muatan aktual turun di {completionDetailState.autoActualDropDraft.locationName || 'tujuan tagihan'}.
                                </div>
                                {completionDetailState.actualDropMismatchMessage && (
                                    <div style={{ background: 'var(--color-danger-light)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-danger)' }}>
                                        {completionDetailState.actualDropMismatchMessage} Muatan aktual {formatCargoSummary(completionDetailState.actualCargoTotals)} tetapi alokasi drop baru {formatCargoSummary(completionDetailState.actualDropTotals)}.
                                    </div>
                                )}
                                {!showCompletionAdvancedDropEditor ? (
                                    <div className="driver-completion-item">
                                        <div className="driver-completion-item-header">
                                            <div>
                                                <div className="driver-completion-item-title">Realisasi Default</div>
                                                <div className="text-muted text-sm">
                                                    {completionDetailState.autoActualDropDraft.locationName || 'Tujuan Tagihan'}
                                                    {completionDetailState.autoActualDropDraft.locationAddress ? ` • ${completionDetailState.autoActualDropDraft.locationAddress}` : ''}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-muted text-sm">
                                            {formatCargoSummary({
                                                qtyKoli: completionDetailState.actualCargoTotals.qtyKoli,
                                                weightKg: completionDetailState.actualCargoTotals.weightKg,
                                                volumeM3: completionDetailState.actualCargoTotals.volumeM3,
                                            })}
                                        </div>
                                        <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                            Barang: {getCompletionDropCargoSummary(completionDetailState.autoActualDropDraft)}
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={addCompletionDropDraft} disabled={isActionInFlight}>
                                                <Plus size={14} /> Tambah Titik Drop
                                            </button>
                                        </div>
                                        {completionDropPoints.map((item, index) => (
                                            <div key={item.draftKey} className="driver-completion-item">
                                                <div className="driver-completion-item-header">
                                                    <div>
                                                        <div className="driver-completion-item-title">Titik Drop {index + 1}</div>
                                                    </div>
                                                    {completionDropPoints.length > 1 && (
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
                                                <div className="driver-completion-metrics">
                                                    {completionShipperReferences.length > 0 && (
                                                        <div className="form-group">
                                                            <label className="form-label">No. SJ / Barang</label>
                                                            <select
                                                                className="form-select"
                                                                value={resolveCompletionDropShipperReferenceValue(item)}
                                                                onChange={event => applyCompletionDropShipperReference(item.draftKey, event.target.value)}
                                                                disabled={isActionInFlight}
                                                            >
                                                                <option value="">Tidak spesifik / semua barang</option>
                                                                {completionShipperReferences.map(reference => {
                                                                    const optionValue = reference._key || reference.referenceNumber || '';
                                                                    return (
                                                                        <option key={optionValue} value={optionValue}>
                                                                            {reference.referenceNumber || '-'}
                                                                            {reference.receiverCompany || reference.receiverName ? ` - ${reference.receiverCompany || reference.receiverName}` : ''}
                                                                        </option>
                                                                    );
                                                                })}
                                                            </select>
                                                            <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                                                Barang: {getCompletionDropCargoSummary(item)}
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div className="form-group">
                                                        <label className="form-label">Tipe Titik</label>
                                                        <select
                                                            className="form-select"
                                                            value={item.stopType}
                                                            onChange={event => updateCompletionDropDraft(item.draftKey, 'stopType', event.target.value)}
                                                            disabled={isActionInFlight}
                                                        >
                                                            <option value="DROP">Drop</option>
                                                            <option value="HOLD">Hold</option>
                                                            <option value="TRANSIT">Transit</option>
                                                            <option value="EXTRA_DROP">Extra Drop</option>
                                                            <option value="RETURN">Return</option>
                                                        </select>
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Nama Lokasi</label>
                                                        <input
                                                            className="form-input"
                                                            value={item.locationName}
                                                            onChange={event => updateCompletionDropDraft(item.draftKey, 'locationName', event.target.value)}
                                                            disabled={isActionInFlight}
                                                            placeholder="Mis. Gudang transit / tujuan drop"
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
                                                    <div className="form-group">
                                                        <label className="form-label">Qty</label>
                                                        <FormattedNumberInput
                                                            min={0}
                                                            maxFractionDigits={2}
                                                            value={parseFormattedNumberish(item.qtyKoli || 0, { maxFractionDigits: 2 })}
                                                            onValueChange={value => updateCompletionDropDraft(item.draftKey, 'qtyKoli', String(value))}
                                                            disabled={isActionInFlight}
                                                        />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Berat</label>
                                                        <div className="driver-completion-unit-row">
                                                            <FormattedNumberInput
                                                                min={0}
                                                                maxFractionDigits={item.weightInputUnit === 'TON' ? 3 : 2}
                                                                value={parseFormattedNumberish(item.weightInputValue || 0, { maxFractionDigits: item.weightInputUnit === 'TON' ? 3 : 2 })}
                                                                onValueChange={value => updateCompletionDropDraft(item.draftKey, 'weightInputValue', String(value))}
                                                                disabled={isActionInFlight}
                                                            />
                                                            <select
                                                                className="form-select"
                                                                value={item.weightInputUnit}
                                                                onChange={event => updateCompletionDropDraft(item.draftKey, 'weightInputUnit', event.target.value)}
                                                                disabled={isActionInFlight}
                                                            >
                                                                {WEIGHT_INPUT_UNIT_OPTIONS.map(option => (
                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Volume</label>
                                                        <div className="driver-completion-unit-row">
                                                            <FormattedNumberInput
                                                                min={0}
                                                                maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3}
                                                                value={parseFormattedNumberish(item.volumeInputValue || 0, { maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3 })}
                                                                onValueChange={value => updateCompletionDropDraft(item.draftKey, 'volumeInputValue', String(value))}
                                                                disabled={isActionInFlight}
                                                            />
                                                            <select
                                                                className="form-select"
                                                                value={item.volumeInputUnit}
                                                                onChange={event => updateCompletionDropDraft(item.draftKey, 'volumeInputUnit', event.target.value)}
                                                                disabled={isActionInFlight}
                                                            >
                                                                {VOLUME_INPUT_UNIT_OPTIONS.map(option => (
                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                                        <label className="form-label">Catatan</label>
                                                        <textarea
                                                            className="form-textarea"
                                                            rows={2}
                                                            value={item.note}
                                                            onChange={event => updateCompletionDropDraft(item.draftKey, 'note', event.target.value)}
                                                            disabled={isActionInFlight}
                                                            placeholder="Opsional: parsial, hold, transit, dll."
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

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
                            <button className="btn btn-secondary" onClick={closeDeliveredRequestModal} disabled={isActionInFlight}>
                                Batal
                            </button>
                            <button
                                className="btn btn-success"
                                onClick={() => void submitDeliveredRequest()}
                                disabled={isActionInFlight || completionCargoItems.length === 0 || !completionCargoReady || !completionDetailState.actualDropReady}
                            >
                                <Truck size={15} /> {actionLoadingId === completionOrder._id ? 'Mengirim...' : 'Ajukan Selesai'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
