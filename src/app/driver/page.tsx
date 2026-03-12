'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    Loader2,
    LogOut,
    MapPin,
    Navigation,
    PauseCircle,
    PlayCircle,
    RefreshCw,
    Smartphone,
    Truck,
} from 'lucide-react';

import { DO_STATUS_MAP, formatDate, formatDateTime } from '@/lib/utils';
import type { DeliveryOrder, Driver, SessionUser } from '@/lib/types';

type DriverSessionResponse = {
    user: SessionUser;
    driver: Driver;
    company: { _id: string; name: string; phone?: string; themeColor?: string } | null;
};

type DriverPortalError = Error & { status?: number };

function createDriverPortalError(status: number, message: string) {
    const error = new Error(message) as DriverPortalError;
    error.status = status;
    return error;
}

function formatTrackingState(state?: DeliveryOrder['trackingState']) {
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

export default function DriverPortalPage() {
    const router = useRouter();
    const intervalRef = useRef<number | null>(null);
    const heartbeatInFlightRef = useRef(false);

    const [user, setUser] = useState<SessionUser | null>(null);
    const [driver, setDriver] = useState<Driver | null>(null);
    const [companyName, setCompanyName] = useState('LOGISTIK');
    const [orders, setOrders] = useState<DeliveryOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'error' | 'success' | 'info'; message: string } | null>(null);

    const handleDriverAuthFailure = useCallback((message = 'Sesi driver berakhir. Silakan login ulang.') => {
        setFeedback({ type: 'error', message });
        router.replace('/driver/login');
    }, [router]);

    const activeTrackingDo = useMemo(
        () => orders.find(item => item.trackingState === 'ACTIVE') || null,
        [orders]
    );
    const isActionInFlight = Boolean(actionLoadingId);

    const applyOrderUpdate = useCallback((updated: DeliveryOrder) => {
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
                setCompanyName(sessionPayload.company?.name || 'LOGISTIK');
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
            action: 'start' | 'heartbeat' | 'pause' | 'resume' | 'stop',
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
                applyOrderUpdate(payload.data as DeliveryOrder);
            }

            return payload.data as DeliveryOrder | undefined;
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
                        message: resume ? 'Tracking dilanjutkan.' : 'Tracking live dimulai. Biar akurat, biarkan halaman ini tetap terbuka di HP.',
                    });
                    await loadOrders();
                } catch (error) {
                    setFeedback({
                        type: 'error',
                        message: error instanceof Error ? error.message : 'Gagal memulai tracking',
                    });
                } finally {
                    setActionLoadingId(null);
                }
            });
        },
        [loadOrders, postTrackingAction, withCurrentPosition]
    );

    const runSimpleTrackingAction = useCallback(
        async (action: 'pause' | 'stop', deliveryOrderRef: string) => {
            setActionLoadingId(deliveryOrderRef);
            try {
                await postTrackingAction(action, deliveryOrderRef);
                setFeedback({
                    type: 'success',
                    message: action === 'pause' ? 'Tracking dijeda.' : 'Tracking dihentikan.',
                });
                await loadOrders();
            } catch (error) {
                setFeedback({
                    type: 'error',
                    message: error instanceof Error ? error.message : 'Gagal memperbarui tracking',
                });
            } finally {
                setActionLoadingId(null);
            }
        },
        [loadOrders, postTrackingAction]
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
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/driver/login');
        router.refresh();
    };

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
                <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
                    <LogOut size={15} /> Keluar
                </button>
            </section>

            <section className="driver-hint-card">
                <div className="driver-hint-title">
                    <Smartphone size={18} />
                    Tracking live v1
                </div>
                <p>
                    Lokasi akan terkirim selama halaman ini tetap terbuka di HP, internet aktif, dan izin lokasi GPS menyala.
                    Kalau aplikasi/browser ditutup total, tracking live tidak akan terus berjalan di background.
                </p>
                {feedback && <div className={`driver-feedback ${feedback.type}`}>{feedback.message}</div>}
            </section>

            <section className="driver-toolbar">
                <div className="driver-toolbar-text">
                    {activeTrackingDo ? (
                        <>Tracking aktif di <strong>{activeTrackingDo.doNumber}</strong></>
                    ) : (
                        <>Belum ada tracking aktif</>
                    )}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => void loadOrders()} disabled={refreshing}>
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
                        const canStart = item.status === 'CREATED' || item.status === 'ON_DELIVERY';
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
                                    <div className="driver-do-meta"><span>Posisi terakhir</span><strong>{item.trackingLastSeenAt ? formatDateTime(item.trackingLastSeenAt) : '-'}</strong></div>
                                    <div className="driver-do-meta"><span>Koordinat</span><strong>{typeof item.trackingLastLat === 'number' && typeof item.trackingLastLng === 'number' ? `${item.trackingLastLat.toFixed(6)}, ${item.trackingLastLng.toFixed(6)}` : '-'}</strong></div>
                                    <div className="driver-do-meta"><span>Akurasi</span><strong>{typeof item.trackingLastAccuracyM === 'number' ? `${Math.round(item.trackingLastAccuracyM)} m` : '-'}</strong></div>

                                    <div className="driver-action-row">
                                        {item.trackingState === 'ACTIVE' ? (
                                            <>
                                                <button className="btn btn-warning btn-sm" onClick={() => void runSimpleTrackingAction('pause', item._id)} disabled={isActionInFlight}>
                                                    <PauseCircle size={15} /> {isBusy ? 'Memproses...' : 'Jeda'}
                                                </button>
                                                <button className="btn btn-secondary btn-sm" onClick={() => void runSimpleTrackingAction('stop', item._id)} disabled={isActionInFlight}>
                                                    <Navigation size={15} /> {isBusy ? 'Memproses...' : 'Stop'}
                                                </button>
                                            </>
                                        ) : item.trackingState === 'PAUSED' ? (
                                            <>
                                                <button className="btn btn-primary btn-sm" onClick={() => startTracking(item._id, true)} disabled={isActionInFlight}>
                                                    <PlayCircle size={15} /> {isBusy ? 'Memproses...' : 'Lanjut'}
                                                </button>
                                                <button className="btn btn-secondary btn-sm" onClick={() => void runSimpleTrackingAction('stop', item._id)} disabled={isActionInFlight}>
                                                    <Navigation size={15} /> {isBusy ? 'Memproses...' : 'Stop'}
                                                </button>
                                            </>
                                        ) : (
                                            <button className="btn btn-primary btn-sm" onClick={() => startTracking(item._id)} disabled={isActionInFlight || !canStart || Boolean(activeTrackingDo && activeTrackingDo._id !== item._id)}>
                                                <PlayCircle size={15} /> {isBusy ? 'Memproses...' : 'Mulai Tracking'}
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
        </main>
    );
}
