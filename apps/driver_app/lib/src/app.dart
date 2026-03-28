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
            'GPS mati. Aktifkan dulu sebelum memakai aplikasi driver.';
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
            'Izin lokasi dibutuhkan untuk kirim posisi driver.';
      });
      return;
    }

    if (permission == LocationPermission.deniedForever) {
      setState(() {
        _isPreparingLocation = false;
        _locationSetupError =
            'Izin lokasi diblokir. Buka pengaturan aplikasi dan aktifkan lagi.';
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
    this.token,
  });

  final String driverId;
  final String driverName;
  final String email;
  final String role;
  final String? driverRef;
  final String? token;
}

class _StartupLocationPage extends StatelessWidget {
  const _StartupLocationPage();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 42,
                height: 42,
                child: CircularProgressIndicator(color: scheme.primary),
              ),
              const SizedBox(height: 18),
              const Text(
                'Menyiapkan aplikasi driver',
                textAlign: TextAlign.center,
              ),
            ],
          ),
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
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 68,
                height: 68,
                decoration: BoxDecoration(
                  color: scheme.errorContainer,
                  borderRadius: BorderRadius.circular(22),
                ),
                child: Icon(
                  Icons.location_off_rounded,
                  size: 30,
                  color: scheme.error,
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Akses lokasi belum siap',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              Text(
                message,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: scheme.onSurface.withValues(alpha: 0.6),
                ),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () => onRetry(),
                child: const Text('Coba lagi'),
              ),
              const SizedBox(height: 10),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton(
                    onPressed: Geolocator.openAppSettings,
                    child: const Text('Izin app'),
                  ),
                  OutlinedButton(
                    onPressed: Geolocator.openLocationSettings,
                    child: const Text('Pengaturan GPS'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
