import 'dart:async';
import 'dart:convert';

import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;

import '../../../shared/config.dart';

/// Result of a single tracking ping
class TrackingPingResult {
  const TrackingPingResult({required this.success, this.error});
  final bool success;
  final String? error;
}

/// Snapshot of one GPS reading
class LocationSnapshot {
  const LocationSnapshot({
    required this.latitude,
    required this.longitude,
    required this.accuracyM,
    required this.speedKph,
    required this.recordedAt,
  });

  final double latitude;
  final double longitude;
  final double accuracyM;
  final double speedKph;
  final DateTime recordedAt;
}

class DriverTrackingService {
  DriverTrackingService({required this.sessionToken});

  final String sessionToken;

  StreamSubscription<Position>? _positionSub;
  Timer? _intervalTimer;
  LocationSnapshot? _lastSnapshot;
  bool _startSent = false;

  LocationSnapshot? get lastSnapshot => _lastSnapshot;

  // ── Permission helpers ─────────────────────────────────────

  Future<String?> checkAndRequestPermission() async {
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
    return null; // null = OK
  }

  // ── Start / stop ───────────────────────────────────────────

  /// Start tracking — calls [onLocation] on each new GPS fix,
  /// and sends a ping to the server every [interval].
  void start({
    required String deliveryOrderId,
    required Duration interval,
    required void Function(LocationSnapshot) onLocation,
    required void Function(String) onError,
    String initialAction = 'start',
    void Function()? onPingSuccess,
    void Function(String)? onTrackingInactive,
  }) {
    stop(); // cancel any existing stream
    _startSent = false;

    // Listen to GPS position stream
    _positionSub =
        Geolocator.getPositionStream(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 10, // meters moved before update
          ),
        ).listen(
          (position) {
            final snapshot = _fromPosition(position);
            _lastSnapshot = snapshot;
            onLocation(snapshot);
            if (!_startSent) {
              _startSent = true;
              unawaited(
                _sendPing(
                  action: initialAction,
                  deliveryOrderRef: deliveryOrderId,
                  snapshot: snapshot,
                  onError: onError,
                  onSuccess: onPingSuccess,
                  onTrackingInactive: onTrackingInactive,
                ),
              );
            }
          },
          onError: (_) =>
              onError('Tidak bisa membaca GPS. Periksa izin dan GPS.'),
        );

    // Send ping to server at interval
    _intervalTimer = Timer.periodic(interval, (_) {
      final snap = _lastSnapshot;
      if (snap == null) return;
      unawaited(
        _sendPing(
          action: 'heartbeat',
          deliveryOrderRef: deliveryOrderId,
          snapshot: snap,
          onError: onError,
          onTrackingInactive: onTrackingInactive,
        ),
      );
    });
  }

  void stop() {
    _positionSub?.cancel();
    _positionSub = null;
    _intervalTimer?.cancel();
    _intervalTimer = null;
    _startSent = false;
  }

  bool get isRunning => _positionSub != null;

  // ── Send ping ──────────────────────────────────────────────

  Future<TrackingPingResult> _sendPing({
    required String action,
    required String deliveryOrderRef,
    required LocationSnapshot snapshot,
    required void Function(String) onError,
    void Function()? onSuccess,
    void Function(String)? onTrackingInactive,
  }) async {
    try {
      final uri = Uri.parse('${AppConfig.apiBaseUrl}/api/driver/tracking');
      final response = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'x-client-type': 'driver-app',
              // Pass session cookie — Flutter http automatically sends cookies
              // if you use a CookieJar. For simplicity, pass token as header:
              'Authorization': 'Bearer $sessionToken',
            },
            body: jsonEncode({
              'action': action,
              'deliveryOrderRef': deliveryOrderRef,
              'latitude': snapshot.latitude,
              'longitude': snapshot.longitude,
              'accuracyM': snapshot.accuracyM,
              'speedMps': snapshot.speedKph / 3.6,
            }),
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode >= 400) {
        final body = _decodeJson(response.body);
        final msg = body['error'] as String? ?? 'Ping gagal';
        if (action == 'heartbeat' &&
            response.statusCode == 409 &&
            msg == 'Tracking belum aktif untuk DO ini') {
          onTrackingInactive?.call(msg);
        }
        onError(msg);
        return TrackingPingResult(success: false, error: msg);
      }

      onSuccess?.call();
      return const TrackingPingResult(success: true);
    } catch (e) {
      const msg = 'Tidak bisa terhubung ke server tracking';
      onError(msg);
      return TrackingPingResult(success: false, error: msg);
    }
  }

  Map<String, dynamic> _decodeJson(String body) {
    if (body.isEmpty) return <String, dynamic>{};
    final decoded = jsonDecode(body);
    if (decoded is Map<String, dynamic>) {
      return decoded;
    }
    return <String, dynamic>{};
  }

  // ── Helper ─────────────────────────────────────────────────

  LocationSnapshot _fromPosition(Position p) {
    return LocationSnapshot(
      latitude: p.latitude,
      longitude: p.longitude,
      accuracyM: p.accuracy,
      speedKph: p.speed >= 0 ? p.speed * 3.6 : 0,
      recordedAt: p.timestamp,
    );
  }
}
