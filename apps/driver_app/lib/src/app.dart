import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import 'features/auth/presentation/login_page.dart';
import 'features/tracking/presentation/tracking_home_page.dart';
import 'shared/theme.dart';

class DriverTrackingApp extends StatefulWidget {
  const DriverTrackingApp({super.key});

  @override
  State<DriverTrackingApp> createState() => _DriverTrackingAppState();
}

class _DriverTrackingAppState extends State<DriverTrackingApp> {
  DriverAppSession? _session;
  bool _isPreparingLocation = true;
  String? _locationSetupError;

  @override
  void initState() {
    super.initState();
    _requestLocationAccessOnLaunch();
  }

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

  Future<void> _requestLocationAccessOnLaunch() async {
    setState(() {
      _isPreparingLocation = true;
      _locationSetupError = null;
    });

    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      if (!mounted) return;
      setState(() {
        _isPreparingLocation = false;
        _locationSetupError =
            'GPS is turned off. Enable location services before using the driver app.';
      });
      return;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    if (!mounted) return;

    if (permission == LocationPermission.denied) {
      setState(() {
        _isPreparingLocation = false;
        _locationSetupError =
            'Location permission is required to track driver position.';
      });
      return;
    }

    if (permission == LocationPermission.deniedForever) {
      setState(() {
        _isPreparingLocation = false;
        _locationSetupError =
            'Location permission is permanently denied. Open app settings and allow location access.';
      });
      return;
    }

    setState(() {
      _isPreparingLocation = false;
      _locationSetupError = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Logistik Driver',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: _isPreparingLocation
          ? const _StartupLocationPage()
          : _locationSetupError != null
          ? _LocationSetupErrorPage(
              message: _locationSetupError!,
              onRetry: _requestLocationAccessOnLaunch,
            )
          : _session == null
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
  });

  final String driverId;
  final String driverName;
  final String email;
  final String role;
  final String? driverRef;
}

class _StartupLocationPage extends StatelessWidget {
  const _StartupLocationPage();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Loading App...'),
          ],
        ),
      ),
    );
  }
}

class _LocationSetupErrorPage extends StatelessWidget {
  const _LocationSetupErrorPage({required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.location_off_rounded, size: 42),
              const SizedBox(height: 16),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => onRetry(),
                child: const Text('Retry'),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: Geolocator.openAppSettings,
                child: const Text('Open app settings'),
              ),
              TextButton(
                onPressed: Geolocator.openLocationSettings,
                child: const Text('Open GPS settings'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
