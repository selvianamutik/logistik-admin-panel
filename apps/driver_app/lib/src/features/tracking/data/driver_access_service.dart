import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app.dart';
import '../../../shared/config.dart';

class DriverAccessService {
  Future<DriverAppSession> fetchCurrentSession({
    required String sessionToken,
  }) async {
    final decoded = await _getCurrentSessionPayload(sessionToken: sessionToken);
    final userValue = decoded['user'];
    final user = userValue is Map<String, dynamic> ? userValue : null;
    if (user == null) {
      throw const DriverAccessException('Respons sesi driver tidak valid', 500);
    }
    final session = DriverAppSession.fromApiUserJson(
      user,
      token: sessionToken,
      refreshToken: decoded['refreshToken']?.toString(),
      accessNotice: parseDriverAccessNotice(decoded['driverAccessNotice']),
    );
    return session;
  }

  Future<DriverAppSession> refreshSession({
    required String refreshToken,
  }) async {
    final response = await http.post(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/mobile/refresh'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
      },
      body: jsonEncode({'refreshToken': refreshToken}),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal memperbarui sesi driver';
      throw DriverAccessException(message, response.statusCode);
    }

    final userValue = decoded['user'];
    final user = userValue is Map<String, dynamic> ? userValue : null;
    if (user == null) {
      throw const DriverAccessException(
        'Respons refresh sesi tidak valid',
        500,
      );
    }

    return DriverAppSession.fromApiUserJson(
      user,
      token: decoded['token']?.toString() ?? '',
      refreshToken: decoded['refreshToken']?.toString() ?? refreshToken,
      accessNotice: parseDriverAccessNotice(decoded['driverAccessNotice']),
    );
  }

  Future<DriverAccessNotice?> fetchCurrentAccessNotice({
    required String sessionToken,
  }) async {
    final decoded = await _getCurrentSessionPayload(sessionToken: sessionToken);
    final notice = parseDriverAccessNotice(decoded['driverAccessNotice']);
    return notice;
  }

  Future<Map<String, dynamic>> _getCurrentSessionPayload({
    required String sessionToken,
  }) async {
    final response = await http.get(
      Uri.parse(
        '${AppConfig.apiBaseUrl}/api/driver/session?_t=${DateTime.now().millisecondsSinceEpoch}',
      ),
      headers: {
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal memuat sesi driver';
      throw DriverAccessException(message, response.statusCode);
    }

    return decoded;
  }

  Future<DriverAccessNotice?> acknowledgeWarning({
    required String sessionToken,
    required String scoreId,
  }) async {
    final response = await http.post(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/scoring/acknowledge'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({'scoreId': scoreId}),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal memproses warning driver';
      throw DriverAccessException(message, response.statusCode);
    }

    final notice = parseDriverAccessNotice(decoded['driverAccessNotice']);
    return notice;
  }

  Map<String, dynamic> _decodeJson(String body) {
    if (body.isEmpty) return <String, dynamic>{};
    final decoded = jsonDecode(body);
    if (decoded is Map<String, dynamic>) {
      return decoded;
    }
    return <String, dynamic>{};
  }
}

class DriverAccessException implements Exception {
  const DriverAccessException(this.message, this.statusCode);

  final String message;
  final int statusCode;

  @override
  String toString() => 'DriverAccessException($statusCode): $message';
}
