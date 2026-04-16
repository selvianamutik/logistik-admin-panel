'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    Loader2,
    LogOut,
    MapPin,
    Plus,
    PlayCircle,
    RefreshCw,
    Smartphone,
    Truck,
} from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import {
    buildActualCargoDrafts,
    updateActualCargoDraftVolumeUnit,
    updateActualCargoDraftWeightUnit,
    type ActualCargoDraft,
} from '@/lib/delivery-order-detail-support';
import { parseFormattedNumberish } from '@/lib/formatted-number';
import { VOLUME_INPUT_UNIT_OPTIONS, WEIGHT_INPUT_UNIT_OPTIONS, formatCargoSummary } from '@/lib/measurement';
import {
    createDefaultOrderItemForm,
    summarizeDraftOrderCargo,
    updateOrderItemVolumeUnit,
    updateOrderItemWeightUnit,
    type OrderItemForm,
} from '@/lib/order-create-page-support';
import { DO_STATUS_MAP, formatDate, formatDateTime } from '@/lib/utils';
import type { Driver, SessionUser } from '@/lib/types';
import type { DriverAssignedDeliveryOrder } from '@/lib/api/driver-portal';

type DriverSessionResponse = {
    user: SessionUser;
    driver: Driver;
    company: { _id: string; name: string; phone?: string; themeColor?: string } | null;
};

type DriverPortalError = Error & { status?: number };
type DriverProgressStatus = Extract<DriverAssignedDeliveryOrder['status'], 'ON_DELIVERY' | 'ARRIVED' | 'DELIVERED'>;
type DriverCargoInputItem = OrderItemForm & {
    shipperReferenceNumber: string;
    pickupStopKey: string;
};

function createDefaultDriverCargoInputItem(defaultPickupStopKey = ''): DriverCargoInputItem {
    return {
        ...createDefaultOrderItemForm(),
        shipperReferenceNumber: '',
        pickupStopKey: defaultPickupStopKey,
    };
}

function getDraftDriverCargoInputItems(items: DriverCargoInputItem[]) {
    return items.filter(item =>
        item.description.trim() ||
        item.customerProductRef ||
        item.qtyKoli > 0 ||
        item.weightInputValue > 0 ||
        item.volumeInputValue > 0
    );
}

function createDriverPortalError(status: number, message: string) {
    const error = new Error(message) as DriverPortalError;
    error.status = status;
    return error;
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
    const [loading, setLoading] = useState(true);
    const [loggingOut, setLoggingOut] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'error' | 'success' | 'info'; message: string } | null>(null);
    const [showDeliveredRequestModal, setShowDeliveredRequestModal] = useState(false);
    const [completionOrderId, setCompletionOrderId] = useState<string | null>(null);
    const [completionNote, setCompletionNote] = useState('');
    const [completionCargoItems, setCompletionCargoItems] = useState<ActualCargoDraft[]>([]);
    const [showCargoInputModal, setShowCargoInputModal] = useState(false);
    const [cargoInputOrderId, setCargoInputOrderId] = useState<string | null>(null);
    const [cargoInputItems, setCargoInputItems] = useState<DriverCargoInputItem[]>([createDefaultDriverCargoInputItem()]);

    const handleDriverAuthFailure = useCallback((message = 'Sesi driver berakhir. Silakan login ulang.') => {
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
    const cargoInputOrder = useMemo(
        () => orders.find(item => item._id === cargoInputOrderId) || null,
        [cargoInputOrderId, orders]
    );
    const completionCargoReady = useMemo(
        () => areActualCargoDraftsReady(completionCargoItems),
        [completionCargoItems]
    );
    const cargoInputDraftItems = useMemo(
        () => getDraftDriverCargoInputItems(cargoInputItems),
        [cargoInputItems]
    );
    const cargoInputSummary = useMemo(
        () => summarizeDraftOrderCargo(cargoInputItems),
        [cargoInputItems]
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

    const applyOrderUpdate = useCallback((updated: DriverAssignedDeliveryOrder) => {
        setOrders(prev => prev.map(item => (item._id === updated._id ? { ...item, ...updated } : item)));
    }, []);

    const loadOrders = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
        if (mode === 'refresh') {
            setRefreshing(true);
        }

        try {
            const res = await fetch('/api/driver/delivery-orders');
            const payload = await res.json();
            if (!res.ok) {
                throw createDriverPortalError(res.status, payload.error || 'Gagal memuat surat jalan driver');
            }
            setOrders(payload.data || []);
        } catch (error) {
            if (error instanceof Error && 'status' in error && (error.status === 401 || error.status === 403)) {
                handleDriverAuthFailure();
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

    useEffect(() => {
        const loadDriverPortal = async () => {
            setLoading(true);
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
                if (error instanceof Error && 'status' in error && (error.status === 401 || error.status === 403)) {
                    handleDriverAuthFailure(error.message);
                    return;
                }
                setFeedback({
                    type: 'error',
                    message: error instanceof Error ? error.message : 'Gagal memuat aplikasi driver',
                });
                router.replace('/driver/login');
            } finally {
                setLoading(false);
            }
        };

        void loadDriverPortal();
    }, [handleDriverAuthFailure, loadOrders, router]);

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
                    if (error instanceof Error && 'status' in error && (error.status === 401 || error.status === 403)) {
                        handleDriverAuthFailure(error.message);
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
                        if (error instanceof Error && 'status' in error) {
                            if (error.status === 401 || error.status === 403) {
                                handleDriverAuthFailure();
                                return;
                            }
                            if (error.status === 409) {
                                setFeedback({ type: 'info', message: error.message });
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
        setCompletionOrderId(order._id);
        setCompletionNote(order.pendingDriverStatusNote || '');
        setCompletionCargoItems(
            buildActualCargoDrafts(order.driverCargoItems || [], order.pendingDriverActualCargoItems)
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
    }, [actionLoadingId]);

    const openCargoInputModal = useCallback((order: DriverAssignedDeliveryOrder) => {
        const defaultPickupStopKey = order.pickupStops?.[0]?._key || '';
        setCargoInputOrderId(order._id);
        setCargoInputItems([createDefaultDriverCargoInputItem(defaultPickupStopKey)]);
        setShowCargoInputModal(true);
    }, []);

    const closeCargoInputModal = useCallback(() => {
        if (actionLoadingId) {
            return;
        }
        setShowCargoInputModal(false);
        setCargoInputOrderId(null);
        setCargoInputItems([createDefaultDriverCargoInputItem()]);
    }, [actionLoadingId]);

    const updateCargoInputItem = useCallback((
        index: number,
        field: keyof Pick<DriverCargoInputItem, 'description' | 'qtyKoli' | 'weightInputValue' | 'volumeInputValue' | 'shipperReferenceNumber' | 'pickupStopKey'>,
        value: string | number
    ) => {
        setCargoInputItems(previous =>
            previous.map((item, itemIndex) => (
                itemIndex === index
                    ? { ...item, [field]: value }
                    : item
            ))
        );
    }, []);

    const addCargoInputItem = useCallback(() => {
        setCargoInputItems(previous => [
            ...previous,
            createDefaultDriverCargoInputItem(cargoInputOrder?.pickupStops?.[0]?._key || ''),
        ]);
    }, [cargoInputOrder]);

    const removeCargoInputItem = useCallback((index: number) => {
        setCargoInputItems(previous => {
            if (previous.length <= 1) {
                return [createDefaultDriverCargoInputItem(cargoInputOrder?.pickupStops?.[0]?._key || '')];
            }
            return previous.filter((_, itemIndex) => itemIndex !== index);
        });
    }, [cargoInputOrder]);

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
            });
            setFeedback({ type: 'success', message: getDriverProgressSuccessMessage('DELIVERED') });
            await loadOrders();
            setShowDeliveredRequestModal(false);
            setCompletionOrderId(null);
            setCompletionNote('');
            setCompletionCargoItems([]);
        } catch (error) {
            if (error instanceof Error && 'status' in error && (error.status === 401 || error.status === 403)) {
                handleDriverAuthFailure(error.message);
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
        if (cargoInputDraftItems.length === 0) {
            setFeedback({ type: 'error', message: 'Isi minimal 1 barang sebelum disimpan ke surat jalan.' });
            return;
        }
        const invalidReferenceRow = cargoInputDraftItems.findIndex(item => !item.shipperReferenceNumber.trim());
        if (invalidReferenceRow >= 0) {
            setFeedback({ type: 'error', message: `No. SJ pengirim wajib diisi pada baris barang ${invalidReferenceRow + 1}.` });
            return;
        }
        if ((cargoInputOrder.pickupStops?.length || 0) > 1) {
            const invalidPickupRow = cargoInputDraftItems.findIndex(item => !item.pickupStopKey);
            if (invalidPickupRow >= 0) {
                setFeedback({ type: 'error', message: `Titik pickup wajib dipilih pada baris barang ${invalidPickupRow + 1}.` });
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
                    cargoItems: cargoInputDraftItems.map(item => ({
                        customerProductRef: item.customerProductRef || undefined,
                        description: item.description,
                        qtyKoli: item.qtyKoli,
                        weightInputValue: item.weightInputValue,
                        weightInputUnit: item.weightInputUnit,
                        volumeInputValue: item.volumeInputValue,
                        volumeInputUnit: item.volumeInputUnit,
                        shipperReferenceNumber: item.shipperReferenceNumber.trim().toUpperCase(),
                        pickupStopKey: item.pickupStopKey || undefined,
                    })),
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw createDriverPortalError(response.status, payload?.error || 'Gagal menambah barang ke surat jalan');
            }

            setFeedback({
                type: 'success',
                message: `${payload?.data?.appendedCount || cargoInputDraftItems.length} barang ditambahkan ke surat jalan.`,
            });
            await loadOrders();
            setShowCargoInputModal(false);
            setCargoInputOrderId(null);
            setCargoInputItems([createDefaultDriverCargoInputItem()]);
        } catch (error) {
            if (error instanceof Error && 'status' in error && (error.status === 401 || error.status === 403)) {
                handleDriverAuthFailure(error.message);
                return;
            }
            setFeedback({
                type: 'error',
                message: error instanceof Error ? error.message : 'Gagal menambah barang ke surat jalan',
            });
        } finally {
            setActionLoadingId(null);
        }
    }, [cargoInputDraftItems, cargoInputOrder, handleDriverAuthFailure, loadOrders]);

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
                if (error instanceof Error && 'status' in error && (error.status === 401 || error.status === 403)) {
                    handleDriverAuthFailure(error.message);
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
                    Lokasi akan terkirim selama halaman ini tetap terbuka di HP, internet aktif, dan izin lokasi GPS menyala.
                    Kalau aplikasi/browser ditutup total, tracking live tidak akan terus berjalan di background. Driver juga tidak bisa
                    menghentikan tracking sendiri sebelum admin menutup DO.
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

            <section className="driver-do-grid">
                {orders.length === 0 ? (
                    <div className="card">
                        <div className="card-body">
                            <div className="empty-state" style={{ padding: '1rem 0' }}>
                                <Truck size={40} className="empty-state-icon" />
                                <div className="empty-state-title">Belum ada surat jalan untuk akun driver ini</div>
                                <div className="empty-state-text">Hubungi admin jika seharusnya kamu sudah mendapat penugasan DO.</div>
                            </div>
                        </div>
                    </div>
                ) : (
                    orders.map(item => {
                        const trackingBadge = formatTrackingState(item.trackingState);
                        const isBusy = actionLoadingId === item._id;
                        const canStart = canDriverStartTracking(item.status);
                        const nextProgressStatus = getNextDriverProgressStatus(item);
                        const canManageCargo =
                            item.status !== 'DELIVERED' &&
                            item.status !== 'CANCELLED' &&
                            item.pendingDriverStatus !== 'DELIVERED';
                        const cargoItemCount = item.driverCargoItems?.length || 0;
                        const cargoButtonLabel = cargoItemCount > 0 ? 'Tambah Barang' : 'Input Barang';
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
                                    <div className="driver-do-meta"><span>Tujuan</span><strong>{item.receiverAddress || '-'}</strong></div>
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

            {showCargoInputModal && cargoInputOrder && (
                <div className="modal-overlay" onClick={closeCargoInputModal}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">{(cargoInputOrder.driverCargoItems?.length || 0) > 0 ? 'Tambah Barang' : 'Input Barang'} {cargoInputOrder.doNumber}</h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>
                                    Isi manifest yang sudah driver terima. Barang ini akan langsung masuk ke Surat Jalan aktif.
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
                                    <span>Tujuan</span>
                                    <strong>{cargoInputOrder.receiverName || cargoInputOrder.receiverAddress || '-'}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Pickup</span>
                                    <strong>{cargoInputOrder.pickupStops?.length ? `${cargoInputOrder.pickupStops.length} titik` : (cargoInputOrder.pickupAddress || '-')}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Ringkasan Tambahan</span>
                                    <strong>{cargoInputDraftItems.length > 0 ? formatCargoSummary(cargoInputSummary) : 'Belum ada barang'}</strong>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gap: '0.85rem' }}>
                                {cargoInputItems.map((item, index) => (
                                    <div
                                        key={`driver-cargo-input-${index}`}
                                        style={{
                                            display: 'flex',
                                            gap: 12,
                                            alignItems: 'flex-end',
                                            flexWrap: 'wrap',
                                            padding: 12,
                                            background: 'var(--color-gray-50)',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--color-gray-200)',
                                        }}
                                    >
                                        {(cargoInputOrder.pickupStops?.length || 0) > 0 && (
                                            <div style={{ flex: '1 1 240px' }}>
                                                <label className="form-label">Titik Pickup</label>
                                                <select
                                                    className="form-select"
                                                    value={item.pickupStopKey}
                                                    onChange={event => updateCargoInputItem(index, 'pickupStopKey', event.target.value)}
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
                                                value={item.shipperReferenceNumber}
                                                onChange={event => updateCargoInputItem(index, 'shipperReferenceNumber', event.target.value.toUpperCase())}
                                                placeholder="Masukkan nomor surat jalan pengirim"
                                                disabled={isActionInFlight}
                                            />
                                        </div>
                                        <div style={{ flex: '2 1 260px' }}>
                                            <label className="form-label">Deskripsi Barang</label>
                                            <input
                                                className="form-input"
                                                value={item.description}
                                                onChange={event => updateCargoInputItem(index, 'description', event.target.value)}
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
                                                onValueChange={value => updateCargoInputItem(index, 'qtyKoli', value)}
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
                                                    onValueChange={value => updateCargoInputItem(index, 'weightInputValue', value)}
                                                    disabled={isActionInFlight}
                                                />
                                                <select
                                                    className="form-select"
                                                    value={item.weightInputUnit}
                                                    onChange={event => setCargoInputItems(previous => previous.map((entry, entryIndex) => (
                                                        entryIndex === index ? { ...entry, ...updateOrderItemWeightUnit(entry, event.target.value as DriverCargoInputItem['weightInputUnit']) } : entry
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
                                                    onValueChange={value => updateCargoInputItem(index, 'volumeInputValue', value)}
                                                    disabled={isActionInFlight}
                                                />
                                                <select
                                                    className="form-select"
                                                    value={item.volumeInputUnit}
                                                    onChange={event => setCargoInputItems(previous => previous.map((entry, entryIndex) => (
                                                        entryIndex === index ? { ...entry, ...updateOrderItemVolumeUnit(entry, event.target.value as DriverCargoInputItem['volumeInputUnit']) } : entry
                                                    )))}
                                                    disabled={isActionInFlight}
                                                >
                                                    {VOLUME_INPUT_UNIT_OPTIONS.map(option => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        {cargoInputItems.length > 1 && (
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-icon-only"
                                                onClick={() => removeCargoInputItem(index)}
                                                disabled={isActionInFlight}
                                                style={{ marginBottom: 4 }}
                                            >
                                                &times;
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                                <div className="text-muted text-sm">
                                    Barang boleh ditambah bertahap. Pastikan deskripsi dan muatan sesuai surat jalan yang driver pegang.
                                </div>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={addCargoInputItem} disabled={isActionInFlight}>
                                    <Plus size={14} /> Tambah Baris
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
                                disabled={isActionInFlight || cargoInputDraftItems.length === 0}
                            >
                                <Truck size={15} /> {actionLoadingId === cargoInputOrder._id ? 'Menyimpan...' : 'Simpan Barang'}
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
                                    <span>Tujuan</span>
                                    <strong>{completionOrder.receiverName || completionOrder.receiverAddress || '-'}</strong>
                                </div>
                                <div className="driver-completion-summary-card">
                                    <span>Ringkasan Aktual</span>
                                    <strong>{completionCargoItems.length > 0 ? completionCargoSummary : 'Belum ada item'}</strong>
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
                                disabled={isActionInFlight || completionCargoItems.length === 0 || !completionCargoReady}
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
