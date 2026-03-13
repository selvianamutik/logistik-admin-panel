import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import 'api.dart';
import 'storage.dart';

class DriverTrackingRuntime {
  DriverTrackingRuntime._();

  static final DriverTrackingRuntime instance = DriverTrackingRuntime._();

  StreamSubscription<Position>? _positionSubscription;
  String? _activeOrderId;
  bool _hasHydrated = false;

  final ValueNotifier<int> changes = ValueNotifier<int>(0);

  String? get activeOrderId => _activeOrderId;

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

    final canTrackInBackground =
        permission == LocationPermission.always ||
        (defaultTargetPlatform != TargetPlatform.android &&
            permission == LocationPermission.whileInUse);

    if (!canTrackInBackground) {
      throw Exception(
        'Izin lokasi background wajib diaktifkan agar tracking tetap berjalan saat layar mati.',
      );
    }
  }

  Future<Position> getCurrentLocation() {
    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.bestForNavigation,
      ),
    );
  }

  Future<void> startHeartbeatStream({
    required String token,
    required String orderId,
  }) async {
    await stopLocalOnly();

    await DriverStorage.setActiveTrackingOrderRef(orderId);
    _activeOrderId = orderId;
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
        } catch (error) {
          debugPrint('Tracking heartbeat failed: $error');
        }
      },
      onError: (Object error, StackTrace stackTrace) {
        debugPrint('Tracking runtime error: $error');
      },
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
    await DriverStorage.clearActiveTrackingOrderRef();
    _notify();
  }

  void _notify() {
    changes.value = changes.value + 1;
  }
}
