import 'package:flutter/material.dart';

import 'features/auth/presentation/login_page.dart';
import 'features/tracking/presentation/tracking_home_page.dart';
import 'shared/branding.dart';
import 'shared/theme.dart';

class DriverTrackingApp extends StatefulWidget {
  const DriverTrackingApp({super.key});

  @override
  State<DriverTrackingApp> createState() => _DriverTrackingAppState();
}

class _DriverTrackingAppState extends State<DriverTrackingApp> {
  DriverAppSession? _session;

  void _handleLogin(DriverAppSession session) {
    setState(() {
      _session = session;
    });
  }

  void _handleLogout() {
    setState(() {
      _session = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: gmsDriverAppTitle,
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: _session == null
          ? LoginPage(onLogin: _handleLogin)
          : TrackingHomePage(session: _session!, onLogout: _handleLogout),
    );
  }
}

class DriverAppSession {
  const DriverAppSession({
    required this.driverId,
    required this.driverName,
    required this.email,
    required this.role,
    this.driverRef,
    this.token,
    this.accessNotice,
  });

  final String driverId;
  final String driverName;
  final String email;
  final String role;
  final String? driverRef;
  final String? token;
  final DriverAccessNotice? accessNotice;
}

class DriverAccessNotice {
  const DriverAccessNotice({
    required this.scoreId,
    required this.scoreType,
    required this.title,
    required this.message,
    required this.blocking,
    required this.effectiveDate,
    required this.dueDate,
    required this.durationDays,
    this.notes,
    this.warningAcknowledgedAt,
  });

  final String scoreId;
  final String scoreType;
  final String title;
  final String message;
  final bool blocking;
  final String effectiveDate;
  final String dueDate;
  final int durationDays;
  final String? notes;
  final String? warningAcknowledgedAt;

  bool get isWarning => scoreType == 'WARNING';
}

DriverAccessNotice? parseDriverAccessNotice(dynamic value) {
  final json = value is Map<String, dynamic> ? value : null;
  if (json == null) {
    return null;
  }
  final scoreId = json['scoreId']?.toString();
  final scoreType = json['scoreType']?.toString();
  final title = json['title']?.toString();
  final message = json['message']?.toString();
  final effectiveDate = json['effectiveDate']?.toString() ?? '';
  final dueDate = json['dueDate']?.toString() ?? '';
  final durationDays = json['durationDays'] is num
      ? (json['durationDays'] as num).toInt()
      : 0;

  if (scoreId == null ||
      scoreType == null ||
      title == null ||
      message == null) {
    return null;
  }

  return DriverAccessNotice(
    scoreId: scoreId,
    scoreType: scoreType,
    title: title,
    message: message,
    blocking: json['blocking'] == true,
    effectiveDate: effectiveDate,
    dueDate: dueDate,
    durationDays: durationDays,
    notes: json['notes']?.toString(),
    warningAcknowledgedAt: json['warningAcknowledgedAt']?.toString(),
  );
}
