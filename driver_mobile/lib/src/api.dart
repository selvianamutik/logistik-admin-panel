import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://app-pytagotechs-projects.vercel.app',
);
const Duration _requestTimeout = Duration(seconds: 20);

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class DriverApi {
  static Uri _uri(String path) => Uri.parse('$apiBaseUrl$path');

  static Future<Map<String, dynamic>> _requestJson(
    String path, {
    String method = 'GET',
    String? token,
    Map<String, dynamic>? body,
  }) async {
    try {
      final headers = <String, String>{
        'Content-Type': 'application/json',
      };
      if (token != null && token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final request = http.Request(method, _uri(path));
      request.headers.addAll(headers);
      if (body != null) {
        request.body = jsonEncode(body);
      }

      final streamed = await request.send().timeout(_requestTimeout);
      final response = await http.Response.fromStream(streamed);
      final payload = _decodeJson(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ApiException(
          payload['error']?.toString() ??
              'Request gagal (${response.statusCode})',
          statusCode: response.statusCode,
        );
      }
      return payload;
    } on TimeoutException {
      throw ApiException(
        'Koneksi ke server terlalu lama. Periksa internet lalu coba lagi.',
      );
    } on http.ClientException {
      throw ApiException(
        'Gagal terhubung ke server. Periksa internet lalu coba lagi.',
      );
    }
  }

  static Map<String, dynamic> _decodeJson(String raw) {
    if (raw.trim().isEmpty) {
      return <String, dynamic>{};
    }
    try {
      final dynamic decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        return decoded;
      }
      return <String, dynamic>{};
    } on FormatException {
      throw ApiException('Respons server tidak valid.');
    }
  }

  static Future<DriverLoginPayload> loginDriver(
    String email,
    String password,
  ) async {
    final payload = await _requestJson(
      '/api/driver/mobile/login',
      method: 'POST',
      body: <String, dynamic>{
        'email': email,
        'password': password,
      },
    );

    return DriverLoginPayload(
      token: payload['token'] as String? ?? '',
      expiresIn: payload['expiresIn'] as int? ?? 0,
      user: DriverUser.fromJson(payload['user'] as Map<String, dynamic>? ?? <String, dynamic>{}),
      driver: DriverProfile.fromJson(payload['driver'] as Map<String, dynamic>? ?? <String, dynamic>{}),
      company: _parseCompany(payload['company']),
    );
  }

  static Future<DriverSessionPayload> fetchSession(String token) async {
    final payload = await _requestJson(
      '/api/driver/session',
      method: 'GET',
      token: token,
    );

    return DriverSessionPayload(
      user: DriverUser.fromJson(payload['user'] as Map<String, dynamic>? ?? <String, dynamic>{}),
      driver: DriverProfile.fromJson(payload['driver'] as Map<String, dynamic>? ?? <String, dynamic>{}),
      company: _parseCompany(payload['company']),
    );
  }

  static Future<List<DeliveryOrder>> fetchDeliveryOrders(String token) async {
    final payload = await _requestJson(
      '/api/driver/delivery-orders',
      method: 'GET',
      token: token,
    );

    final rawOrders = payload['data'];
    if (rawOrders is! List) {
      return const <DeliveryOrder>[];
    }

    return rawOrders
        .whereType<Map<String, dynamic>>()
        .map(DeliveryOrder.fromJson)
        .toList();
  }

  static Future<void> postTrackingAction(
    String token,
    String deliveryOrderRef,
    String action, {
    double? latitude,
    double? longitude,
    double? accuracyM,
    double? speedMps,
  }) async {
    await _requestJson(
      '/api/driver/tracking',
      method: 'POST',
      token: token,
      body: <String, dynamic>{
        'action': action,
        'deliveryOrderRef': deliveryOrderRef,
        'latitude': latitude,
        'longitude': longitude,
        'accuracyM': accuracyM,
        'speedMps': speedMps,
      },
    );
  }

  static Future<void> postDeliveryStatus(
    String token,
    String deliveryOrderRef,
    String status, {
    String? note,
  }) async {
    await _requestJson(
      '/api/driver/delivery-orders/status',
      method: 'POST',
      token: token,
      body: <String, dynamic>{
        'id': deliveryOrderRef,
        'status': status,
        'note': note,
      },
    );
  }

  static CompanySummary? _parseCompany(dynamic raw) {
    if (raw is Map<String, dynamic>) {
      return CompanySummary.fromJson(raw);
    }
    return null;
  }
}
