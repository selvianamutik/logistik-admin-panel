import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../../../app.dart';
import '../data/delivery_order_service.dart';
import '../data/driver_tracking_service.dart';
import '../domain/models.dart';

class TrackingHomePage extends StatefulWidget {
  const TrackingHomePage({
    super.key,
    required this.session,
    required this.onLogout,
  });

  final DriverAppSession session;
  final VoidCallback onLogout;

  @override
  State<TrackingHomePage> createState() => _TrackingHomePageState();
}

class _TrackingHomePageState extends State<TrackingHomePage> {
  final DeliveryOrderService _deliveryOrderService = DeliveryOrderService();
  late final DriverTrackingService _trackingService;

  List<DeliveryTrip> _trips = const [];
  DeliveryTrip? _selectedTrip;
  DeliveryTrip? _activeTrip;
  LocationSnapshot? _latestLocation;

  bool _trackingEnabled = false;
  bool _loadingTrips = true;
  bool _updatingStatus = false;
  String? _loadError;
  String? _locationError;
  String? _pingError;
  int _pingCount = 0;

  Duration _trackingInterval = const Duration(seconds: 30);
  Timer? _pingCounterTimer;

  @override
  void initState() {
    super.initState();
    _trackingService = DriverTrackingService(
      sessionToken: widget.session.token ?? '',
    );
    unawaited(_loadTrips());
  }

  @override
  void dispose() {
    _pingCounterTimer?.cancel();
    _trackingService.stop();
    super.dispose();
  }

  // ── Trips ──────────────────────────────────────────────────

  Future<void> _loadTrips() async {
    final driverRef = widget.session.driverRef;
    if (driverRef == null || driverRef.isEmpty) {
      setState(() {
        _loadingTrips = false;
        _loadError = 'Akun driver belum terhubung ke data supir';
      });
      return;
    }
    setState(() { _loadingTrips = true; _loadError = null; });
    try {
      final trips = await _deliveryOrderService.fetchDriverTrips(driverRef: driverRef);
      if (!mounted) return;
      setState(() {
        _trips = trips;
        final activeId = _activeTrip?.deliveryOrderId;
        final lockedTrip = trips.firstWhereOrNull((t) =>
            t.trackingState == 'ACTIVE' || t.trackingState == 'PAUSED');
        _activeTrip = activeId != null
            ? trips.firstWhereOrNull((t) => t.deliveryOrderId == activeId)
            : lockedTrip ?? trips.firstWhereOrNull((t) => t.status == TripStatus.onDelivery);
        _selectedTrip = _activeTrip ?? (trips.isNotEmpty ? trips.first : null);
        _trackingEnabled = _activeTrip?.trackingState == 'ACTIVE';
        _loadingTrips = false;
      });
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      setState(() { _loadingTrips = false; _loadError = err.message; });
    } catch (_) {
      if (!mounted) return;
      setState(() { _loadingTrips = false; _loadError = 'Tidak bisa memuat DO dari Sanity'; });
    }
  }

  // ── Tracking ───────────────────────────────────────────────

  Future<String?> _checkPermission() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return 'GPS mati. Aktifkan layanan lokasi.';
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return 'Izin lokasi ditolak. Buka pengaturan aplikasi.';
    }
    return null;
  }

  Future<void> _setTrackingEnabled(bool value) async {
    final trip = _activeTrip ?? _selectedTrip;
    if (trip == null) return;

    if (!value) {
      final serverTrackingState = trip.trackingState;
      final isActiveOnServer =
          serverTrackingState == 'ACTIVE' || serverTrackingState == 'PAUSED';
      final isClosedTrip = trip.status == TripStatus.delivered;

      if (isActiveOnServer && !isClosedTrip) {
        if (!mounted) return;
        setState(() => _trackingEnabled = true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Tracking harus tetap aktif sampai DO selesai. Driver tidak bisa mematikannya sendiri.',
            ),
            behavior: SnackBarBehavior.floating,
          ),
        );
        return;
      }
    }

    if (value) {
      final err = await _checkPermission();
      if (err != null) {
        if (mounted) setState(() => _locationError = err);
        return;
      }
    }
    if (!mounted) return;
    setState(() {
      _trackingEnabled = value;
      _locationError = null;
      _pingError = null;
      if (!value) _pingCount = 0;
    });
    if (value) {
      _startTracking(
        initialAction: _trackingStartAction(trip),
      );
    } else {
      _pingCounterTimer?.cancel();
      _trackingService.stop();
    }
  }

  void _startTracking({String initialAction = 'start'}) {
    final trip = _activeTrip ?? _selectedTrip;
    if (trip == null) return;

    _pingCounterTimer?.cancel();

    _trackingService.start(
      deliveryOrderId: trip.deliveryOrderId,
      interval: _trackingInterval,
      onLocation: (snapshot) {
        if (!mounted) return;
        setState(() { _latestLocation = snapshot; _locationError = null; });
      },
      onError: (err) {
        if (!mounted) return;
        setState(() => _pingError = err);
      },
      initialAction: initialAction,
      onPingSuccess: () {
        if (!mounted) return;
        unawaited(_loadTrips());
      },
      onTrackingInactive: (message) {
        if (!mounted) return;
        _pingCounterTimer?.cancel();
        _trackingService.stop();
        setState(() {
          _trackingEnabled = false;
          _activeTrip = null;
          _pingCount = 0;
          _pingError = message;
        });
        unawaited(_loadTrips());
      },
    );

    _pingCounterTimer = Timer.periodic(_trackingInterval, (_) {
      if (!mounted || !_trackingEnabled) return;
      setState(() => _pingCount++);
    });
  }

  void _changeInterval(Duration value) {
    setState(() => _trackingInterval = value);
    if (_trackingEnabled) {
      _startTracking(
        initialAction: _trackingStartAction(_activeTrip ?? _selectedTrip),
      );
    }
  }

  // ── Trip actions ───────────────────────────────────────────

  Future<void> _beginDelivery(DeliveryTrip trip) async {
    if (_activeTrip != null &&
        _activeTrip!.deliveryOrderId != trip.deliveryOrderId) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Selesaikan "${_activeTrip!.doNumber}" terlebih dahulu.'),
          behavior: SnackBarBehavior.floating,
        ));
      }
      return;
    }
    final err = await _checkPermission();
    if (err != null) {
      if (mounted) setState(() => _locationError = err);
      return;
    }
    if (!mounted) return;
    setState(() {
      _activeTrip = _trips.firstWhere((t) => t.deliveryOrderId == trip.deliveryOrderId);
      _selectedTrip = _activeTrip;
      _pingCount = 0;
    });
    await _setTrackingEnabled(true);
  }

  Future<void> _advanceStatus() async {
    final trip = _selectedTrip;
    final sessionToken = widget.session.token;
    if (trip == null || sessionToken == null || sessionToken.isEmpty) return;
    final nextStatus = switch (trip.status) {
      TripStatus.assigned => TripStatus.headingToPickup,
      TripStatus.headingToPickup => TripStatus.onDelivery,
      TripStatus.onDelivery => TripStatus.arrived,
      TripStatus.arrived => TripStatus.delivered,
      TripStatus.delivered => TripStatus.delivered,
    };
    setState(() => _updatingStatus = true);
    try {
      await _deliveryOrderService.updateTripStatus(
        sessionToken: sessionToken,
        deliveryOrderId: trip.deliveryOrderId,
        status: nextStatus,
        note: _statusNoteForUpdate(nextStatus),
      );
      await _loadTrips();
      if (!mounted) return;
      if (nextStatus == TripStatus.delivered) {
        _pingCounterTimer?.cancel();
        _trackingService.stop();
        setState(() {
          _activeTrip = null;
          _trackingEnabled = false;
          _pingCount = 0;
        });
      }
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(err.message),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } finally {
      if (!mounted) return;
      setState(() => _updatingStatus = false);
    }
  }

  String _statusNoteForUpdate(TripStatus status) {
    return switch (status) {
      TripStatus.headingToPickup => 'Driver mulai bergerak ke pickup via driver app',
      TripStatus.onDelivery => 'Pengiriman dimulai via driver app',
      TripStatus.arrived => 'Driver menandai sudah tiba via driver app',
      TripStatus.delivered => 'Driver menandai delivery selesai via driver app',
      TripStatus.assigned => 'Status diperbarui via driver app',
    };
  }

  String _trackingStartAction(DeliveryTrip? trip) {
    final trackingState = trip?.trackingState;
    if (trackingState == 'ACTIVE' || trackingState == 'PAUSED') {
      return 'resume';
    }
    return 'start';
  }

  // ── Build ──────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Row(children: [
          Container(width: 8, height: 8,
            decoration: BoxDecoration(color: scheme.primary, shape: BoxShape.circle)),
          const SizedBox(width: 8),
          const Text('LOGISTIK', style: TextStyle(
            fontSize: 14, fontWeight: FontWeight.w800, letterSpacing: 2,
          )),
        ]),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: OutlinedButton.icon(
              onPressed: widget.onLogout,
              icon: const Icon(Icons.logout_rounded, size: 15),
              label: const Text('Keluar'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadTrips,
        color: scheme.primary,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            _DriverCard(session: widget.session, tripCount: _trips.length),
            const SizedBox(height: 20),
            _SectionHeader(title: 'Delivery orders', count: _trips.length),
            const SizedBox(height: 10),
            _buildTripList(scheme),
            if (_selectedTrip != null) ...[
              const SizedBox(height: 24),
              const _SectionHeader(title: 'Detail DO terpilih'),
              const SizedBox(height: 10),
              _TripDetailCard(trip: _selectedTrip!),
              const SizedBox(height: 12),
              if (_locationError != null) ...[
                _ErrorBanner(
                  icon: Icons.location_off_rounded,
                  message: _locationError!,
                  onRetry: () => unawaited(_setTrackingEnabled(true)),
                ),
                const SizedBox(height: 12),
              ],
              if (_pingError != null) ...[
                _ErrorBanner(
                  icon: Icons.cloud_off_rounded,
                  message: _pingError!,
                  isWarning: true,
                ),
                const SizedBox(height: 12),
              ],
              _TrackingCard(
                trackingEnabled: _trackingEnabled,
                selectedInterval: _trackingInterval,
                location: _latestLocation,
                pingCount: _pingCount,
                onTrackingChanged: (v) => (_setTrackingEnabled(v)),
                onIntervalChanged: _changeInterval,
              ),
              const SizedBox(height: 12),
              if (_activeTrip == null ||
                  _activeTrip!.deliveryOrderId == _selectedTrip!.deliveryOrderId)
                _StartDeliveryButton(
                  trip: _selectedTrip!,
                  onPressed: (_selectedTrip!.status == TripStatus.onDelivery ||
                          _selectedTrip!.status == TripStatus.arrived)
                      ? null
                      : () => unawaited(_beginDelivery(_selectedTrip!)),
                ),
              if (_activeTrip?.deliveryOrderId == _selectedTrip!.deliveryOrderId) ...[
                const SizedBox(height: 12),
                _AdvanceButton(
                  status: _selectedTrip!.status,
                  onPressed: _selectedTrip!.status == TripStatus.delivered
                      ? null : (_updatingStatus ? null : () => unawaited(_advanceStatus())),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildTripList(ColorScheme scheme) {
    if (_loadingTrips) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 40),
        child: Center(child: CircularProgressIndicator(color: scheme.primary)),
      );
    }
    if (_loadError != null) return _ErrorCard(message: _loadError!, onRetry: _loadTrips);
    if (_trips.isEmpty) return const _EmptyCard();
    return Column(
      children: _trips.map((trip) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: _TripListCard(
          trip: trip,
          isSelected: _selectedTrip?.deliveryOrderId == trip.deliveryOrderId,
          onTap: () => setState(() => _selectedTrip = trip),
        ),
      )).toList(),
    );
  }
}

// ── Driver card ────────────────────────────────────────────
class _DriverCard extends StatelessWidget {
  const _DriverCard({required this.session, required this.tripCount});
  final DriverAppSession session;
  final int tripCount;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(children: [
          Container(
            width: 46, height: 46,
            decoration: BoxDecoration(
              color: scheme.primaryContainer, borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(Icons.person_pin_circle_rounded, color: scheme.primary, size: 24),
          ),
          const SizedBox(width: 14),
          Expanded(child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(session.driverName, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
              const SizedBox(height: 2),
              Text(session.email, style: TextStyle(
                color: scheme.onSurface.withOpacity(0.5), fontSize: 13,
              )),
            ],
          )),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: scheme.primaryContainer, borderRadius: BorderRadius.circular(999),
            ),
            child: Text('$tripCount DO', style: TextStyle(
              color: scheme.primary, fontWeight: FontWeight.w700, fontSize: 13,
            )),
          ),
        ]),
      ),
    );
  }
}

// ── Section header ─────────────────────────────────────────
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.count});
  final String title;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(children: [
      Text(title.toUpperCase(), style: TextStyle(
        color: scheme.onSurface.withOpacity(0.4),
        fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.5,
      )),
      if (count != null) ...[
        const SizedBox(width: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
          decoration: BoxDecoration(
            color: scheme.primaryContainer, borderRadius: BorderRadius.circular(6),
          ),
          child: Text('$count', style: TextStyle(
            color: scheme.primary, fontSize: 11, fontWeight: FontWeight.w700,
          )),
        ),
      ],
    ]);
  }
}

// ── Trip list card ─────────────────────────────────────────
class _TripListCard extends StatelessWidget {
  const _TripListCard({required this.trip, required this.isSelected, required this.onTap});
  final DeliveryTrip trip;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? scheme.primary.withOpacity(0.5) : const Color(0xFFE2E8E4),
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(trip.doNumber, style: const TextStyle(
              fontWeight: FontWeight.w700, fontSize: 15,
            ))),
            if (isSelected)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Icon(Icons.check_circle_rounded, color: scheme.primary, size: 16),
              ),
            _StatusChip(status: trip.status),
          ]),
          const SizedBox(height: 6),
          Text('${trip.customerName}  ·  ${trip.vehiclePlate}',
            style: TextStyle(color: scheme.onSurface.withOpacity(0.5), fontSize: 13)),
          const SizedBox(height: 6),
          Row(children: [
            Icon(Icons.location_on_rounded, size: 13, color: scheme.onSurface.withOpacity(0.35)),
            const SizedBox(width: 4),
            Expanded(child: Text(trip.destinationLabel,
              style: TextStyle(color: scheme.onSurface.withOpacity(0.5), fontSize: 13),
              maxLines: 1, overflow: TextOverflow.ellipsis)),
          ]),
        ]),
      ),
    );
  }
}

// ── Trip detail card ───────────────────────────────────────
class _TripDetailCard extends StatelessWidget {
  const _TripDetailCard({required this.trip});
  final DeliveryTrip trip;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(trip.doNumber, style: const TextStyle(
              fontWeight: FontWeight.w700, fontSize: 15,
            ))),
            _StatusChip(status: trip.status),
          ]),
          const SizedBox(height: 16),
          _DetailRow(icon: Icons.business_rounded, label: 'Customer', value: trip.customerName),
          _DetailRow(icon: Icons.local_shipping_rounded, label: 'Kendaraan', value: trip.vehiclePlate),
          if (trip.receiverName != null)
            _DetailRow(icon: Icons.person_rounded, label: 'Penerima', value: trip.receiverName!),
          _DetailRow(icon: Icons.location_on_rounded, label: 'Tujuan', value: trip.destinationLabel),
          _DetailRow(icon: Icons.calendar_today_rounded, label: 'Tanggal', value: trip.etdLabel),
          if (trip.itemSummary != null && trip.itemSummary!.isNotEmpty)
            _DetailRow(icon: Icons.notes_rounded, label: 'Catatan', value: trip.itemSummary!),
        ]),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 15, color: scheme.onSurface.withOpacity(0.3)),
        const SizedBox(width: 10),
        SizedBox(width: 72, child: Text(label, style: TextStyle(
          color: scheme.onSurface.withOpacity(0.5), fontSize: 13,
        ))),
        Expanded(child: Text(value, style: const TextStyle(fontSize: 13))),
      ]),
    );
  }
}

// ── Tracking card ──────────────────────────────────────────
class _TrackingCard extends StatelessWidget {
  const _TrackingCard({
    required this.trackingEnabled,
    required this.selectedInterval,
    required this.location,
    required this.pingCount,
    required this.onTrackingChanged,
    required this.onIntervalChanged,
  });

  final bool trackingEnabled;
  final Duration selectedInterval;
  final LocationSnapshot? location;
  final int pingCount;
  final Future<void> Function(bool) onTrackingChanged;
  final ValueChanged<Duration> onIntervalChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(children: [
          Row(children: [
            Container(
              width: 38, height: 38,
              decoration: BoxDecoration(
                color: trackingEnabled ? scheme.primaryContainer : scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                trackingEnabled ? Icons.sensors_rounded : Icons.sensors_off_rounded,
                color: trackingEnabled ? scheme.primary : scheme.onSurface.withOpacity(0.3),
                size: 18,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                trackingEnabled ? 'Tracking aktif' : 'Tracking nonaktif',
                style: TextStyle(
                  color: trackingEnabled ? scheme.primary : scheme.onSurface,
                  fontWeight: FontWeight.w700, fontSize: 14,
                ),
              ),
              Text(
                trackingEnabled
                    ? 'Mengirim lokasi ke server ($pingCount ping)'
                    : 'Aktifkan untuk kirim lokasi',
                style: TextStyle(color: scheme.onSurface.withOpacity(0.5), fontSize: 12),
              ),
            ])),
            Switch(
              value: trackingEnabled,
              onChanged: (v) => unawaited(onTrackingChanged(v)),
            ),
          ]),
          const SizedBox(height: 14),
          Row(children: [
            Text('Interval', style: TextStyle(
              color: scheme.onSurface.withOpacity(0.5), fontSize: 13,
            )),
            const Spacer(),
            _Chip(
              label: '30s',
              selected: selectedInterval == const Duration(seconds: 30),
              onTap: () => onIntervalChanged(const Duration(seconds: 30)),
            ),
            const SizedBox(width: 8),
            _Chip(
              label: '1 min',
              selected: selectedInterval == const Duration(minutes: 1),
              onTap: () => onIntervalChanged(const Duration(minutes: 1)),
            ),
          ]),
          if (location != null) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(children: [
                Row(children: [
                  _StatMini(
                    label: 'Terakhir',
                    value: TimeOfDay.fromDateTime(location!.recordedAt).format(context),
                  ),
                  Container(width: 1, height: 32,
                    margin: const EdgeInsets.symmetric(horizontal: 12),
                    color: const Color(0xFFE2E8E4)),
                  _StatMini(
                    label: 'Kecepatan',
                    value: '${location!.speedKph.toStringAsFixed(0)} km/h',
                  ),
                  Container(width: 1, height: 32,
                    margin: const EdgeInsets.symmetric(horizontal: 12),
                    color: const Color(0xFFE2E8E4)),
                  _StatMini(
                    label: 'Akurasi',
                    value: '±${location!.accuracyM.toStringAsFixed(0)} m',
                  ),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  Icon(Icons.location_on_rounded, size: 13,
                    color: scheme.onSurface.withOpacity(0.4)),
                  const SizedBox(width: 6),
                  Text(
                    '${location!.latitude.toStringAsFixed(6)}, '
                    '${location!.longitude.toStringAsFixed(6)}',
                    style: TextStyle(
                      fontSize: 12,
                      color: scheme.onSurface.withOpacity(0.5),
                      fontFamily: 'monospace',
                    ),
                  ),
                ]),
              ]),
            ),
          ],
        ]),
      ),
    );
  }
}

// ── Error banner ───────────────────────────────────────────
class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({
    required this.icon,
    required this.message,
    this.onRetry,
    this.isWarning = false,
  });

  final IconData icon;
  final String message;
  final VoidCallback? onRetry;
  final bool isWarning;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = isWarning ? const Color(0xFFB45309) : scheme.error;
    final bgColor = isWarning ? const Color(0xFFFEF3C7) : scheme.errorContainer;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(color: bgColor, borderRadius: BorderRadius.circular(12)),
      child: Row(children: [
        Icon(icon, color: color, size: 16),
        const SizedBox(width: 10),
        Expanded(child: Text(message, style: TextStyle(color: color, fontSize: 13))),
        if (onRetry != null)
          TextButton(
            onPressed: onRetry,
            child: Text('Retry', style: TextStyle(color: color, fontSize: 13)),
          ),
      ]),
    );
  }
}

// ── Chip / stat ────────────────────────────────────────────
class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? scheme.primaryContainer : Colors.transparent,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: selected ? scheme.primary.withOpacity(0.4) : const Color(0xFFD4DDDA),
          ),
        ),
        child: Text(label, style: TextStyle(
          color: selected ? scheme.primary : scheme.onSurface.withOpacity(0.5),
          fontSize: 13, fontWeight: FontWeight.w600,
        )),
      ),
    );
  }
}

class _StatMini extends StatelessWidget {
  const _StatMini({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Expanded(child: Column(children: [
      Text(label, style: TextStyle(
        color: Theme.of(context).colorScheme.onSurface.withOpacity(0.4), fontSize: 11,
      )),
      const SizedBox(height: 4),
      Text(value, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
    ]));
  }
}

// ── Buttons ────────────────────────────────────────────────
class _StartDeliveryButton extends StatelessWidget {
  const _StartDeliveryButton({required this.trip, required this.onPressed});
  final DeliveryTrip trip;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final alreadyStarted = trip.status == TripStatus.onDelivery || trip.status == TripStatus.arrived;
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        onPressed: onPressed,
        icon: Icon(alreadyStarted ? Icons.sensors_rounded : Icons.play_arrow_rounded, size: 18),
        label: Text(alreadyStarted ? 'Pengiriman berjalan' : 'Mulai Pengiriman'),
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

class _AdvanceButton extends StatelessWidget {
  const _AdvanceButton({required this.status, required this.onPressed});
  final TripStatus status;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final label = switch (status) {
      TripStatus.assigned => 'Mulai ke Pickup',
      TripStatus.headingToPickup => 'Mulai Pengiriman',
      TripStatus.onDelivery => 'Tandai Tiba',
      TripStatus.arrived => 'Tandai Delivered',
      TripStatus.delivered => 'Perjalanan Selesai',
    };
    return SizedBox(
      width: double.infinity,
      child: FilledButton.tonalIcon(
        onPressed: onPressed,
        icon: Icon(status == TripStatus.delivered
            ? Icons.check_circle_rounded : Icons.flag_circle_rounded, size: 18),
        label: Text(label),
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

// ── Status chip ────────────────────────────────────────────
class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final TripStatus status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (label, color) = switch (status) {
      TripStatus.assigned => ('Assigned', const Color(0xFF64748B)),
      TripStatus.headingToPickup => ('To Pickup', const Color(0xFF2563EB)),
      TripStatus.onDelivery => ('On Delivery', scheme.primary),
      TripStatus.arrived => ('Arrived', const Color(0xFFB45309)),
      TripStatus.delivered => ('Delivered', const Color(0xFF15803D)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withOpacity(0.25)),
      ),
      child: Text(label, style: TextStyle(
        color: color, fontSize: 11, fontWeight: FontWeight.w700,
      )),
    );
  }
}

// ── Error / empty states ───────────────────────────────────
class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message, required this.onRetry});
  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(Icons.error_outline_rounded, color: scheme.error, size: 16),
            const SizedBox(width: 8),
            Text('Gagal memuat', style: TextStyle(
              color: scheme.error, fontWeight: FontWeight.w700, fontSize: 14,
            )),
          ]),
          const SizedBox(height: 8),
          Text(message, style: TextStyle(
            color: scheme.onSurface.withOpacity(0.5), fontSize: 13,
          )),
          const SizedBox(height: 14),
          OutlinedButton(
            onPressed: () => unawaited(onRetry()),
            child: const Text('Coba lagi'),
          ),
        ]),
      ),
    );
  }
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 40),
        child: Column(children: [
          Icon(Icons.inbox_rounded, color: scheme.onSurface.withOpacity(0.2), size: 36),
          const SizedBox(height: 12),
          Text('Tidak ada DO aktif', style: TextStyle(
            color: scheme.onSurface.withOpacity(0.5), fontWeight: FontWeight.w700,
          )),
          const SizedBox(height: 4),
          Text('Hubungi admin untuk penugasan', style: TextStyle(
            color: scheme.onSurface.withOpacity(0.35), fontSize: 13,
          )),
        ]),
      ),
    );
  }
}

// ── Extension ──────────────────────────────────────────────
extension _IterableX<T> on Iterable<T> {
  T? firstWhereOrNull(bool Function(T) test) {
    for (final e in this) { if (test(e)) return e; }
    return null;
  }
}
