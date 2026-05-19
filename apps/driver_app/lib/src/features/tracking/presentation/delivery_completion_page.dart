import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../data/delivery_order_service.dart';
import '../domain/models.dart';
import 'mobile_action_feedback.dart';
import 'mobile_input_visibility.dart';
import 'mobile_numeric_input_formatter.dart';
import 'mobile_unit_selector_field.dart';

const _mobileInputScrollPadding = EdgeInsets.fromLTRB(20, 20, 20, 120);

enum _CompletionStep { setup, drop, cargo, review }

const _completionSteps = [
  _CompletionStep.setup,
  _CompletionStep.drop,
  _CompletionStep.cargo,
  _CompletionStep.review,
];

extension _CompletionStepLabels on _CompletionStep {
  String get label => switch (this) {
    _CompletionStep.setup => 'SJ & POD',
    _CompletionStep.drop => 'Titik Drop',
    _CompletionStep.cargo => 'Aktual Barang',
    _CompletionStep.review => 'Kirim',
  };

  String get helper => switch (this) {
    _CompletionStep.setup => 'Pilih SJ dan POD',
    _CompletionStep.drop => 'Realisasi drop',
    _CompletionStep.cargo => 'Aktual barang',
    _CompletionStep.review => 'Review akhir',
  };
}

class DeliveryCompletionPage extends StatefulWidget {
  const DeliveryCompletionPage({
    super.key,
    required this.trip,
    required this.customerRecipients,
    this.initialSelectedSuratJalanRefs = const [],
  });

  final DeliveryTrip trip;
  final List<CustomerRecipientOption> customerRecipients;
  final List<String> initialSelectedSuratJalanRefs;

  @override
  State<DeliveryCompletionPage> createState() => _DeliveryCompletionPageState();
}

class _DeliveryCompletionPageState extends State<DeliveryCompletionPage>
    with WidgetsBindingObserver {
  final _inputVisibilityKey = GlobalKey();
  final _dropVisibilityKeys = <String, GlobalKey>{};
  final _noteController = TextEditingController();
  late final TextEditingController _podReceiverNameController;
  late final TextEditingController _podReceivedDateController;
  bool _submitting = false;
  bool _inputVisibilityScheduled = false;
  _CompletionStep _currentStep = _CompletionStep.setup;
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
      widget.initialSelectedSuratJalanRefs,
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
    _dropVisibilityKeys.clear();
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
          .map((draft) {
            if (draft.itemId != cargoId) return draft;
            final nextWeightUnit = weightInputUnit == null
                ? draft.weightInputUnit
                : _normalizeWeightUnit(weightInputUnit);
            final nextVolumeUnit = volumeInputUnit == null
                ? draft.volumeInputUnit
                : _normalizeVolumeUnit(volumeInputUnit);
            final convertedWeightValue =
                weightInputUnit != null && weightInputValue == null
                ? _formatMetric(
                    _convertKgToWeightInputValue(
                      _convertWeightToKg(
                        draft.weightInputValueNumber,
                        draft.weightInputUnit,
                      ),
                      nextWeightUnit,
                    ),
                    fractionDigits: mobileWeightInputFractionDigits(
                      nextWeightUnit,
                    ),
                  )
                : weightInputValue;
            final convertedVolumeValue =
                volumeInputUnit != null && volumeInputValue == null
                ? _formatMetric(
                    _convertM3ToVolumeInputValue(
                      _convertVolumeToM3(
                        draft.volumeInputValueNumber,
                        draft.volumeInputUnit,
                      ),
                      nextVolumeUnit,
                    ),
                    fractionDigits: mobileVolumeInputFractionDigits(
                      nextVolumeUnit,
                    ),
                  )
                : volumeInputValue;

            return draft.copyWith(
              qtyKoli: qtyKoli,
              weightInputValue: convertedWeightValue,
              weightInputUnit: weightInputUnit,
              volumeInputValue: convertedVolumeValue,
              volumeInputUnit: volumeInputUnit,
            );
          })
          .toList(growable: false);
    });
  }

  void _updateDrop(
    String draftId, {
    String? stopType,
    String? deliveryOrderItemRef,
    List<String>? deliveryOrderItemRefs,
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
          .map((draft) {
            if (draft.id != draftId) return draft;
            final selectedItem =
                _findCargoDraftByItemRef(
                  _cargoDrafts,
                  deliveryOrderItemRef ?? draft.deliveryOrderItemRef,
                ) ??
                _resolvedSingleCargoDraftForDrop(draft, _cargoDrafts);
            final nextQty = qtyKoli ?? draft.qtyKoli;
            final nextWeightUnit = weightInputUnit ?? draft.weightInputUnit;
            final nextVolumeUnit = volumeInputUnit ?? draft.volumeInputUnit;
            final nextWeightInputValue =
                qtyKoli != null && weightInputValue == null
                ? _autoWeightInputValueForQty(
                    draft: draft,
                    cargo: selectedItem,
                    nextQtyKoli: nextQty,
                    nextWeightUnit: nextWeightUnit,
                  )
                : weightInputUnit != null && weightInputValue == null
                ? _formatMetric(
                    _convertKgToWeightInputValue(
                      _convertWeightToKg(
                        draft.weightInputValueNumber,
                        draft.weightInputUnit,
                      ),
                      nextWeightUnit,
                    ),
                    fractionDigits: mobileWeightInputFractionDigits(
                      nextWeightUnit,
                    ),
                  )
                : weightInputValue;
            final nextVolumeInputValue =
                volumeInputUnit != null && volumeInputValue == null
                ? _formatMetric(
                    _convertM3ToVolumeInputValue(
                      _convertVolumeToM3(
                        draft.volumeInputValueNumber,
                        draft.volumeInputUnit,
                      ),
                      nextVolumeUnit,
                    ),
                    fractionDigits: mobileVolumeInputFractionDigits(
                      nextVolumeUnit,
                    ),
                  )
                : volumeInputValue;

            return draft.copyWith(
              stopType: stopType,
              deliveryOrderItemRef: deliveryOrderItemRef,
              deliveryOrderItemRefs: deliveryOrderItemRefs,
              locationName: locationName,
              locationAddress: locationAddress,
              qtyKoli: qtyKoli,
              weightInputValue: nextWeightInputValue,
              weightInputUnit: weightInputUnit,
              volumeInputValue: nextVolumeInputValue,
              volumeInputUnit: volumeInputUnit,
              shipperReferenceNumber: shipperReferenceNumber,
              shipperReferenceKey: shipperReferenceKey,
              note: note,
            );
          })
          .toList(growable: false);
    });
  }

  void _addDropPoint() {
    FocusManager.instance.primaryFocus?.unfocus();
    final draft = _createNextDropDraftForSelectedCargo(
      _selectedCargoDrafts,
      _selectedDropDrafts,
      _selectedShipperReferences,
    );
    setState(() {
      _dropDrafts = [..._dropDrafts, draft];
    });
    _scheduleDraftVisibility(_dropVisibilityKey(draft.id));
  }

  Future<void> _removeDropPoint(String draftId) async {
    final confirmed = await showMobileActionConfirmation(
      context,
      title: 'Hapus titik drop?',
      message:
          'Qty, berat, volume, dan catatan di titik ini akan hilang dari draft finalisasi. Data belum dikirim sebelum kamu menekan Ajukan Selesai.',
      confirmLabel: 'Hapus Titik',
      icon: Icons.delete_outline_rounded,
      destructive: true,
    );
    if (!mounted || !confirmed) return;

    setState(() {
      final next = _dropDrafts.where((draft) => draft.id != draftId).toList();
      _dropDrafts = next.isNotEmpty ? next : [_ActualDropDraft.create()];
    });
  }

  void _selectDropCargoTarget(String draftId, String optionValue) {
    final cargo = _findCargoDraftByOptionValue(
      _selectedCargoDrafts,
      optionValue,
    );
    final reference = cargo != null
        ? null
        : _findShipperReferenceByOptionValue(
            widget.trip.shipperReferences,
            optionValue,
          );

    setState(() {
      _dropDrafts = _dropDrafts
          .map((draft) {
            if (draft.id != draftId) return draft;
            if (cargo != null) {
              final currentItemRefs = _normalizedDropItemRefs(draft);
              return _applyCargoDraftToDrop(
                draft,
                cargo,
                _dropDrafts,
                forceValues:
                    currentItemRefs.isEmpty ||
                    !currentItemRefs.contains(cargo.itemId),
              );
            }
            if (reference == null) {
              return draft.copyWith(
                deliveryOrderItemRef: '',
                deliveryOrderItemRefs: const [],
                shipperReferenceNumber: '',
                shipperReferenceKey: '',
              );
            }

            return draft.copyWith(
              deliveryOrderItemRef: '',
              deliveryOrderItemRefs: const [],
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
    final actualItems = _buildSubmissionActualItems(
      _selectedCargoDrafts,
      submissionDropDrafts,
    );

    final actualDropPoints = submissionDropDrafts
        .map((draft) {
          final itemRefs = _dropItemRefsForSubmission(
            draft,
            _selectedCargoDrafts,
          );
          return DriverActualDropPointInput(
            stopType: _normalizeDropStopType(draft.stopType),
            deliveryOrderItemRef: itemRefs.length == 1 ? itemRefs.first : null,
            deliveryOrderItemRefs: itemRefs,
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
          );
        })
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

    final itemSpecificDropRefs = selectedDropDrafts
        .map((drop) => _dropItemRefsForSubmission(drop, selectedCargoDrafts))
        .where((refs) => refs.length == 1)
        .expand((refs) => refs)
        .toSet();
    for (final draft in selectedCargoDrafts) {
      final derivedFromItemDrop = itemSpecificDropRefs.contains(draft.itemId);
      final qty = draft.qtyKoliValue;
      final weight = draft.weightInputValueNumber;
      final volume = draft.volumeInputValueNumber;
      final hasActualValue = qty > 0 || weight > 0 || volume > 0;
      if (!hasActualValue && !derivedFromItemDrop) {
        return 'Semua barang harus punya realisasi aktual.';
      }
      if (!derivedFromItemDrop && draft.requireQty && qty <= 0) {
        return 'Qty aktual wajib diisi untuk barang yang punya target koli.';
      }
      if (!derivedFromItemDrop && draft.requireWeight && weight <= 0) {
        return 'Berat aktual wajib diisi untuk barang yang punya target berat.';
      }
      if (!derivedFromItemDrop && draft.requireVolume && volume <= 0) {
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

    final ambiguityMessage = _getAmbiguousActualDropMappingMessage(
      selectedDropDrafts,
      selectedCargoDrafts,
    );
    if (ambiguityMessage != null) {
      return ambiguityMessage;
    }

    final normalizedDropDrafts = selectedDropDrafts
        .map(
          (draft) =>
              _applySingleReferenceToBlankDrop(draft, selectedReferences),
        )
        .toList(growable: false);
    final actualItems = _buildSubmissionActualItems(
      selectedCargoDrafts,
      normalizedDropDrafts,
    );
    final cargoTotals = _summarizeActualItemInputs(actualItems);
    final dropTotals = _summarizeBillableDropDrafts(normalizedDropDrafts);
    if (cargoTotals.qtyKoli > 0 &&
        (dropTotals.qtyKoli - cargoTotals.qtyKoli).abs() > 0.01) {
      return 'Total qty titik drop terkirim harus sama dengan qty aktual muatan.';
    }
    if (cargoTotals.weightKg > 0 &&
        (dropTotals.weightKg - cargoTotals.weightKg).abs() > 0.01) {
      return 'Total berat titik drop terkirim harus sama dengan berat aktual muatan.';
    }
    if (cargoTotals.volumeM3 > 0 &&
        (dropTotals.volumeM3 - cargoTotals.volumeM3).abs() > 0.001) {
      return 'Total volume titik drop terkirim harus sama dengan volume aktual muatan.';
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

  GlobalKey _dropVisibilityKey(String draftId) =>
      _dropVisibilityKeys.putIfAbsent(draftId, () => GlobalKey());

  void _setCurrentStep(_CompletionStep step) {
    if (_currentStep == step) return;
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() => _currentStep = step);
  }

  void _goToPreviousStep() {
    final index = _completionSteps.indexOf(_currentStep);
    if (index <= 0) return;
    _setCurrentStep(_completionSteps[index - 1]);
  }

  void _goToNextStep() {
    final index = _completionSteps.indexOf(_currentStep);
    if (index < 0 || index >= _completionSteps.length - 1) return;
    _setCurrentStep(_completionSteps[index + 1]);
  }

  void _scheduleDraftVisibility(GlobalKey key) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final draftContext = key.currentContext;
      if (draftContext == null || !draftContext.mounted) return;

      Scrollable.ensureVisible(
        draftContext,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        alignment: 0.08,
        alignmentPolicy: ScrollPositionAlignmentPolicy.explicit,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final selectedReferences = _selectedShipperReferences;
    final selectedCargoDrafts = _selectedCargoDrafts;
    final selectedDropDrafts = _selectedDropDrafts;
    final cargoSections = _groupCargoDraftsBySelectedReferences(
      selectedCargoDrafts,
      selectedReferences,
    );
    final cargoTotals = _summarizeCargoDrafts(selectedCargoDrafts);
    final dropTotals = _summarizeBillableDropDrafts(selectedDropDrafts);
    final hasMultiTargetDefault = widget.trip.shipperReferences.length > 1;
    final usesDetailedDrop =
        selectedDropDrafts.length > 1 ||
        selectedDropDrafts.any(
          (draft) => _normalizeDropStopType(draft.stopType) != 'DROP',
        );
    final currentStepIndex = _completionSteps.indexOf(_currentStep);
    final canGoBack = currentStepIndex > 0 && !_submitting;
    final canGoNext =
        currentStepIndex >= 0 &&
        currentStepIndex < _completionSteps.length - 1 &&
        !_submitting;

    return Scaffold(
      resizeToAvoidBottomInset: true,
      appBar: AppBar(title: const Text('Ajukan Selesai')),
      body: SafeArea(
        child: KeyedSubtree(
          key: _inputVisibilityKey,
          child: Column(
            children: [
              _CompletionStepHeader(
                currentStep: _currentStep,
                onStepSelected: _submitting ? null : _setCurrentStep,
              ),
              Expanded(
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 180),
                  child: _CompletionStepBody(
                    key: ValueKey(_currentStep),
                    step: _currentStep,
                    children: switch (_currentStep) {
                      _CompletionStep.setup => [
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
                      ],
                      _CompletionStep.drop => [
                        _DropWorkflowCard(
                          cargoCount: selectedCargoDrafts.length,
                          dropCount: selectedDropDrafts.length,
                          usesDetailedDrop: usesDetailedDrop,
                        ),
                        const SizedBox(height: 12),
                        _TotalsCard(
                          title: 'Qty Drop Terkirim',
                          qtyLabel: _formatMetric(dropTotals.qtyKoli),
                          weightLabel:
                              '${_formatMetric(dropTotals.weightKg)} kg',
                          volumeLabel:
                              '${_formatMetric(dropTotals.volumeM3, fractionDigits: 3)} m3',
                        ),
                        const SizedBox(height: 12),
                        ...selectedDropDrafts.asMap().entries.map(
                          (entry) => Padding(
                            key: _dropVisibilityKey(entry.value.id),
                            padding: const EdgeInsets.only(bottom: 12),
                            child: _ActualDropCard(
                              key: ValueKey(entry.value.id),
                              index: entry.key + 1,
                              draft: entry.value,
                              shipperReferences: selectedReferences,
                              customerRecipients: widget.customerRecipients,
                              cargoDrafts: selectedCargoDrafts,
                              showRemove: selectedDropDrafts.length > 1,
                              onChanged: _updateDrop,
                              onCargoTargetChanged: _selectDropCargoTarget,
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
                      ],
                      _CompletionStep.cargo => [
                        _InfoCard(
                          title: 'Aktual Barang SJ',
                          message:
                              'Langkah 2 dari 2. Isi realisasi per barang seperti tab aktual barang di admin operasional.',
                        ),
                        const SizedBox(height: 12),
                        _TotalsCard(
                          title: 'Qty',
                          qtyLabel: _formatMetric(cargoTotals.qtyKoli),
                          weightLabel:
                              '${_formatMetric(cargoTotals.weightKg)} kg',
                          volumeLabel:
                              '${_formatMetric(cargoTotals.volumeM3, fractionDigits: 3)} m3',
                        ),
                        const SizedBox(height: 12),
                        ...cargoSections.map(
                          (section) => _ActualCargoSection(
                            key: ValueKey('cargo-section-${section.key}'),
                            section: section,
                            showHeader: hasMultiTargetDefault,
                            onChanged: _updateCargo,
                          ),
                        ),
                      ],
                      _CompletionStep.review => [
                        _InfoCard(
                          title: 'Review & Kirim',
                          message:
                              'Cek ringkasan aktual barang dan titik drop sebelum diajukan ke admin.',
                        ),
                        const SizedBox(height: 12),
                        _TotalsCard(
                          title: 'Qty',
                          qtyLabel: _formatMetric(cargoTotals.qtyKoli),
                          weightLabel:
                              '${_formatMetric(cargoTotals.weightKg)} kg',
                          volumeLabel:
                              '${_formatMetric(cargoTotals.volumeM3, fractionDigits: 3)} m3',
                        ),
                        const SizedBox(height: 12),
                        _TotalsCard(
                          title: 'Qty Drop Terkirim',
                          qtyLabel: _formatMetric(dropTotals.qtyKoli),
                          weightLabel:
                              '${_formatMetric(dropTotals.weightKg)} kg',
                          volumeLabel:
                              '${_formatMetric(dropTotals.volumeM3, fractionDigits: 3)} m3',
                        ),
                        const SizedBox(height: 12),
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
                    },
                  ),
                ),
              ),
              _CompletionFooter(
                currentStep: _currentStep,
                busy: _submitting,
                canGoBack: canGoBack,
                canGoNext: canGoNext,
                onBack: _goToPreviousStep,
                onNext: _goToNextStep,
                onSubmit: _submit,
                scheme: scheme,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CompletionStepHeader extends StatelessWidget {
  const _CompletionStepHeader({
    required this.currentStep,
    required this.onStepSelected,
  });

  final _CompletionStep currentStep;
  final ValueChanged<_CompletionStep>? onStepSelected;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final currentIndex = _completionSteps.indexOf(currentStep);

    return Material(
      color: scheme.surface,
      elevation: 1,
      shadowColor: scheme.shadow.withValues(alpha: 0.08),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compact = constraints.maxWidth < 380;
            final chips = <Widget>[
              for (final entry in _completionSteps.indexed)
                _CompletionStepChip(
                  step: entry.$2,
                  index: entry.$1 + 1,
                  selected: entry.$2 == currentStep,
                  complete: entry.$1 < currentIndex,
                  enabled: onStepSelected != null,
                  onSelected: () => onStepSelected?.call(entry.$2),
                ),
            ];

            if (compact) {
              return SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final entry in chips.indexed) ...[
                      if (entry.$1 > 0) const SizedBox(width: 8),
                      ConstrainedBox(
                        constraints: const BoxConstraints(minWidth: 126),
                        child: entry.$2,
                      ),
                    ],
                  ],
                ),
              );
            }

            return Row(
              children: [
                for (final entry in chips.indexed) ...[
                  if (entry.$1 > 0) const SizedBox(width: 8),
                  Expanded(child: entry.$2),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _CompletionStepChip extends StatelessWidget {
  const _CompletionStepChip({
    required this.step,
    required this.index,
    required this.selected,
    required this.complete,
    required this.enabled,
    required this.onSelected,
  });

  final _CompletionStep step;
  final int index;
  final bool selected;
  final bool complete;
  final bool enabled;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final background = selected
        ? scheme.primaryContainer
        : complete
        ? scheme.secondaryContainer.withValues(alpha: 0.68)
        : scheme.surfaceContainerHighest.withValues(alpha: 0.45);
    final foreground = selected
        ? scheme.onPrimaryContainer
        : scheme.onSurface.withValues(alpha: 0.76);

    return InkWell(
      key: ValueKey('completion-step-chip-${step.name}'),
      onTap: enabled ? onSelected : null,
      borderRadius: BorderRadius.circular(12),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected
                ? scheme.primary.withValues(alpha: 0.42)
                : scheme.outline.withValues(alpha: 0.18),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 24,
              height: 24,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: selected
                    ? scheme.primary
                    : complete
                    ? scheme.secondary
                    : scheme.surface,
                shape: BoxShape.circle,
              ),
              child: complete
                  ? Icon(Icons.check_rounded, size: 15, color: scheme.onPrimary)
                  : Text(
                      '$index',
                      style: TextStyle(
                        color: selected
                            ? scheme.onPrimary
                            : scheme.onSurface.withValues(alpha: 0.72),
                        fontWeight: FontWeight.w800,
                        fontSize: 12,
                      ),
                    ),
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    step.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: foreground,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    step.helper,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: foreground.withValues(alpha: 0.64),
                      fontSize: 10.5,
                      fontWeight: FontWeight.w600,
                    ),
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

class _CompletionStepBody extends StatelessWidget {
  const _CompletionStepBody({
    super.key,
    required this.step,
    required this.children,
  });

  final _CompletionStep step;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return ListView(
      key: ValueKey('completion-step-scroll-${step.name}'),
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: children,
    );
  }
}

class _CompletionFooter extends StatelessWidget {
  const _CompletionFooter({
    required this.currentStep,
    required this.busy,
    required this.canGoBack,
    required this.canGoNext,
    required this.onBack,
    required this.onNext,
    required this.onSubmit,
    required this.scheme,
  });

  final _CompletionStep currentStep;
  final bool busy;
  final bool canGoBack;
  final bool canGoNext;
  final VoidCallback onBack;
  final VoidCallback onNext;
  final VoidCallback onSubmit;
  final ColorScheme scheme;

  @override
  Widget build(BuildContext context) {
    final isReview = currentStep == _CompletionStep.review;
    final primaryLabel = switch (currentStep) {
      _CompletionStep.setup => 'Lanjut Titik Drop',
      _CompletionStep.drop => 'Lanjut Aktual Barang',
      _CompletionStep.cargo => 'Lanjut Kirim',
      _CompletionStep.review => 'Ajukan Selesai',
    };

    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surface,
        border: Border(
          top: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.72)),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
        child: Row(
          children: [
            if (canGoBack) ...[
              Expanded(
                flex: 4,
                child: OutlinedButton.icon(
                  onPressed: busy ? null : onBack,
                  icon: const Icon(Icons.arrow_back_rounded),
                  label: const Text('Kembali'),
                ),
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              flex: 6,
              child: FilledButton.icon(
                onPressed: busy
                    ? null
                    : (isReview
                          ? onSubmit
                          : canGoNext
                          ? onNext
                          : null),
                icon: busy
                    ? SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: scheme.onPrimary,
                        ),
                      )
                    : Icon(
                        isReview
                            ? Icons.check_circle_rounded
                            : Icons.arrow_forward_rounded,
                      ),
                label: Text(primaryLabel),
              ),
            ),
          ],
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

class _ActualCargoSectionData {
  const _ActualCargoSectionData({
    required this.key,
    required this.label,
    required this.targetLabel,
    required this.drafts,
  });

  final String key;
  final String label;
  final String targetLabel;
  final List<_ActualCargoDraft> drafts;
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
    required this.deliveryOrderItemRef,
    required this.deliveryOrderItemRefs,
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
  final String deliveryOrderItemRef;
  final List<String> deliveryOrderItemRefs;
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
    String deliveryOrderItemRef = '',
    List<String> deliveryOrderItemRefs = const [],
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
      deliveryOrderItemRef: deliveryOrderItemRef,
      deliveryOrderItemRefs: deliveryOrderItemRefs,
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
    String? deliveryOrderItemRef,
    List<String>? deliveryOrderItemRefs,
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
      deliveryOrderItemRef: deliveryOrderItemRef ?? this.deliveryOrderItemRef,
      deliveryOrderItemRefs:
          deliveryOrderItemRefs ?? this.deliveryOrderItemRefs,
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
  final holdContinuationByItemId = _holdContinuationTotalsByItemId(trip);
  return trip.cargoItems
      .map((item) {
        final pending = pendingById[item.id];
        final holdContinuation = pending == null
            ? holdContinuationByItemId[item.id]
            : null;
        final defaultWeightUnit =
            (pending?.actualWeightInputUnit ??
                    holdContinuation?.weightInputUnit ??
                    item.actualWeightInputUnit ??
                    item.weightInputUnit ??
                    'KG')
                .toUpperCase();
        final defaultVolumeUnit =
            (pending?.actualVolumeInputUnit ??
                    holdContinuation?.volumeInputUnit ??
                    item.actualVolumeInputUnit ??
                    item.volumeInputUnit ??
                    'M3')
                .toUpperCase();
        final defaultQty =
            pending?.actualQtyKoli ??
            holdContinuation?.qtyKoliValue ??
            item.actualQtyKoli ??
            item.qtyKoli ??
            0;
        final defaultWeightInput =
            pending?.actualWeightInputValue ??
            holdContinuation?.weightInputValueNumber ??
            item.actualWeightInputValue ??
            item.weightInputValue ??
            (item.weightKg ?? 0);
        final defaultVolumeInput =
            pending?.actualVolumeInputValue ??
            holdContinuation?.volumeInputValueNumber ??
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
            fractionDigits: mobileWeightInputFractionDigits(defaultWeightUnit),
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
            deliveryOrderItemRef: point.deliveryOrderItemRef ?? '',
            deliveryOrderItemRefs: point.deliveryOrderItemRefs,
            shipperReferenceNumber: point.shipperReferenceNumber ?? '',
            shipperReferenceKey: point.shipperReferenceKey ?? '',
            originLocationName: point.originLocationName ?? '',
            originLocationAddress: point.originLocationAddress ?? '',
            locationName: point.locationName,
            locationAddress: point.locationAddress ?? '',
            qtyKoli: _formatMetric(point.qtyKoli),
            weightInputValue: _formatMetric(
              point.weightInputValue,
              fractionDigits: mobileWeightInputFractionDigits(
                point.weightInputUnit ?? 'KG',
              ),
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

  final holdContinuationDrafts = _buildHoldContinuationDropDrafts(
    trip,
    cargoDrafts,
  );
  if (holdContinuationDrafts.isNotEmpty) {
    return holdContinuationDrafts;
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

Map<String, _ActualDropDraft> _holdContinuationTotalsByItemId(
  DeliveryTrip trip,
) {
  if (!_hasHoldContinuationContext(trip)) return const {};

  final totalsByItemId = <String, _ActualDropDraft>{};
  for (final point in trip.actualDropPoints) {
    if (!_isHoldContinuationStopType(point.stopType)) continue;
    final itemRefs = _deliveryActualDropPointItemRefs(point, trip.cargoItems);
    if (itemRefs.length != 1) continue;
    final itemRef = itemRefs.first;
    final current = totalsByItemId[itemRef];
    totalsByItemId[itemRef] = _sumDropDraftValues(
      current,
      _actualDropPointToDraft(point, deliveryOrderItemRef: itemRef),
    );
  }
  return totalsByItemId;
}

List<_ActualDropDraft> _buildHoldContinuationDropDrafts(
  DeliveryTrip trip,
  List<_ActualCargoDraft> cargoDrafts,
) {
  if (!_hasHoldContinuationContext(trip)) return const [];

  final drafts = <_ActualDropDraft>[];
  for (final point in trip.actualDropPoints) {
    if (!_isHoldContinuationStopType(point.stopType)) continue;
    final itemRefs = _deliveryActualDropPointItemRefs(point, trip.cargoItems);
    if (itemRefs.length != 1) continue;
    final cargo = _findCargoDraftByItemRef(cargoDrafts, itemRefs.first);
    if (cargo == null) continue;
    final destination = _defaultContinuationDestination(trip, point, cargo);
    drafts.add(
      _ActualDropDraft.create(
        stopType: 'DROP',
        deliveryOrderItemRef: cargo.itemId,
        deliveryOrderItemRefs: [cargo.itemId],
        shipperReferenceNumber: point.shipperReferenceNumber ?? '',
        shipperReferenceKey: point.shipperReferenceKey ?? '',
        originLocationName: point.locationName,
        originLocationAddress: point.locationAddress ?? '',
        locationName: destination.$1,
        locationAddress: destination.$2,
        qtyKoli: _formatMetric(point.qtyKoli),
        weightInputValue: _formatMetric(
          point.weightInputValue,
          fractionDigits: mobileWeightInputFractionDigits(
            point.weightInputUnit ?? 'KG',
          ),
        ),
        weightInputUnit: (point.weightInputUnit ?? 'KG').toUpperCase(),
        volumeInputValue: _formatMetric(
          point.volumeInputValue,
          fractionDigits:
              (point.volumeInputUnit ?? 'M3').toUpperCase() == 'LITER' ? 0 : 3,
        ),
        volumeInputUnit: (point.volumeInputUnit ?? 'M3').toUpperCase(),
        note: 'Lanjutan hold dikirim',
      ),
    );
  }

  return drafts;
}

bool _hasHoldContinuationContext(DeliveryTrip trip) {
  if (trip.actualDropPoints.isEmpty) return false;
  return trip.status == TripStatus.partialHold ||
      trip.shipperReferences.any(
        (reference) =>
            (reference.tripStatus ?? '').trim().toUpperCase() == 'PARTIAL_HOLD',
      );
}

bool _isHoldContinuationStopType(String value) {
  final normalized = _normalizeDropStopType(value);
  return normalized == 'HOLD' || normalized == 'TRANSIT';
}

List<String> _deliveryActualDropPointItemRefs(
  DeliveryActualDropPoint point,
  List<DeliveryCargoItem> cargoItems,
) {
  final seen = <String>{};
  final refs = <String>[];
  void addRef(String? value) {
    final trimmed = (value ?? '').trim();
    if (trimmed.isEmpty || !seen.add(trimmed)) return;
    refs.add(trimmed);
  }

  addRef(point.deliveryOrderItemRef);
  for (final value in point.deliveryOrderItemRefs) {
    addRef(value);
  }
  if (refs.isNotEmpty) return refs;

  final matchingItems = cargoItems
      .where((item) {
        final pointKey = (point.shipperReferenceKey ?? '').trim();
        final pointNumber = (point.shipperReferenceNumber ?? '')
            .trim()
            .toUpperCase();
        return (pointKey.isNotEmpty &&
                item.shipperReferenceKey?.trim() == pointKey) ||
            (pointNumber.isNotEmpty &&
                item.shipperReferenceNumber?.trim().toUpperCase() ==
                    pointNumber);
      })
      .toList(growable: false);
  if (matchingItems.length == 1) {
    return [matchingItems.first.id];
  }
  return const [];
}

_ActualDropDraft _actualDropPointToDraft(
  DeliveryActualDropPoint point, {
  required String deliveryOrderItemRef,
}) {
  return _ActualDropDraft.create(
    deliveryOrderItemRef: deliveryOrderItemRef,
    deliveryOrderItemRefs: [deliveryOrderItemRef],
    qtyKoli: _formatMetric(point.qtyKoli),
    weightInputValue: _formatMetric(
      point.weightInputValue,
      fractionDigits: mobileWeightInputFractionDigits(
        point.weightInputUnit ?? 'KG',
      ),
    ),
    weightInputUnit: (point.weightInputUnit ?? 'KG').toUpperCase(),
    volumeInputValue: _formatMetric(
      point.volumeInputValue,
      fractionDigits: (point.volumeInputUnit ?? 'M3').toUpperCase() == 'LITER'
          ? 0
          : 3,
    ),
    volumeInputUnit: (point.volumeInputUnit ?? 'M3').toUpperCase(),
  );
}

_ActualDropDraft _sumDropDraftValues(
  _ActualDropDraft? current,
  _ActualDropDraft next,
) {
  if (current == null) return next;
  final weightUnit = _normalizeWeightUnit(current.weightInputUnit);
  final volumeUnit = _normalizeVolumeUnit(current.volumeInputUnit);
  final weightKg =
      _convertWeightToKg(
        current.weightInputValueNumber,
        current.weightInputUnit,
      ) +
      _convertWeightToKg(next.weightInputValueNumber, next.weightInputUnit);
  final volumeM3 =
      _convertVolumeToM3(
        current.volumeInputValueNumber,
        current.volumeInputUnit,
      ) +
      _convertVolumeToM3(next.volumeInputValueNumber, next.volumeInputUnit);
  return current.copyWith(
    qtyKoli: _formatMetric(current.qtyKoliValue + next.qtyKoliValue),
    weightInputValue: _formatMetric(
      _convertKgToWeightInputValue(weightKg, weightUnit),
      fractionDigits: mobileWeightInputFractionDigits(weightUnit),
    ),
    weightInputUnit: weightUnit,
    volumeInputValue: _formatMetric(
      _convertM3ToVolumeInputValue(volumeM3, volumeUnit),
      fractionDigits: volumeUnit == 'LITER' ? 0 : 3,
    ),
    volumeInputUnit: volumeUnit,
  );
}

(String, String) _defaultContinuationDestination(
  DeliveryTrip trip,
  DeliveryActualDropPoint point,
  _ActualCargoDraft cargo,
) {
  DeliveryShipperReference? matchingReference;
  for (final reference in trip.shipperReferences) {
    final pointKey = (point.shipperReferenceKey ?? '').trim();
    final pointNumber = (point.shipperReferenceNumber ?? '')
        .trim()
        .toUpperCase();
    final matches =
        (pointKey.isNotEmpty && reference.key?.trim() == pointKey) ||
        (pointNumber.isNotEmpty &&
            reference.referenceNumber.trim().toUpperCase() == pointNumber);
    if (matches) {
      matchingReference = reference;
      break;
    }
  }
  final locationName = matchingReference?.targetLabel.trim() == '-'
      ? ''
      : matchingReference?.targetLabel.trim() ??
            (trip.receiverName ?? '').trim();
  final locationAddress =
      (matchingReference?.receiverAddress ?? trip.receiverAddress ?? '').trim();
  if (locationName.isNotEmpty || locationAddress.isNotEmpty) {
    return (locationName, locationAddress);
  }
  final cargoReferenceNumber = cargo.shipperReferenceNumber.trim();
  return (
    cargoReferenceNumber.isNotEmpty
        ? 'Tujuan SJ $cargoReferenceNumber'
        : 'Tujuan Invoice',
    '',
  );
}

Set<String> _initialSelectedReferenceValues(
  DeliveryTrip trip,
  List<_ActualCargoDraft> cargoDrafts,
  List<String> initialSelectedSuratJalanRefs,
) {
  final requestedRefs = initialSelectedSuratJalanRefs
      .map(_normalizeSuratJalanRefCandidate)
      .where((value) => value.isNotEmpty)
      .toSet();
  if (requestedRefs.isNotEmpty) {
    final requestedValues = trip.shipperReferences
        .where(trip.canRequestFinalizationForReference)
        .where(
          (reference) => _suratJalanRefCandidates(
            trip,
            reference,
          ).any(requestedRefs.contains),
        )
        .map(_shipperReferenceOptionValue)
        .toSet();
    if (requestedValues.isNotEmpty) return requestedValues;
  }

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

List<_ActualCargoSectionData> _groupCargoDraftsBySelectedReferences(
  List<_ActualCargoDraft> drafts,
  List<DeliveryShipperReference> selectedReferences,
) {
  if (drafts.isEmpty) return const [];
  if (selectedReferences.isEmpty) {
    return [
      _ActualCargoSectionData(
        key: 'manual',
        label: 'Tanpa SJ',
        targetLabel: '',
        drafts: drafts,
      ),
    ];
  }

  final usedItemIds = <String>{};
  final sections = <_ActualCargoSectionData>[];
  for (final reference in selectedReferences) {
    final sectionDrafts = drafts
        .where((draft) => _cargoDraftMatchesReference(draft, reference))
        .toList(growable: false);
    if (sectionDrafts.isEmpty) continue;
    usedItemIds.addAll(sectionDrafts.map((draft) => draft.itemId));
    sections.add(
      _ActualCargoSectionData(
        key: _shipperReferenceOptionValue(reference),
        label: reference.referenceNumber,
        targetLabel: reference.targetLabel,
        drafts: sectionDrafts,
      ),
    );
  }

  final unmatchedDrafts = drafts
      .where((draft) => !usedItemIds.contains(draft.itemId))
      .toList(growable: false);
  if (unmatchedDrafts.isNotEmpty) {
    sections.add(
      _ActualCargoSectionData(
        key: 'unmatched',
        label: 'Tanpa SJ',
        targetLabel: '',
        drafts: unmatchedDrafts,
      ),
    );
  }

  if (sections.isEmpty) {
    return [
      _ActualCargoSectionData(
        key: 'all',
        label: selectedReferences.first.referenceNumber,
        targetLabel: selectedReferences.first.targetLabel,
        drafts: drafts,
      ),
    ];
  }
  return sections;
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
      _dropDraftHasNoReference(nextDrafts.first) &&
      !_dropDraftHasItemSelection(nextDrafts.first)) {
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

String _normalizeSuratJalanRefCandidate(String value) =>
    value.trim().toUpperCase();

Set<String> _suratJalanRefCandidates(
  DeliveryTrip trip,
  DeliveryShipperReference reference,
) {
  final documentId = _suratJalanDocumentIdForReference(trip, reference);
  final key = (reference.key ?? '').trim();
  final number = reference.referenceNumber.trim();
  return {
    if (documentId.isNotEmpty) _normalizeSuratJalanRefCandidate(documentId),
    if (key.isNotEmpty) _normalizeSuratJalanRefCandidate(key),
    if (key.isNotEmpty)
      _normalizeSuratJalanRefCandidate('${trip.deliveryOrderId}:$key'),
    if (number.isNotEmpty) _normalizeSuratJalanRefCandidate(number),
    if (number.isNotEmpty)
      _normalizeSuratJalanRefCandidate('${trip.deliveryOrderId}:$number'),
  };
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

_ActualCargoTotals _summarizeBillableDropDrafts(
  List<_ActualDropDraft> drafts,
) => _summarizeDropDrafts(
  drafts
      .where((draft) => _isBillableDropType(draft.stopType))
      .toList(growable: false),
);

_ActualCargoTotals _summarizeActualItemInputs(
  List<DriverActualCargoInput> items,
) {
  double qtyKoli = 0;
  double weightKg = 0;
  double volumeM3 = 0;
  for (final item in items) {
    qtyKoli += item.actualQtyKoli;
    weightKg += _convertWeightToKg(
      item.actualWeightInputValue,
      item.actualWeightInputUnit,
    );
    volumeM3 += _convertVolumeToM3(
      item.actualVolumeInputValue,
      item.actualVolumeInputUnit,
    );
  }
  return _ActualCargoTotals(
    qtyKoli: qtyKoli,
    weightKg: weightKg,
    volumeM3: volumeM3,
  );
}

List<DriverActualCargoInput> _buildSubmissionActualItems(
  List<_ActualCargoDraft> cargoDrafts,
  List<_ActualDropDraft> dropDrafts,
) {
  final itemSpecificRefs = dropDrafts
      .map((drop) => _dropItemRefsForSubmission(drop, cargoDrafts))
      .where((refs) => refs.length == 1)
      .expand((refs) => refs)
      .toSet();

  return cargoDrafts
      .map((draft) {
        final weightUnit = _normalizeWeightUnit(draft.weightInputUnit);
        final volumeUnit = _normalizeVolumeUnit(draft.volumeInputUnit);
        if (!itemSpecificRefs.contains(draft.itemId)) {
          return _actualInputFromCargoDraft(draft);
        }

        final billableDrops = dropDrafts.where((drop) {
          final itemRefs = _dropItemRefsForSubmission(drop, cargoDrafts);
          return itemRefs.length == 1 &&
              itemRefs.first == draft.itemId &&
              _isBillableDropType(drop.stopType);
        });
        double qtyKoli = 0;
        double weightKg = 0;
        double volumeM3 = 0;
        for (final drop in billableDrops) {
          qtyKoli += drop.qtyKoliValue;
          weightKg += _convertWeightToKg(
            drop.weightInputValueNumber,
            drop.weightInputUnit,
          );
          volumeM3 += _convertVolumeToM3(
            drop.volumeInputValueNumber,
            drop.volumeInputUnit,
          );
        }
        return DriverActualCargoInput(
          deliveryOrderItemRef: draft.itemId,
          actualQtyKoli: qtyKoli,
          actualWeightInputValue: _convertKgToWeightInputValue(
            weightKg,
            weightUnit,
          ),
          actualWeightInputUnit: weightUnit,
          actualVolumeInputValue: _convertM3ToVolumeInputValue(
            volumeM3,
            volumeUnit,
          ),
          actualVolumeInputUnit: volumeUnit,
        );
      })
      .toList(growable: false);
}

DriverActualCargoInput _actualInputFromCargoDraft(_ActualCargoDraft draft) {
  return DriverActualCargoInput(
    deliveryOrderItemRef: draft.itemId,
    actualQtyKoli: draft.qtyKoliValue,
    actualWeightInputValue: draft.weightInputValueNumber,
    actualWeightInputUnit: _normalizeWeightUnit(draft.weightInputUnit),
    actualVolumeInputValue: draft.volumeInputValueNumber,
    actualVolumeInputUnit: _normalizeVolumeUnit(draft.volumeInputUnit),
  );
}

List<_ActualCargoDraft> _cargoDraftsForDrop(
  _ActualDropDraft drop,
  List<_ActualCargoDraft> drafts,
) {
  final itemRefs = _normalizedDropItemRefs(drop);
  if (itemRefs.isNotEmpty) {
    final itemRefSet = itemRefs.toSet();
    return drafts
        .where((draft) => itemRefSet.contains(draft.itemId))
        .toList(growable: false);
  }

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

List<String> _normalizedDropItemRefs(_ActualDropDraft draft) {
  final seen = <String>{};
  final values = <String>[];
  void addRef(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty || !seen.add(trimmed)) return;
    values.add(trimmed);
  }

  addRef(draft.deliveryOrderItemRef);
  for (final value in draft.deliveryOrderItemRefs) {
    addRef(value);
  }
  return values;
}

List<String> _dropItemRefsForSubmission(
  _ActualDropDraft draft,
  List<_ActualCargoDraft> cargoDrafts,
) {
  final explicitRefs = _normalizedDropItemRefs(draft);
  if (explicitRefs.isNotEmpty) return explicitRefs;
  final resolvedCargo = _resolvedSingleCargoDraftForDrop(draft, cargoDrafts);
  return resolvedCargo == null ? const [] : [resolvedCargo.itemId];
}

_ActualCargoDraft? _resolvedSingleCargoDraftForDrop(
  _ActualDropDraft draft,
  List<_ActualCargoDraft> cargoDrafts,
) {
  final explicitRefs = _normalizedDropItemRefs(draft);
  if (explicitRefs.length == 1) {
    return _findCargoDraftByItemRef(cargoDrafts, explicitRefs.first);
  }
  if (explicitRefs.length > 1) return null;

  final matchingItems = cargoDrafts
      .where((cargo) => _dropDraftMatchesCargo(draft, cargo))
      .toList(growable: false);
  if (matchingItems.length != 1) return null;
  return matchingItems.first;
}

bool _dropDraftHasItemSelection(_ActualDropDraft draft) =>
    _normalizedDropItemRefs(draft).isNotEmpty;

_ActualCargoDraft? _findCargoDraftByItemRef(
  List<_ActualCargoDraft> drafts,
  String? itemRef,
) {
  final normalized = (itemRef ?? '').trim();
  if (normalized.isEmpty) return null;
  for (final draft in drafts) {
    if (draft.itemId == normalized) return draft;
  }
  return null;
}

String _dropCargoItemOptionValue(_ActualCargoDraft draft) =>
    'item:${draft.itemId}';

_ActualCargoDraft? _findCargoDraftByOptionValue(
  List<_ActualCargoDraft> drafts,
  String optionValue,
) {
  if (!optionValue.startsWith('item:')) return null;
  final itemRef = optionValue.substring('item:'.length).trim();
  return _findCargoDraftByItemRef(drafts, itemRef);
}

_ActualDropDraft _createNextDropDraftForSelectedCargo(
  List<_ActualCargoDraft> selectedCargoDrafts,
  List<_ActualDropDraft> selectedDropDrafts,
  List<DeliveryShipperReference> selectedReferences,
) {
  final base = _ActualDropDraft.create();
  final targetReference = selectedReferences.length == 1
      ? selectedReferences.first
      : null;
  final baseWithTarget = targetReference == null
      ? base
      : base.copyWith(
          shipperReferenceNumber: targetReference.referenceNumber,
          shipperReferenceKey: targetReference.key ?? '',
          locationName: targetReference.targetLabel == '-'
              ? ''
              : targetReference.targetLabel,
          locationAddress: targetReference.receiverAddress ?? '',
        );
  if (selectedCargoDrafts.isEmpty) return baseWithTarget;

  final selectedCargo = selectedCargoDrafts.firstWhere(
    (cargo) => _hasActualDropItemValues(
      _remainingDropValuesForCargoItem(
        cargo,
        selectedDropDrafts,
        excludeDraftId: baseWithTarget.id,
      ),
    ),
    orElse: () => selectedCargoDrafts.first,
  );
  return _applyCargoDraftToDrop(
    baseWithTarget,
    selectedCargo,
    selectedDropDrafts,
    forceValues: true,
  );
}

_ActualDropDraft _applyCargoDraftToDrop(
  _ActualDropDraft draft,
  _ActualCargoDraft cargo,
  List<_ActualDropDraft> allDrafts, {
  required bool forceValues,
}) {
  final remaining = _remainingDropValuesForCargoItem(
    cargo,
    allDrafts,
    excludeDraftId: draft.id,
  );
  String valueOrCurrent(String current, String next) {
    if (forceValues || current.trim().isEmpty) return next;
    return current;
  }

  return draft.copyWith(
    deliveryOrderItemRef: cargo.itemId,
    deliveryOrderItemRefs: [cargo.itemId],
    shipperReferenceNumber: cargo.shipperReferenceNumber,
    shipperReferenceKey: cargo.shipperReferenceKey,
    qtyKoli: valueOrCurrent(draft.qtyKoli, remaining.qtyKoli),
    weightInputValue: valueOrCurrent(
      draft.weightInputValue,
      remaining.weightInputValue,
    ),
    weightInputUnit: remaining.weightInputUnit,
    volumeInputValue: valueOrCurrent(
      draft.volumeInputValue,
      remaining.volumeInputValue,
    ),
    volumeInputUnit: remaining.volumeInputUnit,
  );
}

_ActualDropDraft _remainingDropValuesForCargoItem(
  _ActualCargoDraft cargo,
  List<_ActualDropDraft> allDrafts, {
  required String excludeDraftId,
}) {
  double usedQtyKoli = 0;
  double usedWeightKg = 0;
  double usedVolumeM3 = 0;
  for (final draft in allDrafts) {
    if (draft.id == excludeDraftId) continue;
    final itemRefs = _normalizedDropItemRefs(draft);
    if (itemRefs.length != 1 || itemRefs.first != cargo.itemId) continue;
    usedQtyKoli += draft.qtyKoliValue;
    usedWeightKg += _convertWeightToKg(
      draft.weightInputValueNumber,
      draft.weightInputUnit,
    );
    usedVolumeM3 += _convertVolumeToM3(
      draft.volumeInputValueNumber,
      draft.volumeInputUnit,
    );
  }

  final weightUnit = _normalizeWeightUnit(cargo.weightInputUnit);
  final volumeUnit = _normalizeVolumeUnit(cargo.volumeInputUnit);
  final remainingQtyKoli = (cargo.qtyKoliValue - usedQtyKoli)
      .clamp(0, double.infinity)
      .toDouble();
  final remainingWeightKg =
      (_convertWeightToKg(cargo.weightInputValueNumber, weightUnit) -
              usedWeightKg)
          .clamp(0, double.infinity)
          .toDouble();
  final remainingVolumeM3 =
      (_convertVolumeToM3(cargo.volumeInputValueNumber, volumeUnit) -
              usedVolumeM3)
          .clamp(0, double.infinity)
          .toDouble();
  return _ActualDropDraft.create(
    qtyKoli: _formatMetric(remainingQtyKoli),
    weightInputValue: _formatMetric(
      _convertKgToWeightInputValue(remainingWeightKg, weightUnit),
      fractionDigits: mobileWeightInputFractionDigits(weightUnit),
    ),
    weightInputUnit: weightUnit,
    volumeInputValue: _formatMetric(
      _convertM3ToVolumeInputValue(remainingVolumeM3, volumeUnit),
      fractionDigits: volumeUnit == 'LITER' ? 0 : 3,
    ),
    volumeInputUnit: volumeUnit,
  );
}

bool _hasActualDropItemValues(_ActualDropDraft draft) =>
    draft.qtyKoliValue > 0 ||
    draft.weightInputValueNumber > 0 ||
    draft.volumeInputValueNumber > 0;

String? _autoWeightInputValueForQty({
  required _ActualDropDraft draft,
  required _ActualCargoDraft? cargo,
  required String nextQtyKoli,
  required String nextWeightUnit,
}) {
  if (cargo == null) return null;
  final qtyKoli = _parseDouble(nextQtyKoli);
  final basisQtyKoli = cargo.qtyKoliValue;
  final basisWeightKg = _convertWeightToKg(
    cargo.weightInputValueNumber,
    cargo.weightInputUnit,
  );
  if (qtyKoli <= 0 || basisQtyKoli <= 0 || basisWeightKg <= 0) {
    return '';
  }

  final currentQtyKoli = draft.qtyKoliValue;
  final currentWeightKg = _convertWeightToKg(
    draft.weightInputValueNumber,
    draft.weightInputUnit,
  );
  final previousAutoWeightKg = currentQtyKoli > 0
      ? basisWeightKg * currentQtyKoli / basisQtyKoli
      : 0;
  final shouldRefresh =
      currentWeightKg <= 0 ||
      previousAutoWeightKg <= 0 ||
      (currentWeightKg - previousAutoWeightKg).abs() <= 0.01;
  if (!shouldRefresh) return null;

  final nextWeightKg = basisWeightKg * qtyKoli / basisQtyKoli;
  final normalizedUnit = _normalizeWeightUnit(nextWeightUnit);
  return _formatMetric(
    _convertKgToWeightInputValue(nextWeightKg, normalizedUnit),
    fractionDigits: mobileWeightInputFractionDigits(normalizedUnit),
  );
}

String _formatCargoDraftValues(_ActualCargoDraft draft) {
  final parts = <String>[
    if (draft.qtyKoliValue > 0) '${_formatMetric(draft.qtyKoliValue)} koli',
    if (draft.weightInputValueNumber > 0)
      '${_formatMetric(draft.weightInputValueNumber, fractionDigits: mobileWeightInputFractionDigits(draft.weightInputUnit))} ${_normalizeWeightUnit(draft.weightInputUnit)}',
    if (draft.volumeInputValueNumber > 0)
      '${_formatMetric(draft.volumeInputValueNumber, fractionDigits: _normalizeVolumeUnit(draft.volumeInputUnit) == 'LITER' ? 0 : 3)} ${_normalizeVolumeUnit(draft.volumeInputUnit)}',
  ];
  return parts.isEmpty ? 'Belum diisi' : parts.join(' / ');
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

List<DropdownMenuItem<String>> _buildDropCargoTargetItems(
  List<DeliveryShipperReference> references,
  List<_ActualCargoDraft> cargoDrafts,
) {
  final items = <DropdownMenuItem<String>>[
    const DropdownMenuItem(value: '', child: Text('Semua / manual')),
  ];
  items.addAll(
    _buildUniqueShipperReferenceItems(references).map(
      (item) => DropdownMenuItem<String>(
        value: item.value,
        child: Text(
          '${_dropdownItemLabel(item.child)} - semua barang',
          overflow: TextOverflow.ellipsis,
        ),
      ),
    ),
  );

  final seenItemRefs = <String>{};
  for (final draft in cargoDrafts) {
    if (!seenItemRefs.add(draft.itemId)) continue;
    final sjLabel = draft.shipperReferenceNumber.trim().isEmpty
        ? 'Tanpa SJ'
        : draft.shipperReferenceNumber.trim();
    final description = draft.description.trim().isEmpty
        ? 'Barang'
        : draft.description.trim();
    items.add(
      DropdownMenuItem(
        value: _dropCargoItemOptionValue(draft),
        child: Text('$sjLabel - $description', overflow: TextOverflow.ellipsis),
      ),
    );
  }
  return items;
}

String _dropdownItemLabel(Widget child) {
  if (child is Text) {
    final data = child.data?.trim();
    if (data != null && data.isNotEmpty) return data;
  }
  return 'SJ';
}

String _resolveDropCargoTargetOptionValue(
  _ActualDropDraft drop,
  List<DeliveryShipperReference> references,
  List<_ActualCargoDraft> cargoDrafts,
) {
  final itemRefs = _normalizedDropItemRefs(drop);
  if (itemRefs.length == 1 &&
      cargoDrafts.any((draft) => draft.itemId == itemRefs.first)) {
    return 'item:${itemRefs.first}';
  }
  return _resolveDropReferenceOptionValue(drop, references);
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

String? _getAmbiguousActualDropMappingMessage(
  List<_ActualDropDraft> drops,
  List<_ActualCargoDraft> cargoDrafts,
) {
  if (drops.length <= 1 || cargoDrafts.length <= 1) return null;

  final groups = <String, List<_ActualCargoDraft>>{};
  for (final cargo in cargoDrafts) {
    final key = _cargoDraftReferenceGroupKey(cargo);
    groups.putIfAbsent(key, () => []).add(cargo);
  }

  for (final entry in groups.entries) {
    final groupItems = entry.value;
    if (groupItems.length <= 1) continue;

    final groupDrops = drops
        .where(
          (drop) =>
              groupItems.any((cargo) => _dropDraftMatchesCargo(drop, cargo)),
        )
        .toList(growable: false);
    final hasBillable = groupDrops.any(
      (drop) => _isBillableDropType(drop.stopType),
    );
    final hasNonBillable = groupDrops.any(
      (drop) => _isNonBillableDropType(drop.stopType),
    );
    if (!hasBillable || !hasNonBillable) continue;

    final hasAmbiguousDrop = groupDrops.any((drop) {
      if (_dropDraftHasItemSelection(drop)) return false;
      final matchedItems = groupItems
          .where((cargo) => _dropDraftMatchesCargo(drop, cargo))
          .length;
      return matchedItems > 1;
    });
    if (!hasAmbiguousDrop) continue;

    final groupLabel = groupItems.first.shipperReferenceNumber.trim().isEmpty
        ? 'SJ ini'
        : 'SJ ${groupItems.first.shipperReferenceNumber.trim()}';
    return '$groupLabel punya campuran drop dan hold/return. Pilih barang spesifik untuk setiap titik sebelum finalisasi agar status dan invoice per barang tidak salah.';
  }

  return null;
}

String _cargoDraftReferenceGroupKey(_ActualCargoDraft cargo) {
  final key = cargo.shipperReferenceKey.trim();
  if (key.isNotEmpty) return 'key:$key';
  final number = cargo.shipperReferenceNumber.trim().toUpperCase();
  if (number.isNotEmpty) return 'number:$number';
  return 'TANPA-SJ';
}

bool _dropDraftMatchesCargo(_ActualDropDraft drop, _ActualCargoDraft cargo) {
  final itemRefs = _normalizedDropItemRefs(drop);
  if (itemRefs.isNotEmpty) return itemRefs.contains(cargo.itemId);

  final dropReferenceKey = drop.shipperReferenceKey.trim();
  final dropReferenceNumber = drop.shipperReferenceNumber.trim().toUpperCase();
  if (dropReferenceKey.isEmpty && dropReferenceNumber.isEmpty) return true;

  return (dropReferenceKey.isNotEmpty &&
          dropReferenceKey == cargo.shipperReferenceKey.trim()) ||
      (dropReferenceNumber.isNotEmpty &&
          dropReferenceNumber ==
              cargo.shipperReferenceNumber.trim().toUpperCase());
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

double _convertKgToWeightInputValue(double weightKg, String unit) {
  if (weightKg <= 0) return 0;
  return unit.toUpperCase() == 'TON' ? weightKg / 1000 : weightKg;
}

double _convertM3ToVolumeInputValue(double volumeM3, String unit) {
  if (volumeM3 <= 0) return 0;
  return unit.toUpperCase() == 'LITER' ? volumeM3 * 1000 : volumeM3;
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
    'TRANSIT' => 'TRANSIT',
    'EXTRA_DROP' => 'EXTRA_DROP',
    'RETURN' => 'RETURN',
    _ => 'DROP',
  };
}

String _editableDriverDropStopType(String value) {
  final normalized = _normalizeDropStopType(value);
  return switch (normalized) {
    'HOLD' || 'TRANSIT' || 'RETURN' => 'HOLD',
    _ => 'DROP',
  };
}

const _driverDropStopTypeItems = [
  DropdownMenuItem<String>(value: 'DROP', child: Text('Drop')),
  DropdownMenuItem<String>(value: 'HOLD', child: Text('Hold / Inap')),
];

bool _isBillableDropType(String value) {
  final normalized = _normalizeDropStopType(value);
  return normalized == 'DROP' || normalized == 'EXTRA_DROP';
}

bool _isNonBillableDropType(String value) => !_isBillableDropType(value);

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
      deliveryStatusLabel(reference.tripStatus!.trim()),
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

class _DropWorkflowCard extends StatelessWidget {
  const _DropWorkflowCard({
    required this.cargoCount,
    required this.dropCount,
    required this.usesDetailedDrop,
  });

  final int cargoCount;
  final int dropCount;
  final bool usesDetailedDrop;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Tentukan Realisasi Titik Drop',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
            ),
            const SizedBox(height: 8),
            Text(
              usesDetailedDrop
                  ? '$dropCount titik drop aktif untuk $cargoCount item. Barang tiap titik harus jelas sebelum diajukan.'
                  : '$cargoCount item akan turun di satu titik. Tambahkan titik hanya untuk multi-drop atau hold/inap.',
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.62),
                height: 1.4,
                fontSize: 12.5,
              ),
            ),
          ],
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

class _ActualCargoSection extends StatelessWidget {
  const _ActualCargoSection({
    super.key,
    required this.section,
    required this.showHeader,
    required this.onChanged,
  });

  final _ActualCargoSectionData section;
  final bool showHeader;
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
    final scheme = Theme.of(context).colorScheme;
    final targetLabel = section.targetLabel.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (showHeader) ...[
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Icon(
                  Icons.description_outlined,
                  size: 16,
                  color: scheme.primary,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    targetLabel.isEmpty
                        ? section.label
                        : '${section.label} | $targetLabel',
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.72),
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        ...section.drafts.map(
          (draft) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _ActualCargoCard(
              key: ValueKey(draft.itemId),
              draft: draft,
              onChanged: onChanged,
            ),
          ),
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
            if (draft.shipperReferenceNumber.trim().isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                'SJ ${draft.shipperReferenceNumber.trim()}',
                style: TextStyle(
                  color: Theme.of(
                    context,
                  ).colorScheme.onSurface.withValues(alpha: 0.62),
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
            const SizedBox(height: 12),
            _SyncedTextFormField(
              value: draft.qtyKoli,
              keyboardType: mobileNumberKeyboardType(2),
              inputFormatters: mobileNumberInputFormatters(2),
              decoration: InputDecoration(
                labelText: draft.requireQty ? 'Qty Aktual *' : 'Qty Aktual',
                enabled: draft.requireQty,
              ),
              enabled: draft.requireQty,
              onChanged: (value) => onChanged(draft.itemId, qtyKoli: value),
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                Widget weightField() {
                  final fractionDigits = mobileWeightInputFractionDigits(
                    draft.weightInputUnit,
                  );
                  return _SyncedTextFormField(
                    value: draft.weightInputValue,
                    keyboardType: mobileNumberKeyboardType(fractionDigits),
                    inputFormatters: mobileNumberInputFormatters(
                      fractionDigits,
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
                  final fractionDigits = mobileVolumeInputFractionDigits(
                    draft.volumeInputUnit,
                  );
                  return _SyncedTextFormField(
                    value: draft.volumeInputValue,
                    keyboardType: mobileNumberKeyboardType(fractionDigits),
                    inputFormatters: mobileNumberInputFormatters(
                      fractionDigits,
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
    required this.onCargoTargetChanged,
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
    String? deliveryOrderItemRef,
    List<String>? deliveryOrderItemRefs,
    String? shipperReferenceNumber,
    String? shipperReferenceKey,
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
  final void Function(String draftId, String optionValue) onCargoTargetChanged;
  final void Function(String draftId, String recipientId) onRecipientChanged;
  final void Function(String draftId) onRemove;

  @override
  Widget build(BuildContext context) {
    final selectedCargoTargetValue = _resolveDropCargoTargetOptionValue(
      draft,
      shipperReferences,
      cargoDrafts,
    );
    final cargoTargetItems = _buildDropCargoTargetItems(
      shipperReferences,
      cargoDrafts,
    );
    final resolvedCargoTargetValue =
        cargoTargetItems.any((item) => item.value == selectedCargoTargetValue)
        ? selectedCargoTargetValue
        : '';
    final selectedRecipientValue = _resolveRecipientOptionValue(
      draft,
      customerRecipients,
    );
    final selectedDropCargoDrafts = _cargoDraftsForDrop(draft, cargoDrafts);

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
              initialValue: _editableDriverDropStopType(draft.stopType),
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Tipe Titik'),
              items: _driverDropStopTypeItems,
              onChanged: (value) =>
                  onChanged(draft.id, stopType: value ?? 'DROP'),
            ),
            const SizedBox(height: 12),
            if (shipperReferences.isNotEmpty || cargoDrafts.length > 1) ...[
              DropdownButtonFormField<String>(
                key: ValueKey(
                  'drop-target-${draft.id}-$resolvedCargoTargetValue',
                ),
                initialValue: resolvedCargoTargetValue,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Tentukan Barang'),
                items: cargoTargetItems,
                onChanged: (value) =>
                    onCargoTargetChanged(draft.id, value ?? ''),
              ),
              const SizedBox(height: 8),
              _DropCargoAllocationSummary(cargoDrafts: selectedDropCargoDrafts),
              const SizedBox(height: 12),
            ] else ...[
              _DropCargoAllocationSummary(cargoDrafts: selectedDropCargoDrafts),
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
                  labelText: 'Tujuan Master Customer',
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
              keyboardType: mobileNumberKeyboardType(2),
              inputFormatters: mobileNumberInputFormatters(2),
              decoration: const InputDecoration(labelText: 'Qty Drop'),
              onChanged: (value) => onChanged(draft.id, qtyKoli: value),
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                Widget weightField() {
                  final fractionDigits = mobileWeightInputFractionDigits(
                    draft.weightInputUnit,
                  );
                  return _SyncedTextFormField(
                    value: draft.weightInputValue,
                    keyboardType: mobileNumberKeyboardType(fractionDigits),
                    inputFormatters: mobileNumberInputFormatters(
                      fractionDigits,
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
                  final fractionDigits = mobileVolumeInputFractionDigits(
                    draft.volumeInputUnit,
                  );
                  return _SyncedTextFormField(
                    value: draft.volumeInputValue,
                    keyboardType: mobileNumberKeyboardType(fractionDigits),
                    inputFormatters: mobileNumberInputFormatters(
                      fractionDigits,
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
              decoration: const InputDecoration(
                labelText: 'Catatan Titik Drop',
              ),
              onChanged: (value) => onChanged(draft.id, note: value),
            ),
          ],
        ),
      ),
    );
  }
}

class _DropCargoAllocationSummary extends StatelessWidget {
  const _DropCargoAllocationSummary({required this.cargoDrafts});

  final List<_ActualCargoDraft> cargoDrafts;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    if (cargoDrafts.isEmpty) {
      return Text(
        'Belum ada barang dialokasikan.',
        style: TextStyle(
          color: scheme.onSurface.withValues(alpha: 0.62),
          fontSize: 12,
          height: 1.35,
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.38),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outline.withValues(alpha: 0.24)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Alokasi Barang Titik Ini',
            style: TextStyle(
              color: scheme.onSurface,
              fontWeight: FontWeight.w700,
              fontSize: 12.5,
            ),
          ),
          const SizedBox(height: 8),
          for (final entry in cargoDrafts.indexed) ...[
            if (entry.$1 > 0) const Divider(height: 14),
            _DropCargoAllocationRow(cargo: entry.$2),
          ],
        ],
      ),
    );
  }
}

class _DropCargoAllocationRow extends StatelessWidget {
  const _DropCargoAllocationRow({required this.cargo});

  final _ActualCargoDraft cargo;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final sjNumber = cargo.shipperReferenceNumber.trim().isEmpty
        ? 'Tanpa SJ'
        : cargo.shipperReferenceNumber.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          cargo.description.trim().isEmpty ? 'Barang' : cargo.description,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5),
        ),
        const SizedBox(height: 3),
        Text(
          '$sjNumber | ${_formatCargoDraftValues(cargo)}',
          style: TextStyle(
            color: scheme.onSurface.withValues(alpha: 0.62),
            fontSize: 11.5,
            height: 1.35,
          ),
        ),
      ],
    );
  }
}

class _SyncedTextFormField extends StatefulWidget {
  const _SyncedTextFormField({
    required this.value,
    required this.decoration,
    required this.onChanged,
    this.keyboardType,
    this.inputFormatters,
    this.minLines,
    this.maxLines = 1,
    this.enabled = true,
  });

  final String value;
  final InputDecoration decoration;
  final ValueChanged<String> onChanged;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final int? minLines;
  final int? maxLines;
  final bool enabled;

  @override
  State<_SyncedTextFormField> createState() => _SyncedTextFormFieldState();
}

class _SyncedTextFormFieldState extends State<_SyncedTextFormField> {
  late final TextEditingController _controller;
  String? _pendingControllerValue;
  bool _controllerSyncScheduled = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.value);
  }

  @override
  void didUpdateWidget(covariant _SyncedTextFormField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.value == _controller.text) return;

    _pendingControllerValue = widget.value;
    if (_controllerSyncScheduled) return;

    _controllerSyncScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _controllerSyncScheduled = false;
      if (!mounted) return;
      final nextValue = _pendingControllerValue;
      _pendingControllerValue = null;
      if (nextValue == null || nextValue != widget.value) return;
      if (nextValue == _controller.text) return;

      _controller.value = TextEditingValue(
        text: nextValue,
        selection: TextSelection.collapsed(offset: nextValue.length),
      );
    });
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
      inputFormatters: widget.inputFormatters,
      minLines: widget.minLines,
      maxLines: widget.maxLines,
      decoration: widget.decoration,
      enabled: widget.enabled,
      scrollPadding: _mobileInputScrollPadding,
      onChanged: widget.onChanged,
    );
  }
}
