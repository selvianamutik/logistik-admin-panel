import 'dart:async';

import 'package:flutter/material.dart';

import '../../../app.dart';
import '../data/delivery_order_service.dart';
import '../data/mock_tracking_service.dart';
import '../domain/models.dart';
import 'delivery_detail_page.dart';

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
  final MockTrackingService _trackingService = MockTrackingService();
  final DeliveryOrderService _deliveryOrderService = DeliveryOrderService();
  List<DeliveryTrip> _trips = const [];
  DeliveryTrip? _selectedTrip;
  DriverLocationSnapshot? _latestLocation;
  StreamSubscription<DriverLocationSnapshot>? _locationSubscription;
  bool _trackingEnabled = false;
  bool _loadingTrips = true;
  String? _loadError;
  Duration _trackingInterval = const Duration(seconds: 30);

  @override
  void initState() {
    super.initState();
    unawaited(_loadTrips());
  }

  @override
  void dispose() {
    _locationSubscription?.cancel();
    super.dispose();
  }

  Future<void> _loadTrips() async {
    final driverRef = widget.session.driverRef;
    if (driverRef == null || driverRef.isEmpty) {
      setState(() {
        _loadingTrips = false;
        _loadError = 'Akun driver belum terhubung ke data supir';
      });
      return;
    }
    setState(() {
      _loadingTrips = true;
      _loadError = null;
    });
    try {
      final trips = await _deliveryOrderService.fetchDriverTrips(
        driverRef: driverRef,
      );
      if (!mounted) return;
      setState(() {
        _trips = trips;
        _selectedTrip = trips.isNotEmpty ? trips.first : null;
        _loadingTrips = false;
      });
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      setState(() {
        _loadingTrips = false;
        _loadError = err.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loadingTrips = false;
        _loadError = 'Tidak bisa memuat DO dari Sanity';
      });
    }
  }

  void _startTracking() {
    _locationSubscription?.cancel();
    _locationSubscription = _trackingService
        .watchLocation(interval: _trackingInterval)
        .listen((snapshot) {
          if (!mounted) return;
          setState(() {
            _latestLocation = snapshot;
          });
        });
  }

  void _setTrackingEnabled(bool value) {
    if (_selectedTrip == null) return;
    setState(() {
      _trackingEnabled = value;
    });
    if (value) {
      _startTracking();
    } else {
      _locationSubscription?.cancel();
      _locationSubscription = null;
    }
  }

  void _changeInterval(Duration value) {
    setState(() {
      _trackingInterval = value;
    });
    if (_trackingEnabled) _startTracking();
  }

  Future<void> _showTripDetails(DeliveryTrip trip) async {
    final updatedTrip = await Navigator.of(context).push<DeliveryTrip>(
      MaterialPageRoute(builder: (_) => DeliveryDetailPage(trip: trip)),
    );

    if (!mounted || updatedTrip == null) return;

    setState(() {
      _trips = _trips.map((item) {
        return item.deliveryOrderId == updatedTrip.deliveryOrderId
            ? updatedTrip
            : item;
      }).toList();
      _selectedTrip = updatedTrip;
    });
  }

  void _beginDelivery(DeliveryTrip trip) {
    setState(() {
      _selectedTrip = trip;
      _trackingEnabled = true;
      _trips = _trips.map((item) {
        if (item.deliveryOrderId != trip.deliveryOrderId) return item;
        if (item.status == TripStatus.assigned ||
            item.status == TripStatus.headingToPickup) {
          return item.copyWith(status: TripStatus.onDelivery);
        }
        return item;
      }).toList();
      _selectedTrip = _trips.firstWhere(
        (i) => i.deliveryOrderId == trip.deliveryOrderId,
      );
    });
    _startTracking();
  }

  void _advanceStatus() {
    final trip = _selectedTrip;
    if (trip == null) return;
    final nextStatus = switch (trip.status) {
      TripStatus.assigned => TripStatus.headingToPickup,
      TripStatus.headingToPickup => TripStatus.onDelivery,
      TripStatus.onDelivery => TripStatus.arrived,
      TripStatus.arrived => TripStatus.delivered,
      TripStatus.delivered => TripStatus.delivered,
    };
    setState(() {
      _trips = _trips
          .map(
            (i) => i.deliveryOrderId == trip.deliveryOrderId
                ? i.copyWith(status: nextStatus)
                : i,
          )
          .toList();
      _selectedTrip = _trips.firstWhere(
        (i) => i.deliveryOrderId == trip.deliveryOrderId,
      );
      if (nextStatus == TripStatus.delivered) _trackingEnabled = false;
    });
    if (nextStatus == TripStatus.delivered) {
      _locationSubscription?.cancel();
      _locationSubscription = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: scheme.primary,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 8),
            const Text(
              'LOGISTIK',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w800,
                letterSpacing: 2,
              ),
            ),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: OutlinedButton.icon(
              onPressed: widget.onLogout,
              icon: const Icon(Icons.logout_rounded, size: 15),
              label: const Text('Keluar'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 8,
                ),
                textStyle: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
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
            // ── Driver card ──
            _DriverCard(session: widget.session, tripCount: _trips.length),
            const SizedBox(height: 20),

            // ── Trip list ──
            _SectionHeader(title: 'Delivery orders', count: _trips.length),
            const SizedBox(height: 10),
            _buildTripList(scheme),

            // ── Selected DO detail ──
            if (_selectedTrip != null) ...[
              const SizedBox(height: 24),
              const _SectionHeader(title: 'Detail DO terpilih'),
              const SizedBox(height: 10),
              _TripDetailCard(trip: _selectedTrip!),
              const SizedBox(height: 12),
              _MapCard(location: _latestLocation),
              const SizedBox(height: 12),
              _TrackingCard(
                trackingEnabled: _trackingEnabled,
                selectedInterval: _trackingInterval,
                location: _latestLocation,
                onTrackingChanged: _setTrackingEnabled,
                onIntervalChanged: _changeInterval,
              ),
              const SizedBox(height: 16),
              _AdvanceButton(
                status: _selectedTrip!.status,
                onPressed: _selectedTrip!.status == TripStatus.delivered
                    ? null
                    : _advanceStatus,
              ),
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
    if (_loadError != null) {
      return _ErrorCard(message: _loadError!, onRetry: _loadTrips);
    }
    if (_trips.isEmpty) {
      return const _EmptyCard();
    }
    return Column(
      children: _trips
          .map(
            (trip) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _TripListCard(
                trip: trip,
                isSelected:
                    _selectedTrip?.deliveryOrderId == trip.deliveryOrderId,
                onDetails: () => _showTripDetails(trip),
                onBegin: () => _beginDelivery(trip),
              ),
            ),
          )
          .toList(),
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
        child: Row(
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: scheme.primaryContainer,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(
                Icons.person_pin_circle_rounded,
                color: scheme.primary,
                size: 24,
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session.driverName,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    session.email,
                    style: TextStyle(
                      color: scheme.onSurface.withOpacity(0.5),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: scheme.primaryContainer,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                '$tripCount DO',
                style: TextStyle(
                  color: scheme.primary,
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
              ),
            ),
          ],
        ),
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
    return Row(
      children: [
        Text(
          title.toUpperCase(),
          style: TextStyle(
            color: scheme.onSurface.withOpacity(0.4),
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.5,
          ),
        ),
        if (count != null) ...[
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
            decoration: BoxDecoration(
              color: scheme.primaryContainer,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              '$count',
              style: TextStyle(
                color: scheme.primary,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

// ── Trip list card ─────────────────────────────────────────
class _TripListCard extends StatelessWidget {
  const _TripListCard({
    required this.trip,
    required this.isSelected,
    required this.onDetails,
    required this.onBegin,
  });
  final DeliveryTrip trip;
  final bool isSelected;
  final VoidCallback onDetails;
  final VoidCallback onBegin;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isSelected
              ? scheme.primary.withOpacity(0.5)
              : const Color(0xFFE2E8E4),
          width: isSelected ? 1.5 : 1,
        ),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        trip.doNumber,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                        ),
                      ),
                    ),
                    if (isSelected)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: Icon(
                          Icons.check_circle_rounded,
                          color: scheme.primary,
                          size: 16,
                        ),
                      ),
                    _StatusChip(status: trip.status),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  '${trip.customerName}  ·  ${trip.vehiclePlate}',
                  style: TextStyle(
                    color: scheme.onSurface.withOpacity(0.5),
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Icon(
                      Icons.location_on_rounded,
                      size: 13,
                      color: scheme.onSurface.withOpacity(0.35),
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        trip.destinationLabel,
                        style: TextStyle(
                          color: scheme.onSurface.withOpacity(0.5),
                          fontSize: 13,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          // Action row
          Container(
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: Color(0xFFE2E8E4))),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextButton.icon(
                    onPressed: onDetails,
                    icon: const Icon(Icons.info_outline_rounded, size: 15),
                    label: const Text('Detail'),
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: const RoundedRectangleBorder(
                        borderRadius: BorderRadius.only(
                          bottomLeft: Radius.circular(20),
                        ),
                      ),
                    ),
                  ),
                ),
                Container(width: 1, height: 44, color: const Color(0xFFE2E8E4)),
                Expanded(
                  child: TextButton.icon(
                    onPressed: trip.status == TripStatus.delivered
                        ? null
                        : onBegin,
                    icon: Icon(
                      trip.status == TripStatus.delivered
                          ? Icons.check_circle_rounded
                          : Icons.play_arrow_rounded,
                      size: 15,
                    ),
                    label: Text(
                      trip.status == TripStatus.delivered ? 'Selesai' : 'Mulai',
                    ),
                    style: TextButton.styleFrom(
                      foregroundColor: trip.status == TripStatus.delivered
                          ? scheme.onSurface.withOpacity(0.3)
                          : scheme.primary,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: const RoundedRectangleBorder(
                        borderRadius: BorderRadius.only(
                          bottomRight: Radius.circular(20),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
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
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    trip.doNumber,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                    ),
                  ),
                ),
                _StatusChip(status: trip.status),
              ],
            ),
            const SizedBox(height: 16),
            _DetailRow(
              icon: Icons.business_rounded,
              label: 'Customer',
              value: trip.customerName,
            ),
            _DetailRow(
              icon: Icons.local_shipping_rounded,
              label: 'Kendaraan',
              value: trip.vehiclePlate,
            ),
            if (trip.receiverName != null)
              _DetailRow(
                icon: Icons.person_rounded,
                label: 'Penerima',
                value: trip.receiverName!,
              ),
            _DetailRow(
              icon: Icons.location_on_rounded,
              label: 'Tujuan',
              value: trip.destinationLabel,
            ),
            _DetailRow(
              icon: Icons.calendar_today_rounded,
              label: 'Tanggal',
              value: trip.etdLabel,
            ),
            if (trip.itemSummary != null && trip.itemSummary!.isNotEmpty)
              _DetailRow(
                icon: Icons.notes_rounded,
                label: 'Catatan',
                value: trip.itemSummary!,
              ),
          ],
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: scheme.onSurface.withOpacity(0.3)),
          const SizedBox(width: 10),
          SizedBox(
            width: 72,
            child: Text(
              label,
              style: TextStyle(
                color: scheme.onSurface.withOpacity(0.5),
                fontSize: 13,
              ),
            ),
          ),
          Expanded(child: Text(value, style: const TextStyle(fontSize: 13))),
        ],
      ),
    );
  }
}

// ── Map card ───────────────────────────────────────────────
class _MapCard extends StatelessWidget {
  const _MapCard({required this.location});
  final DriverLocationSnapshot? location;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Container(
        height: 180,
        color: scheme.primaryContainer.withOpacity(0.3),
        child: Stack(
          children: [
            Positioned.fill(
              child: CustomPaint(
                painter: _DotGridPainter(
                  color: scheme.primary.withOpacity(0.1),
                ),
              ),
            ),
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: scheme.primaryContainer,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: scheme.primary.withOpacity(0.3),
                        width: 1.5,
                      ),
                    ),
                    child: Icon(
                      Icons.my_location_rounded,
                      color: scheme.primary,
                      size: 22,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    location == null
                        ? 'Menunggu sinyal GPS'
                        : '${location!.latitude.toStringAsFixed(5)}, ${location!.longitude.toStringAsFixed(5)}',
                    style: TextStyle(
                      color: scheme.onSurface.withOpacity(0.5),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DotGridPainter extends CustomPainter {
  const _DotGridPainter({required this.color});
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    for (var x = 0.0; x < size.width; x += 24) {
      for (var y = 0.0; y < size.height; y += 24) {
        canvas.drawCircle(Offset(x, y), 1.5, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// ── Tracking card ──────────────────────────────────────────
class _TrackingCard extends StatelessWidget {
  const _TrackingCard({
    required this.trackingEnabled,
    required this.selectedInterval,
    required this.location,
    required this.onTrackingChanged,
    required this.onIntervalChanged,
  });
  final bool trackingEnabled;
  final Duration selectedInterval;
  final DriverLocationSnapshot? location;
  final ValueChanged<bool> onTrackingChanged;
  final ValueChanged<Duration> onIntervalChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: trackingEnabled
                        ? scheme.primaryContainer
                        : scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    trackingEnabled
                        ? Icons.sensors_rounded
                        : Icons.sensors_off_rounded,
                    color: trackingEnabled
                        ? scheme.primary
                        : scheme.onSurface.withOpacity(0.3),
                    size: 18,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        trackingEnabled
                            ? 'Tracking aktif'
                            : 'Tracking nonaktif',
                        style: TextStyle(
                          color: trackingEnabled
                              ? scheme.primary
                              : scheme.onSurface,
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                      ),
                      Text(
                        trackingEnabled
                            ? 'Lokasi dikirim berkala'
                            : 'Aktifkan untuk kirim lokasi',
                        style: TextStyle(
                          color: scheme.onSurface.withOpacity(0.5),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                Switch(value: trackingEnabled, onChanged: onTrackingChanged),
              ],
            ),

            const SizedBox(height: 14),

            Row(
              children: [
                Text(
                  'Interval',
                  style: TextStyle(
                    color: scheme.onSurface.withOpacity(0.5),
                    fontSize: 13,
                  ),
                ),
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
              ],
            ),

            if (location != null) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    _StatMini(
                      label: 'Terakhir',
                      value: TimeOfDay.fromDateTime(
                        location!.recordedAt,
                      ).format(context),
                    ),
                    Container(
                      width: 1,
                      height: 32,
                      margin: const EdgeInsets.symmetric(horizontal: 12),
                      color: const Color(0xFFE2E8E4),
                    ),
                    _StatMini(
                      label: 'Kecepatan',
                      value: '${location!.speedKph.toStringAsFixed(0)} km/h',
                    ),
                    Container(
                      width: 1,
                      height: 32,
                      margin: const EdgeInsets.symmetric(horizontal: 12),
                      color: const Color(0xFFE2E8E4),
                    ),
                    _StatMini(
                      label: 'Akurasi',
                      value: '${location!.accuracyMeters.toStringAsFixed(0)} m',
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.selected,
    required this.onTap,
  });
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
            color: selected
                ? scheme.primary.withOpacity(0.4)
                : const Color(0xFFD4DDDA),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected
                ? scheme.primary
                : scheme.onSurface.withOpacity(0.5),
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
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
    return Expanded(
      child: Column(
        children: [
          Text(
            label,
            style: TextStyle(
              color: Theme.of(context).colorScheme.onSurface.withOpacity(0.4),
              fontSize: 11,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

// ── Advance button ─────────────────────────────────────────
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
      child: FilledButton.icon(
        onPressed: onPressed,
        icon: Icon(
          status == TripStatus.delivered
              ? Icons.check_circle_rounded
              : Icons.flag_circle_rounded,
          size: 18,
        ),
        label: Text(label),
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
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
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
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
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.error_outline_rounded,
                  color: scheme.error,
                  size: 16,
                ),
                const SizedBox(width: 8),
                Text(
                  'Gagal memuat',
                  style: TextStyle(
                    color: scheme.error,
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: TextStyle(
                color: scheme.onSurface.withOpacity(0.5),
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 14),
            OutlinedButton(
              onPressed: () => unawaited(onRetry()),
              child: const Text('Coba lagi'),
            ),
          ],
        ),
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
        child: Column(
          children: [
            Icon(
              Icons.inbox_rounded,
              color: scheme.onSurface.withOpacity(0.2),
              size: 36,
            ),
            const SizedBox(height: 12),
            Text(
              'Tidak ada DO aktif',
              style: TextStyle(
                color: scheme.onSurface.withOpacity(0.5),
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Hubungi admin untuk penugasan',
              style: TextStyle(
                color: scheme.onSurface.withOpacity(0.35),
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
