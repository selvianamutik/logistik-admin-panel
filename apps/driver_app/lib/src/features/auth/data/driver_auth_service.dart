import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../../../app.dart';
import '../../../shared/config.dart';

class DriverAuthService {
  Future<DriverAppSession> login({
    required String email,
    required String password,
  }) async {
    final uri = Uri.parse('${AppConfig.apiBaseUrl}/api/auth/login');
    final headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-client-type': 'driver-app',
    };
debugPrint('=== LOGIN HEADERS ===');
headers.forEach((key, value) => debugPrint('  $key: $value'));
    final response = await http.post(
      uri,
      headers: headers,
      body: jsonEncode({
        'email': email.trim().toLowerCase(),
        'password': password,
        'scope': 'DRIVER',
      }),
    );
debugPrint('=== LOGIN ===');
debugPrint('URL: $uri');
debugPrint('STATUS: ${response.statusCode}');
debugPrint('BODY: ${response.body}');
    final decoded = _decodeJson(response.body);

    if (response.statusCode >= 400) {
      final errorMessage = decoded['error'] is String
          ? decoded['error'] as String
          : 'Login gagal';
      throw DriverAuthException(errorMessage, response.statusCode);
    }

    final dynamic userValue = decoded['user'];
    final user = userValue is Map<String, dynamic> ? userValue : null;
    if (user == null) {
      throw const DriverAuthException('Respons login tidak valid', 500);
    }

    final driverRef = user['driverRef'];
    if (driverRef is! String || driverRef.isEmpty) {
      throw const DriverAuthException(
        'Akun driver belum terhubung ke data supir',
        409,
      );
    }

    return DriverAppSession(
      driverId: user['_id'] as String? ?? '',
      driverName: user['name'] as String? ?? '',
      email: user['email'] as String? ?? email,
      role: user['role'] as String? ?? 'DRIVER',
      driverRef: driverRef,
      token: decoded['token'] as String?,
    );
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

class DriverAuthException implements Exception {
  const DriverAuthException(this.message, this.statusCode);

  final String message;
  final int statusCode;

  @override
  String toString() => 'DriverAuthException($statusCode): $message';
}
