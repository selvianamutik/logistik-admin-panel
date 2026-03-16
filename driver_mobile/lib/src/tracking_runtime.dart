import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import 'api.dart';
import 'storage.dart';

class DriverTrackingRuntime {
  DriverTrackingRuntime._();

  static final DriverTrackingRuntime instance = DriverTrackingRuntime._();
  static const Duration _currentLocationTimeout = Duration(seconds: 20);
  static const int _heartbeatFailureThreshold = 3;

  StreamSubscription<Position>? _positionSubscription;
  String? _activeOrderId;
  bool _hasHydrated = false;
  int _consecutiveHeartbeatFailures = 0;
  String? _lastHeartbeatError;

  final ValueNotifier<int> changes = ValueNotifier<int>(0);

  String? get activeOrderId => _activeOrderId;
  String? get lastHeartbeatError => _lastHeartbeatError;
  int get consecutiveHeartbeatFailures => _consecutiveHeartbeatFailures;
  bool get hasCriticalHeartbeatFailure =>
      _consecutiveHeartbeatFailures >= _heartbeatFailureThreshold;

  bool get isRunning => _positionSubscription != null && _activeOrderId != null;

  bool isRunningFor(String orderId) {
    return _positionSubscription != null && _activeOrderId == orderId;
  }

  Future<void> hydrate() async {
    if (_hasHydrated) {
      return;
    }
    _activeOrderId = await DriverStorage.getActiveTrackingOrderRef();
    _hasHydrated = true;
    _notify();
  }

  Future<void> ensureLocationPermissions() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      throw Exception('GPS perangkat belum aktif. Nyalakan layanan lokasi dulu.');
    }

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    if (permission == LocationPermission.denied) {
      throw Exception('Izin lokasi foreground wajib diaktifkan.');
    }

    if (permission == LocationPermission.deniedForever) {
      throw Exception(
        'Izin lokasi diblok permanen. Buka pengaturan aplikasi dan aktifkan izin lokasi.',
      );
    }

    if (defaultTargetPlatform == TargetPlatform.android &&
        permission != LocationPermission.always) {
      permission = await Geolocator.requestPermission();
    }

    final requiresAlwaysPermission =
        defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS;

    if (requiresAlwaysPermission && permission != LocationPermission.always) {
      final message = defaultTargetPlatform == TargetPlatform.iOS
          ? 'Di iPhone, ubah izin lokasi ke "Always" agar tracking bisa tetap berjalan saat aplikasi di-background.'
          : 'Izin lokasi background wajib diaktifkan agar tracking tetap berjalan saat layar mati.';
      throw Exception(message);
    }
  }

  Future<Position> getCurrentLocation() async {
    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.bestForNavigation,
          timeLimit: _currentLocationTimeout,
        ),
      );
    } on TimeoutException {
      throw Exception(
        'GPS terlalu lama merespons. Pindah ke area lebih terbuka lalu coba lagi.',
      );
    }
  }

  Future<void> startHeartbeatStream({
    required String token,
    required String orderId,
  }) async {
    await stopLocalOnly();

    await DriverStorage.setActiveTrackingOrderRef(orderId);
    _activeOrderId = orderId;
    _consecutiveHeartbeatFailures = 0;
    _lastHeartbeatError = null;
    _notify();

    final locationSettings = defaultTargetPlatform == TargetPlatform.android
        ? AndroidSettings(
            accuracy: LocationAccuracy.bestForNavigation,
            distanceFilter: 25,
            intervalDuration: const Duration(seconds: 15),
            foregroundNotificationConfig:
                const ForegroundNotificationConfig(
              notificationTitle: 'Tracking pengiriman aktif',
              notificationText:
                  'Lokasi driver sedang dikirim ke dashboard logistik.',
              enableWakeLock: true,
            ),
          )
        : AppleSettings(
            accuracy: LocationAccuracy.bestForNavigation,
            distanceFilter: 25,
            pauseLocationUpdatesAutomatically: false,
            showBackgroundLocationIndicator: true,
          );

    _positionSubscription = Geolocator.getPositionStream(
      locationSettings: locationSettings,
    ).listen(
      (position) async {
        if (_activeOrderId == null) {
          return;
        }
        try {
          await DriverApi.postTrackingAction(
            token,
            _activeOrderId!,
            'heartbeat',
            latitude: position.latitude,
            longitude: position.longitude,
            accuracyM: position.accuracy,
            speedMps: position.speed,
          );
          _markHeartbeatSuccess();
        } catch (error) {
          debugPrint('Tracking heartbeat failed: $error');
          _markHeartbeatFailure(error.toString());
        }
      },
      onError: (Object error, StackTrace stackTrace) {
        debugPrint('Tracking runtime error: $error');
        unawaited(_markStreamInterrupted());
      },
      onDone: () => unawaited(_markStreamInterrupted()),
      cancelOnError: false,
    );
  }

  Future<void> reconcileWithServer(String? activeServerOrderId) async {
    if (activeServerOrderId == null) {
      if (_activeOrderId != null || _positionSubscription != null) {
        await stopLocalOnly();
      }
      return;
    }

    if (_activeOrderId != null && _activeOrderId != activeServerOrderId) {
      await stopLocalOnly();
      return;
    }

    _notify();
  }

  Future<void> stopLocalOnly() async {
    await _positionSubscription?.cancel();
    _positionSubscription = null;
    _activeOrderId = null;
    _consecutiveHeartbeatFailures = 0;
    _lastHeartbeatError = null;
    await DriverStorage.clearActiveTrackingOrderRef();
    _notify();
  }

  Future<void> _markStreamInterrupted() async {
    await _positionSubscription?.cancel();
    _positionSubscription = null;
    _notify();
  }

  void _markHeartbeatSuccess() {
    if (_consecutiveHeartbeatFailures == 0 && _lastHeartbeatError == null) {
      return;
    }
    _consecutiveHeartbeatFailures = 0;
    _lastHeartbeatError = null;
    _notify();
  }

  void _markHeartbeatFailure(String message) {
    _consecutiveHeartbeatFailures = _consecutiveHeartbeatFailures + 1;
    _lastHeartbeatError = message;
    _notify();
  }

  void _notify() {
    changes.value = changes.value + 1;
  }
}
