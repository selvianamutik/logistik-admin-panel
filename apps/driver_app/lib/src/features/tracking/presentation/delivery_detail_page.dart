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
        _locationError =
            'GPS is turned off. Enable location services to show your truck position.';
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
        _locationError =
            'Location permission is missing. Re-open the app or enable it from settings.';
      });
      return;
    }

    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );

    if (!mounted) return;

    _updateLocation(position, animateCamera: false);
    setState(() {
      _locationError = null;
    });
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
          onError: (Object error) {
            if (!mounted) return;
            setState(() {
              _locationError =
                  'Unable to read GPS position. Check permission and GPS.';
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
      if (_locationError != null) {
        return;
      }
    }

    setState(() {
      _trackingEnabled = value;
    });

    if (value) {
      _startTracking();
    } else {
      _stopTracking();
    }
  }

  void _changeInterval(Duration value) {
    setState(() {
      _trackingInterval = value;
    });

    if (_trackingEnabled) {
      _startTracking();
    }
  }

  Future<void> _beginDelivery() async {
    await _syncCurrentLocation();
    if (_locationError != null) {
      return;
    }

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
    final scheme = Theme.of(context).colorScheme;
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
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          _DetailCard(trip: _trip),
          const SizedBox(height: 12),
          if (_locationError != null)
            _PermissionCard(
              title: 'Location unavailable',
              message: _locationError!,
              actionLabel: 'Refresh GPS',
              onPressed: _syncCurrentLocation,
            ),
          if (_locationError != null) const SizedBox(height: 12),
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
              label: const Text('Track / Begin delivery'),
              style: FilledButton.styleFrom(
                backgroundColor: scheme.primary,
                padding: const EdgeInsets.symmetric(vertical: 16),
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
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

String _advanceLabel(TripStatus status) {
  return switch (status) {
    TripStatus.assigned => 'Mulai ke Pickup',
    TripStatus.headingToPickup => 'Mulai Pengiriman',
    TripStatus.onDelivery => 'Tandai Tiba',
    TripStatus.arrived => 'Tandai Delivered',
    TripStatus.delivered => 'Perjalanan Selesai',
  };
}

class _DetailCard extends StatelessWidget {
  const _DetailCard({required this.trip});

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
                      fontSize: 16,
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
            _DetailRow(
              icon: Icons.info_outline_rounded,
              label: 'Status',
              value: trip.statusNote,
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
          Icon(icon, size: 15, color: scheme.onSurface.withValues(alpha: 0.3)),
          const SizedBox(width: 10),
          SizedBox(
            width: 72,
            child: Text(
              label,
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.5),
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
              infoWindow: const InfoWindow(title: 'Driver position'),
            ),
          },
        ),
      ),
    );
  }
}

class _PermissionCard extends StatelessWidget {
  const _PermissionCard({
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
    final scheme = Theme.of(context).colorScheme;

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
                style: FilledButton.styleFrom(backgroundColor: scheme.primary),
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
            Row(
              children: [
                Text(
                  'Interval',
                  style: TextStyle(
                    color: scheme.onSurface.withValues(alpha: 0.5),
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
    return Expanded(
      child: Column(
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
      TripStatus.assigned => ('Assigned', const Color(0xFF64748B)),
      TripStatus.headingToPickup => ('To Pickup', const Color(0xFF2563EB)),
      TripStatus.onDelivery => ('On Delivery', scheme.primary),
      TripStatus.arrived => ('Arrived', const Color(0xFFB45309)),
      TripStatus.delivered => ('Delivered', const Color(0xFF15803D)),
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
