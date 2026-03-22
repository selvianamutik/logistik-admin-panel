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
        cardTheme: CardThemeData(
          elevation: 0,
          margin: EdgeInsets.zero,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(28),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 16,
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(18),
            borderSide: const BorderSide(color: Color(0xFFD7E2F0)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(18),
            borderSide: const BorderSide(color: Color(0xFFD7E2F0)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(18),
            borderSide: const BorderSide(
              color: Color(0xFF0F4C81),
              width: 1.4,
            ),
          ),
        ),
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

  List<DeliveryOrder> get _visibleOrders {
    final lockedOrder = _lockedTrackingOrder;
    if (lockedOrder != null) {
      return <DeliveryOrder>[lockedOrder];
    }

    final orders = List<DeliveryOrder>.of(_orders);
    orders.sort((left, right) {
      final byDate = right.date.compareTo(left.date);
      if (byDate != 0) {
        return byDate;
      }
      return right.doNumber.compareTo(left.doNumber);
    });
    return orders;
  }

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

  Future<void> _refreshOrders({bool allowDuringMutation = false}) async {
    final token = _token;
    if (token == null ||
        token.isEmpty ||
        _refreshing ||
        (!allowDuringMutation && _isMutating)) {
      return;
    }
    await _hydrateDriverApp(token);
  }

  void _applyOrderUpdate(DeliveryOrder updatedOrder) {
    if (!mounted) {
      return;
    }

    final nextOrders = _orders
        .map((order) => order.id == updatedOrder.id ? updatedOrder : order)
        .toList(growable: false);

    setState(() {
      _orders = nextOrders;
      _trackingRuntimeHealthy = _deriveTrackingRuntimeHealthy(nextOrders);
    });
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
      final permissionState = await _trackingRuntime.ensureLocationPermissions();
      final currentPosition = await _trackingRuntime.getCurrentLocation();

      final updatedOrder = await DriverApi.postTrackingAction(
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

      if (updatedOrder != null) {
        _applyOrderUpdate(updatedOrder);
      }
      await _refreshOrders(allowDuringMutation: true);
      final successMessage =
        action == 'resume'
            ? 'Tracking dipulihkan lagi. Biarkan GPS dan internet tetap menyala sampai admin menutup DO.'
            : permissionState.hasBackgroundAccess
                ? 'Tracking background aktif. Driver tidak bisa menghentikannya sendiri sebelum admin menyelesaikan DO.'
                : 'Tracking aktif saat aplikasi terbuka. Driver tidak bisa menghentikannya sendiri sebelum admin menyelesaikan DO.';
      _showSnackBar(
        permissionState.advisoryMessage == null
            ? successMessage
            : '$successMessage ${permissionState.advisoryMessage}',
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
      final updatedOrder = await DriverApi.postDeliveryStatus(
        token,
        order.id,
        _toDeliveryStatusPayload(nextStatus),
      );
      if (updatedOrder != null) {
        _applyOrderUpdate(updatedOrder);
      }
      await _refreshOrders(allowDuringMutation: true);
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
      return Scaffold(
        body: Center(
          child: Container(
            margin: const EdgeInsets.all(24),
            padding: const EdgeInsets.all(28),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(28),
            ),
            child: const Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                CircularProgressIndicator(),
                SizedBox(height: 16),
                Text(
                  'Memuat aplikasi driver...',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
              ],
            ),
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
                clipBehavior: Clip.antiAlias,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.fromLTRB(24, 24, 24, 22),
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          colors: <Color>[
                            Color(0xFF0F4C81),
                            Color(0xFF155E75),
                          ],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: Colors.white24,
                              borderRadius: BorderRadius.circular(18),
                            ),
                            child: const Icon(
                              Icons.local_shipping_rounded,
                              color: Colors.white,
                              size: 26,
                            ),
                          ),
                          const SizedBox(height: 18),
                          Text(
                            'LOGISTIK DRIVER',
                            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                                  color: const Color(0xFFDCEBFF),
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: 1.1,
                                ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Masuk ke APK Driver',
                            style:
                                Theme.of(context).textTheme.headlineMedium?.copyWith(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800,
                                    ),
                          ),
                          const SizedBox(height: 10),
                          const Text(
                            'Gunakan akun mobile driver dari admin. Android paling stabil untuk tracking background.',
                            style: TextStyle(
                              color: Color(0xFFDCEBFF),
                              height: 1.45,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF0F9FF),
                              borderRadius: BorderRadius.circular(18),
                            ),
                            child: const Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Icon(
                                  Icons.info_outline,
                                  color: Color(0xFF0F4C81),
                                  size: 20,
                                ),
                                SizedBox(width: 10),
                                Expanded(
                                  child: Text(
                                    'Pastikan GPS aktif dan internet stabil agar last seen cepat muncul di dashboard admin.',
                                    style: TextStyle(
                                      color: Color(0xFF1E3A8A),
                                      fontWeight: FontWeight.w600,
                                      height: 1.4,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 20),
                          TextField(
                            controller: _emailController,
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              labelText: 'Email driver',
                              prefixIcon: Icon(Icons.mail_outline),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _passwordController,
                            obscureText: true,
                            onSubmitted: (_) => _submitting ? null : _handleLogin(),
                            decoration: const InputDecoration(
                              labelText: 'Password',
                              prefixIcon: Icon(Icons.lock_outline),
                            ),
                          ),
                          if (_error != null) ...<Widget>[
                            const SizedBox(height: 14),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(14),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFEF2F2),
                                borderRadius: BorderRadius.circular(16),
                              ),
                              child: Text(
                                _error!,
                                style: const TextStyle(
                                  color: Color(0xFFB91C1C),
                                  fontWeight: FontWeight.w700,
                                  height: 1.4,
                                ),
                              ),
                            ),
                          ],
                          const SizedBox(height: 20),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton(
                              style: FilledButton.styleFrom(
                                padding: const EdgeInsets.symmetric(vertical: 16),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(18),
                                ),
                              ),
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
                  ],
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
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEFF6FF),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: const Icon(
                          Icons.wifi_find_rounded,
                          color: Color(0xFF0F4C81),
                        ),
                      ),
                      const SizedBox(height: 16),
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
                          style: FilledButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(18),
                            ),
                          ),
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
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(18),
                            ),
                          ),
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
    final visibleOrders = _visibleOrders;
    final trackedOrderCount = _orders
        .where((order) => order.trackingState == TrackingState.active)
        .length;
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
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: <Widget>[
                _buildSummaryPill(
                  'DO Aktif',
                  visibleOrders.length.toString(),
                  const Color(0xFFEFF6FF),
                  const Color(0xFF0F4C81),
                ),
                _buildSummaryPill(
                  'Tracking Aktif',
                  trackedOrderCount.toString(),
                  const Color(0xFFECFDF5),
                  const Color(0xFF0F766E),
                ),
                _buildSummaryPill(
                  'DO Terkunci',
                  lockedOrder == null ? 'Tidak' : 'Ya',
                  const Color(0xFFFFF7ED),
                  const Color(0xFFC2410C),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Text(
              'DO Aktif Driver',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: 4),
            Text(
              lockedOrder == null
                  ? 'Tampilkan hanya DO yang masih operasional agar driver tidak bingung.'
                  : 'Tracking sedang terkunci di ${lockedOrder.doNumber}. Fokuskan driver ke DO ini sampai admin menutupnya.',
              style: const TextStyle(
                color: Color(0xFF64748B),
                height: 1.4,
              ),
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF2F2),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(
                  _error!,
                  style: const TextStyle(
                    color: Color(0xFFB91C1C),
                    fontWeight: FontWeight.w700,
                    height: 1.4,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 12),
            if (visibleOrders.isEmpty)
              _buildEmptyCard()
            else
              ...visibleOrders.map(_buildOrderCard),
          ],
        ),
      ),
    );
  }

  Widget _buildHeaderCard() {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: <Color>[
              Color(0xFF0F4C81),
              Color(0xFF155E75),
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(22),
          child: Row(
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      (_company?.name ?? 'LOGISTIK').toUpperCase(),
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                            color: const Color(0xFFDCEBFF),
                            fontWeight: FontWeight.w800,
                            letterSpacing: 1.0,
                          ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _driver?.name ?? '-',
                      style:
                          Theme.of(context).textTheme.headlineSmall?.copyWith(
                                color: Colors.white,
                                fontWeight: FontWeight.w800,
                              ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      (_driver!.phone.isNotEmpty ? _driver!.phone : _user?.email) ??
                          '-',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: const Color(0xFFDCEBFF),
                          ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white24,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Icon(
                  Icons.local_shipping_rounded,
                  color: Colors.white,
                  size: 28,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInfoCard(DeliveryOrder? activeOrder, DeliveryOrder? lockedOrder) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              'Status Tracking Driver',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: 10),
            const Text(
              'Saat tracking aktif, aplikasi akan menjalankan service lokasi dan mengirim heartbeat ke dashboard admin. Driver juga bisa mengirim progres perjalanan sampai status tiba. Penyelesaian akhir DO tetap dilakukan admin. Android paling stabil; di iPhone pastikan izin lokasi Always aktif dan aplikasi tidak di-force close.',
              style: TextStyle(color: Color(0xFF475569), height: 1.45),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: <Widget>[
                _buildSummaryInfoCard(
                  'DO terkunci',
                  lockedOrder?.doNumber ?? 'Belum ada',
                  Icons.lock_outline,
                  const Color(0xFFEFF6FF),
                  const Color(0xFF0F4C81),
                ),
                _buildSummaryInfoCard(
                  'Runtime lokal',
                  _trackingRuntimeHealthy ? 'Sehat' : 'Perlu dipulihkan',
                  Icons.radar_outlined,
                  _trackingRuntimeHealthy
                      ? const Color(0xFFECFDF5)
                      : const Color(0xFFFFF7ED),
                  _trackingRuntimeHealthy
                      ? const Color(0xFF0F766E)
                      : const Color(0xFFC2410C),
                ),
              ],
            ),
            if (!_trackingRuntimeHealthy && activeOrder != null) ...<Widget>[
              const SizedBox(height: 12),
              _buildNotice(
                _trackingRuntime.isRunningFor(activeOrder.id)
                    ? 'Tracking lokal masih berjalan, tetapi heartbeat ke server sedang gagal. Periksa internet dan GPS. Error terakhir: ${_trackingRuntime.lastHeartbeatError ?? 'tidak diketahui'}.'
                    : 'Server mencatat tracking aktif untuk ${activeOrder.doNumber}, tetapi runtime lokasi di perangkat tidak sedang berjalan. Tekan Pulihkan Tracking agar heartbeat aktif lagi.',
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFEFF6FF),
                borderRadius: BorderRadius.circular(18),
              ),
              child: const Icon(
                Icons.assignment_outlined,
                color: Color(0xFF0F4C81),
                size: 24,
              ),
              ),
              const SizedBox(height: 14),
              const Text(
                'Belum ada DO aktif',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Belum ada surat jalan operasional yang ditugaskan ke akun driver ini. Hubungi admin bila seharusnya sudah ada penugasan.',
                style: TextStyle(color: Color(0xFF64748B), height: 1.45),
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
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: <Widget>[
                          _buildHeaderMetaChip(
                            icon: Icons.receipt_long_outlined,
                            label: order.masterResi ?? '-',
                          ),
                          _buildHeaderMetaChip(
                            icon: Icons.calendar_today_outlined,
                            label: _formatDate(order.date),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    _buildTrackingBadge(order.trackingState),
                    const SizedBox(height: 8),
                    _buildDoStatusChip(order.status),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 14),
            _buildLastSeenBanner(order),
            const SizedBox(height: 12),
            _buildMetaGrid(order),
            if (order.trackingLastLat != null && order.trackingLastLng != null)
              TextButton.icon(
                onPressed: () => _handleOpenMap(order),
                icon: const Icon(Icons.map_outlined),
                label: const Text('Buka lokasi terakhir di Maps'),
              ),
            const SizedBox(height: 8),
            if (order.trackingState == TrackingState.active && !showRestore) ...<Widget>[
              _buildActionPanel(
                backgroundColor: const Color(0xFFECFDF5),
                children: <Widget>[
                  _buildSectionLabel('Tracking aktif'),
                  const SizedBox(height: 8),
                  if (order.hasPendingDriverStatusRequest) ...<Widget>[
                    _buildPendingApprovalNotice(order),
                    const SizedBox(height: 10),
                  ],
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
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                        icon: const Icon(Icons.route),
                        label: Text(
                          _driverProgressButtonLabel(nextDriverProgress),
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                  _buildNotice(
                    order.hasPendingDriverStatusRequest
                        ? 'Tracking tetap harus aktif sampai admin approve status selesai atau memberi arahan lanjutan.'
                        : 'Tracking harus tetap aktif sampai admin menyelesaikan DO ini. Driver tidak bisa menjeda atau menghentikannya sendiri.',
                  ),
                ],
              ),
            ]
            else if (order.trackingState == TrackingState.paused)
              _buildActionPanel(
                backgroundColor: const Color(0xFFFFF7ED),
                children: <Widget>[
                  _buildSectionLabel('Tracking perlu dipulihkan'),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
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
                  const SizedBox(height: 10),
                  _buildNotice(
                    'Status jeda ini hanya untuk data lama. Tracking harus dipulihkan sampai admin benar-benar menutup DO.',
                  ),
                ],
              )
            else
              _buildActionPanel(
                children: <Widget>[
                  _buildSectionLabel(
                    showRestore ? 'Pulihkan tracking' : 'Aksi utama',
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
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
                  const SizedBox(height: 10),
                  _buildNotice(
                    canStartNew
                        ? 'Mulai tracking saat driver benar-benar berangkat. Setelah aktif, admin akan memantau dari dashboard.'
                        : 'Masih ada DO lain yang sedang mengunci tracking. Selesaikan dulu DO tersebut bersama admin.',
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeaderMetaChip({
    required IconData icon,
    required String label,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 14, color: const Color(0xFF64748B)),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF334155),
              fontWeight: FontWeight.w700,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLastSeenBanner(DeliveryOrder order) {
    final hasSignal = order.trackingLastSeenAt != null;
    final isActiveTracking = order.trackingState == TrackingState.active;
    final lastSeen = _formatDateTime(order.trackingLastSeenAt);

    Color backgroundColor = const Color(0xFFF8FAFC);
    Color foregroundColor = const Color(0xFF475569);
    IconData icon = Icons.schedule_outlined;
    String label = 'Belum ada heartbeat';
    String detail = 'Tracking belum mengirim posisi terbaru dari perangkat ini.';

    if (hasSignal) {
      backgroundColor = const Color(0xFFEFF6FF);
      foregroundColor = const Color(0xFF0F4C81);
      icon = Icons.access_time_filled_rounded;
      label = 'Last seen $lastSeen';
      detail = isActiveTracking
          ? 'Posisi terakhir driver sudah tercatat dan akan terus diperbarui selama tracking sehat.'
          : 'Ini posisi terakhir yang tersimpan sebelum tracking berhenti atau DO ditutup.';
    } else if (isActiveTracking) {
      backgroundColor = const Color(0xFFFFF7ED);
      foregroundColor = const Color(0xFFC2410C);
      icon = Icons.wifi_tethering_error_rounded;
      label = 'Tracking aktif, heartbeat belum masuk';
      detail =
          'Periksa GPS, internet, dan izin lokasi bila status ini tidak berubah.';
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.72),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, size: 18, color: foregroundColor),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  label,
                  style: TextStyle(
                    color: foregroundColor,
                    fontWeight: FontWeight.w800,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  detail,
                  style: TextStyle(
                    color: foregroundColor.withValues(alpha: 0.9),
                    height: 1.35,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryPill(
    String label,
    String value,
    Color backgroundColor,
    Color foregroundColor,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            label,
            style: TextStyle(
              color: foregroundColor.withValues(alpha: 0.78),
              fontWeight: FontWeight.w700,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: TextStyle(
              color: foregroundColor,
              fontWeight: FontWeight.w800,
              fontSize: 16,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryInfoCard(
    String label,
    String value,
    IconData icon,
    Color backgroundColor,
    Color foregroundColor,
  ) {
    return Container(
      constraints: const BoxConstraints(minWidth: 150),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.72),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, color: foregroundColor, size: 18),
          ),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                label,
                style: TextStyle(
                  color: foregroundColor.withValues(alpha: 0.78),
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                value,
                style: TextStyle(
                  color: foregroundColor,
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMetaGrid(DeliveryOrder order) {
    final items = <({String label, String value, IconData icon})>[
      (
        label: 'Customer',
        value: order.customerName ?? '-',
        icon: Icons.apartment_rounded,
      ),
      (
        label: 'Status DO',
        value: _formatDeliveryOrderStatus(order.status),
        icon: Icons.flag_outlined,
      ),
      (
        label: 'Tujuan',
        value: order.receiverAddress ?? '-',
        icon: Icons.location_on_outlined,
      ),
      (
        label: 'Kendaraan',
        value: order.vehiclePlate ?? '-',
        icon: Icons.local_shipping_outlined,
      ),
      (
        label: 'Last seen (WIB)',
        value: _formatDateTime(order.trackingLastSeenAt),
        icon: Icons.schedule_outlined,
      ),
      (
        label: 'Akurasi',
        value: order.trackingLastAccuracyM == null
            ? '-'
            : '${order.trackingLastAccuracyM!.round()} m',
        icon: Icons.gps_fixed,
      ),
    ];

    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: items
          .map(
            (item) => SizedBox(
              width: 155,
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Icon(item.icon, size: 16, color: const Color(0xFF64748B)),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            item.label,
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFF64748B),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      item.value,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 14,
                        color: Color(0xFF0F172A),
                        fontWeight: FontWeight.w700,
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          )
          .toList(growable: false),
    );
  }

  Widget _buildActionPanel({
    required List<Widget> children,
    Color backgroundColor = const Color(0xFFF8FAFC),
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: children,
      ),
    );
  }

  Widget _buildSectionLabel(String text) {
    return Text(
      text,
      style: const TextStyle(
        color: Color(0xFF64748B),
        fontWeight: FontWeight.w700,
        fontSize: 12,
        letterSpacing: 0.3,
      ),
    );
  }

  Widget _buildDoStatusChip(DeliveryOrderStatus status) {
    late final Color backgroundColor;
    late final Color foregroundColor;

    switch (status) {
      case DeliveryOrderStatus.created:
        backgroundColor = const Color(0xFFF1F5F9);
        foregroundColor = const Color(0xFF475569);
        break;
      case DeliveryOrderStatus.headingToPickup:
        backgroundColor = const Color(0xFFFEF3C7);
        foregroundColor = const Color(0xFFB45309);
        break;
      case DeliveryOrderStatus.onDelivery:
        backgroundColor = const Color(0xFFE0F2FE);
        foregroundColor = const Color(0xFF0369A1);
        break;
      case DeliveryOrderStatus.arrived:
        backgroundColor = const Color(0xFFEDE9FE);
        foregroundColor = const Color(0xFF6D28D9);
        break;
      case DeliveryOrderStatus.delivered:
        backgroundColor = const Color(0xFFDCFCE7);
        foregroundColor = const Color(0xFF15803D);
        break;
      case DeliveryOrderStatus.cancelled:
        backgroundColor = const Color(0xFFFEE2E2);
        foregroundColor = const Color(0xFFB91C1C);
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        _formatDeliveryOrderStatus(status),
        style: TextStyle(
          color: foregroundColor,
          fontWeight: FontWeight.w700,
          fontSize: 12,
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

  Widget _buildPendingApprovalNotice(DeliveryOrder order) {
    final requestedStatus =
        order.pendingDriverStatus == null
            ? 'perubahan status'
            : _formatDeliveryOrderStatus(order.pendingDriverStatus!);
    final requestedBy = order.pendingDriverStatusRequestedByName ?? 'Driver';
    final requestedAt = _formatDateTime(order.pendingDriverStatusRequestedAt);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7ED),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Menunggu approval admin untuk $requestedStatus.',
            style: const TextStyle(
              color: Color(0xFF9A3412),
              fontWeight: FontWeight.w800,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '$requestedBy • $requestedAt',
            style: const TextStyle(
              color: Color(0xFFC2410C),
              fontWeight: FontWeight.w700,
            ),
          ),
          if ((order.pendingDriverStatusNote ?? '').trim().isNotEmpty) ...<Widget>[
            const SizedBox(height: 8),
            Text(
              'Catatan: ${order.pendingDriverStatusNote!.trim()}',
              style: const TextStyle(
                color: Color(0xFF9A3412),
                fontWeight: FontWeight.w600,
                height: 1.4,
              ),
            ),
          ],
        ],
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
      final parsed = DateTime.parse(value);
      final jakartaTime =
          (parsed.isUtc ? parsed : parsed.toUtc()).add(const Duration(hours: 7));
      return '${DateFormat('dd/MM/yyyy HH:mm').format(jakartaTime)} WIB';
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
    if (order.trackingState != TrackingState.active ||
        order.isClosed ||
        order.hasPendingDriverStatusRequest) {
      return null;
    }

    switch (order.status) {
      case DeliveryOrderStatus.headingToPickup:
        return DeliveryOrderStatus.onDelivery;
      case DeliveryOrderStatus.onDelivery:
        return DeliveryOrderStatus.arrived;
      case DeliveryOrderStatus.arrived:
        return DeliveryOrderStatus.delivered;
      case DeliveryOrderStatus.created:
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
      case DeliveryOrderStatus.delivered:
        return 'Ajukan Selesai ke Admin';
      case DeliveryOrderStatus.created:
      case DeliveryOrderStatus.headingToPickup:
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
      case DeliveryOrderStatus.delivered:
        return 'Permintaan selesai dikirim ke admin untuk approval.';
      case DeliveryOrderStatus.created:
      case DeliveryOrderStatus.headingToPickup:
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
