import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import 'src/api.dart';
import 'src/models.dart';
import 'src/storage.dart';
import 'src/tracking_runtime.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await DriverTrackingRuntime.instance.hydrate();
  runApp(const DriverMobileApp());
}

class DriverMobileApp extends StatelessWidget {
  const DriverMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Logistik Driver',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0F4C81),
          primary: const Color(0xFF0F4C81),
        ),
        scaffoldBackgroundColor: const Color(0xFFF4F7FB),
        useMaterial3: true,
      ),
      home: const DriverHomePage(),
    );
  }
}

class DriverHomePage extends StatefulWidget {
  const DriverHomePage({super.key});

  @override
  State<DriverHomePage> createState() => _DriverHomePageState();
}

class _DriverHomePageState extends State<DriverHomePage>
    with WidgetsBindingObserver {
  final DriverTrackingRuntime _trackingRuntime = DriverTrackingRuntime.instance;
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  bool _booting = true;
  bool _submitting = false;
  bool _refreshing = false;
  String? _actionOrderId;
  String? _token;
  String? _persistedToken;
  DriverUser? _user;
  DriverProfile? _driver;
  CompanySummary? _company;
  List<DeliveryOrder> _orders = const <DeliveryOrder>[];
  String? _error;
  bool _trackingRuntimeHealthy = true;
  bool _hasStoredSession = false;
  int _hydrateSequence = 0;

  bool get _isMutating => _actionOrderId != null;

  DeliveryOrder? get _activeOrder =>
      _firstWhere(_orders, (order) => order.trackingState == TrackingState.active);

  DeliveryOrder? get _lockedTrackingOrder => _firstWhere(
        _orders,
        (order) =>
            order.trackingState == TrackingState.active ||
            order.trackingState == TrackingState.paused,
      );

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _trackingRuntime.changes.addListener(_handleTrackingRuntimeChanged);
    unawaited(_bootstrap());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _trackingRuntime.changes.removeListener(_handleTrackingRuntimeChanged);
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final resumableToken = _token ?? _persistedToken;
    if (state == AppLifecycleState.resumed &&
        !_isMutating &&
        resumableToken != null &&
        resumableToken.isNotEmpty) {
      unawaited(_hydrateDriverApp(resumableToken));
    }
  }

  void _handleTrackingRuntimeChanged() {
    final authFailure = _trackingRuntime.authFailureMessage;
    if (authFailure != null) {
      _trackingRuntime.clearAuthFailure();
      unawaited(_forceLogoutWithMessage(authFailure));
      return;
    }
    if (!mounted) {
      return;
    }
    setState(() {
      _trackingRuntimeHealthy = _deriveTrackingRuntimeHealthy(_orders);
    });
  }

  Future<void> _bootstrap() async {
    try {
      final storedToken = await DriverStorage.getAuthToken();
      if (storedToken == null || storedToken.isEmpty) {
        if (!mounted) {
          return;
        }
        setState(() {
          _persistedToken = null;
          _hasStoredSession = false;
          _booting = false;
        });
        return;
      }

      if (mounted) {
        setState(() {
          _persistedToken = storedToken;
          _hasStoredSession = true;
        });
      }

      await _hydrateDriverApp(storedToken, boot: true);
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() {
        _booting = false;
        _error =
            'Sesi tersimpan gagal dimuat. Coba sambungkan internet lalu tekan coba lagi.';
      });
    }
  }

  Future<void> _hydrateDriverApp(String token, {bool boot = false}) async {
    if (!mounted) {
      return;
    }
    final hydrateSequence = ++_hydrateSequence;

    setState(() {
      if (boot) {
        _booting = true;
      } else {
        _refreshing = true;
      }
    });

    try {
      final results = await Future.wait<dynamic>(<Future<dynamic>>[
        DriverApi.fetchSession(token),
        DriverApi.fetchDeliveryOrders(token),
      ]);
      final session = results[0] as DriverSessionPayload;
      final orders = results[1] as List<DeliveryOrder>;

      await _trackingRuntime.reconcileWithServer(_activeServerOrderId(orders));

      if (!mounted || hydrateSequence != _hydrateSequence) {
        return;
      }

      setState(() {
        _token = token;
        _persistedToken = token;
        _user = session.user;
        _driver = session.driver;
        _company = session.company;
        _orders = orders;
        _trackingRuntimeHealthy = _deriveTrackingRuntimeHealthy(orders);
        _hasStoredSession = true;
        _error = null;
      });
    } catch (error) {
      if (error is ApiException &&
          (error.statusCode == 401 || error.statusCode == 403)) {
        await DriverStorage.clearAuthToken();
        await _trackingRuntime.stopLocalOnly();
        if (!mounted || hydrateSequence != _hydrateSequence) {
          return;
        }
        setState(() {
          _token = null;
          _persistedToken = null;
          _user = null;
          _driver = null;
          _company = null;
          _orders = const <DeliveryOrder>[];
          _trackingRuntimeHealthy = true;
          _hasStoredSession = false;
          _error = error.message;
        });
      } else if (mounted && hydrateSequence == _hydrateSequence) {
        setState(() {
          _error = error.toString();
        });
      }
    } finally {
      if (mounted && hydrateSequence == _hydrateSequence) {
        setState(() {
          _booting = false;
          _refreshing = false;
        });
      }
    }
  }

  Future<void> _handleLogin() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    if (email.isEmpty || password.isEmpty) {
      _showSnackBar('Email dan password wajib diisi.');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final payload = await DriverApi.loginDriver(email, password);
      await DriverStorage.setAuthToken(payload.token);
      _passwordController.clear();
      if (mounted) {
        setState(() {
          _persistedToken = payload.token;
          _hasStoredSession = true;
        });
      }
      await _hydrateDriverApp(payload.token);
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = error.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
        });
      }
    }
  }

  Future<void> _refreshOrders() async {
    final token = _token;
    if (token == null || token.isEmpty || _refreshing || _isMutating) {
      return;
    }
    await _hydrateDriverApp(token);
  }

  Future<void> _handleTrackingAction(
    DeliveryOrder order,
    String action,
  ) async {
    final token = _token;
    if (token == null || token.isEmpty || _isMutating) {
      return;
    }

    setState(() {
      _actionOrderId = order.id;
    });

    try {
      await _trackingRuntime.ensureLocationPermissions();
      final currentPosition = await _trackingRuntime.getCurrentLocation();

      await DriverApi.postTrackingAction(
        token,
        order.id,
        action,
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
        accuracyM: currentPosition.accuracy,
        speedMps: currentPosition.speed,
      );

      try {
        await _trackingRuntime.startHeartbeatStream(
          token: token,
          orderId: order.id,
        );
      } catch (runtimeError) {
        await DriverApi.postTrackingAction(
          token,
          order.id,
          'rollback-start',
        );
        rethrow;
      }

      await _refreshOrders();
      _showSnackBar(
        action == 'resume'
            ? 'Tracking dipulihkan lagi. Biarkan GPS dan internet tetap menyala sampai admin menutup DO.'
            : 'Tracking background aktif. Driver tidak bisa menghentikannya sendiri sebelum admin menyelesaikan DO.',
      );
    } catch (error) {
      if (error is ApiException &&
          (error.statusCode == 401 || error.statusCode == 403)) {
        await _forceLogoutWithMessage(error.message);
      }
      _showSnackBar(error.toString());
    } finally {
      if (mounted) {
        setState(() {
          _actionOrderId = null;
        });
      }
    }
  }

  Future<void> _handleDeliveryProgress(
    DeliveryOrder order,
    DeliveryOrderStatus nextStatus,
  ) async {
    final token = _token;
    if (token == null || token.isEmpty || _isMutating) {
      return;
    }

    setState(() {
      _actionOrderId = order.id;
    });

    try {
      await DriverApi.postDeliveryStatus(
        token,
        order.id,
        _toDeliveryStatusPayload(nextStatus),
      );
      await _refreshOrders();
      _showSnackBar(_deliveryProgressSuccessMessage(nextStatus));
    } catch (error) {
      if (error is ApiException &&
          (error.statusCode == 401 || error.statusCode == 403)) {
        await _forceLogoutWithMessage(error.message);
      }
      _showSnackBar(error.toString());
    } finally {
      if (mounted) {
        setState(() {
          _actionOrderId = null;
        });
      }
    }
  }

  Future<void> _handleOpenMap(DeliveryOrder order) async {
    final lat = order.trackingLastLat;
    final lng = order.trackingLastLng;
    if (lat == null || lng == null) {
      return;
    }

    final uri = Uri.parse('https://www.google.com/maps?q=$lat,$lng');
    final launched =
        await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!launched && mounted) {
      _showSnackBar('Gagal membuka Maps di perangkat ini.');
    }
  }

  Future<void> _handleLogout() async {
    if (_isMutating) {
      _showSnackBar('Tunggu proses yang sedang berjalan selesai dulu.');
      return;
    }
    final lockedOrder = _lockedTrackingOrder ?? _findOrderById(_trackingRuntime.activeOrderId);
    if (lockedOrder != null) {
      await showDialog<void>(
        context: context,
        builder: (context) {
          return AlertDialog(
            title: const Text('DO masih berjalan'),
            content: Text(
              'Kamu masih terikat ke ${lockedOrder.doNumber}. Driver tidak boleh logout sebelum admin benar-benar menyelesaikan DO ini.',
            ),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Tutup'),
              ),
            ],
          );
        },
      );
      return;
    }

    if (_trackingRuntime.isRunning) {
      _showSnackBar(
        'Runtime tracking lokal masih aktif. Refresh dulu dan pastikan admin sudah menutup DO sebelum logout.',
      );
      return;
    }

    await _trackingRuntime.stopLocalOnly();
    await DriverStorage.clearAuthToken();
    if (!mounted) {
      return;
    }

    setState(() {
      _token = null;
      _persistedToken = null;
      _user = null;
      _driver = null;
      _company = null;
      _orders = const <DeliveryOrder>[];
      _trackingRuntimeHealthy = true;
      _hasStoredSession = false;
      _error = null;
    });
  }

  Future<void> _forceLogoutWithMessage(String message) async {
    await DriverStorage.clearAuthToken();
    await _trackingRuntime.stopLocalOnly();
    if (!mounted) {
      return;
    }
    setState(() {
      _token = null;
      _persistedToken = null;
      _user = null;
      _driver = null;
      _company = null;
      _orders = const <DeliveryOrder>[];
      _trackingRuntimeHealthy = true;
      _hasStoredSession = false;
      _error = message;
    });
  }

  Future<void> _clearStoredSessionAndShowLogin() async {
    if (_trackingRuntime.activeOrderId != null || _trackingRuntime.isRunning) {
      _showSnackBar(
        'Tracking lokal masih terikat ke DO. Sambungkan lagi ke server dulu sebelum login ulang.',
      );
      return;
    }
    await DriverStorage.clearAuthToken();
    await _trackingRuntime.stopLocalOnly();
    if (!mounted) {
      return;
    }
    setState(() {
      _token = null;
      _persistedToken = null;
      _user = null;
      _driver = null;
      _company = null;
      _orders = const <DeliveryOrder>[];
      _trackingRuntimeHealthy = true;
      _hasStoredSession = false;
      _error = null;
    });
  }

  bool _deriveTrackingRuntimeHealthy(List<DeliveryOrder> orders) {
    final activeOrder = _firstWhere(
      orders,
      (order) => order.trackingState == TrackingState.active,
    );
    if (activeOrder == null) {
      return true;
    }
    return _trackingRuntime.isRunningFor(activeOrder.id) &&
        !_trackingRuntime.hasCriticalHeartbeatFailure;
  }

  String? _activeServerOrderId(List<DeliveryOrder> orders) {
    final activeOrder = _firstWhere(
      orders,
      (order) => order.trackingState == TrackingState.active,
    );
    return activeOrder?.id;
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    if (_booting) {
      return const Scaffold(
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('Memuat aplikasi driver...'),
            ],
          ),
        ),
      );
    }

    if (_token == null || _user == null || _driver == null) {
      if (_hasStoredSession && _persistedToken != null) {
        return _buildReconnectScreen();
      }
      return _buildLoginScreen();
    }

    return _buildDashboard();
  }

  Widget _buildLoginScreen() {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Card(
                elevation: 2,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'LOGISTIK DRIVER',
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                              color: const Color(0xFF0F4C81),
                              fontWeight: FontWeight.w800,
                              letterSpacing: 1.1,
                            ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Masuk ke APK Driver',
                        style:
                            Theme.of(context).textTheme.headlineMedium?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Login dengan akun mobile driver yang dibuat oleh admin. Android paling stabil untuk tracking background; iOS tetap lebih ketat dan bisa berhenti bila izin atau sistem membatasi lokasi.',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: const Color(0xFF475569),
                              height: 1.45,
                            ),
                      ),
                      const SizedBox(height: 20),
                      TextField(
                        controller: _emailController,
                        keyboardType: TextInputType.emailAddress,
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(
                          labelText: 'Email driver',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _passwordController,
                        obscureText: true,
                        onSubmitted: (_) => _submitting ? null : _handleLogin(),
                        decoration: const InputDecoration(
                          labelText: 'Password',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      if (_error != null) ...<Widget>[
                        const SizedBox(height: 12),
                        Text(
                          _error!,
                          style: const TextStyle(
                            color: Color(0xFFB91C1C),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                      const SizedBox(height: 20),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: _submitting ? null : _handleLogin,
                          child: _submitting
                              ? const SizedBox(
                                  height: 20,
                                  width: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2.4,
                                    color: Colors.white,
                                  ),
                                )
                              : const Text('Masuk'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildReconnectScreen() {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Card(
                elevation: 2,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'Sesi tersimpan ditemukan',
                        style:
                            Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _error ??
                            'Aplikasi belum bisa menyinkronkan data driver dari server.',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: const Color(0xFF475569),
                              height: 1.45,
                            ),
                      ),
                      const SizedBox(height: 20),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          onPressed: _refreshing || _persistedToken == null
                              || _isMutating
                              ? null
                              : () => _hydrateDriverApp(
                                    _persistedToken!,
                                    boot: true,
                                  ),
                          icon: _refreshing
                              ? const SizedBox(
                                  height: 18,
                                  width: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2.2,
                                    color: Colors.white,
                                  ),
                                )
                              : const Icon(Icons.refresh),
                          label: const Text('Coba Lagi'),
                        ),
                      ),
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton(
                          onPressed: _refreshing
                              || _isMutating
                              ? null
                              : _clearStoredSessionAndShowLogin,
                          child: const Text('Login Ulang'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildDashboard() {
    final activeOrder = _activeOrder;
    final lockedOrder = _lockedTrackingOrder;
    final companyName = _company?.name.isNotEmpty == true
        ? _company!.name
        : 'LOGISTIK';

    return Scaffold(
      appBar: AppBar(
        title: Text(companyName),
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh',
            onPressed: (_refreshing || _isMutating) ? null : _refreshOrders,
            icon: _refreshing
                ? const SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Keluar',
            onPressed: _isMutating ? null : _handleLogout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refreshOrders,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            _buildHeaderCard(),
            const SizedBox(height: 16),
            _buildInfoCard(activeOrder, lockedOrder),
            const SizedBox(height: 16),
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    'DO Aktif Driver',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                ),
              ],
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: const TextStyle(
                  color: Color(0xFFB91C1C),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
            const SizedBox(height: 12),
            if (_orders.isEmpty)
              _buildEmptyCard()
            else
              ..._orders.map(_buildOrderCard),
          ],
        ),
      ),
    );
  }

  Widget _buildHeaderCard() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    (_company?.name ?? 'LOGISTIK').toUpperCase(),
                    style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: const Color(0xFF0F4C81),
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.0,
                        ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _driver?.name ?? '-',
                    style:
                        Theme.of(context).textTheme.headlineSmall?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    (_driver!.phone.isNotEmpty ? _driver!.phone : _user?.email) ??
                        '-',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: const Color(0xFF475569),
                        ),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFEFF6FF),
                borderRadius: BorderRadius.circular(18),
              ),
              child: const Icon(
                Icons.local_shipping_rounded,
                color: Color(0xFF0F4C81),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoCard(DeliveryOrder? activeOrder, DeliveryOrder? lockedOrder) {
    return Card(
      color: const Color(0xFF0F4C81),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              'Tracking background driver',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: 10),
            const Text(
              'Saat tracking aktif, aplikasi akan menjalankan service lokasi dan mengirim heartbeat ke dashboard admin. Driver juga bisa mengirim progres perjalanan sampai status tiba. Penyelesaian akhir DO tetap dilakukan admin. Android paling stabil; di iPhone pastikan izin lokasi Always aktif dan aplikasi tidak di-force close.',
              style: TextStyle(
                color: Color(0xFFDBEAFE),
                height: 1.45,
              ),
            ),
            const SizedBox(height: 14),
            _buildInfoRow('DO terkunci', lockedOrder?.doNumber ?? 'Belum ada'),
            if (!_trackingRuntimeHealthy && activeOrder != null) ...<Widget>[
              const SizedBox(height: 12),
              Text(
                _trackingRuntime.isRunningFor(activeOrder.id)
                    ? 'Tracking lokal masih berjalan, tetapi heartbeat ke server sedang gagal. Periksa internet dan GPS. Error terakhir: ${_trackingRuntime.lastHeartbeatError ?? 'tidak diketahui'}.'
                    : 'Server mencatat tracking aktif untuk ${activeOrder.doNumber}, tetapi runtime lokasi di perangkat tidak sedang berjalan. Tekan Pulihkan Tracking agar heartbeat aktif lagi.',
                style: const TextStyle(
                  color: Color(0xFFFEF3C7),
                  fontWeight: FontWeight.w700,
                  height: 1.4,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Row(
      children: <Widget>[
        Expanded(
          child: Text(
            label,
            style: const TextStyle(
              color: Color(0xFFBFDBFE),
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }

  Widget _buildEmptyCard() {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      child: const Padding(
        padding: EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              'Belum ada DO',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
              ),
            ),
            SizedBox(height: 8),
            Text(
              'Belum ada surat jalan yang ditugaskan ke akun driver ini.',
              style: TextStyle(color: Color(0xFF64748B)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildOrderCard(DeliveryOrder order) {
    final busy = _actionOrderId == order.id;
    final activeOrder = _activeOrder;
    final lockedOrder = _lockedTrackingOrder;
    final canStartNew = lockedOrder == null || lockedOrder.id == order.id;
    final showRestore = order.trackingState == TrackingState.active &&
        activeOrder?.id == order.id &&
        !_trackingRuntimeHealthy;
    final interactionLocked = _isMutating && _actionOrderId != order.id;
    final nextDriverProgress = _nextDriverProgressStatus(order);

    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        order.doNumber,
                        style:
                            Theme.of(context).textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${order.masterResi ?? '-'} | ${_formatDate(order.date)}',
                        style: const TextStyle(color: Color(0xFF64748B)),
                      ),
                    ],
                  ),
                ),
                _buildTrackingBadge(order.trackingState),
              ],
            ),
            const SizedBox(height: 14),
            _buildMetaRow('Customer', order.customerName ?? '-'),
            _buildMetaRow('Status DO', _formatDeliveryOrderStatus(order.status)),
            _buildMetaRow('Tujuan', order.receiverAddress ?? '-'),
            _buildMetaRow('Kendaraan', order.vehiclePlate ?? '-'),
            _buildMetaRow('Last seen', _formatDateTime(order.trackingLastSeenAt)),
            if (order.trackingLastLat != null && order.trackingLastLng != null)
              TextButton.icon(
                onPressed: () => _handleOpenMap(order),
                icon: const Icon(Icons.map_outlined),
                label: const Text('Buka lokasi terakhir di Maps'),
              ),
            const SizedBox(height: 8),
            if (order.trackingState == TrackingState.active && !showRestore) ...<Widget>[
              if (nextDriverProgress != null) ...<Widget>[
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: busy
                        || interactionLocked
                        ? null
                        : () => _handleDeliveryProgress(
                              order,
                              nextDriverProgress,
                            ),
                    icon: const Icon(Icons.route),
                    label: Text(
                      _driverProgressButtonLabel(nextDriverProgress),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
              ],
              _buildNotice(
                'Tracking harus tetap aktif sampai admin menyelesaikan DO ini. Driver tidak bisa menjeda atau menghentikannya sendiri.',
              ),
            ]
            else if (order.trackingState == TrackingState.paused)
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: busy || order.isClosed
                          || interactionLocked
                          ? null
                          : () => _handleTrackingAction(order, 'resume'),
                      child: busy
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.4,
                                color: Colors.white,
                              ),
                            )
                          : const Text('Lanjutkan Tracking'),
                    ),
                  ),
                  const SizedBox(height: 8),
                  _buildNotice(
                    'Status jeda ini hanya untuk data lama. Tracking harus dipulihkan sampai admin benar-benar menutup DO.',
                  ),
                ],
              )
            else
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: busy || order.isClosed || !canStartNew
                      || interactionLocked
                      ? null
                      : () => _handleTrackingAction(
                            order,
                            showRestore ? 'resume' : 'start',
                          ),
                  child: busy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.4,
                            color: Colors.white,
                          ),
                        )
                      : Text(showRestore
                          ? 'Pulihkan Tracking'
                          : 'Mulai Tracking'),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildTrackingBadge(TrackingState state) {
    late final Color color;
    late final String label;

    switch (state) {
      case TrackingState.active:
        color = const Color(0xFF0F766E);
        label = 'Tracking Aktif';
        break;
      case TrackingState.paused:
        color = const Color(0xFFB45309);
        label = 'Tracking Dijeda';
        break;
      case TrackingState.stopped:
        color = const Color(0xFF475569);
        label = 'Tracking Selesai';
        break;
      case TrackingState.idle:
        color = const Color(0xFF64748B);
        label = 'Belum Tracking';
        break;
    }

    return Chip(
      backgroundColor: color,
      side: BorderSide.none,
      label: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  Widget _buildMetaRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              color: Color(0xFF64748B),
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: const TextStyle(
              fontSize: 15,
              color: Color(0xFF0F172A),
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNotice(String message) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF6FF),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(
        message,
        style: const TextStyle(
          color: Color(0xFF1E3A8A),
          fontWeight: FontWeight.w700,
          height: 1.4,
        ),
      ),
    );
  }

  String _formatDate(String? value) {
    if (value == null || value.isEmpty) {
      return '-';
    }

    try {
      return DateFormat('dd/MM/yyyy').format(DateTime.parse(value));
    } catch (_) {
      return value;
    }
  }

  String _formatDateTime(String? value) {
    if (value == null || value.isEmpty) {
      return '-';
    }

    try {
      return DateFormat('dd/MM/yyyy HH:mm').format(DateTime.parse(value));
    } catch (_) {
      return value;
    }
  }

  String _formatDeliveryOrderStatus(DeliveryOrderStatus status) {
    switch (status) {
      case DeliveryOrderStatus.headingToPickup:
        return 'Menuju Pickup';
      case DeliveryOrderStatus.onDelivery:
        return 'Dalam Pengiriman';
      case DeliveryOrderStatus.arrived:
        return 'Sudah Tiba';
      case DeliveryOrderStatus.delivered:
        return 'Selesai';
      case DeliveryOrderStatus.cancelled:
        return 'Dibatalkan';
      case DeliveryOrderStatus.created:
        return 'Siap Berangkat';
    }
  }

  DeliveryOrderStatus? _nextDriverProgressStatus(DeliveryOrder order) {
    if (order.trackingState != TrackingState.active || order.isClosed) {
      return null;
    }

    switch (order.status) {
      case DeliveryOrderStatus.headingToPickup:
        return DeliveryOrderStatus.onDelivery;
      case DeliveryOrderStatus.onDelivery:
        return DeliveryOrderStatus.arrived;
      case DeliveryOrderStatus.created:
      case DeliveryOrderStatus.arrived:
      case DeliveryOrderStatus.delivered:
      case DeliveryOrderStatus.cancelled:
        return null;
    }
  }

  String _driverProgressButtonLabel(DeliveryOrderStatus nextStatus) {
    switch (nextStatus) {
      case DeliveryOrderStatus.onDelivery:
        return 'Tandai Dalam Pengiriman';
      case DeliveryOrderStatus.arrived:
        return 'Tandai Sudah Tiba';
      case DeliveryOrderStatus.created:
      case DeliveryOrderStatus.headingToPickup:
      case DeliveryOrderStatus.delivered:
      case DeliveryOrderStatus.cancelled:
        return 'Kirim Progres';
    }
  }

  String _toDeliveryStatusPayload(DeliveryOrderStatus status) {
    switch (status) {
      case DeliveryOrderStatus.headingToPickup:
        return 'HEADING_TO_PICKUP';
      case DeliveryOrderStatus.onDelivery:
        return 'ON_DELIVERY';
      case DeliveryOrderStatus.arrived:
        return 'ARRIVED';
      case DeliveryOrderStatus.delivered:
        return 'DELIVERED';
      case DeliveryOrderStatus.cancelled:
        return 'CANCELLED';
      case DeliveryOrderStatus.created:
        return 'CREATED';
    }
  }

  String _deliveryProgressSuccessMessage(DeliveryOrderStatus status) {
    switch (status) {
      case DeliveryOrderStatus.onDelivery:
        return 'Status DO diperbarui menjadi dalam pengiriman.';
      case DeliveryOrderStatus.arrived:
        return 'Status DO diperbarui menjadi sudah tiba.';
      case DeliveryOrderStatus.created:
      case DeliveryOrderStatus.headingToPickup:
      case DeliveryOrderStatus.delivered:
      case DeliveryOrderStatus.cancelled:
        return 'Progres perjalanan berhasil diperbarui.';
    }
  }

  DeliveryOrder? _firstWhere(
    List<DeliveryOrder> orders,
    bool Function(DeliveryOrder) test,
  ) {
    for (final order in orders) {
      if (test(order)) {
        return order;
      }
    }
    return null;
  }

  DeliveryOrder? _findOrderById(String? orderId) {
    if (orderId == null || orderId.isEmpty) {
      return null;
    }
    return _firstWhere(_orders, (order) => order.id == orderId);
  }
}
