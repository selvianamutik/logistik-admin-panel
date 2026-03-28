import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../domain/models.dart';

class DeliveryDetailPage extends StatefulWidget {
  const DeliveryDetailPage({super.key, required this.trip});

  final DeliveryTrip trip;

  @override
  State<DeliveryDetailPage> createState() => _DeliveryDetailPageState();
}

class _DeliveryDetailPageState extends State<DeliveryDetailPage> {
  static const LatLng _fallbackCenter = LatLng(-6.200000, 106.816666);

  late DeliveryTrip _trip;
  DriverLocationSnapshot? _latestLocation;
  StreamSubscription<Position>? _locationSubscription;
  GoogleMapController? _mapController;
  bool _trackingEnabled = false;
  Duration _trackingInterval = const Duration(seconds: 30);
  String? _locationError;

  @override
  void initState() {
    super.initState();
    _trip = widget.trip;
    unawaited(_syncCurrentLocation());
  }

  @override
  void dispose() {
    _locationSubscription?.cancel();
    _mapController?.dispose();
    super.dispose();
  }

  Future<void> _syncCurrentLocation() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      if (!mounted) return;
      setState(() {
        _locationError = 'GPS mati. Aktifkan dulu untuk lihat posisi terbaru.';
      });
      return;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    if (!mounted) return;

    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      setState(() {
        _locationError = 'Izin lokasi belum aktif. Cek pengaturan aplikasi.';
      });
      return;
    }

    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );

    if (!mounted) return;

    _updateLocation(position, animateCamera: false);
    setState(() => _locationError = null);
  }

  void _startTracking() {
    _locationSubscription?.cancel();
    _locationSubscription =
        Geolocator.getPositionStream(
          locationSettings: LocationSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 10,
            timeLimit: _trackingInterval,
          ),
        ).listen(
          (position) {
            if (!mounted) return;
            _updateLocation(position);
          },
          onError: (Object _) {
            if (!mounted) return;
            setState(() {
              _locationError = 'Posisi GPS tidak terbaca. Cek izin dan GPS.';
            });
          },
        );
  }

  void _stopTracking() {
    _locationSubscription?.cancel();
    _locationSubscription = null;
  }

  void _updateLocation(Position position, {bool animateCamera = true}) {
    final snapshot = DriverLocationSnapshot(
      latitude: position.latitude,
      longitude: position.longitude,
      speedKph: position.speed >= 0 ? position.speed * 3.6 : 0,
      accuracyMeters: position.accuracy,
      recordedAt: position.timestamp,
    );

    setState(() {
      _latestLocation = snapshot;
      _locationError = null;
    });

    if (animateCamera) {
      _mapController?.animateCamera(
        CameraUpdate.newLatLng(LatLng(snapshot.latitude, snapshot.longitude)),
      );
    }
  }

  Future<void> _setTrackingEnabled(bool value) async {
    if (value) {
      await _syncCurrentLocation();
      if (_locationError != null) return;
    }

    setState(() => _trackingEnabled = value);

    if (value) {
      _startTracking();
    } else {
      _stopTracking();
    }
  }

  void _changeInterval(Duration value) {
    setState(() => _trackingInterval = value);
    if (_trackingEnabled) {
      _startTracking();
    }
  }

  Future<void> _beginDelivery() async {
    await _syncCurrentLocation();
    if (_locationError != null) return;

    if (_trip.status == TripStatus.assigned ||
        _trip.status == TripStatus.headingToPickup) {
      setState(() {
        _trip = _trip.copyWith(status: TripStatus.onDelivery);
        _trackingEnabled = true;
      });
      _startTracking();
    }
  }

  void _advanceStatus() {
    final nextStatus = switch (_trip.status) {
      TripStatus.assigned => TripStatus.headingToPickup,
      TripStatus.headingToPickup => TripStatus.onDelivery,
      TripStatus.onDelivery => TripStatus.arrived,
      TripStatus.arrived => TripStatus.delivered,
      TripStatus.delivered => TripStatus.delivered,
    };

    setState(() {
      _trip = _trip.copyWith(status: nextStatus);
      if (nextStatus == TripStatus.delivered) {
        _trackingEnabled = false;
      }
    });

    if (nextStatus == TripStatus.delivered) {
      _stopTracking();
    }
  }

  void _closePage() {
    Navigator.of(context).pop(_trip);
  }

  @override
  Widget build(BuildContext context) {
    final mapCenter = _latestLocation == null
        ? _fallbackCenter
        : LatLng(_latestLocation!.latitude, _latestLocation!.longitude);

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          onPressed: _closePage,
          icon: const Icon(Icons.arrow_back_rounded),
        ),
        title: Text(_trip.doNumber),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
        children: [
          _DetailCard(trip: _trip),
          const SizedBox(height: 12),
          if (_locationError != null) ...[
            _InfoCard(
              title: 'Lokasi belum siap',
              message: _locationError!,
              actionLabel: 'Muat ulang',
              onPressed: _syncCurrentLocation,
            ),
            const SizedBox(height: 12),
          ],
          _MapCard(
            center: mapCenter,
            hasLiveLocation: _latestLocation != null,
            onMapCreated: (controller) {
              _mapController = controller;
            },
          ),
          const SizedBox(height: 12),
          _TrackingCard(
            trackingEnabled: _trackingEnabled,
            selectedInterval: _trackingInterval,
            location: _latestLocation,
            onTrackingChanged: _setTrackingEnabled,
            onIntervalChanged: _changeInterval,
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _trip.status == TripStatus.delivered
                  ? null
                  : () => unawaited(_beginDelivery()),
              icon: const Icon(Icons.play_arrow_rounded),
              label: Text(
                _trip.status == TripStatus.onDelivery ||
                        _trip.status == TripStatus.arrived
                    ? 'Sedang jalan'
                    : 'Mulai trip',
              ),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton.tonalIcon(
              onPressed: _trip.status == TripStatus.delivered
                  ? null
                  : _advanceStatus,
              icon: const Icon(Icons.flag_circle_rounded),
              label: Text(_advanceLabel(_trip.status)),
            ),
          ),
        ],
      ),
    );
  }
}

String _advanceLabel(TripStatus status) {
  return switch (status) {
    TripStatus.assigned => 'Ke pickup',
    TripStatus.headingToPickup => 'Mulai kirim',
    TripStatus.onDelivery => 'Tandai tiba',
    TripStatus.arrived => 'Selesaikan',
    TripStatus.delivered => 'Trip selesai',
  };
}

class _DetailCard extends StatelessWidget {
  const _DetailCard({required this.trip});

  final DeliveryTrip trip;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  trip.doNumber,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
                _StatusChip(status: trip.status),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              '${trip.originLabel} -> ${trip.destinationLabel}',
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.7),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                _DetailTile(
                  icon: Icons.business_rounded,
                  label: 'Customer',
                  value: trip.customerName,
                ),
                _DetailTile(
                  icon: Icons.local_shipping_rounded,
                  label: 'Kendaraan',
                  value: trip.vehiclePlate,
                ),
                if (trip.receiverName != null)
                  _DetailTile(
                    icon: Icons.person_rounded,
                    label: 'Penerima',
                    value: trip.receiverName!,
                  ),
                _DetailTile(
                  icon: Icons.calendar_today_rounded,
                  label: 'Tanggal',
                  value: trip.etdLabel,
                ),
              ],
            ),
            if (trip.statusNote.isNotEmpty) ...[
              const SizedBox(height: 12),
              _NoteCard(
                icon: Icons.info_outline_rounded,
                label: 'Status',
                value: trip.statusNote,
              ),
            ],
            if (trip.itemSummary != null && trip.itemSummary!.isNotEmpty) ...[
              const SizedBox(height: 12),
              _NoteCard(
                icon: Icons.notes_rounded,
                label: 'Catatan',
                value: trip.itemSummary!,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DetailTile extends StatelessWidget {
  const _DetailTile({
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

    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 140, maxWidth: 220),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        decoration: BoxDecoration(
          color: scheme.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: scheme.outline.withValues(alpha: 0.4)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 15, color: scheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.5),
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    value,
                    style: const TextStyle(fontSize: 13),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
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

class _NoteCard extends StatelessWidget {
  const _NoteCard({
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

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: scheme.outline.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: scheme.primary),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    color: scheme.onSurface.withValues(alpha: 0.5),
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(value, style: const TextStyle(fontSize: 13)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MapCard extends StatelessWidget {
  const _MapCard({
    required this.center,
    required this.hasLiveLocation,
    required this.onMapCreated,
  });

  final LatLng center;
  final bool hasLiveLocation;
  final ValueChanged<GoogleMapController> onMapCreated;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: SizedBox(
        height: 220,
        child: GoogleMap(
          initialCameraPosition: CameraPosition(
            target: center,
            zoom: hasLiveLocation ? 15 : 10,
          ),
          myLocationEnabled: hasLiveLocation,
          myLocationButtonEnabled: true,
          zoomControlsEnabled: false,
          onMapCreated: onMapCreated,
          markers: {
            Marker(
              markerId: const MarkerId('driver-location'),
              position: center,
              infoWindow: const InfoWindow(title: 'Posisi driver'),
            ),
          },
        ),
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    required this.title,
    required this.message,
    this.actionLabel,
    this.onPressed,
  });

  final String title;
  final String message;
  final String? actionLabel;
  final Future<void> Function()? onPressed;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
            ),
            const SizedBox(height: 8),
            Text(message),
            if (actionLabel != null && onPressed != null) ...[
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () => unawaited(onPressed!()),
                child: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

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
  final Future<void> Function(bool value) onTrackingChanged;
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
              crossAxisAlignment: CrossAxisAlignment.start,
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
                        : scheme.onSurface.withValues(alpha: 0.3),
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
                          color: scheme.onSurface.withValues(alpha: 0.5),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                Switch(
                  value: trackingEnabled,
                  onChanged: (value) => unawaited(onTrackingChanged(value)),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 7,
                  ),
                  decoration: BoxDecoration(
                    color: scheme.surface,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                      color: scheme.outline.withValues(alpha: 0.4),
                    ),
                  ),
                  child: Text(
                    'Interval',
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.58),
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                _Chip(
                  label: '30s',
                  selected: selectedInterval == const Duration(seconds: 30),
                  onTap: () => onIntervalChanged(const Duration(seconds: 30)),
                ),
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
                  color: scheme.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: scheme.outline.withValues(alpha: 0.4),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        _StatMini(
                          label: 'Terakhir',
                          value: TimeOfDay.fromDateTime(
                            location!.recordedAt,
                          ).format(context),
                        ),
                        _StatMini(
                          label: 'Kecepatan',
                          value:
                              '${location!.speedKph.toStringAsFixed(0)} km/h',
                        ),
                        _StatMini(
                          label: 'Akurasi',
                          value:
                              '+/- ${location!.accuracyMeters.toStringAsFixed(0)} m',
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.location_on_rounded,
                          size: 13,
                          color: scheme.onSurface.withValues(alpha: 0.4),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            '${location!.latitude.toStringAsFixed(6)}, '
                            '${location!.longitude.toStringAsFixed(6)}',
                            style: TextStyle(
                              fontSize: 12,
                              color: scheme.onSurface.withValues(alpha: 0.5),
                              fontFamily: 'monospace',
                            ),
                          ),
                        ),
                      ],
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

    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? scheme.primaryContainer : Colors.transparent,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: selected
                ? scheme.primary.withValues(alpha: 0.4)
                : const Color(0xFFD4DDDA),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected
                ? scheme.primary
                : scheme.onSurface.withValues(alpha: 0.5),
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
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 92),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: Theme.of(
                context,
              ).colorScheme.onSurface.withValues(alpha: 0.4),
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

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final TripStatus status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (label, color) = switch (status) {
      TripStatus.assigned => ('Siap', const Color(0xFF64748B)),
      TripStatus.headingToPickup => ('Pickup', const Color(0xFF2563EB)),
      TripStatus.onDelivery => ('Kirim', scheme.primary),
      TripStatus.arrived => ('Tiba', const Color(0xFFB45309)),
      TripStatus.delivered => ('Selesai', const Color(0xFF15803D)),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.25)),
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
