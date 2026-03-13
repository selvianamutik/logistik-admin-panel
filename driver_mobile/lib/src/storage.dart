import 'package:shared_preferences/shared_preferences.dart';

class DriverStorage {
  static const _authTokenKey = 'logistik-driver-auth-token';
  static const _activeTrackingKey = 'logistik-driver-active-tracking';

  static Future<SharedPreferences> _prefs() {
    return SharedPreferences.getInstance();
  }

  static Future<String?> getAuthToken() async {
    final prefs = await _prefs();
    return prefs.getString(_authTokenKey);
  }

  static Future<void> setAuthToken(String token) async {
    final prefs = await _prefs();
    await prefs.setString(_authTokenKey, token);
  }

  static Future<void> clearAuthToken() async {
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
