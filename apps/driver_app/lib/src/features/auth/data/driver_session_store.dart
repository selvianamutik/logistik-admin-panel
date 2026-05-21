import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../../app.dart';

class DriverSessionStore {
  static const _sessionKey = 'driver_app.session.v1';

  Future<DriverAppSession?> load() async {
    final prefs = await SharedPreferences.getInstance();
    final rawSession = prefs.getString(_sessionKey);
    if (rawSession == null || rawSession.trim().isEmpty) {
      return null;
    }

    try {
      final decoded = jsonDecode(rawSession);
      if (decoded is! Map<String, dynamic>) {
        await clear();
        return null;
      }
      final session = DriverAppSession.fromJson(decoded);
      if ((session.token ?? '').isEmpty || session.driverId.isEmpty) {
        await clear();
        return null;
      }
      return session;
    } catch (_) {
      await clear();
      return null;
    }
  }

  Future<void> save(DriverAppSession session) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_sessionKey, jsonEncode(session.toJson()));
  }

  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_sessionKey);
  }
}
