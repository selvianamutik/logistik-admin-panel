import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchDriverDeliveryOrders, fetchDriverSession, loginDriver, postTrackingAction } from './src/api';
import { clearActiveTrackingContext, clearAuthToken, getActiveTrackingContext, getAuthToken, setAuthToken } from './src/storage';
import {
  getCurrentLocation,
  isBackgroundTrackingRunning,
  requestTrackingPermissions,
  startBackgroundTracking,
  stopBackgroundTracking,
} from './src/tracking';
import type { CompanySummary, DeliveryOrder, Driver, DriverUser } from './src/types';

function formatDateTime(value?: string) {
  if (!value) return '-';

  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDate(value?: string) {
  if (!value) return '-';

  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function trackingLabel(order: DeliveryOrder) {
  switch (order.trackingState) {
    case 'ACTIVE':
      return { label: 'Tracking Aktif', color: '#0f766e' };
    case 'PAUSED':
      return { label: 'Tracking Dijeda', color: '#b45309' };
    case 'STOPPED':
      return { label: 'Tracking Selesai', color: '#475569' };
    default:
      return { label: 'Belum Tracking', color: '#64748b' };
  }
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionOrderId, setActionOrderId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<DriverUser | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [company, setCompany] = useState<CompanySummary>(null);
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [trackingRuntimeHealthy, setTrackingRuntimeHealthy] = useState(true);

  const activeOrder = useMemo(
    () => orders.find((item) => item.trackingState === 'ACTIVE') || null,
    [orders],
  );

  const syncLocalTrackingState = useCallback(async (deliveryOrders: DeliveryOrder[]) => {
    const activeTrackedOrder = deliveryOrders.find((item) => item.trackingState === 'ACTIVE') || null;
    const [localTrackingRunning, localTrackingContext] = await Promise.all([
      isBackgroundTrackingRunning(),
      getActiveTrackingContext(),
    ]);

    if (!activeTrackedOrder) {
      if (localTrackingRunning) {
        await stopBackgroundTracking();
      } else if (localTrackingContext) {
        await clearActiveTrackingContext();
      }
      setTrackingRuntimeHealthy(true);
      return;
    }

    const trackingMatchesOrder = localTrackingContext?.deliveryOrderRef === activeTrackedOrder._id;
    setTrackingRuntimeHealthy(localTrackingRunning && trackingMatchesOrder);
  }, []);

  const hydrateDriverApp = useCallback(async (sessionToken: string, mode: 'boot' | 'refresh' = 'refresh') => {
    if (mode === 'refresh') {
      setRefreshing(true);
    }

    try {
      const [sessionPayload, deliveryOrders] = await Promise.all([
        fetchDriverSession(sessionToken),
        fetchDriverDeliveryOrders(sessionToken),
      ]);

      setTokenState(sessionToken);
      setUser(sessionPayload.user);
      setDriver(sessionPayload.driver);
      setCompany(sessionPayload.company);
      setOrders(deliveryOrders);
      await syncLocalTrackingState(deliveryOrders);
      setError(null);
    } catch (requestError) {
      const nextError = requestError instanceof Error ? requestError : new Error('Gagal memuat aplikasi driver');
      if ('status' in nextError && (nextError.status === 401 || nextError.status === 403)) {
        await clearAuthToken();
        setTokenState(null);
        setUser(null);
        setDriver(null);
        setOrders([]);
        setTrackingRuntimeHealthy(true);
      }
      setError(nextError.message);
    } finally {
      if (mode === 'refresh') {
        setRefreshing(false);
      }
      if (mode === 'boot') {
        setBooting(false);
      }
    }
  }, [syncLocalTrackingState]);

  useEffect(() => {
    void (async () => {
      const storedToken = await getAuthToken();
      if (!storedToken) {
        setBooting(false);
        return;
      }

      await hydrateDriverApp(storedToken, 'boot');
    })();
  }, [hydrateDriverApp]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && token) {
        void hydrateDriverApp(token);
      }
    });

    return () => subscription.remove();
  }, [hydrateDriverApp, token]);

  const handleLogin = useCallback(async () => {
    if (!email.trim() || !password) {
      setError('Email dan password wajib diisi.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = await loginDriver(email.trim(), password);
      await setAuthToken(payload.token);
      setPassword('');
      await hydrateDriverApp(payload.token);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Login gagal');
    } finally {
      setSubmitting(false);
    }
  }, [email, hydrateDriverApp, password]);

  const refreshOrders = useCallback(async () => {
    if (!token) return;
    await hydrateDriverApp(token);
  }, [hydrateDriverApp, token]);

  const handleTrackingAction = useCallback(async (order: DeliveryOrder, action: 'start' | 'resume' | 'pause' | 'stop') => {
    if (!token) return;

    setActionOrderId(order._id);
    try {
      if (action === 'start' || action === 'resume') {
        await requestTrackingPermissions();
        const currentPosition = await getCurrentLocation();

        await postTrackingAction(token, order._id, action, {
          latitude: currentPosition.coords.latitude,
          longitude: currentPosition.coords.longitude,
          accuracyM: currentPosition.coords.accuracy,
          speedMps: currentPosition.coords.speed,
        });

        try {
          await startBackgroundTracking(order._id);
        } catch (trackingError) {
          await postTrackingAction(token, order._id, 'stop');
          throw trackingError;
        }
      } else {
        await postTrackingAction(token, order._id, action);
        await stopBackgroundTracking();
      }

      await refreshOrders();
      Alert.alert('Berhasil', action === 'pause'
        ? 'Tracking dijeda.'
        : action === 'stop'
          ? 'Tracking dihentikan.'
          : 'Tracking background aktif. Biarkan GPS dan internet menyala.');
    } catch (requestError) {
      Alert.alert('Tracking gagal', requestError instanceof Error ? requestError.message : 'Terjadi kesalahan tracking.');
    } finally {
      setActionOrderId(null);
    }
  }, [refreshOrders, token]);

  const handleLogout = useCallback(async () => {
    if (activeOrder) {
      Alert.alert('Tracking masih aktif', 'Hentikan tracking aktif sebelum logout agar pengiriman tidak terlihat macet.');
      return;
    }

    await stopBackgroundTracking();
    await clearAuthToken();
    setTokenState(null);
    setUser(null);
    setDriver(null);
    setOrders([]);
    setError(null);
  }, [activeOrder]);

  if (booting) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0f4c81" />
          <Text style={styles.mutedText}>Memuat aplikasi driver...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!token || !user || !driver) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.loginContainer}>
          <View style={styles.loginCard}>
            <Text style={styles.brandLabel}>LOGISTIK DRIVER</Text>
            <Text style={styles.title}>Masuk ke APK Driver</Text>
            <Text style={styles.subtitle}>
              Login dengan akun mobile driver yang dibuat oleh admin. Aplikasi ini dipakai untuk tracking pengiriman background di Android.
            </Text>

            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Email driver"
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Password"
              style={styles.input}
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable style={[styles.primaryButton, submitting && styles.buttonDisabled]} disabled={submitting} onPress={() => void handleLogin()}>
              {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Masuk</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.appContainer}>
        <View style={styles.headerCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.brandLabel}>{company?.name || 'LOGISTIK'}</Text>
            <Text style={styles.title}>{driver.name}</Text>
            <Text style={styles.subtitle}>{driver.phone || user.email}</Text>
          </View>
          <Pressable style={[styles.ghostButton, activeOrder && styles.buttonDisabled]} disabled={Boolean(activeOrder)} onPress={() => void handleLogout()}>
            <Text style={styles.ghostButtonText}>Keluar</Text>
          </Pressable>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Tracking background Android</Text>
          <Text style={styles.infoText}>
            Saat tracking aktif, aplikasi akan menjalankan foreground service Android dan mengirim heartbeat lokasi ke web admin.
            Jangan matikan izin lokasi atau data seluler saat perjalanan berlangsung.
          </Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoKey}>Tracking aktif</Text>
            <Text style={styles.infoValue}>{activeOrder ? activeOrder.doNumber : 'Belum ada'}</Text>
          </View>
          {!trackingRuntimeHealthy && activeOrder ? (
            <Text style={styles.runtimeWarning}>
              Server mencatat tracking aktif untuk {activeOrder.doNumber}, tetapi service lokasi di perangkat tidak sedang berjalan. Tekan Stop lalu Mulai lagi.
            </Text>
          ) : null}
        </View>

        <View style={styles.toolbar}>
          <Text style={styles.sectionTitle}>DO Aktif Driver</Text>
          <Pressable style={[styles.ghostButton, refreshing && styles.buttonDisabled]} onPress={() => void refreshOrders()} disabled={refreshing}>
            {refreshing ? <ActivityIndicator color="#0f4c81" /> : <Text style={styles.ghostButtonText}>Refresh</Text>}
          </Pressable>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {orders.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.sectionTitle}>Belum ada DO</Text>
            <Text style={styles.mutedText}>Belum ada surat jalan yang ditugaskan ke akun driver ini.</Text>
          </View>
        ) : (
          orders.map((order) => {
            const badge = trackingLabel(order);
            const busy = actionOrderId === order._id;
            const mapUrl =
              typeof order.trackingLastLat === 'number' && typeof order.trackingLastLng === 'number'
                ? `https://www.google.com/maps?q=${order.trackingLastLat},${order.trackingLastLng}`
                : null;

            return (
              <View key={order._id} style={styles.orderCard}>
                <View style={styles.orderHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.orderNumber}>{order.doNumber}</Text>
                    <Text style={styles.orderMeta}>{order.masterResi || '-'} | {formatDate(order.date)}</Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: badge.color }]}>
                    <Text style={styles.badgeText}>{badge.label}</Text>
                  </View>
                </View>

                <View style={styles.metaBlock}>
                  <Text style={styles.metaLabel}>Customer</Text>
                  <Text style={styles.metaValue}>{order.customerName || '-'}</Text>
                </View>
                <View style={styles.metaBlock}>
                  <Text style={styles.metaLabel}>Tujuan</Text>
                  <Text style={styles.metaValue}>{order.receiverAddress || '-'}</Text>
                </View>
                <View style={styles.metaBlock}>
                  <Text style={styles.metaLabel}>Kendaraan</Text>
                  <Text style={styles.metaValue}>{order.vehiclePlate || '-'}</Text>
                </View>
                <View style={styles.metaBlock}>
                  <Text style={styles.metaLabel}>Last seen</Text>
                  <Text style={styles.metaValue}>{formatDateTime(order.trackingLastSeenAt)}</Text>
                </View>

                {mapUrl ? (
                  <Pressable style={styles.linkButton} onPress={() => void Linking.openURL(mapUrl)}>
                    <Text style={styles.linkButtonText}>Buka lokasi terakhir di Maps</Text>
                  </Pressable>
                ) : null}

                <View style={styles.actionRow}>
                  {order.trackingState === 'ACTIVE' ? (
                    <>
                      <Pressable style={[styles.warningButton, styles.flexButton, busy && styles.buttonDisabled]} onPress={() => void handleTrackingAction(order, 'pause')} disabled={busy}>
                        {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Jeda</Text>}
                      </Pressable>
                      <Pressable style={[styles.dangerButton, styles.flexButton, busy && styles.buttonDisabled]} onPress={() => void handleTrackingAction(order, 'stop')} disabled={busy}>
                        {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Stop</Text>}
                      </Pressable>
                    </>
                  ) : order.trackingState === 'PAUSED' ? (
                    <>
                      <Pressable style={[styles.primaryButton, styles.flexButton, busy && styles.buttonDisabled]} onPress={() => void handleTrackingAction(order, 'resume')} disabled={busy}>
                        {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Lanjut</Text>}
                      </Pressable>
                      <Pressable style={[styles.dangerButton, styles.flexButton, busy && styles.buttonDisabled]} onPress={() => void handleTrackingAction(order, 'stop')} disabled={busy}>
                        {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Stop</Text>}
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      style={[
                        styles.primaryButton,
                        styles.fullButton,
                        (busy || order.status === 'DELIVERED' || order.status === 'CANCELLED') && styles.buttonDisabled,
                      ]}
                      onPress={() => void handleTrackingAction(order, 'start')}
                      disabled={busy || order.status === 'DELIVERED' || order.status === 'CANCELLED'}
                    >
                      {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Mulai Tracking</Text>}
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4f7fb',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loginContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  appContainer: {
    padding: 16,
    gap: 16,
  },
  loginCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    gap: 14,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  headerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoCard: {
    backgroundColor: '#0f4c81',
    borderRadius: 20,
    padding: 18,
    gap: 10,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#dbeafe',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoKey: {
    color: '#bfdbfe',
    fontSize: 13,
  },
  infoValue: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  runtimeWarning: {
    marginTop: 6,
    color: '#fef3c7',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandLabel: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#0f4c81',
    fontWeight: '700',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: '#ffffff',
    fontSize: 15,
  },
  primaryButton: {
    backgroundColor: '#0f4c81',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  warningButton: {
    backgroundColor: '#b45309',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  dangerButton: {
    backgroundColor: '#b91c1c',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  ghostButton: {
    borderWidth: 1,
    borderColor: '#0f4c81',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  ghostButtonText: {
    color: '#0f4c81',
    fontWeight: '700',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 14,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  mutedText: {
    color: '#64748b',
    fontSize: 14,
  },
  emptyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    gap: 8,
  },
  orderCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    gap: 12,
  },
  orderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  orderNumber: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  orderMeta: {
    fontSize: 13,
    color: '#64748b',
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  metaBlock: {
    gap: 2,
  },
  metaLabel: {
    fontSize: 12,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaValue: {
    fontSize: 15,
    color: '#0f172a',
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  flexButton: {
    flex: 1,
  },
  fullButton: {
    width: '100%',
  },
  linkButton: {
    paddingVertical: 6,
  },
  linkButtonText: {
    color: '#0f4c81',
    fontWeight: '700',
  },
});
