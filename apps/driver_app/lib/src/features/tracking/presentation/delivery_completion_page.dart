import 'package:flutter/material.dart';

import '../data/delivery_order_service.dart';
import '../domain/models.dart';
import 'mobile_input_visibility.dart';
import 'mobile_unit_selector_field.dart';

const _mobileInputScrollPadding = EdgeInsets.fromLTRB(20, 20, 20, 120);

class DeliveryCompletionPage extends StatefulWidget {
  const DeliveryCompletionPage({
    super.key,
    required this.trip,
    required this.customerRecipients,
  });

  final DeliveryTrip trip;
  final List<CustomerRecipientOption> customerRecipients;

  @override
  State<DeliveryCompletionPage> createState() => _DeliveryCompletionPageState();
}

class _DeliveryCompletionPageState extends State<DeliveryCompletionPage>
    with WidgetsBindingObserver {
  final _inputVisibilityKey = GlobalKey();
  final _noteController = TextEditingController();
  late final TextEditingController _podReceiverNameController;
  late final TextEditingController _podReceivedDateController;
  bool _submitting = false;
  bool _inputVisibilityScheduled = false;
  late List<_ActualCargoDraft> _cargoDrafts;
  late List<_ActualDropDraft> _dropDrafts;
  late Set<String> _selectedShipperReferenceValues;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    FocusManager.instance.addListener(_scheduleFocusedInputVisibility);
    _cargoDrafts = _buildInitialCargoDrafts(widget.trip);
    _dropDrafts = _buildInitialDropDrafts(widget.trip, _cargoDrafts);
    _selectedShipperReferenceValues = _initialSelectedReferenceValues(
      widget.trip,
      _cargoDrafts,
    );
    _dropDrafts = _normalizeDropDraftsForSelectedReferences(
      _dropDrafts,
      _selectedShipperReferences,
      _selectedCargoDrafts,
    );
    _podReceiverNameController = TextEditingController(
      text: _defaultPodReceiverName(widget.trip, _selectedShipperReferences),
    );
    _podReceivedDateController = TextEditingController(
      text: _currentJakartaDateValue(),
    );
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_scheduleFocusedInputVisibility);
    WidgetsBinding.instance.removeObserver(this);
    _noteController.dispose();
    _podReceiverNameController.dispose();
    _podReceivedDateController.dispose();
    super.dispose();
  }

  @override
  void didChangeMetrics() {
    _scheduleFocusedInputVisibility();
  }

  List<DeliveryShipperReference> get _selectedShipperReferences =>
      _selectedReferencesForValues(
        widget.trip,
        widget.trip.shipperReferences,
        _selectedShipperReferenceValues,
      );

  List<_ActualCargoDraft> get _selectedCargoDrafts =>
      _cargoDraftsForSelectedReferences(
        _cargoDrafts,
        widget.trip.shipperReferences,
        _selectedShipperReferences,
      );

  List<_ActualDropDraft> get _selectedDropDrafts =>
      _dropDraftsForSelectedReferences(
        _dropDrafts,
        widget.trip.shipperReferences,
        _selectedShipperReferences,
      );

  void _setShipperReferenceSelected(String optionValue, bool selected) {
    setState(() {
      final nextValues = Set<String>.from(_selectedShipperReferenceValues);
      if (selected) {
        nextValues.add(optionValue);
      } else {
        nextValues.remove(optionValue);
      }
      _selectedShipperReferenceValues = nextValues;
      _dropDrafts = _normalizeDropDraftsForSelectedReferences(
        _dropDrafts,
        _selectedShipperReferences,
        _selectedCargoDrafts,
      );
    });
  }

  Future<void> _pickPodReceivedDate() async {
    final initialDate =
        _parseDateValue(_podReceivedDateController.text) ??
        _jakartaDateTimeNow();
    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(_jakartaDateTimeNow().year + 2, 12, 31),
    );
    if (picked == null) return;
    _podReceivedDateController.text = _formatDateValue(picked);
  }

  void _updateCargo(
    String cargoId, {
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  }) {
    setState(() {
      _cargoDrafts = _cargoDrafts
          .map(
            (draft) => draft.itemId == cargoId
                ? draft.copyWith(
                    qtyKoli: qtyKoli,
                    weightInputValue: weightInputValue,
                    weightInputUnit: weightInputUnit,
                    volumeInputValue: volumeInputValue,
                    volumeInputUnit: volumeInputUnit,
                  )
                : draft,
          )
          .toList(growable: false);
    });
  }

  void _updateDrop(
    String draftId, {
    String? stopType,
    String? locationName,
    String? locationAddress,
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
    String? shipperReferenceNumber,
    String? shipperReferenceKey,
    String? note,
  }) {
    setState(() {
      _dropDrafts = _dropDrafts
          .map(
            (draft) => draft.id == draftId
                ? draft.copyWith(
                    stopType: stopType,
                    locationName: locationName,
                    locationAddress: locationAddress,
                    qtyKoli: qtyKoli,
                    weightInputValue: weightInputValue,
                    weightInputUnit: weightInputUnit,
                    volumeInputValue: volumeInputValue,
                    volumeInputUnit: volumeInputUnit,
                    shipperReferenceNumber: shipperReferenceNumber,
                    shipperReferenceKey: shipperReferenceKey,
                    note: note,
                  )
                : draft,
          )
          .toList(growable: false);
    });
  }

  void _addDropPoint() {
    setState(() {
      _dropDrafts = [..._dropDrafts, _ActualDropDraft.create()];
    });
  }

  void _removeDropPoint(String draftId) {
    setState(() {
      final next = _dropDrafts.where((draft) => draft.id != draftId).toList();
      _dropDrafts = next.isNotEmpty ? next : [_ActualDropDraft.create()];
    });
  }

  void _selectDropReference(String draftId, String optionValue) {
    final reference = _findShipperReferenceByOptionValue(
      widget.trip.shipperReferences,
      optionValue,
    );

    setState(() {
      _dropDrafts = _dropDrafts
          .map((draft) {
            if (draft.id != draftId) return draft;
            if (reference == null) {
              return draft.copyWith(
                shipperReferenceNumber: '',
                shipperReferenceKey: '',
              );
            }

            return draft.copyWith(
              shipperReferenceNumber: reference.referenceNumber,
              shipperReferenceKey: reference.key ?? '',
            );
          })
          .toList(growable: false);
    });
  }

  void _selectRecipient(String draftId, String recipientId) {
    CustomerRecipientOption? recipient;
    for (final item in widget.customerRecipients) {
      if (item.id == recipientId) {
        recipient = item;
        break;
      }
    }
    final selectedRecipient = recipient;
    if (selectedRecipient == null) return;

    setState(() {
      _dropDrafts = _dropDrafts
          .map(
            (draft) => draft.id == draftId
                ? draft.copyWith(
                    locationName: selectedRecipient.locationName,
                    locationAddress: selectedRecipient.receiverAddress,
                  )
                : draft,
          )
          .toList(growable: false);
    });
  }

  Future<void> _submit() async {
    final validationError = _validateDrafts();
    if (validationError != null) {
      _showError(validationError);
      return;
    }

    final selectedReferences = _selectedShipperReferences;
    final submissionDropDrafts = _selectedDropDrafts
        .map(
          (draft) =>
              _applySingleReferenceToBlankDrop(draft, selectedReferences),
        )
        .toList(growable: false);
    final actualItems = _selectedCargoDrafts
        .map(
          (draft) => DriverActualCargoInput(
            deliveryOrderItemRef: draft.itemId,
            actualQtyKoli: draft.qtyKoliValue,
            actualWeightInputValue: draft.weightInputValueNumber,
            actualWeightInputUnit: _normalizeWeightUnit(draft.weightInputUnit),
            actualVolumeInputValue: draft.volumeInputValueNumber,
            actualVolumeInputUnit: _normalizeVolumeUnit(draft.volumeInputUnit),
          ),
        )
        .toList(growable: false);

    final actualDropPoints = submissionDropDrafts
        .map(
          (draft) => DriverActualDropPointInput(
            stopType: _normalizeDropStopType(draft.stopType),
            shipperReferenceNumber:
                draft.shipperReferenceNumber.trim().isNotEmpty
                ? draft.shipperReferenceNumber.trim()
                : null,
            shipperReferenceKey: draft.shipperReferenceKey.trim().isNotEmpty
                ? draft.shipperReferenceKey.trim()
                : null,
            originLocationName: draft.originLocationName.trim().isNotEmpty
                ? draft.originLocationName.trim()
                : null,
            originLocationAddress: draft.originLocationAddress.trim().isNotEmpty
                ? draft.originLocationAddress.trim()
                : null,
            locationName: draft.locationName.trim().isNotEmpty
                ? draft.locationName.trim()
                : draft.locationAddress.trim(),
            locationAddress: draft.locationAddress.trim(),
            qtyKoli: draft.qtyKoliValue,
            weightInputValue: draft.weightInputValueNumber,
            weightInputUnit: _normalizeWeightUnit(draft.weightInputUnit),
            volumeInputValue: draft.volumeInputValueNumber,
            volumeInputUnit: _normalizeVolumeUnit(draft.volumeInputUnit),
            note: draft.note.trim().isNotEmpty ? draft.note.trim() : null,
          ),
        )
        .toList(growable: false);

    setState(() => _submitting = true);
    Navigator.of(context).pop(
      DeliveryCompletionSubmitResult(
        note: _noteController.text.trim(),
        podReceiverName: _podReceiverNameController.text.trim(),
        podReceivedDate: _podReceivedDateController.text.trim(),
        selectedSuratJalanRefs: _selectedSuratJalanDocumentIds(
          widget.trip,
          selectedReferences,
          _selectedCargoDrafts,
        ),
        actualItems: actualItems,
        actualDropPoints: actualDropPoints,
      ),
    );
  }

  String? _validateDrafts() {
    final selectedReferences = _selectedShipperReferences;
    final selectedCargoDrafts = _selectedCargoDrafts;
    final selectedDropDrafts = _selectedDropDrafts;
    if (widget.trip.shipperReferences.isNotEmpty &&
        selectedReferences.isEmpty) {
      return 'Pilih minimal satu SJ untuk diajukan selesai.';
    }
    if (_podReceiverNameController.text.trim().isEmpty) {
      return 'Nama penerima POD wajib diisi.';
    }
    if (!_isValidDateValue(_podReceivedDateController.text)) {
      return 'Tanggal terima POD wajib diisi dengan format YYYY-MM-DD.';
    }
    if (selectedCargoDrafts.isEmpty) {
      return 'Muatan DO belum ada. Isi barang dulu sebelum ajukan selesai.';
    }

    for (final draft in selectedCargoDrafts) {
      final qty = draft.qtyKoliValue;
      final weight = draft.weightInputValueNumber;
      final volume = draft.volumeInputValueNumber;
      final hasActualValue = qty > 0 || weight > 0 || volume > 0;
      if (!hasActualValue) {
        return 'Semua barang harus punya realisasi aktual.';
      }
      if (draft.requireQty && qty <= 0) {
        return 'Qty aktual wajib diisi untuk barang yang punya target koli.';
      }
      if (draft.requireWeight && weight <= 0) {
        return 'Berat aktual wajib diisi untuk barang yang punya target berat.';
      }
      if (draft.requireVolume && volume <= 0) {
        return 'Volume aktual wajib diisi untuk barang yang punya target volume.';
      }
    }

    if (selectedDropDrafts.isEmpty) {
      return 'Isi minimal satu titik realisasi drop.';
    }

    for (final draft in selectedDropDrafts) {
      final locationName = draft.locationName.trim();
      final locationAddress = draft.locationAddress.trim();
      final hasLocation = locationName.isNotEmpty || locationAddress.isNotEmpty;
      if (!hasLocation) {
        return 'Nama atau alamat titik realisasi wajib diisi.';
      }
      if (draft.qtyKoliValue <= 0 &&
          draft.weightInputValueNumber <= 0 &&
          draft.volumeInputValueNumber <= 0) {
        return 'Setiap titik realisasi harus punya qty, berat, atau volume.';
      }
    }

    final cargoTotals = _summarizeCargoDrafts(selectedCargoDrafts);
    final dropTotals = _summarizeDropDrafts(selectedDropDrafts);
    if (cargoTotals.qtyKoli > 0 &&
        (dropTotals.qtyKoli - cargoTotals.qtyKoli).abs() > 0.01) {
      return 'Total qty titik drop harus sama dengan qty aktual muatan.';
    }
    if (cargoTotals.weightKg > 0 &&
        (dropTotals.weightKg - cargoTotals.weightKg).abs() > 0.01) {
      return 'Total berat titik drop harus sama dengan berat aktual muatan.';
    }
    if (cargoTotals.volumeM3 > 0 &&
        (dropTotals.volumeM3 - cargoTotals.volumeM3).abs() > 0.001) {
      return 'Total volume titik drop harus sama dengan volume aktual muatan.';
    }

    return null;
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
  }

  void _scheduleFocusedInputVisibility() {
    if (_inputVisibilityScheduled) return;
    if (focusedEditableContextInside(_inputVisibilityKey) == null) return;

    _inputVisibilityScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _inputVisibilityScheduled = false;
      if (!mounted) return;

      final inputContext = focusedEditableContextInside(_inputVisibilityKey);
      if (inputContext == null) return;

      ensureMobileInputVisible(inputContext);
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final selectedCargoDrafts = _selectedCargoDrafts;
    final selectedDropDrafts = _selectedDropDrafts;
    final cargoTotals = _summarizeCargoDrafts(selectedCargoDrafts);
    final dropTotals = _summarizeDropDrafts(selectedDropDrafts);
    final hasMultiTargetDefault = widget.trip.shipperReferences.length > 1;

    return Scaffold(
      resizeToAvoidBottomInset: true,
      appBar: AppBar(title: const Text('Ajukan Selesai')),
      body: SafeArea(
        child: KeyedSubtree(
          key: _inputVisibilityKey,
          child: Column(
            children: [
              Expanded(
                child: ListView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                  children: [
                    _InfoCard(
                      title: 'Realisasi trip',
                      message: hasMultiTargetDefault
                          ? 'Trip ini punya beberapa target SJ. Driver perlu isi realisasi muatan dan alokasi titik drop dengan benar.'
                          : 'Isi realisasi muatan dan titik drop. Admin akan cross-check sebelum DO diselesaikan.',
                    ),
                    if (widget.trip.shipperReferences.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      _BatchSuratJalanCard(
                        references: widget.trip.shipperReferences,
                        selectedValues: _selectedShipperReferenceValues,
                        canRequestFinalization:
                            widget.trip.canRequestFinalizationForReference,
                        onChanged: _submitting
                            ? null
                            : _setShipperReferenceSelected,
                      ),
                    ],
                    const SizedBox(height: 12),
                    _PodCard(
                      receiverController: _podReceiverNameController,
                      dateController: _podReceivedDateController,
                      onPickDate: _submitting ? null : _pickPodReceivedDate,
                    ),
                    const SizedBox(height: 16),
                    _TotalsCard(
                      title: 'Qty',
                      qtyLabel: _formatMetric(cargoTotals.qtyKoli),
                      weightLabel: '${_formatMetric(cargoTotals.weightKg)} kg',
                      volumeLabel:
                          '${_formatMetric(cargoTotals.volumeM3, fractionDigits: 3)} m3',
                    ),
                    const SizedBox(height: 12),
                    ...selectedCargoDrafts.map(
                      (draft) => Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _ActualCargoCard(
                          key: ValueKey(draft.itemId),
                          draft: draft,
                          onChanged: _updateCargo,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    _TotalsCard(
                      title: 'Qty Drop',
                      qtyLabel: _formatMetric(dropTotals.qtyKoli),
                      weightLabel: '${_formatMetric(dropTotals.weightKg)} kg',
                      volumeLabel:
                          '${_formatMetric(dropTotals.volumeM3, fractionDigits: 3)} m3',
                    ),
                    const SizedBox(height: 12),
                    ...selectedDropDrafts.asMap().entries.map(
                      (entry) => Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: _ActualDropCard(
                          key: ValueKey(entry.value.id),
                          index: entry.key + 1,
                          draft: entry.value,
                          shipperReferences: widget.trip.shipperReferences,
                          customerRecipients: widget.customerRecipients,
                          cargoDrafts: selectedCargoDrafts,
                          showRemove: selectedDropDrafts.length > 1,
                          onChanged: _updateDrop,
                          onReferenceChanged: _selectDropReference,
                          onRecipientChanged: _selectRecipient,
                          onRemove: _removeDropPoint,
                        ),
                      ),
                    ),
                    OutlinedButton.icon(
                      onPressed: _submitting ? null : _addDropPoint,
                      icon: const Icon(Icons.add_location_alt_rounded),
                      label: const Text('Tambah Titik Drop'),
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _noteController,
                      minLines: 2,
                      maxLines: 4,
                      scrollPadding: _mobileInputScrollPadding,
                      decoration: const InputDecoration(
                        labelText: 'Catatan Driver',
                        hintText: 'Opsional',
                      ),
                    ),
                  ],
                ),
              ),
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 180),
                child: Padding(
                  key: const ValueKey('submit-bar'),
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _submitting ? null : _submit,
                      icon: _submitting
                          ? SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: scheme.onPrimary,
                              ),
                            )
                          : const Icon(Icons.check_circle_rounded),
                      label: const Text('Ajukan Selesai'),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class DeliveryCompletionSubmitResult {
  const DeliveryCompletionSubmitResult({
    required this.note,
    required this.podReceiverName,
    required this.podReceivedDate,
    required this.selectedSuratJalanRefs,
    required this.actualItems,
    required this.actualDropPoints,
  });

  final String note;
  final String podReceiverName;
  final String podReceivedDate;
  final List<String> selectedSuratJalanRefs;
  final List<DriverActualCargoInput> actualItems;
  final List<DriverActualDropPointInput> actualDropPoints;
}

class _ActualCargoTotals {
  const _ActualCargoTotals({
    required this.qtyKoli,
    required this.weightKg,
    required this.volumeM3,
  });

  final double qtyKoli;
  final double weightKg;
  final double volumeM3;
}

class _ActualCargoDraft {
  const _ActualCargoDraft({
    required this.itemId,
    required this.description,
    required this.shipperReferenceNumber,
    required this.shipperReferenceKey,
    required this.requireQty,
    required this.requireWeight,
    required this.requireVolume,
    required this.qtyKoli,
    required this.weightInputValue,
    required this.weightInputUnit,
    required this.volumeInputValue,
    required this.volumeInputUnit,
  });

  final String itemId;
  final String description;
  final String shipperReferenceNumber;
  final String shipperReferenceKey;
  final bool requireQty;
  final bool requireWeight;
  final bool requireVolume;
  final String qtyKoli;
  final String weightInputValue;
  final String weightInputUnit;
  final String volumeInputValue;
  final String volumeInputUnit;

  double get qtyKoliValue => _parseDouble(qtyKoli);
  double get weightInputValueNumber => _parseDouble(weightInputValue);
  double get volumeInputValueNumber => _parseDouble(volumeInputValue);

  _ActualCargoDraft copyWith({
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  }) {
    return _ActualCargoDraft(
      itemId: itemId,
      description: description,
      shipperReferenceNumber: shipperReferenceNumber,
      shipperReferenceKey: shipperReferenceKey,
      requireQty: requireQty,
      requireWeight: requireWeight,
      requireVolume: requireVolume,
      qtyKoli: qtyKoli ?? this.qtyKoli,
      weightInputValue: weightInputValue ?? this.weightInputValue,
      weightInputUnit: weightInputUnit ?? this.weightInputUnit,
      volumeInputValue: volumeInputValue ?? this.volumeInputValue,
      volumeInputUnit: volumeInputUnit ?? this.volumeInputUnit,
    );
  }
}

class _ActualDropDraft {
  const _ActualDropDraft({
    required this.id,
    required this.stopType,
    required this.shipperReferenceNumber,
    required this.shipperReferenceKey,
    required this.originLocationName,
    required this.originLocationAddress,
    required this.locationName,
    required this.locationAddress,
    required this.qtyKoli,
    required this.weightInputValue,
    required this.weightInputUnit,
    required this.volumeInputValue,
    required this.volumeInputUnit,
    required this.note,
  });

  final String id;
  final String stopType;
  final String shipperReferenceNumber;
  final String shipperReferenceKey;
  final String originLocationName;
  final String originLocationAddress;
  final String locationName;
  final String locationAddress;
  final String qtyKoli;
  final String weightInputValue;
  final String weightInputUnit;
  final String volumeInputValue;
  final String volumeInputUnit;
  final String note;

  double get qtyKoliValue => _parseDouble(qtyKoli);
  double get weightInputValueNumber => _parseDouble(weightInputValue);
  double get volumeInputValueNumber => _parseDouble(volumeInputValue);

  factory _ActualDropDraft.create({
    String stopType = 'DROP',
    String shipperReferenceNumber = '',
    String shipperReferenceKey = '',
    String originLocationName = '',
    String originLocationAddress = '',
    String locationName = '',
    String locationAddress = '',
    String qtyKoli = '',
    String weightInputValue = '',
    String weightInputUnit = 'KG',
    String volumeInputValue = '',
    String volumeInputUnit = 'M3',
    String note = '',
  }) {
    return _ActualDropDraft(
      id: UniqueKey().toString(),
      stopType: stopType,
      shipperReferenceNumber: shipperReferenceNumber,
      shipperReferenceKey: shipperReferenceKey,
      originLocationName: originLocationName,
      originLocationAddress: originLocationAddress,
      locationName: locationName,
      locationAddress: locationAddress,
      qtyKoli: qtyKoli,
      weightInputValue: weightInputValue,
      weightInputUnit: weightInputUnit,
      volumeInputValue: volumeInputValue,
      volumeInputUnit: volumeInputUnit,
      note: note,
    );
  }

  _ActualDropDraft copyWith({
    String? stopType,
    String? shipperReferenceNumber,
    String? shipperReferenceKey,
    String? originLocationName,
    String? originLocationAddress,
    String? locationName,
    String? locationAddress,
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
    String? note,
  }) {
    return _ActualDropDraft(
      id: id,
      stopType: stopType ?? this.stopType,
      shipperReferenceNumber:
          shipperReferenceNumber ?? this.shipperReferenceNumber,
      shipperReferenceKey: shipperReferenceKey ?? this.shipperReferenceKey,
      originLocationName: originLocationName ?? this.originLocationName,
      originLocationAddress:
          originLocationAddress ?? this.originLocationAddress,
      locationName: locationName ?? this.locationName,
      locationAddress: locationAddress ?? this.locationAddress,
      qtyKoli: qtyKoli ?? this.qtyKoli,
      weightInputValue: weightInputValue ?? this.weightInputValue,
      weightInputUnit: weightInputUnit ?? this.weightInputUnit,
      volumeInputValue: volumeInputValue ?? this.volumeInputValue,
      volumeInputUnit: volumeInputUnit ?? this.volumeInputUnit,
      note: note ?? this.note,
    );
  }
}

List<_ActualCargoDraft> _buildInitialCargoDrafts(DeliveryTrip trip) {
  final pendingById = {
    for (final item in trip.pendingActualCargoItems)
      item.deliveryOrderItemRef: item,
  };
  return trip.cargoItems
      .map((item) {
        final pending = pendingById[item.id];
        final defaultWeightUnit =
            (pending?.actualWeightInputUnit ??
                    item.actualWeightInputUnit ??
                    item.weightInputUnit ??
                    'KG')
                .toUpperCase();
        final defaultVolumeUnit =
            (pending?.actualVolumeInputUnit ??
                    item.actualVolumeInputUnit ??
                    item.volumeInputUnit ??
                    'M3')
                .toUpperCase();
        final defaultQty =
            pending?.actualQtyKoli ?? item.actualQtyKoli ?? item.qtyKoli ?? 0;
        final defaultWeightInput =
            pending?.actualWeightInputValue ??
            item.actualWeightInputValue ??
            item.weightInputValue ??
            (item.weightKg ?? 0);
        final defaultVolumeInput =
            pending?.actualVolumeInputValue ??
            item.actualVolumeInputValue ??
            item.volumeInputValue ??
            (item.volumeM3 ?? 0);
        return _ActualCargoDraft(
          itemId: item.id,
          description: item.description,
          shipperReferenceNumber: item.shipperReferenceNumber ?? '',
          shipperReferenceKey: item.shipperReferenceKey ?? '',
          requireQty: (item.qtyKoli ?? 0) > 0,
          requireWeight:
              (item.weightKg ?? 0) > 0 || (item.weightInputValue ?? 0) > 0,
          requireVolume:
              (item.volumeM3 ?? 0) > 0 || (item.volumeInputValue ?? 0) > 0,
          qtyKoli: _formatMetric(defaultQty),
          weightInputValue: _formatMetric(
            defaultWeightInput,
            fractionDigits: defaultWeightUnit == 'TON' ? 3 : 2,
          ),
          weightInputUnit: defaultWeightUnit,
          volumeInputValue: _formatMetric(
            defaultVolumeInput,
            fractionDigits: defaultVolumeUnit == 'LITER' ? 0 : 3,
          ),
          volumeInputUnit: defaultVolumeUnit,
        );
      })
      .toList(growable: false);
}

List<_ActualDropDraft> _buildInitialDropDrafts(
  DeliveryTrip trip,
  List<_ActualCargoDraft> cargoDrafts,
) {
  if (trip.pendingActualDropPoints.isNotEmpty) {
    return trip.pendingActualDropPoints
        .map(
          (point) => _ActualDropDraft.create(
            stopType: point.stopType,
            shipperReferenceNumber: point.shipperReferenceNumber ?? '',
            shipperReferenceKey: point.shipperReferenceKey ?? '',
            originLocationName: point.originLocationName ?? '',
            originLocationAddress: point.originLocationAddress ?? '',
            locationName: point.locationName,
            locationAddress: point.locationAddress ?? '',
            qtyKoli: _formatMetric(point.qtyKoli),
            weightInputValue: _formatMetric(
              point.weightInputValue,
              fractionDigits:
                  (point.weightInputUnit ?? 'KG').toUpperCase() == 'TON'
                  ? 3
                  : 2,
            ),
            weightInputUnit: (point.weightInputUnit ?? 'KG').toUpperCase(),
            volumeInputValue: _formatMetric(
              point.volumeInputValue,
              fractionDigits:
                  (point.volumeInputUnit ?? 'M3').toUpperCase() == 'LITER'
                  ? 0
                  : 3,
            ),
            volumeInputUnit: (point.volumeInputUnit ?? 'M3').toUpperCase(),
            note: point.note ?? '',
          ),
        )
        .toList(growable: false);
  }

  final totals = _summarizeCargoDrafts(cargoDrafts);
  return [
    _ActualDropDraft.create(
      qtyKoli: _formatMetric(totals.qtyKoli),
      weightInputValue: _formatMetric(totals.weightKg),
      volumeInputValue: _formatMetric(totals.volumeM3, fractionDigits: 3),
    ),
  ];
}

Set<String> _initialSelectedReferenceValues(
  DeliveryTrip trip,
  List<_ActualCargoDraft> cargoDrafts,
) {
  final referencesWithCargo = trip.shipperReferences
      .where(trip.canRequestFinalizationForReference)
      .where(
        (reference) => cargoDrafts.any(
          (draft) => _cargoDraftMatchesReference(draft, reference),
        ),
      )
      .map(_shipperReferenceOptionValue)
      .toSet();
  if (referencesWithCargo.isNotEmpty) return referencesWithCargo;
  return trip.shipperReferences
      .where(trip.canRequestFinalizationForReference)
      .map(_shipperReferenceOptionValue)
      .toSet();
}

List<DeliveryShipperReference> _selectedReferencesForValues(
  DeliveryTrip trip,
  List<DeliveryShipperReference> references,
  Set<String> selectedValues,
) {
  return references
      .where(
        (reference) =>
            selectedValues.contains(_shipperReferenceOptionValue(reference)),
      )
      .where(trip.canRequestFinalizationForReference)
      .toList(growable: false);
}

List<_ActualCargoDraft> _cargoDraftsForSelectedReferences(
  List<_ActualCargoDraft> drafts,
  List<DeliveryShipperReference> references,
  List<DeliveryShipperReference> selectedReferences,
) {
  if (references.isEmpty) return drafts;
  if (selectedReferences.isEmpty) return const [];
  if (selectedReferences.length == references.length) return drafts;
  return drafts
      .where(
        (draft) => selectedReferences.any(
          (reference) => _cargoDraftMatchesReference(draft, reference),
        ),
      )
      .toList(growable: false);
}

List<_ActualDropDraft> _dropDraftsForSelectedReferences(
  List<_ActualDropDraft> drafts,
  List<DeliveryShipperReference> references,
  List<DeliveryShipperReference> selectedReferences,
) {
  if (references.isEmpty) return drafts;
  if (selectedReferences.isEmpty) return const [];
  if (selectedReferences.length == references.length) return drafts;
  return drafts
      .where(
        (draft) =>
            _dropDraftHasNoReference(draft) ||
            selectedReferences.any(
              (reference) => _dropDraftMatchesReference(draft, reference),
            ),
      )
      .toList(growable: false);
}

List<_ActualDropDraft> _normalizeDropDraftsForSelectedReferences(
  List<_ActualDropDraft> drafts,
  List<DeliveryShipperReference> selectedReferences,
  List<_ActualCargoDraft> selectedCargoDrafts,
) {
  final totals = _summarizeCargoDrafts(selectedCargoDrafts);
  final retainedDrafts = drafts
      .where(
        (draft) =>
            selectedReferences.isEmpty ||
            _dropDraftHasNoReference(draft) ||
            selectedReferences.any(
              (reference) => _dropDraftMatchesReference(draft, reference),
            ),
      )
      .toList(growable: false);
  var nextDrafts = retainedDrafts.isNotEmpty
      ? retainedDrafts
      : [
          _ActualDropDraft.create(
            qtyKoli: _formatMetric(totals.qtyKoli),
            weightInputValue: _formatMetric(totals.weightKg),
            volumeInputValue: _formatMetric(totals.volumeM3, fractionDigits: 3),
          ),
        ];

  if (selectedReferences.length == 1 &&
      nextDrafts.length == 1 &&
      _dropDraftHasNoReference(nextDrafts.first)) {
    nextDrafts = [
      nextDrafts.first.copyWith(
        qtyKoli: _formatMetric(totals.qtyKoli),
        weightInputValue: _formatMetric(totals.weightKg),
        volumeInputValue: _formatMetric(totals.volumeM3, fractionDigits: 3),
      ),
    ];
  }

  if (selectedReferences.length != 1) {
    return nextDrafts;
  }

  return nextDrafts
      .map(
        (draft) => _applySingleReferenceToBlankDrop(draft, selectedReferences),
      )
      .toList(growable: false);
}

_ActualDropDraft _applySingleReferenceToBlankDrop(
  _ActualDropDraft draft,
  List<DeliveryShipperReference> selectedReferences,
) {
  if (selectedReferences.length != 1 || !_dropDraftHasNoReference(draft)) {
    return draft;
  }
  final reference = selectedReferences.first;
  return draft.copyWith(
    shipperReferenceNumber: reference.referenceNumber,
    shipperReferenceKey: reference.key ?? '',
  );
}

bool _cargoDraftMatchesReference(
  _ActualCargoDraft draft,
  DeliveryShipperReference reference,
) {
  final draftKey = draft.shipperReferenceKey.trim();
  final draftNumber = draft.shipperReferenceNumber.trim().toUpperCase();
  final referenceKey = (reference.key ?? '').trim();
  final referenceNumber = reference.referenceNumber.trim().toUpperCase();
  return (draftKey.isNotEmpty &&
          referenceKey.isNotEmpty &&
          draftKey == referenceKey) ||
      (draftNumber.isNotEmpty &&
          referenceNumber.isNotEmpty &&
          draftNumber == referenceNumber);
}

bool _dropDraftHasNoReference(_ActualDropDraft draft) =>
    draft.shipperReferenceKey.trim().isEmpty &&
    draft.shipperReferenceNumber.trim().isEmpty;

bool _dropDraftMatchesReference(
  _ActualDropDraft draft,
  DeliveryShipperReference reference,
) {
  final draftKey = draft.shipperReferenceKey.trim();
  final draftNumber = draft.shipperReferenceNumber.trim().toUpperCase();
  final referenceKey = (reference.key ?? '').trim();
  final referenceNumber = reference.referenceNumber.trim().toUpperCase();
  return (draftKey.isNotEmpty &&
          referenceKey.isNotEmpty &&
          draftKey == referenceKey) ||
      (draftNumber.isNotEmpty &&
          referenceNumber.isNotEmpty &&
          draftNumber == referenceNumber);
}

List<String> _selectedSuratJalanDocumentIds(
  DeliveryTrip trip,
  List<DeliveryShipperReference> selectedReferences,
  List<_ActualCargoDraft> selectedCargoDrafts,
) {
  if (trip.shipperReferences.isEmpty || selectedReferences.isEmpty) {
    return const [];
  }
  final selectedAllReferences =
      selectedReferences.length == trip.shipperReferences.length;
  final hasUnmappedCargo = selectedCargoDrafts.any(
    (draft) =>
        draft.shipperReferenceKey.trim().isEmpty &&
        draft.shipperReferenceNumber.trim().isEmpty,
  );
  if (selectedAllReferences && hasUnmappedCargo) {
    return const [];
  }

  return selectedReferences
      .map((reference) => _suratJalanDocumentIdForReference(trip, reference))
      .where((value) => value.isNotEmpty)
      .toSet()
      .toList(growable: false);
}

String _suratJalanDocumentIdForReference(
  DeliveryTrip trip,
  DeliveryShipperReference reference,
) {
  final documentId = reference.documentId?.trim();
  if (documentId != null && documentId.isNotEmpty) return documentId;
  final key = (reference.key ?? '').trim();
  final suffix = key.isNotEmpty ? key : reference.referenceNumber.trim();
  if (trip.deliveryOrderId.trim().isEmpty || suffix.isEmpty) return '';
  return '${trip.deliveryOrderId}:$suffix';
}

String _defaultPodReceiverName(
  DeliveryTrip trip,
  List<DeliveryShipperReference> selectedReferences,
) {
  final tripReceiver = (trip.receiverName ?? '').trim();
  if (tripReceiver.isNotEmpty) return tripReceiver;
  for (final reference in selectedReferences) {
    final targetLabel = reference.targetLabel.trim();
    if (targetLabel.isNotEmpty && targetLabel != '-') return targetLabel;
  }
  return '';
}

DateTime _jakartaDateTimeNow() =>
    DateTime.now().toUtc().add(const Duration(hours: 7));

String _currentJakartaDateValue() => _formatDateValue(_jakartaDateTimeNow());

String _formatDateValue(DateTime date) {
  String twoDigits(int value) => value.toString().padLeft(2, '0');
  return '${date.year}-${twoDigits(date.month)}-${twoDigits(date.day)}';
}

DateTime? _parseDateValue(String value) {
  final parts = value.trim().split('-');
  if (parts.length != 3) return null;
  final year = int.tryParse(parts[0]);
  final month = int.tryParse(parts[1]);
  final day = int.tryParse(parts[2]);
  if (year == null || month == null || day == null) return null;
  return DateTime(year, month, day);
}

bool _isValidDateValue(String value) =>
    RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value.trim());

_ActualCargoTotals _summarizeCargoDrafts(List<_ActualCargoDraft> drafts) {
  double qtyKoli = 0;
  double weightKg = 0;
  double volumeM3 = 0;
  for (final draft in drafts) {
    qtyKoli += draft.qtyKoliValue;
    weightKg += _convertWeightToKg(
      draft.weightInputValueNumber,
      draft.weightInputUnit,
    );
    volumeM3 += _convertVolumeToM3(
      draft.volumeInputValueNumber,
      draft.volumeInputUnit,
    );
  }
  return _ActualCargoTotals(
    qtyKoli: qtyKoli,
    weightKg: weightKg,
    volumeM3: volumeM3,
  );
}

_ActualCargoTotals _summarizeDropDrafts(List<_ActualDropDraft> drafts) {
  double qtyKoli = 0;
  double weightKg = 0;
  double volumeM3 = 0;
  for (final draft in drafts) {
    qtyKoli += draft.qtyKoliValue;
    weightKg += _convertWeightToKg(
      draft.weightInputValueNumber,
      draft.weightInputUnit,
    );
    volumeM3 += _convertVolumeToM3(
      draft.volumeInputValueNumber,
      draft.volumeInputUnit,
    );
  }
  return _ActualCargoTotals(
    qtyKoli: qtyKoli,
    weightKg: weightKg,
    volumeM3: volumeM3,
  );
}

List<_ActualCargoDraft> _cargoDraftsForDrop(
  _ActualDropDraft drop,
  List<_ActualCargoDraft> drafts,
) {
  final referenceKey = drop.shipperReferenceKey.trim();
  final referenceNumber = drop.shipperReferenceNumber.trim().toUpperCase();
  if (referenceKey.isEmpty && referenceNumber.isEmpty) return drafts;

  return drafts
      .where(
        (draft) =>
            (referenceKey.isNotEmpty &&
                draft.shipperReferenceKey.trim() == referenceKey) ||
            (referenceNumber.isNotEmpty &&
                draft.shipperReferenceNumber.trim().toUpperCase() ==
                    referenceNumber),
      )
      .toList(growable: false);
}

String _summarizeCargoDescriptions(List<_ActualCargoDraft> drafts) {
  final seen = <String>{};
  final descriptions = <String>[];
  for (final draft in drafts) {
    final description = draft.description.trim();
    if (description.isEmpty || seen.contains(description.toLowerCase())) {
      continue;
    }
    seen.add(description.toLowerCase());
    descriptions.add(description);
  }

  if (descriptions.isEmpty) return 'Belum ada barang';
  if (descriptions.length <= 3) return descriptions.join(', ');
  return '${descriptions.take(3).join(', ')} +${descriptions.length - 3} barang';
}

String _shipperReferenceOptionValue(DeliveryShipperReference reference) {
  final key = (reference.key ?? '').trim();
  if (key.isNotEmpty) return 'key:$key';
  return 'number:${reference.referenceNumber.trim().toUpperCase()}';
}

DeliveryShipperReference? _findShipperReferenceByOptionValue(
  List<DeliveryShipperReference> references,
  String optionValue,
) {
  if (optionValue.trim().isEmpty) return null;
  for (final reference in references) {
    if (_shipperReferenceOptionValue(reference) == optionValue) {
      return reference;
    }
  }
  return null;
}

List<DropdownMenuItem<String>> _buildUniqueShipperReferenceItems(
  List<DeliveryShipperReference> references,
) {
  final seenValues = <String>{};
  final items = <DropdownMenuItem<String>>[];
  for (final reference in references) {
    final value = _shipperReferenceOptionValue(reference);
    if (!seenValues.add(value)) continue;
    items.add(
      DropdownMenuItem(
        value: value,
        child: Text(reference.referenceNumber, overflow: TextOverflow.ellipsis),
      ),
    );
  }
  return items;
}

String _resolveDropReferenceOptionValue(
  _ActualDropDraft drop,
  List<DeliveryShipperReference> references,
) {
  final dropReferenceKey = drop.shipperReferenceKey.trim();
  final dropReferenceNumber = drop.shipperReferenceNumber.trim().toUpperCase();
  for (final reference in references) {
    final referenceKey = (reference.key ?? '').trim();
    final referenceNumber = reference.referenceNumber.trim().toUpperCase();
    if ((dropReferenceKey.isNotEmpty && referenceKey == dropReferenceKey) ||
        (dropReferenceNumber.isNotEmpty &&
            referenceNumber == dropReferenceNumber)) {
      return _shipperReferenceOptionValue(reference);
    }
  }
  return '';
}

String _resolveRecipientOptionValue(
  _ActualDropDraft drop,
  List<CustomerRecipientOption> recipients,
) {
  final locationName = drop.locationName.trim().toLowerCase();
  final locationAddress = drop.locationAddress.trim().toLowerCase();
  if (locationName.isEmpty && locationAddress.isEmpty) return '';

  for (final recipient in recipients) {
    final recipientName = recipient.locationName.trim().toLowerCase();
    final recipientAddress = recipient.receiverAddress.trim().toLowerCase();
    if ((locationAddress.isNotEmpty && locationAddress == recipientAddress) ||
        (locationName.isNotEmpty && locationName == recipientName)) {
      return recipient.id;
    }
  }
  return '';
}

double _parseDouble(String raw) =>
    double.tryParse(raw.replaceAll(',', '.')) ?? 0;

double _convertWeightToKg(double value, String unit) {
  if (value <= 0) return 0;
  return unit.toUpperCase() == 'TON' ? value * 1000 : value;
}

double _convertVolumeToM3(double value, String unit) {
  if (value <= 0) return 0;
  switch (unit.toUpperCase()) {
    case 'LITER':
      return value / 1000;
    case 'KL':
      return value;
    default:
      return value;
  }
}

String _normalizeWeightUnit(String value) {
  final normalized = value.trim().toUpperCase();
  return normalized == 'TON' ? 'TON' : 'KG';
}

String _normalizeVolumeUnit(String value) {
  final normalized = value.trim().toUpperCase();
  return switch (normalized) {
    'LITER' => 'LITER',
    'KL' => 'KL',
    _ => 'M3',
  };
}

String _normalizeDropStopType(String value) {
  final normalized = value.trim().toUpperCase();
  return switch (normalized) {
    'HOLD' => 'HOLD',
    'EXTRA_DROP' => 'EXTRA_DROP',
    _ => 'DROP',
  };
}

String _formatMetric(double? value, {int fractionDigits = 2}) {
  if (value == null || value <= 0) return '';
  final rounded = value.toStringAsFixed(fractionDigits);
  return rounded.contains('.')
      ? rounded.replaceFirst(RegExp(r'\.?0+$'), '')
      : rounded;
}

class _PodCard extends StatelessWidget {
  const _PodCard({
    required this.receiverController,
    required this.dateController,
    required this.onPickDate,
  });

  final TextEditingController receiverController;
  final TextEditingController dateController;
  final VoidCallback? onPickDate;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'POD',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: receiverController,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(labelText: 'Nama Penerima POD'),
              scrollPadding: _mobileInputScrollPadding,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: dateController,
              keyboardType: TextInputType.datetime,
              decoration: InputDecoration(
                labelText: 'Tanggal Terima POD',
                suffixIcon: IconButton(
                  onPressed: onPickDate,
                  icon: const Icon(Icons.calendar_today_rounded),
                  tooltip: 'Pilih tanggal',
                ),
              ),
              scrollPadding: _mobileInputScrollPadding,
            ),
          ],
        ),
      ),
    );
  }
}

class _BatchSuratJalanCard extends StatelessWidget {
  const _BatchSuratJalanCard({
    required this.references,
    required this.selectedValues,
    required this.canRequestFinalization,
    required this.onChanged,
  });

  final List<DeliveryShipperReference> references;
  final Set<String> selectedValues;
  final bool Function(DeliveryShipperReference reference)
  canRequestFinalization;
  final void Function(String optionValue, bool selected)? onChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 8, 16, 4),
              child: Text(
                'SJ Finalisasi',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
              ),
            ),
            for (final reference in references)
              CheckboxListTile(
                value: selectedValues.contains(
                  _shipperReferenceOptionValue(reference),
                ),
                onChanged:
                    canRequestFinalization(reference) && onChanged != null
                    ? (value) => onChanged!(
                        _shipperReferenceOptionValue(reference),
                        value ?? false,
                      )
                    : null,
                title: Text(reference.referenceNumber),
                subtitle: Text(
                  _shipperReferenceSubtitle(
                    reference,
                    pending:
                        !canRequestFinalization(reference) &&
                        reference.canRequestFinalization,
                  ),
                ),
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: const EdgeInsets.symmetric(horizontal: 12),
              ),
          ],
        ),
      ),
    );
  }
}

String _shipperReferenceSubtitle(
  DeliveryShipperReference reference, {
  bool pending = false,
}) {
  final parts = [
    reference.targetLabel,
    if ((reference.tripStatus ?? '').trim().isNotEmpty)
      reference.tripStatus!.trim(),
    if (pending) 'Menunggu approval admin',
  ].where((value) => value.trim().isNotEmpty && value.trim() != '-');
  return parts.isEmpty ? 'Belum ada tujuan' : parts.join(' | ');
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.title, required this.message});

  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(
                color: scheme.onSurface,
                fontWeight: FontWeight.w700,
                fontSize: 15,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.65),
                height: 1.45,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TotalsCard extends StatelessWidget {
  const _TotalsCard({
    required this.title,
    required this.qtyLabel,
    required this.weightLabel,
    required this.volumeLabel,
  });

  final String title;
  final String qtyLabel;
  final String weightLabel;
  final String volumeLabel;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final metrics = [
              _MetricItem(
                label: title,
                value: qtyLabel.isEmpty ? '-' : qtyLabel,
              ),
              _MetricItem(
                label: 'Berat',
                value: weightLabel.isEmpty ? '-' : weightLabel,
              ),
              _MetricItem(
                label: 'Volume',
                value: volumeLabel.isEmpty ? '-' : volumeLabel,
              ),
            ];

            if (constraints.maxWidth < 360) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final entry in metrics.indexed) ...[
                    if (entry.$1 > 0) const SizedBox(height: 12),
                    entry.$2,
                  ],
                ],
              );
            }

            return Row(
              children: [for (final metric in metrics) Expanded(child: metric)],
            );
          },
        ),
      ),
    );
  }
}

class _MetricItem extends StatelessWidget {
  const _MetricItem({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            color: scheme.onSurface.withValues(alpha: 0.55),
            fontSize: 12,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          value,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
        ),
      ],
    );
  }
}

class _ActualCargoCard extends StatelessWidget {
  const _ActualCargoCard({
    super.key,
    required this.draft,
    required this.onChanged,
  });

  final _ActualCargoDraft draft;
  final void Function(
    String cargoId, {
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  })
  onChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              draft.description,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
            ),
            const SizedBox(height: 12),
            _SyncedTextFormField(
              value: draft.qtyKoli,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: InputDecoration(
                labelText: draft.requireQty ? 'Qty Aktual *' : 'Qty Aktual',
              ),
              onChanged: (value) => onChanged(draft.itemId, qtyKoli: value),
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                Widget weightField() {
                  return _SyncedTextFormField(
                    value: draft.weightInputValue,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: InputDecoration(
                      labelText: draft.requireWeight
                          ? 'Berat Aktual *'
                          : 'Berat Aktual',
                    ),
                    onChanged: (value) =>
                        onChanged(draft.itemId, weightInputValue: value),
                  );
                }

                Widget weightUnitField() {
                  final selectedUnit = _normalizeWeightUnit(
                    draft.weightInputUnit,
                  );
                  return MobileUnitSelectorField(
                    value: selectedUnit,
                    options: const ['KG', 'TON'],
                    onChanged: (value) =>
                        onChanged(draft.itemId, weightInputUnit: value),
                  );
                }

                if (constraints.maxWidth < 340) {
                  return Column(
                    children: [
                      weightField(),
                      const SizedBox(height: 12),
                      weightUnitField(),
                    ],
                  );
                }

                return Row(
                  children: [
                    Expanded(child: weightField()),
                    const SizedBox(width: 12),
                    SizedBox(width: 110, child: weightUnitField()),
                  ],
                );
              },
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                Widget volumeField() {
                  return _SyncedTextFormField(
                    value: draft.volumeInputValue,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: InputDecoration(
                      labelText: draft.requireVolume
                          ? 'Volume Aktual *'
                          : 'Volume Aktual',
                    ),
                    onChanged: (value) =>
                        onChanged(draft.itemId, volumeInputValue: value),
                  );
                }

                Widget volumeUnitField() {
                  final selectedUnit = _normalizeVolumeUnit(
                    draft.volumeInputUnit,
                  );
                  return MobileUnitSelectorField(
                    value: selectedUnit,
                    options: const ['M3', 'LITER', 'KL'],
                    onChanged: (value) =>
                        onChanged(draft.itemId, volumeInputUnit: value),
                  );
                }

                if (constraints.maxWidth < 340) {
                  return Column(
                    children: [
                      volumeField(),
                      const SizedBox(height: 12),
                      volumeUnitField(),
                    ],
                  );
                }

                return Row(
                  children: [
                    Expanded(child: volumeField()),
                    const SizedBox(width: 12),
                    SizedBox(width: 110, child: volumeUnitField()),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _ActualDropCard extends StatelessWidget {
  const _ActualDropCard({
    super.key,
    required this.index,
    required this.draft,
    required this.shipperReferences,
    required this.customerRecipients,
    required this.cargoDrafts,
    required this.showRemove,
    required this.onChanged,
    required this.onReferenceChanged,
    required this.onRecipientChanged,
    required this.onRemove,
  });

  final int index;
  final _ActualDropDraft draft;
  final List<DeliveryShipperReference> shipperReferences;
  final List<CustomerRecipientOption> customerRecipients;
  final List<_ActualCargoDraft> cargoDrafts;
  final bool showRemove;
  final void Function(
    String draftId, {
    String? stopType,
    String? locationName,
    String? locationAddress,
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
    String? note,
  })
  onChanged;
  final void Function(String draftId, String optionValue) onReferenceChanged;
  final void Function(String draftId, String recipientId) onRecipientChanged;
  final void Function(String draftId) onRemove;

  @override
  Widget build(BuildContext context) {
    final selectedReferenceValue = _resolveDropReferenceOptionValue(
      draft,
      shipperReferences,
    );
    final referenceItems = _buildUniqueShipperReferenceItems(shipperReferences);
    final resolvedReferenceValue =
        referenceItems.any((item) => item.value == selectedReferenceValue)
        ? selectedReferenceValue
        : '';
    final selectedRecipientValue = _resolveRecipientOptionValue(
      draft,
      customerRecipients,
    );
    final cargoSummary = _summarizeCargoDescriptions(
      _cargoDraftsForDrop(draft, cargoDrafts),
    );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Titik Drop $index',
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                    ),
                  ),
                ),
                if (showRemove)
                  IconButton(
                    onPressed: () => onRemove(draft.id),
                    icon: const Icon(Icons.delete_outline_rounded),
                    tooltip: 'Hapus titik',
                  ),
              ],
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _normalizeDropStopType(draft.stopType),
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Tipe'),
              items: const [
                DropdownMenuItem(value: 'DROP', child: Text('Drop')),
                DropdownMenuItem(value: 'HOLD', child: Text('Hold Gudang')),
                DropdownMenuItem(
                  value: 'EXTRA_DROP',
                  child: Text('Drop Tambahan'),
                ),
              ],
              onChanged: (value) =>
                  onChanged(draft.id, stopType: value ?? 'DROP'),
            ),
            const SizedBox(height: 12),
            if (shipperReferences.isNotEmpty) ...[
              DropdownButtonFormField<String>(
                key: ValueKey('drop-ref-${draft.id}-$resolvedReferenceValue'),
                initialValue: resolvedReferenceValue,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'No. SJ / Barang'),
                items: [
                  const DropdownMenuItem(
                    value: '',
                    child: Text('Semua / manual'),
                  ),
                  ...referenceItems,
                ],
                onChanged: (value) => onReferenceChanged(draft.id, value ?? ''),
              ),
              const SizedBox(height: 8),
              Text(
                'Barang: $cargoSummary',
                style: TextStyle(
                  color: Theme.of(
                    context,
                  ).colorScheme.onSurface.withValues(alpha: 0.65),
                  fontSize: 12,
                  height: 1.35,
                ),
              ),
              const SizedBox(height: 12),
            ] else ...[
              Text(
                'Barang: $cargoSummary',
                style: TextStyle(
                  color: Theme.of(
                    context,
                  ).colorScheme.onSurface.withValues(alpha: 0.65),
                  fontSize: 12,
                  height: 1.35,
                ),
              ),
              const SizedBox(height: 12),
            ],
            if (customerRecipients.isNotEmpty) ...[
              DropdownButtonFormField<String>(
                key: ValueKey(
                  'drop-recipient-${draft.id}-$selectedRecipientValue',
                ),
                initialValue: selectedRecipientValue,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Master Tujuan Customer',
                ),
                items: [
                  const DropdownMenuItem(value: '', child: Text('Isi manual')),
                  ...customerRecipients.map(
                    (recipient) => DropdownMenuItem(
                      value: recipient.id,
                      child: Text(
                        recipient.displayLabel,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                ],
                onChanged: (value) => onRecipientChanged(draft.id, value ?? ''),
              ),
              const SizedBox(height: 12),
            ],
            _SyncedTextFormField(
              value: draft.locationName,
              decoration: const InputDecoration(labelText: 'Nama Lokasi'),
              onChanged: (value) => onChanged(draft.id, locationName: value),
            ),
            const SizedBox(height: 12),
            _SyncedTextFormField(
              value: draft.locationAddress,
              minLines: 2,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Alamat Lokasi'),
              onChanged: (value) => onChanged(draft.id, locationAddress: value),
            ),
            const SizedBox(height: 12),
            _SyncedTextFormField(
              value: draft.qtyKoli,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(labelText: 'Qty Drop'),
              onChanged: (value) => onChanged(draft.id, qtyKoli: value),
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                Widget weightField() {
                  return _SyncedTextFormField(
                    value: draft.weightInputValue,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(labelText: 'Berat Drop'),
                    onChanged: (value) =>
                        onChanged(draft.id, weightInputValue: value),
                  );
                }

                Widget weightUnitField() {
                  final selectedUnit = _normalizeWeightUnit(
                    draft.weightInputUnit,
                  );
                  return MobileUnitSelectorField(
                    value: selectedUnit,
                    options: const ['KG', 'TON'],
                    onChanged: (value) =>
                        onChanged(draft.id, weightInputUnit: value),
                  );
                }

                if (constraints.maxWidth < 340) {
                  return Column(
                    children: [
                      weightField(),
                      const SizedBox(height: 12),
                      weightUnitField(),
                    ],
                  );
                }

                return Row(
                  children: [
                    Expanded(child: weightField()),
                    const SizedBox(width: 12),
                    SizedBox(width: 110, child: weightUnitField()),
                  ],
                );
              },
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                Widget volumeField() {
                  return _SyncedTextFormField(
                    value: draft.volumeInputValue,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(labelText: 'Volume Drop'),
                    onChanged: (value) =>
                        onChanged(draft.id, volumeInputValue: value),
                  );
                }

                Widget volumeUnitField() {
                  final selectedUnit = _normalizeVolumeUnit(
                    draft.volumeInputUnit,
                  );
                  return MobileUnitSelectorField(
                    value: selectedUnit,
                    options: const ['M3', 'LITER', 'KL'],
                    onChanged: (value) =>
                        onChanged(draft.id, volumeInputUnit: value),
                  );
                }

                if (constraints.maxWidth < 340) {
                  return Column(
                    children: [
                      volumeField(),
                      const SizedBox(height: 12),
                      volumeUnitField(),
                    ],
                  );
                }

                return Row(
                  children: [
                    Expanded(child: volumeField()),
                    const SizedBox(width: 12),
                    SizedBox(width: 110, child: volumeUnitField()),
                  ],
                );
              },
            ),
            const SizedBox(height: 12),
            _SyncedTextFormField(
              value: draft.note,
              minLines: 2,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Catatan Titik'),
              onChanged: (value) => onChanged(draft.id, note: value),
            ),
          ],
        ),
      ),
    );
  }
}

class _SyncedTextFormField extends StatefulWidget {
  const _SyncedTextFormField({
    required this.value,
    required this.decoration,
    required this.onChanged,
    this.keyboardType,
    this.minLines,
    this.maxLines = 1,
  });

  final String value;
  final InputDecoration decoration;
  final ValueChanged<String> onChanged;
  final TextInputType? keyboardType;
  final int? minLines;
  final int? maxLines;

  @override
  State<_SyncedTextFormField> createState() => _SyncedTextFormFieldState();
}

class _SyncedTextFormFieldState extends State<_SyncedTextFormField> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.value);
  }

  @override
  void didUpdateWidget(covariant _SyncedTextFormField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.value == _controller.text) return;

    _controller.value = TextEditingValue(
      text: widget.value,
      selection: TextSelection.collapsed(offset: widget.value.length),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: _controller,
      keyboardType: widget.keyboardType,
      minLines: widget.minLines,
      maxLines: widget.maxLines,
      decoration: widget.decoration,
      scrollPadding: _mobileInputScrollPadding,
      onChanged: widget.onChanged,
    );
  }
}
