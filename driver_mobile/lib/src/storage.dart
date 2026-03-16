import 'dart:io' show Platform;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class DriverStorage {
  static const _authTokenKey = 'logistik-driver-auth-token';
  static const _activeTrackingKey = 'logistik-driver-active-tracking';
  static const FlutterSecureStorage _secureStorage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );
  static bool get _isFlutterTest =>
      Platform.environment.containsKey('FLUTTER_TEST');

  static Future<SharedPreferences> _prefs() {
    return SharedPreferences.getInstance();
  }

  static Future<String?> getAuthToken() async {
    if (!_isFlutterTest) {
      try {
        final secureToken = await _secureStorage.read(key: _authTokenKey);
        if (secureToken != null && secureToken.isNotEmpty) {
          return secureToken;
        }
      } catch (_) {
        // Fallback untuk widget test atau perangkat yang belum siap pakai secure storage.
      }
    }

    final prefs = await _prefs();
    final legacyToken = prefs.getString(_authTokenKey);
    if (legacyToken == null || legacyToken.isEmpty) {
      return null;
    }

    if (!_isFlutterTest) {
      try {
        await _secureStorage.write(key: _authTokenKey, value: legacyToken);
      } catch (_) {
        return legacyToken;
      }
      await prefs.remove(_authTokenKey);
    }
    return legacyToken;
  }

  static Future<void> setAuthToken(String token) async {
    if (!_isFlutterTest) {
      try {
        await _secureStorage.write(key: _authTokenKey, value: token);
        final prefs = await _prefs();
        await prefs.remove(_authTokenKey);
        return;
      } catch (_) {
        // Fallback ke prefs bila secure storage tidak tersedia.
      }
    }
    final prefs = await _prefs();
    await prefs.setString(_authTokenKey, token);
  }

  static Future<void> clearAuthToken() async {
    if (!_isFlutterTest) {
      try {
        await _secureStorage.delete(key: _authTokenKey);
      } catch (_) {
        // Abaikan agar logout tetap bisa lanjut membersihkan fallback storage.
      }
    }
    final prefs = await _prefs();
    await prefs.remove(_authTokenKey);
  }

  static Future<String?> getActiveTrackingOrderRef() async {
    final prefs = await _prefs();
    return prefs.getString(_activeTrackingKey);
  }

  static Future<void> setActiveTrackingOrderRef(String orderId) async {
    final prefs = await _prefs();
    await prefs.setString(_activeTrackingKey, orderId);
  }

  static Future<void> clearActiveTrackingOrderRef() async {
    final prefs = await _prefs();
    await prefs.remove(_activeTrackingKey);
  }
}
