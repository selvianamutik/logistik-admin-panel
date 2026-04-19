import 'package:flutter/material.dart';

import '../data/delivery_order_service.dart';
import '../domain/models.dart';

class DeliveryCompletionPage extends StatefulWidget {
  const DeliveryCompletionPage({super.key, required this.trip});

  final DeliveryTrip trip;

  @override
  State<DeliveryCompletionPage> createState() => _DeliveryCompletionPageState();
}

class _DeliveryCompletionPageState extends State<DeliveryCompletionPage> {
  final _noteController = TextEditingController();
  bool _submitting = false;
  late List<_ActualCargoDraft> _cargoDrafts;
  late List<_ActualDropDraft> _dropDrafts;

  @override
  void initState() {
    super.initState();
    _cargoDrafts = _buildInitialCargoDrafts(widget.trip);
    _dropDrafts = _buildInitialDropDrafts(widget.trip, _cargoDrafts);
  }

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
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

            final targetLabel = reference.targetLabel == '-'
                ? ''
                : reference.targetLabel;
            final targetAddress = (reference.receiverAddress ?? '').trim();
            return draft.copyWith(
              shipperReferenceNumber: reference.referenceNumber,
              shipperReferenceKey: reference.key ?? '',
              locationName: targetLabel.isNotEmpty
                  ? targetLabel
                  : draft.locationName,
              locationAddress: targetAddress.isNotEmpty
                  ? targetAddress
                  : draft.locationAddress,
            );
          })
          .toList(growable: false);
    });
  }

  Future<void> _submit() async {
    final validationError = _validateDrafts();
    if (validationError != null) {
      _showError(validationError);
      return;
    }

    final actualItems = _cargoDrafts
        .map(
          (draft) => DriverActualCargoInput(
            deliveryOrderItemRef: draft.itemId,
            actualQtyKoli: draft.qtyKoliValue,
            actualWeightInputValue: draft.weightInputValueNumber,
            actualWeightInputUnit: draft.weightInputUnit,
            actualVolumeInputValue: draft.volumeInputValueNumber,
            actualVolumeInputUnit: draft.volumeInputUnit,
          ),
        )
        .toList(growable: false);

    final actualDropPoints = _dropDrafts
        .map(
          (draft) => DriverActualDropPointInput(
            stopType: draft.stopType,
            shipperReferenceNumber: draft.shipperReferenceNumber.trim().isNotEmpty
                ? draft.shipperReferenceNumber.trim()
                : null,
            shipperReferenceKey: draft.shipperReferenceKey.trim().isNotEmpty
                ? draft.shipperReferenceKey.trim()
                : null,
            locationName: draft.locationName.trim().isNotEmpty
                ? draft.locationName.trim()
                : draft.locationAddress.trim(),
            locationAddress: draft.locationAddress.trim(),
            qtyKoli: draft.qtyKoliValue,
            weightInputValue: draft.weightInputValueNumber,
            weightInputUnit: draft.weightInputUnit,
            volumeInputValue: draft.volumeInputValueNumber,
            volumeInputUnit: draft.volumeInputUnit,
            note: draft.note.trim().isNotEmpty ? draft.note.trim() : null,
          ),
        )
        .toList(growable: false);

    setState(() => _submitting = true);
    Navigator.of(context).pop(
      DeliveryCompletionSubmitResult(
        note: _noteController.text.trim(),
        actualItems: actualItems,
        actualDropPoints: actualDropPoints,
      ),
    );
  }

  String? _validateDrafts() {
    if (_cargoDrafts.isEmpty) {
      return 'Muatan DO belum ada. Isi barang dulu sebelum ajukan selesai.';
    }

    for (final draft in _cargoDrafts) {
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

    if (_dropDrafts.isEmpty) {
      return 'Isi minimal satu titik realisasi drop.';
    }

    for (final draft in _dropDrafts) {
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

    final cargoTotals = _summarizeCargoDrafts(_cargoDrafts);
    final dropTotals = _summarizeDropDrafts(_dropDrafts);
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

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final cargoTotals = _summarizeCargoDrafts(_cargoDrafts);
    final dropTotals = _summarizeDropDrafts(_dropDrafts);
    final hasMultiTargetDefault =
        _resolveDistinctTargets(widget.trip).length > 1;

    return Scaffold(
      appBar: AppBar(title: const Text('Ajukan Selesai')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                children: [
                  _InfoCard(
                    title: 'Realisasi trip',
                    message: hasMultiTargetDefault
                        ? 'Trip ini punya beberapa target SJ. Driver perlu isi realisasi muatan dan alokasi titik drop dengan benar.'
                        : 'Isi realisasi muatan dan titik drop. Admin akan cross-check sebelum DO diselesaikan.',
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
                  ..._cargoDrafts.map(
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
                  ..._dropDrafts.asMap().entries.map(
                    (entry) => Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: _ActualDropCard(
                        key: ValueKey(entry.value.id),
                        index: entry.key + 1,
                        draft: entry.value,
                        shipperReferences: widget.trip.shipperReferences,
                        cargoDrafts: _cargoDrafts,
                        showRemove: _dropDrafts.length > 1,
                        onChanged: _updateDrop,
                        onReferenceChanged: _selectDropReference,
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
                    decoration: const InputDecoration(
                      labelText: 'Catatan Driver',
                      hintText: 'Opsional',
                    ),
                  ),
                ],
              ),
            ),
            Padding(
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
          ],
        ),
      ),
    );
  }
}

class DeliveryCompletionSubmitResult {
  const DeliveryCompletionSubmitResult({
    required this.note,
    required this.actualItems,
    required this.actualDropPoints,
  });

  final String note;
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

  final targets = _resolveDistinctTargets(trip);
  final totals = _summarizeCargoDrafts(cargoDrafts);
  if (targets.length <= 1) {
    final target = targets.isNotEmpty
        ? targets.first
        : (
            locationName: (trip.receiverName ?? trip.destinationLabel).trim(),
            locationAddress: (trip.receiverAddress ?? '').trim(),
            shipperReferenceNumber: '',
            shipperReferenceKey: '',
          );
    return [
      _ActualDropDraft.create(
        locationName: target.locationName,
        locationAddress: target.locationAddress,
        shipperReferenceNumber: target.shipperReferenceNumber,
        shipperReferenceKey: target.shipperReferenceKey,
        qtyKoli: _formatMetric(totals.qtyKoli),
        weightInputValue: _formatMetric(totals.weightKg),
        volumeInputValue: _formatMetric(totals.volumeM3, fractionDigits: 3),
      ),
    ];
  }

  return targets
      .map((target) {
        final targetTotals = _summarizeCargoDrafts(
          _cargoDraftsForDropReference(target, cargoDrafts),
        );
        return _ActualDropDraft.create(
          locationName: target.locationName,
          locationAddress: target.locationAddress,
          shipperReferenceNumber: target.shipperReferenceNumber,
          shipperReferenceKey: target.shipperReferenceKey,
          qtyKoli: _formatMetric(targetTotals.qtyKoli),
          weightInputValue: _formatMetric(targetTotals.weightKg),
          volumeInputValue: _formatMetric(
            targetTotals.volumeM3,
            fractionDigits: 3,
          ),
        );
      })
      .toList(growable: false);
}

List<
  ({
    String locationName,
    String locationAddress,
    String shipperReferenceNumber,
    String shipperReferenceKey,
  })
>
_resolveDistinctTargets(
  DeliveryTrip trip,
) {
  final results =
      <({
        String locationName,
        String locationAddress,
        String shipperReferenceNumber,
        String shipperReferenceKey,
      })>[];
  final seen = <String>{};
  for (final reference in trip.shipperReferences) {
    final locationName = reference.targetLabel.trim();
    final locationAddress = (reference.receiverAddress ?? '').trim();
    final referenceNumber = reference.referenceNumber.trim();
    final key = referenceNumber.isNotEmpty
        ? 'sj:${referenceNumber.toUpperCase()}'
        : '$locationName::$locationAddress';
    if ((locationName.isEmpty && locationAddress.isEmpty) ||
        seen.contains(key)) {
      continue;
    }
    seen.add(key);
    results.add((
      locationName: locationName,
      locationAddress: locationAddress,
      shipperReferenceNumber: reference.referenceNumber,
      shipperReferenceKey: reference.key ?? '',
    ));
  }
  return results;
}

List<_ActualCargoDraft> _cargoDraftsForDropReference(
  ({
    String locationName,
    String locationAddress,
    String shipperReferenceNumber,
    String shipperReferenceKey,
  })
  reference,
  List<_ActualCargoDraft> drafts,
) {
  final referenceKey = reference.shipperReferenceKey.trim();
  final referenceNumber = reference.shipperReferenceNumber.trim().toUpperCase();
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

String _formatMetric(double? value, {int fractionDigits = 2}) {
  if (value == null || value <= 0) return '';
  final rounded = value.toStringAsFixed(fractionDigits);
  return rounded.contains('.')
      ? rounded.replaceFirst(RegExp(r'\.?0+$'), '')
      : rounded;
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
        child: Row(
          children: [
            Expanded(
              child: _MetricItem(
                label: title,
                value: qtyLabel.isEmpty ? '-' : qtyLabel,
              ),
            ),
            Expanded(
              child: _MetricItem(
                label: 'Berat',
                value: weightLabel.isEmpty ? '-' : weightLabel,
              ),
            ),
            Expanded(
              child: _MetricItem(
                label: 'Volume',
                value: volumeLabel.isEmpty ? '-' : volumeLabel,
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
            Row(
              children: [
                Expanded(
                  child: _SyncedTextFormField(
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
                  ),
                ),
                const SizedBox(width: 12),
                SizedBox(
                  width: 110,
                  child: DropdownButtonFormField<String>(
                    initialValue: draft.weightInputUnit,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Unit'),
                    items: const [
                      DropdownMenuItem(value: 'KG', child: Text('KG')),
                      DropdownMenuItem(value: 'TON', child: Text('TON')),
                    ],
                    onChanged: (value) =>
                        onChanged(draft.itemId, weightInputUnit: value ?? 'KG'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _SyncedTextFormField(
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
                  ),
                ),
                const SizedBox(width: 12),
                SizedBox(
                  width: 110,
                  child: DropdownButtonFormField<String>(
                    initialValue: draft.volumeInputUnit,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Unit'),
                    items: const [
                      DropdownMenuItem(value: 'M3', child: Text('M3')),
                      DropdownMenuItem(value: 'LITER', child: Text('LITER')),
                      DropdownMenuItem(value: 'KL', child: Text('KL')),
                    ],
                    onChanged: (value) =>
                        onChanged(draft.itemId, volumeInputUnit: value ?? 'M3'),
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

class _ActualDropCard extends StatelessWidget {
  const _ActualDropCard({
    super.key,
    required this.index,
    required this.draft,
    required this.shipperReferences,
    required this.cargoDrafts,
    required this.showRemove,
    required this.onChanged,
    required this.onReferenceChanged,
    required this.onRemove,
  });

  final int index;
  final _ActualDropDraft draft;
  final List<DeliveryShipperReference> shipperReferences;
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
  final void Function(String draftId) onRemove;

  @override
  Widget build(BuildContext context) {
    final selectedReferenceValue = _resolveDropReferenceOptionValue(
      draft,
      shipperReferences,
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
              initialValue: draft.stopType,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Tipe'),
              items: const [
                DropdownMenuItem(value: 'DROP', child: Text('Drop')),
                DropdownMenuItem(value: 'HOLD', child: Text('Hold Gudang')),
                DropdownMenuItem(value: 'TRANSIT', child: Text('Transit')),
                DropdownMenuItem(
                  value: 'EXTRA_DROP',
                  child: Text('Drop Tambahan'),
                ),
                DropdownMenuItem(value: 'RETURN', child: Text('Return')),
              ],
              onChanged: (value) =>
                  onChanged(draft.id, stopType: value ?? 'DROP'),
            ),
            const SizedBox(height: 12),
            if (shipperReferences.isNotEmpty) ...[
              DropdownButtonFormField<String>(
                key: ValueKey('drop-ref-${draft.id}-$selectedReferenceValue'),
                initialValue: selectedReferenceValue,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'No. SJ / Barang'),
                items: [
                  const DropdownMenuItem(
                    value: '',
                    child: Text('Semua / manual'),
                  ),
                  ...shipperReferences.map(
                    (reference) {
                      final targetLabel = reference.targetLabel == '-'
                          ? ''
                          : ' - ${reference.targetLabel}';
                      return DropdownMenuItem(
                        value: _shipperReferenceOptionValue(reference),
                        child: Text(
                          '${reference.referenceNumber}$targetLabel',
                          overflow: TextOverflow.ellipsis,
                        ),
                      );
                    },
                  ),
                ],
                onChanged: (value) =>
                    onReferenceChanged(draft.id, value ?? ''),
              ),
              const SizedBox(height: 8),
              Text(
                'Barang: $cargoSummary',
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurface.withValues(
                    alpha: 0.65,
                  ),
                  fontSize: 12,
                  height: 1.35,
                ),
              ),
              const SizedBox(height: 12),
            ] else ...[
              Text(
                'Barang: $cargoSummary',
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurface.withValues(
                    alpha: 0.65,
                  ),
                  fontSize: 12,
                  height: 1.35,
                ),
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
            Row(
              children: [
                Expanded(
                  child: _SyncedTextFormField(
                    value: draft.weightInputValue,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(labelText: 'Berat Drop'),
                    onChanged: (value) =>
                        onChanged(draft.id, weightInputValue: value),
                  ),
                ),
                const SizedBox(width: 12),
                SizedBox(
                  width: 110,
                  child: DropdownButtonFormField<String>(
                    initialValue: draft.weightInputUnit,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Unit'),
                    items: const [
                      DropdownMenuItem(value: 'KG', child: Text('KG')),
                      DropdownMenuItem(value: 'TON', child: Text('TON')),
                    ],
                    onChanged: (value) =>
                        onChanged(draft.id, weightInputUnit: value ?? 'KG'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _SyncedTextFormField(
                    value: draft.volumeInputValue,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: const InputDecoration(labelText: 'Volume Drop'),
                    onChanged: (value) =>
                        onChanged(draft.id, volumeInputValue: value),
                  ),
                ),
                const SizedBox(width: 12),
                SizedBox(
                  width: 110,
                  child: DropdownButtonFormField<String>(
                    initialValue: draft.volumeInputUnit,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Unit'),
                    items: const [
                      DropdownMenuItem(value: 'M3', child: Text('M3')),
                      DropdownMenuItem(value: 'LITER', child: Text('LITER')),
                      DropdownMenuItem(value: 'KL', child: Text('KL')),
                    ],
                    onChanged: (value) =>
                        onChanged(draft.id, volumeInputUnit: value ?? 'M3'),
                  ),
                ),
              ],
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
      onChanged: widget.onChanged,
    );
  }
}
