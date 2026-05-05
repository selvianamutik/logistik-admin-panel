import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../../../app.dart';
import '../data/driver_access_service.dart';
import '../data/delivery_order_service.dart';
import '../data/driver_tracking_service.dart';
import '../domain/models.dart';
import 'delivery_completion_page.dart';
import 'delivery_manifest_page.dart';

class TrackingHomePage extends StatefulWidget {
  const TrackingHomePage({
    super.key,
    required this.session,
    required this.onLogout,
  });

  final DriverAppSession session;
  final VoidCallback onLogout;

  @override
  State<TrackingHomePage> createState() => _TrackingHomePageState();
}

class _TrackingHomePageState extends State<TrackingHomePage>
    with WidgetsBindingObserver {
  final DeliveryOrderService _deliveryOrderService = DeliveryOrderService();
  final DriverAccessService _driverAccessService = DriverAccessService();
  late final DriverTrackingService _trackingService;

  List<DeliveryTrip> _trips = const [];
  List<DriverAssignedTripPlan> _plannedTrips = const [];
  List<CustomerProductOption> _customerProducts = const [];
  List<CustomerRecipientOption> _customerRecipients = const [];
  DeliveryTrip? _selectedTrip;
  DeliveryTrip? _activeTrip;
  LocationSnapshot? _latestLocation;

  bool _trackingEnabled = false;
  bool _loadingTrips = true;
  bool _updatingStatus = false;
  bool _submittingManifest = false;
  bool _acknowledgingWarning = false;
  String? _loadError;
  String? _locationError;
  String? _pingError;
  int _pingCount = 0;
  DriverAccessNotice? _accessNotice;

  Duration _trackingInterval = const Duration(seconds: 30);
  Timer? _pingCounterTimer;
  Timer? _noticePollTimer;

  @override
  void initState() {
    super.initState();
    _accessNotice = widget.session.accessNotice;
    _trackingService = DriverTrackingService(
      sessionToken: widget.session.token ?? '',
    );
    unawaited(_bootstrapPage());
    WidgetsBinding.instance.addObserver(this);
    _noticePollTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (mounted && widget.session.token != null) {
        unawaited(_silentNoticeCheck());
      }
    });
  }

  Future<void> _silentNoticeCheck() async {
    final sessionToken = widget.session.token;
    if (sessionToken == null || sessionToken.isEmpty) return;

    try {
      final notice = await _driverAccessService.fetchCurrentAccessNotice(
        sessionToken: sessionToken,
      );
      if (!mounted) return;

      if (notice == null) {
        if (_accessNotice != null) {
          setState(() => _accessNotice = null);
        }
      } else if (_isNoticeBlocking(notice)) {
        if (_accessNotice?.scoreId != notice.scoreId ||
            !_isNoticeBlocking(_accessNotice)) {
          setState(() {
            _accessNotice = notice;
            _loadingTrips = false;
          });
        }
      } else {
        if (_accessNotice?.scoreId != notice.scoreId ||
            _accessNotice?.warningAcknowledgedAt !=
                notice.warningAcknowledgedAt) {
          setState(() => _accessNotice = notice);
        }
      }
    } catch (_) {
      // Background poll swallows errors safely
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (!_loadingTrips) {
        unawaited(_bootstrapPage());
      }
    }
  }

  bool _isNoticeBlocking(DriverAccessNotice? notice) {
    final isBlocking =
        notice != null &&
        (notice.blocking ||
            (notice.isWarning &&
                (notice.warningAcknowledgedAt == null ||
                    notice.warningAcknowledgedAt!.isEmpty)));
    return isBlocking;
  }

  Future<void> _bootstrapPage() async {
    final sessionToken = widget.session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      if (!mounted) return;
      setState(() {
        _loadingTrips = false;
        _loadError = 'Sesi driver tidak valid. Silakan login ulang.';
      });
      return;
    }

    try {
      final notice = await _driverAccessService.fetchCurrentAccessNotice(
        sessionToken: sessionToken,
      );
      if (!mounted) return;
      if (_isNoticeBlocking(notice)) {
        setState(() {
          _accessNotice = notice;
          _loadingTrips = false;
          _loadError = null;
        });
        return;
      }
      setState(() => _accessNotice = notice);
      await _loadTrips(skipAccessRefresh: true);
    } on DriverAccessException catch (err) {
      if (!mounted) return;
      // Server explicitly rejected access — surface the error.
      // Keep any session-level blocking notice visible.
      if (_isNoticeBlocking(_accessNotice)) {
        setState(() => _loadingTrips = false);
      } else {
        setState(() {
          _loadingTrips = false;
          _loadError = err.message;
        });
      }
    } catch (_) {
      // Network / parse errors — do not swallow silently.
      if (!mounted) return;
      if (_isNoticeBlocking(_accessNotice)) {
        // Session has a blocking notice — keep showing it, stop spinner.
        setState(() => _loadingTrips = false);
      } else {
        setState(() {
          _loadingTrips = false;
          _loadError =
              'Gagal terhubung ke server. Tarik ke bawah untuk refresh.';
        });
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _noticePollTimer?.cancel();
    _pingCounterTimer?.cancel();
    _trackingService.stop();
    super.dispose();
  }

  // ── Trips ──────────────────────────────────────────────────

  Future<void> _loadTrips({bool skipAccessRefresh = false}) async {
    final sessionToken = widget.session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      setState(() {
        _loadingTrips = false;
        _loadError = 'Sesi driver tidak valid. Silakan login ulang.';
      });
      return;
    }

    if (!skipAccessRefresh) {
      try {
        final notice = await _driverAccessService.fetchCurrentAccessNotice(
          sessionToken: sessionToken,
        );
        if (!mounted) return;
        if (_isNoticeBlocking(notice)) {
          setState(() {
            _accessNotice = notice;
            _loadingTrips = false;
            _loadError = null;
          });
          return;
        }
        setState(() => _accessNotice = notice);
      } on DriverAccessException catch (err) {
        if (!mounted) return;
        setState(() {
          _loadingTrips = false;
          _loadError = err.message;
        });
        return;
      }
    }

    setState(() {
      _loadingTrips = true;
      _loadError = null;
    });
    try {
      final portalData = await _deliveryOrderService.fetchDriverPortalData(
        sessionToken: sessionToken,
      );
      final trips = portalData.trips;
      if (!mounted) return;
      setState(() {
        _trips = trips;
        _plannedTrips = portalData.plannedTrips;
        _customerProducts = portalData.customerProducts;
        _customerRecipients = portalData.customerRecipients;
        // DO NOT clear _accessNotice here. It should only be cleared by
        // explicit server response (notice = null) or after acknowledgement.
        // The previous code was wiping warnings incorrectly.
        final activeId = _activeTrip?.deliveryOrderId;
        final lockedTrip = trips.firstWhereOrNull(
          (t) => t.trackingState == 'ACTIVE' || t.trackingState == 'PAUSED',
        );
        _activeTrip = activeId != null
            ? trips.firstWhereOrNull((t) => t.deliveryOrderId == activeId)
            : lockedTrip ??
                  trips.firstWhereOrNull(
                    (t) => t.status == TripStatus.onDelivery,
                  );
        _selectedTrip = _activeTrip ?? (trips.isNotEmpty ? trips.first : null);
        _trackingEnabled = _activeTrip?.trackingState == 'ACTIVE';
        _loadingTrips = false;
      });
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      setState(() {
        _loadingTrips = false;
        _loadError = err.message;
        if (err.statusCode == 403) {
          _accessNotice = DriverAccessNotice(
            scoreId: '',
            scoreType: 'DAYS',
            title: 'Akses aplikasi ditangguhkan',
            message: err.message,
            blocking: true,
            effectiveDate: '',
            dueDate: '',
            durationDays: 0,
          );
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loadingTrips = false;
        _loadError = 'Tidak bisa memuat trip driver dari server';
      });
    }
  }

  Future<void> _closeWarningNotice() async {
    final sessionToken = widget.session.token;
    final notice = _accessNotice;
    if (sessionToken == null ||
        sessionToken.isEmpty ||
        notice == null ||
        !notice.isWarning ||
        notice.scoreId.isEmpty) {
      return;
    }

    setState(() => _acknowledgingWarning = true);
    try {
      final nextNotice = await _driverAccessService.acknowledgeWarning(
        sessionToken: sessionToken,
        scoreId: notice.scoreId,
      );
      if (!mounted) return;
      setState(() {
        _acknowledgingWarning = false;
        _accessNotice = nextNotice;
      });
      await _loadTrips(skipAccessRefresh: true);
    } on DriverAccessException catch (err) {
      if (!mounted) return;
      setState(() => _acknowledgingWarning = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(err.message),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  // ── Tracking ───────────────────────────────────────────────

  List<CustomerProductOption> _productsForCustomer(String? customerRef) {
    final normalizedCustomerRef = customerRef?.trim() ?? '';
    if (normalizedCustomerRef.isEmpty) {
      return _customerProducts;
    }
    return _customerProducts
        .where((product) => product.customerRef == normalizedCustomerRef)
        .toList(growable: false);
  }

  List<CustomerRecipientOption> _recipientsForCustomer(String? customerRef) {
    final normalizedCustomerRef = customerRef?.trim() ?? '';
    if (normalizedCustomerRef.isEmpty) {
      return _customerRecipients;
    }
    return _customerRecipients
        .where((recipient) => recipient.customerRef == normalizedCustomerRef)
        .toList(growable: false);
  }

  bool _canManageManifest(DeliveryTrip trip) {
    if (trip.status == TripStatus.delivered) {
      return false;
    }
    return !trip.isAwaitingAdminApproval;
  }

  Future<void> _openTripManifestPlan(DriverAssignedTripPlan tripPlan) async {
    final sessionToken = widget.session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      return;
    }
    if (tripPlan.linkedDeliveryOrderRef?.trim().isNotEmpty == true) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Trip ini sudah punya DO. Kelola SJ dari DO aktifnya.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }

    final result = await Navigator.of(context)
        .push<DeliveryManifestSubmitResult>(
          MaterialPageRoute(
            builder: (_) => DeliveryManifestPage(
              title: tripPlan.allowsDirectCargoInput
                  ? 'Buat SJ & Barang'
                  : 'Buat SJ',
              submitLabel: tripPlan.allowsDirectCargoInput
                  ? 'Simpan SJ & Barang'
                  : 'Simpan SJ',
              pickupStops: tripPlan.pickupStops,
              customerProducts: _productsForCustomer(tripPlan.customerRef),
              allowsDirectCargoInput: tripPlan.allowsDirectCargoInput,
            ),
          ),
        );

    if (result == null) {
      return;
    }

    setState(() => _submittingManifest = true);
    try {
      await _deliveryOrderService.createDeliveryOrderFromTripPlan(
        sessionToken: sessionToken,
        orderRef: tripPlan.orderRef,
        orderTripPlanKey: tripPlan.tripPlanKey,
        shipperReferences: result.shipperReferences,
        cargoItems: result.cargoItems,
      );
      await _loadTrips();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            tripPlan.allowsDirectCargoInput
                ? 'SJ dan barang berhasil dibuat.'
                : 'SJ berhasil dibuat.',
          ),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(err.message),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _submittingManifest = false);
      }
    }
  }

  Future<void> _openDeliveryManifest(DeliveryTrip trip) async {
    final sessionToken = widget.session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      return;
    }
    if (!_canManageManifest(trip)) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('DO ini tidak bisa diubah dari aplikasi driver.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }

    final result = await Navigator.of(context)
        .push<DeliveryManifestSubmitResult>(
          MaterialPageRoute(
            builder: (_) => DeliveryManifestPage(
              title: trip.allowsDirectCargoInput
                  ? 'Kelola SJ & Barang'
                  : 'Kelola SJ',
              submitLabel: trip.allowsDirectCargoInput
                  ? 'Simpan SJ & Barang'
                  : 'Simpan SJ',
              pickupStops: trip.pickupStops,
              customerProducts: _productsForCustomer(trip.customerRef),
              allowsDirectCargoInput: trip.allowsDirectCargoInput,
              initialShipperReferences: trip.shipperReferences,
              existingCargoItems: trip.cargoItems,
            ),
          ),
        );

    if (result == null) {
      return;
    }

    setState(() => _submittingManifest = true);
    try {
      await _deliveryOrderService.appendCargoToDeliveryOrder(
        sessionToken: sessionToken,
        deliveryOrderId: trip.deliveryOrderId,
        shipperReferences: result.shipperReferences,
        cargoItems: result.cargoItems,
      );
      await _loadTrips();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            result.cargoItems.isEmpty
                ? 'SJ berhasil disimpan.'
                : 'SJ dan barang berhasil disimpan.',
          ),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(err.message),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _submittingManifest = false);
      }
    }
  }

  Future<String?> _checkPermission() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return 'GPS mati. Aktifkan layanan lokasi.';
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return 'Izin lokasi ditolak. Buka pengaturan aplikasi.';
    }
    return null;
  }

  Future<void> _setTrackingEnabled(bool value) async {
    final trip = _activeTrip ?? _selectedTrip;
    if (trip == null) return;

    if (!value) {
      final serverTrackingState = trip.trackingState;
      final isActiveOnServer =
          serverTrackingState == 'ACTIVE' || serverTrackingState == 'PAUSED';
      final isClosedTrip = trip.status == TripStatus.delivered;

      if (isActiveOnServer && !isClosedTrip) {
        if (!mounted) return;
        setState(() => _trackingEnabled = true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Tracking harus tetap aktif sampai DO selesai. Driver tidak bisa mematikannya sendiri.',
            ),
            behavior: SnackBarBehavior.floating,
          ),
        );
        return;
      }
    }

    if (value) {
      final err = await _checkPermission();
      if (err != null) {
        if (mounted) setState(() => _locationError = err);
        return;
      }
    }
    if (!mounted) return;
    setState(() {
      _trackingEnabled = value;
      _locationError = null;
      _pingError = null;
      if (!value) _pingCount = 0;
    });
    if (value) {
      _startTracking(initialAction: _trackingStartAction(trip));
    } else {
      _pingCounterTimer?.cancel();
      _trackingService.stop();
    }
  }

  void _startTracking({String initialAction = 'start'}) {
    final trip = _activeTrip ?? _selectedTrip;
    if (trip == null) return;

    _pingCounterTimer?.cancel();

    _trackingService.start(
      deliveryOrderId: trip.deliveryOrderId,
      interval: _trackingInterval,
      onLocation: (snapshot) {
        if (!mounted) return;
        setState(() {
          _latestLocation = snapshot;
          _locationError = null;
        });
      },
      onError: (err) {
        if (!mounted) return;
        setState(() => _pingError = err);
      },
      initialAction: initialAction,
      onPingSuccess: () {
        if (!mounted) return;
        unawaited(_loadTrips());
      },
      onTrackingInactive: (message) {
        if (!mounted) return;
        _pingCounterTimer?.cancel();
        _trackingService.stop();
        setState(() {
          _trackingEnabled = false;
          _activeTrip = null;
          _pingCount = 0;
          _pingError = message;
        });
        unawaited(_loadTrips());
      },
    );

    _pingCounterTimer = Timer.periodic(_trackingInterval, (_) {
      if (!mounted || !_trackingEnabled) return;
      setState(() => _pingCount++);
    });
  }

  void _changeInterval(Duration value) {
    setState(() => _trackingInterval = value);
    if (_trackingEnabled) {
      _startTracking(
        initialAction: _trackingStartAction(_activeTrip ?? _selectedTrip),
      );
    }
  }

  // ── Trip actions ───────────────────────────────────────────

  Future<void> _beginDelivery(DeliveryTrip trip) async {
    if (_activeTrip != null &&
        _activeTrip!.deliveryOrderId != trip.deliveryOrderId) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Selesaikan "${_activeTrip!.doNumber}" terlebih dahulu.',
            ),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
      return;
    }
    final err = await _checkPermission();
    if (err != null) {
      if (mounted) setState(() => _locationError = err);
      return;
    }
    if (!mounted) return;
    setState(() {
      _activeTrip = _trips.firstWhere(
        (t) => t.deliveryOrderId == trip.deliveryOrderId,
      );
      _selectedTrip = _activeTrip;
      _pingCount = 0;
    });
    await _setTrackingEnabled(true);
  }

  Future<void> _advanceStatus() async {
    final trip = _selectedTrip;
    final sessionToken = widget.session.token;
    if (trip == null || sessionToken == null || sessionToken.isEmpty) return;
    if (trip.isAwaitingAdminApproval) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Trip ini sudah menunggu approval admin.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }
    final nextStatus = switch (trip.status) {
      TripStatus.assigned => TripStatus.headingToPickup,
      TripStatus.headingToPickup => TripStatus.onDelivery,
      TripStatus.onDelivery => TripStatus.arrived,
      TripStatus.arrived => TripStatus.delivered,
      TripStatus.delivered => TripStatus.delivered,
    };
    if (trip.status == TripStatus.arrived) {
      await _openDeliveryCompletion(trip);
      return;
    }
    setState(() => _updatingStatus = true);
    try {
      final updatedTrip = await _deliveryOrderService.updateTripStatus(
        sessionToken: sessionToken,
        deliveryOrderId: trip.deliveryOrderId,
        status: nextStatus,
        note: _statusNoteForUpdate(nextStatus),
      );
      await _loadTrips();
      if (!mounted) return;
      if (nextStatus == TripStatus.delivered &&
          updatedTrip.status == TripStatus.delivered) {
        _pingCounterTimer?.cancel();
        _trackingService.stop();
        setState(() {
          _activeTrip = null;
          _trackingEnabled = false;
          _pingCount = 0;
        });
      } else if (nextStatus == TripStatus.delivered &&
          updatedTrip.isAwaitingAdminApproval) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Permintaan selesai dikirim. Menunggu approval admin.',
            ),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(err.message),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _updatingStatus = false);
      }
    }
  }

  Future<void> _openDeliveryCompletion(DeliveryTrip trip) async {
    final sessionToken = widget.session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      return;
    }
    if (trip.cargoItems.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Muatan DO belum ada. Isi barang dulu sebelum ajukan selesai.',
          ),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }

    final result = await Navigator.of(context)
        .push<DeliveryCompletionSubmitResult>(
          MaterialPageRoute(
            builder: (_) => DeliveryCompletionPage(
              trip: trip,
              customerRecipients: _recipientsForCustomer(trip.customerRef),
            ),
          ),
        );

    if (result == null) {
      return;
    }

    setState(() => _updatingStatus = true);
    try {
      await _deliveryOrderService.requestDeliveryCompletion(
        sessionToken: sessionToken,
        deliveryOrderId: trip.deliveryOrderId,
        note: result.note,
        actualItems: result.actualItems,
        actualDropPoints: result.actualDropPoints,
      );
      await _loadTrips();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Permintaan selesai dikirim. Menunggu approval admin.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(err.message),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _updatingStatus = false);
      }
    }
  }

  Future<void> _openTripClosure(DeliveryTrip trip) async {
    final sessionToken = widget.session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      return;
    }
    if (trip.status != TripStatus.delivered) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Tutup trip hanya bisa diajukan setelah trip selesai.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }
    if (trip.isAwaitingAdminApproval) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Trip ini masih menunggu approval admin.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }

    final currentOdometer = (trip.vehicleLastOdometer ?? 0).clamp(
      0,
      double.infinity,
    );
    final odometerController = TextEditingController(
      text: trip.tripEndOdometerKm != null && trip.tripEndOdometerKm! > 0
          ? trip.tripEndOdometerKm!.round().toString()
          : '',
    );
    final noteController = TextEditingController();

    final result = await showDialog<_TripClosureSubmitResult>(
      context: context,
      builder: (context) {
        String? errorText;

        return StatefulBuilder(
          builder: (context, setDialogState) {
            void submit() {
              final odometer = _parseOdometerInput(odometerController.text);
              if (odometer == null || odometer <= 0) {
                setDialogState(
                  () => errorText = 'Odometer akhir trip wajib diisi.',
                );
                return;
              }
              if (odometer < currentOdometer) {
                setDialogState(
                  () => errorText =
                      'Odometer akhir tidak boleh lebih kecil dari ${_formatKm(currentOdometer)} km.',
                );
                return;
              }
              Navigator.of(context).pop(
                _TripClosureSubmitResult(
                  odometerKm: odometer,
                  note: noteController.text.trim(),
                ),
              );
            }

            return AlertDialog(
              title: const Text('Tutup Trip'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Odometer kendaraan terakhir: ${_formatKm(currentOdometer)} km',
                      style: TextStyle(
                        color: Theme.of(
                          context,
                        ).colorScheme.onSurface.withValues(alpha: 0.65),
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: odometerController,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: false,
                      ),
                      decoration: InputDecoration(
                        labelText: 'Odometer Akhir Trip',
                        suffixText: 'km',
                        errorText: errorText,
                      ),
                      onSubmitted: (_) => submit(),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: noteController,
                      minLines: 2,
                      maxLines: 4,
                      decoration: const InputDecoration(
                        labelText: 'Catatan',
                        hintText: 'Opsional',
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Batal'),
                ),
                FilledButton.icon(
                  onPressed: submit,
                  icon: const Icon(Icons.lock_clock_rounded),
                  label: const Text('Ajukan Tutup Trip'),
                ),
              ],
            );
          },
        );
      },
    );
    odometerController.dispose();
    noteController.dispose();

    if (result == null) {
      return;
    }

    setState(() => _updatingStatus = true);
    try {
      await _deliveryOrderService.requestTripClosure(
        sessionToken: sessionToken,
        deliveryOrderId: trip.deliveryOrderId,
        tripEndOdometerKm: result.odometerKm,
        note: result.note,
      );
      await _loadTrips();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Permintaan tutup trip dikirim. Menunggu approval admin.',
          ),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(err.message),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _updatingStatus = false);
      }
    }
  }

  String _statusNoteForUpdate(TripStatus status) {
    return switch (status) {
      TripStatus.headingToPickup =>
        'Driver mulai bergerak ke pickup via driver app',
      TripStatus.onDelivery => 'Pengiriman dimulai via driver app',
      TripStatus.arrived => 'Driver menandai sudah tiba via driver app',
      TripStatus.delivered =>
        'Driver mengajukan delivery selesai via aplikasi driver',
      TripStatus.assigned => 'Status diperbarui via driver app',
    };
  }

  String _trackingStartAction(DeliveryTrip? trip) {
    final trackingState = trip?.trackingState;
    if (trackingState == 'ACTIVE' || trackingState == 'PAUSED') {
      return 'resume';
    }
    return 'start';
  }

  Future<void> _confirmLogout() async {
    final lockedTrip = _trips.firstWhereOrNull(
      (trip) =>
          trip.trackingState == 'ACTIVE' || trip.trackingState == 'PAUSED',
    );
    if (lockedTrip != null) {
      final shouldLogout = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Keluar aplikasi driver?'),
          content: Text(
            'Kamu masih terikat ke ${lockedTrip.doNumber}. Keluar sekarang akan menghentikan ping lokasi dari HP ini sampai login lagi.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Batal'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Keluar'),
            ),
          ],
        ),
      );
      if (shouldLogout != true || !mounted) return;
    }

    widget.onLogout();
  }

  // ── Build ──────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final compact = MediaQuery.sizeOf(context).width < 380;
    final pendingTripPlans = _plannedTrips
        .where(
          (tripPlan) =>
              tripPlan.linkedDeliveryOrderRef?.trim().isNotEmpty != true,
        )
        .toList(growable: false);
    final accessNotice = _accessNotice;
    final hasBlockingNotice =
        accessNotice != null &&
        (accessNotice.blocking ||
            (accessNotice.isWarning &&
                (accessNotice.warningAcknowledgedAt == null ||
                    accessNotice.warningAcknowledgedAt!.isEmpty)));
    final blockingNotice = hasBlockingNotice ? accessNotice : null;

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'GMS Driver',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: compact
                ? IconButton(
                    onPressed: _confirmLogout,
                    tooltip: 'Keluar',
                    icon: const Icon(Icons.logout_rounded),
                  )
                : OutlinedButton.icon(
                    onPressed: _confirmLogout,
                    icon: const Icon(Icons.logout_rounded, size: 15),
                    label: const Text('Keluar'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 8,
                      ),
                      textStyle: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
          ),
        ],
      ),
      body: Stack(
        children: [
          RefreshIndicator(
            onRefresh: hasBlockingNotice ? () async {} : _loadTrips,
            color: scheme.primary,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 28),
              physics: hasBlockingNotice
                  ? const NeverScrollableScrollPhysics()
                  : const AlwaysScrollableScrollPhysics(),
              children: [
                _DriverCard(
                  session: widget.session,
                  tripCount: _trips.length + pendingTripPlans.length,
                ),
                const SizedBox(height: 16),
                if (!hasBlockingNotice && accessNotice != null) ...[
                  _ErrorBanner(
                    icon: Icons.warning_amber_rounded,
                    message: accessNotice.message,
                    isWarning: true,
                  ),
                  const SizedBox(height: 16),
                ],
                if (!hasBlockingNotice && pendingTripPlans.isNotEmpty) ...[
                  _SectionHeader(
                    title: 'Trip siap input SJ',
                    count: pendingTripPlans.length,
                  ),
                  const SizedBox(height: 10),
                  ...pendingTripPlans.map(
                    (tripPlan) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _PlannedTripCard(
                        tripPlan: tripPlan,
                        busy: _submittingManifest,
                        onPressed: () =>
                            unawaited(_openTripManifestPlan(tripPlan)),
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                ],
                _SectionHeader(title: 'Trip', count: _trips.length),
                const SizedBox(height: 10),
                _buildTripList(scheme),
                if (_selectedTrip != null) ...[
                  const SizedBox(height: 20),
                  const _SectionHeader(title: 'Trip dipilih'),
                  const SizedBox(height: 10),
                  _TripDetailCard(trip: _selectedTrip!),
                  const SizedBox(height: 12),
                  _ManifestSummaryCard(trip: _selectedTrip!),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.tonalIcon(
                      onPressed:
                          _submittingManifest ||
                              !_canManageManifest(_selectedTrip!)
                          ? null
                          : () => unawaited(
                              _openDeliveryManifest(_selectedTrip!),
                            ),
                      icon: _submittingManifest
                          ? SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: scheme.primary,
                              ),
                            )
                          : const Icon(Icons.inventory_2_outlined),
                      label: Text(
                        _selectedTrip!.allowsDirectCargoInput
                            ? 'Kelola SJ & Barang'
                            : 'Kelola SJ',
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (_locationError != null) ...[
                    _ErrorBanner(
                      icon: Icons.location_off_rounded,
                      message: _locationError!,
                      onRetry: () => unawaited(_setTrackingEnabled(true)),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (_pingError != null) ...[
                    _ErrorBanner(
                      icon: Icons.cloud_off_rounded,
                      message: _pingError!,
                      isWarning: true,
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (_selectedTrip!.isAwaitingAdminApproval) ...[
                    const _ErrorBanner(
                      icon: Icons.admin_panel_settings_rounded,
                      message: 'Trip ini menunggu approval admin.',
                      isWarning: true,
                    ),
                    const SizedBox(height: 12),
                  ],
                  _TrackingCard(
                    trackingEnabled: _trackingEnabled,
                    selectedInterval: _trackingInterval,
                    location: _latestLocation,
                    pingCount: _pingCount,
                    onTrackingChanged: (v) => (_setTrackingEnabled(v)),
                    onIntervalChanged: _changeInterval,
                  ),
                  const SizedBox(height: 12),
                  if (_activeTrip == null ||
                      _activeTrip!.deliveryOrderId ==
                          _selectedTrip!.deliveryOrderId)
                    _StartDeliveryButton(
                      trip: _selectedTrip!,
                      onPressed:
                          (_selectedTrip!.status == TripStatus.onDelivery ||
                              _selectedTrip!.status == TripStatus.arrived ||
                              _selectedTrip!.status == TripStatus.delivered ||
                              _selectedTrip!.isAwaitingAdminApproval)
                          ? null
                          : () => unawaited(_beginDelivery(_selectedTrip!)),
                    ),
                  if (_activeTrip?.deliveryOrderId ==
                      _selectedTrip!.deliveryOrderId) ...[
                    const SizedBox(height: 12),
                    _AdvanceButton(
                      status: _selectedTrip!.status,
                      awaitingAdminApproval:
                          _selectedTrip!.isAwaitingAdminApproval,
                      onPressed:
                          _selectedTrip!.status == TripStatus.delivered ||
                              _selectedTrip!.isAwaitingAdminApproval
                          ? null
                          : (_updatingStatus
                                ? null
                                : () => unawaited(_advanceStatus())),
                    ),
                  ],
                  if (_selectedTrip!.status == TripStatus.delivered &&
                      !_selectedTrip!.isAwaitingAdminApproval) ...[
                    const SizedBox(height: 12),
                    _CloseTripButton(
                      onPressed: _updatingStatus
                          ? null
                          : () => unawaited(_openTripClosure(_selectedTrip!)),
                    ),
                  ],
                ],
              ],
            ),
          ),
          if (blockingNotice != null)
            Positioned.fill(
              child: ColoredBox(
                color: Colors.black.withValues(alpha: 0.45),
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 420),
                      child: Material(
                        color: Colors.white,
                        elevation: 16,
                        borderRadius: BorderRadius.circular(24),
                        child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Container(
                                    width: 48,
                                    height: 48,
                                    decoration: BoxDecoration(
                                      color: blockingNotice.blocking
                                          ? scheme.errorContainer
                                          : scheme.secondaryContainer,
                                      borderRadius: BorderRadius.circular(16),
                                    ),
                                    child: Icon(
                                      blockingNotice.blocking
                                          ? Icons.block_rounded
                                          : Icons.warning_amber_rounded,
                                      color: blockingNotice.blocking
                                          ? scheme.error
                                          : scheme.secondary,
                                    ),
                                  ),
                                  const SizedBox(width: 14),
                                  Expanded(
                                    child: Text(
                                      blockingNotice.title,
                                      style: const TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 16),
                              Text(
                                blockingNotice.message,
                                style: TextStyle(
                                  color: scheme.onSurface.withValues(
                                    alpha: 0.78,
                                  ),
                                  height: 1.5,
                                ),
                              ),
                              const SizedBox(height: 12),
                              Text(
                                blockingNotice.isWarning
                                    ? 'Warning ini hanya tampil satu kali. Setelah ditutup, warning akan hilang dari aplikasi driver.'
                                    : 'Akses akan kembali normal setelah masa skors selesai di server.',
                                style: TextStyle(
                                  color: scheme.onSurface.withValues(
                                    alpha: 0.6,
                                  ),
                                  fontSize: 12,
                                  height: 1.45,
                                ),
                              ),
                              const SizedBox(height: 20),
                              Row(
                                children: [
                                  if (blockingNotice.blocking)
                                    OutlinedButton.icon(
                                      onPressed: () =>
                                          unawaited(_bootstrapPage()),
                                      icon: const Icon(Icons.refresh_rounded),
                                      label: const Text('Refresh'),
                                    ),
                                  const Spacer(),
                                  if (blockingNotice.blocking)
                                    FilledButton.icon(
                                      onPressed: widget.onLogout,
                                      icon: const Icon(Icons.logout_rounded),
                                      label: const Text('Keluar'),
                                    )
                                  else
                                    FilledButton(
                                      onPressed: _acknowledgingWarning
                                          ? null
                                          : () => unawaited(
                                              _closeWarningNotice(),
                                            ),
                                      child: Text(
                                        _acknowledgingWarning
                                            ? 'Memproses...'
                                            : 'Tutup Warning',
                                      ),
                                    ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildTripList(ColorScheme scheme) {
    if (_loadingTrips) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 40),
        child: Center(child: CircularProgressIndicator(color: scheme.primary)),
      );
    }
    if (_loadError != null) {
      return _ErrorCard(message: _loadError!, onRetry: _loadTrips);
    }
    if (_trips.isEmpty) return const _EmptyCard();
    return Column(
      children: _trips
          .map(
            (trip) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _TripListCard(
                trip: trip,
                isSelected:
                    _selectedTrip?.deliveryOrderId == trip.deliveryOrderId,
                onTap: () => setState(() => _selectedTrip = trip),
              ),
            ),
          )
          .toList(),
    );
  }
}

// ── Driver card ────────────────────────────────────────────
class _TripClosureSubmitResult {
  const _TripClosureSubmitResult({
    required this.odometerKm,
    required this.note,
  });

  final double odometerKm;
  final String note;
}

double? _parseOdometerInput(String value) {
  final normalized = value.trim().replaceAll('.', '').replaceAll(',', '.');
  if (normalized.isEmpty) return null;
  final parsed = double.tryParse(normalized);
  return parsed == null || parsed.isNaN || parsed.isInfinite ? null : parsed;
}

String _formatKm(num value) {
  final rounded = value.round().toString();
  final buffer = StringBuffer();
  for (var index = 0; index < rounded.length; index++) {
    final remaining = rounded.length - index;
    buffer.write(rounded[index]);
    if (remaining > 1 && remaining % 3 == 1) {
      buffer.write('.');
    }
  }
  return buffer.toString();
}

class _DriverCard extends StatelessWidget {
  const _DriverCard({required this.session, required this.tripCount});
  final DriverAppSession session;
  final int tripCount;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final tripLabel = tripCount == 1 ? '1 trip' : '$tripCount trip';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: scheme.primaryContainer,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(
                Icons.person_pin_circle_rounded,
                color: scheme.primary,
                size: 24,
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session.driverName,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    session.role,
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.5),
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: scheme.primaryContainer,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                tripLabel,
                style: TextStyle(
                  color: scheme.primary,
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Section header ─────────────────────────────────────────
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.count});
  final String title;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      children: [
        Text(
          title,
          style: TextStyle(
            color: scheme.onSurface,
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (count != null) ...[
          const SizedBox(width: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: scheme.primaryContainer,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              '$count',
              style: TextStyle(
                color: scheme.primary,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

// ── Trip list card ─────────────────────────────────────────
class _TripListCard extends StatelessWidget {
  const _TripListCard({
    required this.trip,
    required this.isSelected,
    required this.onTap,
  });
  final DeliveryTrip trip;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.fromLTRB(15, 14, 15, 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: isSelected
                ? scheme.primary.withValues(alpha: 0.5)
                : const Color(0xFFE2E8E4),
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  trip.doNumber,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
                if (isSelected)
                  Icon(
                    Icons.check_circle_rounded,
                    color: scheme.primary,
                    size: 16,
                  ),
                _StatusChip(status: trip.status),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              '${trip.customerName} | ${trip.vehiclePlate}',
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.5),
                fontSize: 12.5,
              ),
            ),
            const SizedBox(height: 6),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.route_rounded,
                  size: 13,
                  color: scheme.onSurface.withValues(alpha: 0.35),
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    '${trip.originLabel} -> ${trip.destinationLabel}',
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.62),
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ── Trip detail card ───────────────────────────────────────
class _PlannedTripCard extends StatelessWidget {
  const _PlannedTripCard({
    required this.tripPlan,
    required this.busy,
    required this.onPressed,
  });

  final DriverAssignedTripPlan tripPlan;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final pickupSummary = tripPlan.pickupStops.isEmpty
        ? 'Pickup belum diset'
        : tripPlan.pickupStops.map((pickup) => pickup.displayLabel).join(', ');

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  tripPlan.tripLabel,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: scheme.primaryContainer,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    tripPlan.allowsDirectCargoInput ? 'SJ & Barang' : 'SJ',
                    style: TextStyle(
                      color: scheme.primary,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              '${tripPlan.customerName ?? 'Tanpa customer'} | ${tripPlan.vehiclePlate ?? '-'}',
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.58),
                fontSize: 12.5,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              pickupSummary,
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.72),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.tonalIcon(
                onPressed: busy ? null : onPressed,
                icon: busy
                    ? SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: scheme.primary,
                        ),
                      )
                    : const Icon(Icons.note_add_outlined),
                label: Text(
                  tripPlan.allowsDirectCargoInput
                      ? 'Buat SJ & Barang'
                      : 'Buat SJ',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ManifestSummaryCard extends StatelessWidget {
  const _ManifestSummaryCard({required this.trip});

  final DeliveryTrip trip;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final shipperRefs = trip.shipperReferences;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  'Manifest',
                  style: TextStyle(
                    color: scheme.onSurface,
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '${shipperRefs.length} SJ',
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.72),
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (shipperRefs.isEmpty)
              Text(
                'Belum ada SJ tercatat untuk DO ini.',
                style: TextStyle(
                  color: scheme.onSurface.withValues(alpha: 0.58),
                  fontSize: 13,
                ),
              )
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: shipperRefs
                    .map(
                      (shipperRef) => Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 7,
                        ),
                        decoration: BoxDecoration(
                          color: scheme.surface,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: scheme.outline.withValues(alpha: 0.32),
                          ),
                        ),
                        child: Text(
                          shipperRef.referenceNumber,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    )
                    .toList(growable: false),
              ),
            const SizedBox(height: 10),
            Text(
              trip.allowsDirectCargoInput
                  ? '${trip.cargoItems.length} barang sudah tercatat di DO ini.'
                  : 'Muatan mengikuti order/resi. Driver cukup kelola nomor SJ dan pickup yang dibawa.',
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.58),
                fontSize: 12.5,
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TripDetailCard extends StatelessWidget {
  const _TripDetailCard({required this.trip});
  final DeliveryTrip trip;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  trip.doNumber,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
                _StatusChip(status: trip.status),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              '${trip.originLabel} -> ${trip.destinationLabel}',
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.7),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                _DetailTile(
                  icon: Icons.business_rounded,
                  label: 'Customer',
                  value: trip.customerName,
                ),
                _DetailTile(
                  icon: Icons.local_shipping_rounded,
                  label: 'Kendaraan',
                  value: trip.vehiclePlate,
                ),
                if (trip.receiverName != null)
                  _DetailTile(
                    icon: Icons.person_rounded,
                    label: 'Penerima',
                    value: trip.receiverName!,
                  ),
                _DetailTile(
                  icon: Icons.calendar_today_rounded,
                  label: 'Tanggal',
                  value: trip.etdLabel,
                ),
              ],
            ),
            if (trip.itemSummary != null && trip.itemSummary!.isNotEmpty) ...[
              const SizedBox(height: 12),
              _DetailNote(
                icon: Icons.notes_rounded,
                label: 'Catatan',
                value: trip.itemSummary!,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DetailTile extends StatelessWidget {
  const _DetailTile({
    required this.icon,
    required this.label,
    required this.value,
  });
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 140, maxWidth: 220),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        decoration: BoxDecoration(
          color: scheme.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: scheme.outline.withValues(alpha: 0.4)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 15, color: scheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.5),
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    value,
                    style: const TextStyle(fontSize: 13),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DetailNote extends StatelessWidget {
  const _DetailNote({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: scheme.outline.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: scheme.primary),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    color: scheme.onSurface.withValues(alpha: 0.5),
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(value, style: const TextStyle(fontSize: 13)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Tracking card ──────────────────────────────────────────
class _TrackingCard extends StatelessWidget {
  const _TrackingCard({
    required this.trackingEnabled,
    required this.selectedInterval,
    required this.location,
    required this.pingCount,
    required this.onTrackingChanged,
    required this.onIntervalChanged,
  });

  final bool trackingEnabled;
  final Duration selectedInterval;
  final LocationSnapshot? location;
  final int pingCount;
  final Future<void> Function(bool) onTrackingChanged;
  final ValueChanged<Duration> onIntervalChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: trackingEnabled
                        ? scheme.primaryContainer
                        : scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    trackingEnabled
                        ? Icons.sensors_rounded
                        : Icons.sensors_off_rounded,
                    color: trackingEnabled
                        ? scheme.primary
                        : scheme.onSurface.withValues(alpha: 0.3),
                    size: 18,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        trackingEnabled
                            ? 'Tracking aktif'
                            : 'Tracking nonaktif',
                        style: TextStyle(
                          color: trackingEnabled
                              ? scheme.primary
                              : scheme.onSurface,
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                      ),
                      Text(
                        trackingEnabled
                            ? '$pingCount ping terkirim'
                            : 'Aktifkan untuk kirim lokasi',
                        style: TextStyle(
                          color: scheme.onSurface.withValues(alpha: 0.5),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                Switch(
                  value: trackingEnabled,
                  onChanged: (v) => unawaited(onTrackingChanged(v)),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 7,
                  ),
                  decoration: BoxDecoration(
                    color: scheme.surface,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                      color: scheme.outline.withValues(alpha: 0.4),
                    ),
                  ),
                  child: Text(
                    'Interval',
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.58),
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                _Chip(
                  label: '30s',
                  selected: selectedInterval == const Duration(seconds: 30),
                  onTap: () => onIntervalChanged(const Duration(seconds: 30)),
                ),
                const SizedBox(width: 8),
                _Chip(
                  label: '1 min',
                  selected: selectedInterval == const Duration(minutes: 1),
                  onTap: () => onIntervalChanged(const Duration(minutes: 1)),
                ),
              ],
            ),
            if (location != null) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: scheme.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: scheme.outline.withValues(alpha: 0.4),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        _StatMini(
                          label: 'Terakhir',
                          value: TimeOfDay.fromDateTime(
                            location!.recordedAt,
                          ).format(context),
                        ),
                        _StatMini(
                          label: 'Kecepatan',
                          value:
                              '${location!.speedKph.toStringAsFixed(0)} km/h',
                        ),
                        _StatMini(
                          label: 'Akurasi',
                          value:
                              '+/- ${location!.accuracyM.toStringAsFixed(0)} m',
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.location_on_rounded,
                          size: 13,
                          color: scheme.onSurface.withValues(alpha: 0.4),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            '${location!.latitude.toStringAsFixed(6)}, '
                            '${location!.longitude.toStringAsFixed(6)}',
                            style: TextStyle(
                              fontSize: 12,
                              color: scheme.onSurface.withValues(alpha: 0.5),
                              fontFamily: 'monospace',
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ── Error banner ───────────────────────────────────────────
class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({
    required this.icon,
    required this.message,
    this.onRetry,
    this.isWarning = false,
  });

  final IconData icon;
  final String message;
  final VoidCallback? onRetry;
  final bool isWarning;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = isWarning ? const Color(0xFFB45309) : scheme.error;
    final bgColor = isWarning ? const Color(0xFFFEF3C7) : scheme.errorContainer;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message, style: TextStyle(color: color, fontSize: 13)),
          ),
          if (onRetry != null)
            TextButton(
              onPressed: onRetry,
              child: Text(
                'Coba lagi',
                style: TextStyle(color: color, fontSize: 13),
              ),
            ),
        ],
      ),
    );
  }
}

// ── Chip / stat ────────────────────────────────────────────
class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: selected ? scheme.primaryContainer : Colors.transparent,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: selected
                ? scheme.primary.withValues(alpha: 0.4)
                : const Color(0xFFD4DDDA),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected
                ? scheme.primary
                : scheme.onSurface.withValues(alpha: 0.5),
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _StatMini extends StatelessWidget {
  const _StatMini({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 92),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: Theme.of(
                context,
              ).colorScheme.onSurface.withValues(alpha: 0.4),
              fontSize: 11,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

// ── Buttons ────────────────────────────────────────────────
class _StartDeliveryButton extends StatelessWidget {
  const _StartDeliveryButton({required this.trip, required this.onPressed});
  final DeliveryTrip trip;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final alreadyStarted =
        trip.status == TripStatus.onDelivery ||
        trip.status == TripStatus.arrived;
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        onPressed: onPressed,
        icon: Icon(
          alreadyStarted ? Icons.sensors_rounded : Icons.play_arrow_rounded,
          size: 18,
        ),
        label: Text(alreadyStarted ? 'Sedang jalan' : 'Mulai trip'),
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

class _AdvanceButton extends StatelessWidget {
  const _AdvanceButton({
    required this.status,
    required this.onPressed,
    this.awaitingAdminApproval = false,
  });
  final TripStatus status;
  final VoidCallback? onPressed;
  final bool awaitingAdminApproval;

  @override
  Widget build(BuildContext context) {
    final label = awaitingAdminApproval
        ? 'Tunggu approval'
        : switch (status) {
            TripStatus.assigned => 'Ke pickup',
            TripStatus.headingToPickup => 'Mulai kirim',
            TripStatus.onDelivery => 'Tandai Tiba',
            TripStatus.arrived => 'Ajukan Selesai',
            TripStatus.delivered => 'Trip selesai',
          };
    return SizedBox(
      width: double.infinity,
      child: FilledButton.tonalIcon(
        onPressed: onPressed,
        icon: Icon(
          status == TripStatus.delivered
              ? Icons.check_circle_rounded
              : Icons.flag_circle_rounded,
          size: 18,
        ),
        label: Text(label),
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

// ── Status chip ────────────────────────────────────────────
class _CloseTripButton extends StatelessWidget {
  const _CloseTripButton({required this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        onPressed: onPressed,
        icon: const Icon(Icons.lock_clock_rounded, size: 18),
        label: const Text('Tutup Trip'),
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final TripStatus status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (label, color) = switch (status) {
      TripStatus.assigned => ('Siap', const Color(0xFF64748B)),
      TripStatus.headingToPickup => ('Pickup', const Color(0xFF2563EB)),
      TripStatus.onDelivery => ('Kirim', scheme.primary),
      TripStatus.arrived => ('Tiba', const Color(0xFFB45309)),
      TripStatus.delivered => ('Selesai', const Color(0xFF15803D)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

// ── Error / empty states ───────────────────────────────────
class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message, required this.onRetry});
  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.error_outline_rounded,
                  color: scheme.error,
                  size: 16,
                ),
                const SizedBox(width: 8),
                Text(
                  'Gagal memuat',
                  style: TextStyle(
                    color: scheme.error,
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.5),
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 14),
            OutlinedButton(
              onPressed: () => unawaited(onRetry()),
              child: const Text('Coba lagi'),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 40),
        child: Column(
          children: [
            Icon(
              Icons.inbox_rounded,
              color: scheme.onSurface.withValues(alpha: 0.2),
              size: 36,
            ),
            const SizedBox(height: 12),
            Text(
              'Tidak ada DO aktif',
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.5),
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Extension ──────────────────────────────────────────────
extension _IterableX<T> on Iterable<T> {
  T? firstWhereOrNull(bool Function(T) test) {
    for (final e in this) {
      if (test(e)) return e;
    }
    return null;
  }
}
