import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../data/delivery_order_service.dart';
import '../domain/models.dart';
import 'mobile_action_feedback.dart';
import 'mobile_input_visibility.dart';
import 'mobile_numeric_input_formatter.dart';
import 'mobile_unit_selector_field.dart';

const _mobileInputScrollPadding = EdgeInsets.fromLTRB(20, 20, 20, 120);

class DeliveryManifestPage extends StatefulWidget {
  const DeliveryManifestPage({
    super.key,
    required this.title,
    required this.submitLabel,
    required this.pickupStops,
    required this.customerProducts,
    required this.allowsDirectCargoInput,
    this.initialShipperReferences = const [],
    this.existingCargoItems = const [],
  });

  final String title;
  final String submitLabel;
  final List<DeliveryPickupStop> pickupStops;
  final List<CustomerProductOption> customerProducts;
  final bool allowsDirectCargoInput;
  final List<DeliveryShipperReference> initialShipperReferences;
  final List<DeliveryCargoItem> existingCargoItems;

  @override
  State<DeliveryManifestPage> createState() => _DeliveryManifestPageState();
}

class _DeliveryManifestPageState extends State<DeliveryManifestPage>
    with WidgetsBindingObserver {
  final _formKey = GlobalKey<FormState>();
  final _inputVisibilityKey = GlobalKey();
  final _draftVisibilityKeys = <String, GlobalKey>{};
  bool _submitting = false;
  bool _inputVisibilityScheduled = false;
  String? _selectedGroupId;
  late String _initialDraftFingerprint;
  late List<_ManifestGroupDraft> _groups;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    FocusManager.instance.addListener(_scheduleFocusedInputVisibility);
    _groups = _buildInitialGroups();
    _selectedGroupId = _groups.isNotEmpty ? _groups.first.id : null;
    _initialDraftFingerprint = _draftFingerprint(_groups);
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_scheduleFocusedInputVisibility);
    WidgetsBinding.instance.removeObserver(this);
    _draftVisibilityKeys.clear();
    super.dispose();
  }

  @override
  void didChangeMetrics() {
    _scheduleFocusedInputVisibility();
  }

  List<_ManifestGroupDraft> _buildInitialGroups() {
    final defaultPickupStopKey = widget.pickupStops.isNotEmpty
        ? widget.pickupStops.first.key
        : '';
    final groups = <_ManifestGroupDraft>[];

    int findGroupIndex({
      String? referenceKey,
      String? referenceNumber,
      String? pickupStopKey,
    }) {
      final normalizedKey = (referenceKey ?? '').trim();
      final normalizedNumber = (referenceNumber ?? '').trim().toUpperCase();
      final normalizedPickup = (pickupStopKey ?? '').trim();
      return groups.indexWhere((group) {
        if (normalizedKey.isNotEmpty && group.referenceKey == normalizedKey) {
          return true;
        }
        if (normalizedNumber.isNotEmpty &&
            group.shipperReferenceNumber.trim().toUpperCase() ==
                normalizedNumber) {
          return true;
        }
        return normalizedKey.isEmpty &&
            normalizedNumber.isEmpty &&
            normalizedPickup.isNotEmpty &&
            group.pickupStopKey == normalizedPickup;
      });
    }

    void upsertGroup({
      String? referenceKey,
      String? referenceNumber,
      String? pickupStopKey,
      _ManifestItemDraft? item,
    }) {
      final resolvedPickup = (pickupStopKey ?? '').trim().isNotEmpty == true
          ? pickupStopKey!.trim()
          : defaultPickupStopKey;
      final index = findGroupIndex(
        referenceKey: referenceKey,
        referenceNumber: referenceNumber,
        pickupStopKey: resolvedPickup,
      );
      if (index < 0) {
        groups.add(
          _ManifestGroupDraft.create(
            resolvedPickup,
            initialReferenceKey: (referenceKey ?? '').trim(),
            initialReferenceNumber: (referenceNumber ?? '').trim(),
            initialItems: item != null ? [item] : const [],
            createBlankItem: item == null ? false : true,
          ),
        );
        return;
      }
      final group = groups[index];
      groups[index] = group.copyWith(
        referenceKey: (referenceKey ?? group.referenceKey).trim(),
        shipperReferenceNumber:
            (referenceNumber ?? group.shipperReferenceNumber).trim(),
        pickupStopKey: resolvedPickup,
        items: item != null ? [...group.items, item] : group.items,
      );
    }

    for (final reference in widget.initialShipperReferences) {
      upsertGroup(
        referenceKey: reference.key,
        referenceNumber: reference.referenceNumber,
        pickupStopKey: reference.pickupStopKey,
      );
    }

    for (final item in widget.existingCargoItems) {
      upsertGroup(
        referenceKey: item.shipperReferenceKey,
        referenceNumber: item.shipperReferenceNumber,
        pickupStopKey: item.pickupStopKey,
        item: _ManifestItemDraft.fromCargoItem(item),
      );
    }

    if (groups.isEmpty) {
      return [_ManifestGroupDraft.create(defaultPickupStopKey)];
    }

    return groups
        .map(
          (group) => group.items.isEmpty
              ? group.copyWith(items: [_ManifestItemDraft.create()])
              : group,
        )
        .toList(growable: true);
  }

  void _addGroup() {
    FocusManager.instance.primaryFocus?.unfocus();
    final group = _ManifestGroupDraft.create(
      widget.pickupStops.isNotEmpty ? widget.pickupStops.first.key : '',
    );
    setState(() {
      _groups = [..._groups, group];
      _selectedGroupId = group.id;
    });
    _scheduleDraftVisibility(_groupVisibilityKey(group.id));
  }

  Future<void> _removeGroup(String groupId) async {
    final group = _groups.firstWhere(
      (entry) => entry.id == groupId,
      orElse: () => _groups.first,
    );
    final hasExistingCargo = group.items.any(
      (item) => item.sourceCargoItemId.trim().isNotEmpty,
    );
    final confirmed = await showMobileActionConfirmation(
      context,
      title: 'Hapus SJ ini?',
      message: hasExistingCargo
          ? 'SJ dan barang yang sudah tercatat di dalamnya akan ditandai hapus saat kamu menekan Simpan. Data belum dikirim sebelum disimpan.'
          : 'Draft SJ dan barang di dalamnya akan hilang dari layar ini.',
      confirmLabel: 'Hapus SJ',
      icon: Icons.delete_outline_rounded,
      destructive: true,
    );
    if (!mounted || !confirmed) return;

    setState(() {
      final nextGroups = _groups.where((group) => group.id != groupId).toList();
      _groups = nextGroups.isNotEmpty
          ? nextGroups
          : [
              _ManifestGroupDraft.create(
                widget.pickupStops.isNotEmpty
                    ? widget.pickupStops.first.key
                    : '',
              ),
            ];
      _selectedGroupId = _groups.first.id;
    });
  }

  void _selectGroup(String groupId) {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() => _selectedGroupId = groupId);
  }

  _ManifestGroupDraft? get _selectedGroup {
    if (_groups.isEmpty) return null;
    final selectedId = _selectedGroupId;
    if (selectedId != null) {
      for (final group in _groups) {
        if (group.id == selectedId) return group;
      }
    }
    return _groups.first;
  }

  void _updateGroup(
    String groupId, {
    String? pickupStopKey,
    String? shipperReferenceNumber,
  }) {
    setState(() {
      _groups = _groups
          .map(
            (group) => group.id == groupId
                ? group.copyWith(
                    pickupStopKey: pickupStopKey,
                    shipperReferenceNumber: shipperReferenceNumber,
                  )
                : group,
          )
          .toList(growable: false);
    });
  }

  void _addItem(String groupId) {
    FocusManager.instance.primaryFocus?.unfocus();
    final item = _ManifestItemDraft.create();
    setState(() {
      _selectedGroupId = groupId;
      _groups = _groups
          .map(
            (group) => group.id == groupId
                ? group.copyWith(items: [...group.items, item])
                : group,
          )
          .toList(growable: false);
    });
    _scheduleDraftVisibility(_itemVisibilityKey(item.id));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _openItemEditor(groupId, item.id);
      }
    });
  }

  Future<void> _removeItem(String groupId, String itemId) async {
    _ManifestItemDraft? targetItem;
    for (final group in _groups) {
      if (group.id != groupId) continue;
      for (final item in group.items) {
        if (item.id == itemId) {
          targetItem = item;
          break;
        }
      }
    }
    final isExistingCargo =
        targetItem?.sourceCargoItemId.trim().isNotEmpty == true;
    final confirmed = await showMobileActionConfirmation(
      context,
      title: 'Hapus barang ini?',
      message: isExistingCargo
          ? 'Barang yang sudah tercatat akan ditandai hapus saat kamu menekan Simpan. Data belum dikirim sebelum disimpan.'
          : 'Draft barang ini akan dihapus dari SJ.',
      confirmLabel: 'Hapus Barang',
      icon: Icons.remove_circle_outline_rounded,
      destructive: true,
    );
    if (!mounted || !confirmed) return;

    setState(() {
      _groups = _groups
          .map((group) {
            if (group.id != groupId) return group;
            final nextItems = group.items
                .where((item) => item.id != itemId)
                .toList();
            return group.copyWith(
              items: nextItems.isNotEmpty
                  ? nextItems
                  : [_ManifestItemDraft.create()],
            );
          })
          .toList(growable: false);
    });
  }

  void _replaceItem(String groupId, _ManifestItemDraft nextItem) {
    final groupIndex = _groups.indexWhere((group) => group.id == groupId);
    if (groupIndex < 0) return;
    final group = _groups[groupIndex];
    final itemIndex = group.items.indexWhere((item) => item.id == nextItem.id);
    if (itemIndex < 0 || group.items[itemIndex] == nextItem) return;

    final nextItems = [...group.items];
    nextItems[itemIndex] = nextItem;
    final nextGroups = [..._groups];
    nextGroups[groupIndex] = group.copyWith(items: nextItems);

    setState(() {
      _groups = nextGroups;
    });
  }

  Future<void> _openItemEditor(String groupId, String itemId) async {
    FocusManager.instance.primaryFocus?.unfocus();
    final item = _findItem(groupId, itemId);
    if (item == null) return;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _ManifestItemEditorSheet(
        initialItem: item,
        customerProducts: widget.customerProducts,
        normalizePatch: _normalizeManifestItemPatch,
        applyCustomerProduct: _applyCustomerProductToDraft,
        onSave: (nextItem) => _replaceItem(groupId, nextItem),
      ),
    );
  }

  _ManifestItemDraft _applyCustomerProductToDraft(
    _ManifestItemDraft currentItem,
    String? customerProductRef,
  ) {
    final selectedProduct = widget.customerProducts.firstWhere(
      (product) => product.id == customerProductRef,
      orElse: () =>
          const CustomerProductOption(id: '', customerRef: '', name: ''),
    );
    if (selectedProduct.id.isEmpty) {
      return currentItem.copyWith(customerProductRef: '');
    }

    final currentQty = currentItem.qtyKoliValue;
    final nextQty = currentQty > 0
        ? currentQty
        : (selectedProduct.defaultQtyKoli ?? 0);
    final nextWeightUnit = (selectedProduct.defaultWeightInputUnit ?? 'KG')
        .toUpperCase();
    final weightPerKoliKg = _productWeightPerKoliKg(selectedProduct);
    final nextWeightValue = nextQty > 0 && weightPerKoliKg > 0
        ? _convertKgToWeightInputValue(
            weightPerKoliKg * nextQty,
            nextWeightUnit,
          )
        : 0.0;
    final nextVolumeUnit = (selectedProduct.defaultVolumeInputUnit ?? 'M3')
        .toUpperCase();
    final nextVolumeValue =
        selectedProduct.defaultVolumeInputValue ??
        _convertM3ToVolumeInputValue(
          selectedProduct.defaultVolume ?? 0,
          nextVolumeUnit,
        );

    return currentItem.copyWith(
      customerProductRef: selectedProduct.id,
      description: (selectedProduct.description ?? selectedProduct.name).trim(),
      qtyKoli: _formatNumber(nextQty, fractionDigits: 0),
      weightInputValue: _formatNumber(
        nextWeightValue,
        fractionDigits: mobileWeightInputFractionDigits(nextWeightUnit),
      ),
      weightInputUnit: nextWeightUnit,
      volumeInputValue: _formatNumber(
        nextVolumeValue,
        fractionDigits: mobileVolumeInputFractionDigits(nextVolumeUnit),
      ),
      volumeInputUnit: nextVolumeUnit,
    );
  }

  _ManifestItemDraft _normalizeManifestItemPatch(
    _ManifestItemDraft item, {
    String? customerProductRef,
    String? description,
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  }) {
    if (weightInputValue != null &&
        customerProductRef == null &&
        qtyKoli == null &&
        weightInputUnit == null &&
        _shouldLockWeight(item)) {
      return item;
    }

    var patched = item.copyWith(
      customerProductRef: customerProductRef,
      description: description,
      qtyKoli: qtyKoli,
      weightInputValue: weightInputValue,
      weightInputUnit: weightInputUnit,
      volumeInputValue: volumeInputValue,
      volumeInputUnit: volumeInputUnit,
    );

    if (weightInputUnit != null && weightInputValue == null) {
      final currentWeightKg = _convertWeightToKg(
        item.weightInputValueNumber,
        item.weightInputUnit,
      );
      patched = patched.copyWith(
        weightInputValue: currentWeightKg > 0
            ? _formatNumber(
                _convertKgToWeightInputValue(currentWeightKg, weightInputUnit),
                fractionDigits: mobileWeightInputFractionDigits(
                  weightInputUnit,
                ),
              )
            : '',
      );
    }

    if (volumeInputUnit != null && volumeInputValue == null) {
      final currentVolumeM3 = _convertVolumeToM3(
        item.volumeInputValueNumber,
        item.volumeInputUnit,
      );
      patched = patched.copyWith(
        volumeInputValue: currentVolumeM3 > 0
            ? _formatNumber(
                _convertM3ToVolumeInputValue(currentVolumeM3, volumeInputUnit),
                fractionDigits: mobileVolumeInputFractionDigits(
                  volumeInputUnit,
                ),
              )
            : '',
      );
    }

    if (qtyKoli == null && weightInputUnit == null) {
      return patched;
    }

    final selectedProduct = widget.customerProducts.firstWhere(
      (product) => product.id == patched.customerProductRef,
      orElse: () =>
          const CustomerProductOption(id: '', customerRef: '', name: ''),
    );
    if (selectedProduct.id.isEmpty) {
      return patched;
    }

    final nextQty = patched.qtyKoliValue;
    final nextWeightUnit = patched.weightInputUnit.toUpperCase();
    final weightPerKoliKg = _productWeightBasisPerKoliKg(item, selectedProduct);
    if (nextQty <= 0 || weightPerKoliKg <= 0) {
      return patched.copyWith(weightInputValue: '');
    }

    return patched.copyWith(
      weightInputValue: _formatNumber(
        _convertKgToWeightInputValue(weightPerKoliKg * nextQty, nextWeightUnit),
        fractionDigits: mobileWeightInputFractionDigits(nextWeightUnit),
      ),
      weightInputUnit: nextWeightUnit,
    );
  }

  _ManifestItemDraft? _findItem(String groupId, String itemId) {
    for (final group in _groups) {
      if (group.id != groupId) continue;
      for (final item in group.items) {
        if (item.id == itemId) {
          return item;
        }
      }
    }
    return null;
  }

  bool _shouldLockWeight(_ManifestItemDraft item) {
    return item.isWeightLocked;
  }

  double _productWeightPerKoliKg(CustomerProductOption product) {
    final inputValue = product.defaultWeightInputValue ?? 0;
    if (inputValue > 0) {
      final weightInputUnit = (product.defaultWeightInputUnit ?? 'KG')
          .toUpperCase();
      return _convertWeightToKg(inputValue, weightInputUnit);
    }
    return product.defaultWeight ?? 0;
  }

  double _productWeightBasisPerKoliKg(
    _ManifestItemDraft currentItem,
    CustomerProductOption product,
  ) {
    final productWeightPerKoliKg = _productWeightPerKoliKg(product);
    if (productWeightPerKoliKg > 0) return productWeightPerKoliKg;

    final currentQty = currentItem.qtyKoliValue;
    final currentWeightKg = _convertWeightToKg(
      currentItem.weightInputValueNumber,
      currentItem.weightInputUnit,
    );
    if (currentQty <= 0 || currentWeightKg <= 0) return 0;
    return currentWeightKg / currentQty;
  }

  double _convertWeightToKg(double value, String unit) {
    return unit.toUpperCase() == 'TON' ? value * 1000 : value;
  }

  double _convertKgToWeightInputValue(double valueKg, String unit) {
    return unit.toUpperCase() == 'TON' ? valueKg / 1000 : valueKg;
  }

  double _convertVolumeToM3(double value, String unit) {
    return unit.toUpperCase() == 'LITER' ? value / 1000 : value;
  }

  double _convertM3ToVolumeInputValue(double valueM3, String unit) {
    return unit.toUpperCase() == 'LITER' ? valueM3 * 1000 : valueM3;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    final shipperReferences = <DriverManifestShipperReferenceInput>[];
    final cargoItems = <DriverManifestCargoItemInput>[];

    for (final group in _groups) {
      final referenceNumber = group.shipperReferenceNumber.trim().toUpperCase();
      final hasFilledItems = group.items.any((item) => item.isFilled);
      if (referenceNumber.isEmpty && !hasFilledItems) {
        continue;
      }
      if (referenceNumber.isEmpty) {
        _showError(
          'Nomor SJ pengirim wajib diisi untuk grup yang punya barang.',
        );
        return;
      }

      shipperReferences.add(
        DriverManifestShipperReferenceInput(
          referenceNumber: referenceNumber,
          key: group.referenceKey.trim().isNotEmpty
              ? group.referenceKey.trim()
              : null,
          pickupStopKey: group.pickupStopKey.trim().isNotEmpty
              ? group.pickupStopKey.trim()
              : null,
        ),
      );

      if (!widget.allowsDirectCargoInput) {
        continue;
      }

      for (final item in group.items.where((entry) => entry.isFilled)) {
        final description = item.description.trim();
        if (description.isEmpty) {
          _showError(
            'Deskripsi barang wajib diisi untuk semua barang yang dicatat.',
          );
          return;
        }
        if (!item.hasCargoMetric) {
          _showError(
            'Isi koli, berat, atau volume untuk semua barang yang dicatat.',
          );
          return;
        }

        final cargoInput = DriverManifestCargoItemInput(
          customerProductRef: item.customerProductRef.trim().isNotEmpty
              ? item.customerProductRef.trim()
              : null,
          description: description,
          qtyKoli: item.qtyKoliValue,
          weightInputValue: item.weightInputValueNumber,
          weightInputUnit: _normalizeWeightUnit(item.weightInputUnit),
          volumeInputValue: item.volumeInputValueNumber,
          volumeInputUnit: _normalizeVolumeUnit(item.volumeInputUnit),
          shipperReferenceNumber: referenceNumber,
          pickupStopKey: group.pickupStopKey.trim().isNotEmpty
              ? group.pickupStopKey.trim()
              : null,
        );
        if (item.sourceCargoItemId.trim().isNotEmpty) {
          continue;
        }
        cargoItems.add(cargoInput);
      }
    }

    if (shipperReferences.isEmpty) {
      _showError('Isi minimal satu nomor SJ pengirim.');
      return;
    }

    setState(() => _submitting = true);
    Navigator.of(context).pop(
      DeliveryManifestSubmitResult(
        shipperReferences: shipperReferences,
        cargoItems: cargoItems,
        updatedCargoItems: _buildUpdatedCargoItems(),
        deletedCargoItemIds: _buildDeletedCargoItemIds(),
      ),
    );
  }

  List<DeliveryManifestCargoItemUpdate> _buildUpdatedCargoItems() {
    if (!widget.allowsDirectCargoInput) return const [];
    final updates = <DeliveryManifestCargoItemUpdate>[];
    for (final group in _groups) {
      final referenceNumber = group.shipperReferenceNumber.trim().toUpperCase();
      for (final item in group.items.where((entry) => entry.isFilled)) {
        final sourceId = item.sourceCargoItemId.trim();
        if (sourceId.isEmpty) continue;
        updates.add(
          DeliveryManifestCargoItemUpdate(
            deliveryOrderItemId: sourceId,
            cargoItem: DriverManifestCargoItemInput(
              customerProductRef: item.customerProductRef.trim().isNotEmpty
                  ? item.customerProductRef.trim()
                  : null,
              description: item.description.trim(),
              qtyKoli: item.qtyKoliValue,
              weightInputValue: item.weightInputValueNumber,
              weightInputUnit: _normalizeWeightUnit(item.weightInputUnit),
              volumeInputValue: item.volumeInputValueNumber,
              volumeInputUnit: _normalizeVolumeUnit(item.volumeInputUnit),
              shipperReferenceNumber: referenceNumber,
              pickupStopKey: group.pickupStopKey.trim().isNotEmpty
                  ? group.pickupStopKey.trim()
                  : null,
            ),
          ),
        );
      }
    }
    return updates;
  }

  List<String> _buildDeletedCargoItemIds() {
    if (!widget.allowsDirectCargoInput) return const [];
    final originalIds = widget.existingCargoItems
        .map((item) => item.id.trim())
        .where((id) => id.isNotEmpty)
        .toSet();
    final retainedIds = _groups
        .expand((group) => group.items)
        .where((item) => item.isFilled)
        .map((item) => item.sourceCargoItemId.trim())
        .where((id) => id.isNotEmpty)
        .toSet();
    return originalIds.difference(retainedIds).toList(growable: false);
  }

  void _showError(String message) {
    showMobileFeedback(
      context,
      type: MobileFeedbackType.error,
      message: message,
    );
  }

  String _formatNumber(double? value, {int fractionDigits = 5}) {
    return formatMobileNumberValue(value, fractionDigits: fractionDigits);
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

  GlobalKey _groupVisibilityKey(String groupId) =>
      _draftVisibilityKeys.putIfAbsent('group:$groupId', () => GlobalKey());

  GlobalKey _itemVisibilityKey(String itemId) =>
      _draftVisibilityKeys.putIfAbsent('item:$itemId', () => GlobalKey());

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

  bool get _hasUnsavedChanges =>
      _draftFingerprint(_groups) != _initialDraftFingerprint;

  String _draftFingerprint(List<_ManifestGroupDraft> groups) {
    return jsonEncode(
      groups
          .map(
            (group) => {
              'referenceKey': group.referenceKey.trim(),
              'pickupStopKey': group.pickupStopKey.trim(),
              'shipperReferenceNumber': group.shipperReferenceNumber.trim(),
              'items': group.items
                  .map(
                    (item) => {
                      'sourceCargoItemId': item.sourceCargoItemId.trim(),
                      'customerProductRef': item.customerProductRef.trim(),
                      'description': item.description.trim(),
                      'qtyKoli': item.qtyKoli.trim(),
                      'weightInputValue': item.weightInputValue.trim(),
                      'weightInputUnit': item.weightInputUnit.trim(),
                      'volumeInputValue': item.volumeInputValue.trim(),
                      'volumeInputUnit': item.volumeInputUnit.trim(),
                    },
                  )
                  .toList(growable: false),
            },
          )
          .toList(growable: false),
    );
  }

  Future<void> _confirmLeaveWithUnsavedChanges() async {
    final shouldLeave = await showMobileActionConfirmation(
      context,
      title: 'Perubahan belum disimpan',
      message:
          'Keluar sekarang akan membuang perubahan SJ dan barang yang belum disimpan.',
      cancelLabel: 'Tetap Edit',
      confirmLabel: 'Keluar',
      icon: Icons.warning_amber_rounded,
      destructive: true,
    );
    if (!mounted || !shouldLeave) return;

    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final selectedGroup = _selectedGroup;

    return PopScope(
      canPop: _submitting || !_hasUnsavedChanges,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop || _submitting || !_hasUnsavedChanges) return;
        _confirmLeaveWithUnsavedChanges();
      },
      child: Scaffold(
        resizeToAvoidBottomInset: true,
        appBar: AppBar(title: Text(widget.title)),
        body: SafeArea(
          child: KeyedSubtree(
            key: _inputVisibilityKey,
            child: Form(
              key: _formKey,
              child: Column(
                children: [
                  Expanded(
                    child: ListView(
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                      children: [
                        if (widget.existingCargoItems.isNotEmpty) ...[
                          _InfoCard(
                            title: 'Muatan saat ini',
                            message:
                                '${widget.existingCargoItems.length} barang sudah tercatat. Tambahan dari halaman ini akan ditambahkan ke DO yang sama.',
                          ),
                          const SizedBox(height: 12),
                        ],
                        _InfoCard(
                          title: widget.allowsDirectCargoInput
                              ? 'Kelola SJ dan barang'
                              : 'Kelola SJ',
                          message: widget.allowsDirectCargoInput
                              ? 'Pilih satu SJ, lalu edit barang di dalamnya. Data baru dikirim setelah tombol simpan ditekan.'
                              : 'Edit nomor SJ sebelum approval/final; barang mengikuti order/resi admin.',
                        ),
                        const SizedBox(height: 16),
                        _ManifestGroupSelectorField(
                          groups: _groups,
                          selectedGroupId: selectedGroup?.id,
                          onChanged: _selectGroup,
                        ),
                        const SizedBox(height: 14),
                        if (selectedGroup != null)
                          Padding(
                            key: _groupVisibilityKey(selectedGroup.id),
                            padding: const EdgeInsets.only(bottom: 14),
                            child: _ManifestGroupEditorCard(
                              key: ValueKey(selectedGroup.id),
                              group: selectedGroup,
                              pickupStops: widget.pickupStops,
                              allowsDirectCargoInput:
                                  widget.allowsDirectCargoInput,
                              onGroupChanged: _updateGroup,
                              onAddItem: _addItem,
                              onEditItem: _openItemEditor,
                              onRemoveItem: _removeItem,
                              onRemoveGroup: _groups.length > 1
                                  ? _removeGroup
                                  : null,
                              itemVisibilityKeyFor: _itemVisibilityKey,
                            ),
                          ),
                        const SizedBox(height: 4),
                        OutlinedButton.icon(
                          onPressed: _submitting ? null : _addGroup,
                          icon: const Icon(Icons.add_rounded),
                          label: const Text('Tambah SJ'),
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
                              : const Icon(Icons.save_rounded),
                          label: Text(widget.submitLabel),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class DeliveryManifestSubmitResult {
  const DeliveryManifestSubmitResult({
    required this.shipperReferences,
    required this.cargoItems,
    this.updatedCargoItems = const [],
    this.deletedCargoItemIds = const [],
  });

  final List<DriverManifestShipperReferenceInput> shipperReferences;
  final List<DriverManifestCargoItemInput> cargoItems;
  final List<DeliveryManifestCargoItemUpdate> updatedCargoItems;
  final List<String> deletedCargoItemIds;
}

class DeliveryManifestCargoItemUpdate {
  const DeliveryManifestCargoItemUpdate({
    required this.deliveryOrderItemId,
    required this.cargoItem,
  });

  final String deliveryOrderItemId;
  final DriverManifestCargoItemInput cargoItem;
}

class _ManifestGroupDraft {
  const _ManifestGroupDraft({
    required this.id,
    required this.referenceKey,
    required this.pickupStopKey,
    required this.shipperReferenceNumber,
    required this.items,
  });

  final String id;
  final String referenceKey;
  final String pickupStopKey;
  final String shipperReferenceNumber;
  final List<_ManifestItemDraft> items;

  factory _ManifestGroupDraft.create(
    String pickupStopKey, {
    String initialReferenceKey = '',
    String initialReferenceNumber = '',
    List<_ManifestItemDraft> initialItems = const [],
    bool createBlankItem = true,
  }) {
    return _ManifestGroupDraft(
      id: UniqueKey().toString(),
      referenceKey: initialReferenceKey,
      pickupStopKey: pickupStopKey,
      shipperReferenceNumber: initialReferenceNumber,
      items: initialItems.isNotEmpty
          ? initialItems
          : (createBlankItem ? [_ManifestItemDraft.create()] : const []),
    );
  }

  _ManifestGroupDraft copyWith({
    String? referenceKey,
    String? pickupStopKey,
    String? shipperReferenceNumber,
    List<_ManifestItemDraft>? items,
  }) {
    return _ManifestGroupDraft(
      id: id,
      referenceKey: referenceKey ?? this.referenceKey,
      pickupStopKey: pickupStopKey ?? this.pickupStopKey,
      shipperReferenceNumber:
          shipperReferenceNumber ?? this.shipperReferenceNumber,
      items: items ?? this.items,
    );
  }
}

class _ManifestItemDraft {
  const _ManifestItemDraft({
    required this.id,
    required this.sourceCargoItemId,
    required this.customerProductRef,
    required this.description,
    required this.qtyKoli,
    required this.weightInputValue,
    required this.weightInputUnit,
    required this.volumeInputValue,
    required this.volumeInputUnit,
  });

  final String id;
  final String sourceCargoItemId;
  final String customerProductRef;
  final String description;
  final String qtyKoli;
  final String weightInputValue;
  final String weightInputUnit;
  final String volumeInputValue;
  final String volumeInputUnit;

  factory _ManifestItemDraft.create() {
    return const _ManifestItemDraft(
      id: '',
      sourceCargoItemId: '',
      customerProductRef: '',
      description: '',
      qtyKoli: '',
      weightInputValue: '',
      weightInputUnit: 'KG',
      volumeInputValue: '',
      volumeInputUnit: 'M3',
    )._withId();
  }

  factory _ManifestItemDraft.fromCargoItem(DeliveryCargoItem item) {
    final weightUnit = (item.weightInputUnit ?? 'KG').toUpperCase();
    final volumeUnit = (item.volumeInputUnit ?? 'M3').toUpperCase();
    return _ManifestItemDraft(
      id: '',
      sourceCargoItemId: item.id,
      customerProductRef: (item.customerProductRef ?? '').trim(),
      description: item.description,
      qtyKoli: _formatDraftNumber(item.qtyKoli, fractionDigits: 0),
      weightInputValue: _formatDraftNumber(
        item.weightInputValue ?? item.weightKg,
        fractionDigits: mobileWeightInputFractionDigits(weightUnit),
      ),
      weightInputUnit: weightUnit,
      volumeInputValue: _formatDraftNumber(
        item.volumeInputValue ?? item.volumeM3,
        fractionDigits: mobileVolumeInputFractionDigits(volumeUnit),
      ),
      volumeInputUnit: volumeUnit,
    )._withId();
  }

  _ManifestItemDraft _withId() {
    return _ManifestItemDraft(
      id: id.isNotEmpty ? id : UniqueKey().toString(),
      sourceCargoItemId: sourceCargoItemId,
      customerProductRef: customerProductRef,
      description: description,
      qtyKoli: qtyKoli,
      weightInputValue: weightInputValue,
      weightInputUnit: weightInputUnit,
      volumeInputValue: volumeInputValue,
      volumeInputUnit: volumeInputUnit,
    );
  }

  bool get isFilled =>
      customerProductRef.trim().isNotEmpty ||
      description.trim().isNotEmpty ||
      qtyKoliValue > 0 ||
      weightInputValueNumber > 0 ||
      volumeInputValueNumber > 0;

  bool get hasCargoMetric =>
      qtyKoliValue > 0 ||
      weightInputValueNumber > 0 ||
      volumeInputValueNumber > 0;

  bool get isWeightLocked =>
      customerProductRef.trim().isNotEmpty &&
      qtyKoliValue > 0 &&
      weightInputValueNumber > 0;

  double get qtyKoliValue => parseMobileNumberInput(qtyKoli);
  double get weightInputValueNumber => parseMobileNumberInput(weightInputValue);
  double get volumeInputValueNumber => parseMobileNumberInput(volumeInputValue);

  _ManifestItemDraft copyWith({
    String? customerProductRef,
    String? description,
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  }) {
    return _ManifestItemDraft(
      id: id,
      sourceCargoItemId: sourceCargoItemId,
      customerProductRef: customerProductRef ?? this.customerProductRef,
      description: description ?? this.description,
      qtyKoli: qtyKoli ?? this.qtyKoli,
      weightInputValue: weightInputValue ?? this.weightInputValue,
      weightInputUnit: weightInputUnit ?? this.weightInputUnit,
      volumeInputValue: volumeInputValue ?? this.volumeInputValue,
      volumeInputUnit: volumeInputUnit ?? this.volumeInputUnit,
    );
  }
}

String _formatDraftNumber(double? value, {int fractionDigits = 5}) {
  return formatMobileNumberValue(value, fractionDigits: fractionDigits);
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

class _ManifestGroupSelectorField extends StatelessWidget {
  const _ManifestGroupSelectorField({
    required this.groups,
    required this.selectedGroupId,
    required this.onChanged,
  });

  final List<_ManifestGroupDraft> groups;
  final String? selectedGroupId;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final selectedGroup = groups.firstWhere(
      (group) => group.id == selectedGroupId,
      orElse: () => groups.isNotEmpty
          ? groups.first
          : _ManifestGroupDraft.create('', createBlankItem: false),
    );

    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: groups.length > 1 ? () => _openPicker(context) : null,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: 'Pilih Surat Jalan',
          helperText: groups.length > 1
              ? '${groups.length} SJ tersedia. Pilih SJ yang mau diedit.'
              : 'Satu SJ tersedia.',
          suffixIcon: groups.length > 1
              ? const Icon(Icons.expand_more_rounded)
              : null,
        ),
        child: Text(
          _manifestGroupPickerLabel(selectedGroup),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.bodyLarge,
        ),
      ),
    );
  }

  Future<void> _openPicker(BuildContext context) async {
    FocusManager.instance.primaryFocus?.unfocus();
    final selectedId = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Pilih Surat Jalan',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                Flexible(
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: groups.length,
                    separatorBuilder: (context, index) =>
                        const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final group = groups[index];
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.description_outlined),
                        title: Text(_manifestGroupPickerLabel(group)),
                        subtitle: Text(_manifestGroupSummary(group)),
                        trailing: group.id == selectedGroupId
                            ? const Icon(Icons.check_rounded)
                            : null,
                        onTap: () => Navigator.of(context).pop(group.id),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
    if (selectedId != null && selectedId != selectedGroupId) {
      onChanged(selectedId);
    }
  }
}

class _ManifestGroupEditorCard extends StatelessWidget {
  const _ManifestGroupEditorCard({
    super.key,
    required this.group,
    required this.pickupStops,
    required this.allowsDirectCargoInput,
    required this.onGroupChanged,
    required this.onAddItem,
    required this.onEditItem,
    required this.onRemoveItem,
    required this.onRemoveGroup,
    required this.itemVisibilityKeyFor,
  });

  final _ManifestGroupDraft group;
  final List<DeliveryPickupStop> pickupStops;
  final bool allowsDirectCargoInput;
  final void Function(
    String groupId, {
    String? pickupStopKey,
    String? shipperReferenceNumber,
  })
  onGroupChanged;
  final void Function(String groupId) onAddItem;
  final void Function(String groupId, String itemId) onEditItem;
  final void Function(String groupId, String itemId) onRemoveItem;
  final void Function(String groupId)? onRemoveGroup;
  final GlobalKey Function(String itemId) itemVisibilityKeyFor;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'SJ Pengirim',
                    style: TextStyle(
                      color: scheme.onSurface,
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                    ),
                  ),
                ),
                if (onRemoveGroup != null)
                  IconButton(
                    onPressed: () => onRemoveGroup!(group.id),
                    icon: const Icon(Icons.delete_outline_rounded),
                    tooltip: 'Hapus SJ',
                  ),
              ],
            ),
            _SyncedTextFormField(
              value: group.shipperReferenceNumber,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                labelText: 'No. SJ Pengirim',
                hintText: 'Contoh: BK/27032026/001',
              ),
              validator: (_) => null,
              onChanged: (value) =>
                  onGroupChanged(group.id, shipperReferenceNumber: value),
            ),
            const SizedBox(height: 12),
            _PickupStopSelectorField(
              key: ValueKey('pickup-${group.id}-${group.pickupStopKey}'),
              value: group.pickupStopKey,
              pickupStops: pickupStops,
              onChanged: (value) =>
                  onGroupChanged(group.id, pickupStopKey: value),
            ),
            const SizedBox(height: 12),
            if (allowsDirectCargoInput) ...[
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Barang di SJ ini',
                      style: TextStyle(
                        color: scheme.onSurface,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  Text(
                    _manifestGroupSummary(group),
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.62),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              ...group.items.map(
                (item) => Padding(
                  key: itemVisibilityKeyFor(item.id),
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _ManifestItemListTile(
                    item: item,
                    onEdit: () => onEditItem(group.id, item.id),
                    onRemove: group.items.length > 1
                        ? () => onRemoveItem(group.id, item.id)
                        : null,
                  ),
                ),
              ),
              OutlinedButton.icon(
                onPressed: () => onAddItem(group.id),
                icon: const Icon(Icons.add_rounded),
                label: const Text('Tambah Barang di SJ Ini'),
              ),
            ] else
              _InfoCard(
                title: 'Barang mengikuti order',
                message:
                    'Untuk trip ini, driver cukup mengisi nomor SJ. Barang utama tetap mengikuti order/resi yang sudah ditetapkan admin.',
              ),
          ],
        ),
      ),
    );
  }
}

String _manifestGroupPickerLabel(_ManifestGroupDraft group) {
  final referenceNumber = group.shipperReferenceNumber.trim();
  final title = referenceNumber.isNotEmpty ? referenceNumber : 'SJ baru';
  return '$title - ${group.items.length} barang';
}

String _manifestGroupSummary(_ManifestGroupDraft group) {
  final filledCount = group.items.where((item) => item.isFilled).length;
  return '$filledCount/${group.items.length} terisi';
}

class _PickupStopSelectorField extends StatelessWidget {
  const _PickupStopSelectorField({
    super.key,
    required this.value,
    required this.pickupStops,
    required this.onChanged,
  });

  final String value;
  final List<DeliveryPickupStop> pickupStops;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    if (pickupStops.isEmpty) {
      return InputDecorator(
        decoration: const InputDecoration(
          labelText: 'Pickup untuk SJ ini',
          enabled: false,
        ),
        child: Text(
          'Pickup belum tersedia',
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
            color: Theme.of(context).disabledColor,
          ),
        ),
      );
    }

    final selectedStop = pickupStops.firstWhere(
      (stop) => stop.key == value,
      orElse: () => pickupStops.first,
    );
    final canChoose = pickupStops.length > 1;

    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: canChoose ? () => _openPicker(context, selectedStop) : null,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: canChoose ? 'Pickup untuk SJ ini' : 'Pickup trip',
          helperText: _pickupStopSubtitle(selectedStop),
          helperMaxLines: 2,
          suffixIcon: canChoose ? const Icon(Icons.expand_more_rounded) : null,
        ),
        child: Text(
          _pickupStopTitle(selectedStop),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.bodyLarge,
        ),
      ),
    );
  }

  Future<void> _openPicker(
    BuildContext context,
    DeliveryPickupStop selectedStop,
  ) async {
    FocusManager.instance.primaryFocus?.unfocus();
    final selectedKey = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Pilih Pickup untuk SJ Ini',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                ...pickupStops.map(
                  (stop) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(_pickupStopTitle(stop)),
                    subtitle: _pickupStopSubtitle(stop) == null
                        ? null
                        : Text(_pickupStopSubtitle(stop)!),
                    trailing: stop.key == selectedStop.key
                        ? const Icon(Icons.check_rounded)
                        : null,
                    onTap: () => Navigator.of(context).pop(stop.key),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
    if (selectedKey != null && selectedKey != selectedStop.key) {
      onChanged(selectedKey);
    }
  }
}

String _pickupStopTitle(DeliveryPickupStop stop) {
  final label = stop.displayLabel.trim();
  final address = stop.pickupAddress.trim();
  if (label.isNotEmpty) return label;
  if (address.isNotEmpty) return address;
  return 'Pickup';
}

String? _pickupStopSubtitle(DeliveryPickupStop stop) {
  final title = _pickupStopTitle(stop).toLowerCase();
  final address = stop.pickupAddress.trim();
  if (address.isEmpty || address.toLowerCase() == title) return null;
  return address;
}

List<CustomerProductOption> _dedupeCustomerProducts(
  List<CustomerProductOption> products,
) {
  final seenIds = <String>{};
  final result = <CustomerProductOption>[];
  for (final product in products) {
    final id = product.id.trim();
    if (id.isEmpty || !seenIds.add(id)) continue;
    result.add(product);
  }
  return result;
}

CustomerProductOption? _findCustomerProductById(
  List<CustomerProductOption> products,
  String value,
) {
  final selectedId = value.trim();
  if (selectedId.isEmpty) return null;
  for (final product in products) {
    if (product.id == selectedId) return product;
  }
  return null;
}

class _CustomerProductSelectorField extends StatelessWidget {
  const _CustomerProductSelectorField({
    super.key,
    required this.value,
    required this.customerProducts,
    required this.onChanged,
  });

  final String value;
  final List<CustomerProductOption> customerProducts;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context) {
    final selectedProduct = _findCustomerProductById(customerProducts, value);

    if (customerProducts.isEmpty) {
      return InputDecorator(
        decoration: const InputDecoration(
          labelText: 'Barang Customer',
          enabled: false,
        ),
        child: Text(
          'Belum ada master barang',
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
            color: Theme.of(context).disabledColor,
          ),
        ),
      );
    }

    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: () => _openPicker(context),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: 'Barang Customer',
          helperText: selectedProduct == null
              ? 'Pilih dari master barang atau isi manual.'
              : _customerProductSubtitle(selectedProduct),
          helperMaxLines: 3,
          suffixIcon: const Icon(Icons.expand_more_rounded),
        ),
        child: Text(
          selectedProduct?.displayLabel ?? 'Pilih master barang',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
            color: selectedProduct == null
                ? Theme.of(context).hintColor
                : Theme.of(context).colorScheme.onSurface,
          ),
        ),
      ),
    );
  }

  Future<void> _openPicker(BuildContext context) async {
    FocusManager.instance.primaryFocus?.unfocus();
    final selectedId = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _CustomerProductPickerSheet(
        customerProducts: customerProducts,
        selectedProductId: value,
      ),
    );
    if (selectedId == null || selectedId == value) return;
    onChanged(selectedId);
  }
}

class _CustomerProductPickerSheet extends StatefulWidget {
  const _CustomerProductPickerSheet({
    required this.customerProducts,
    required this.selectedProductId,
  });

  final List<CustomerProductOption> customerProducts;
  final String selectedProductId;

  @override
  State<_CustomerProductPickerSheet> createState() =>
      _CustomerProductPickerSheetState();
}

class _CustomerProductPickerSheetState
    extends State<_CustomerProductPickerSheet> {
  late final TextEditingController _searchController;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _searchController = TextEditingController();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final normalizedQuery = _query.trim().toLowerCase();
    final filteredProducts = normalizedQuery.isEmpty
        ? widget.customerProducts
        : widget.customerProducts
              .where(
                (product) => _customerProductSearchText(
                  product,
                ).contains(normalizedQuery),
              )
              .toList(growable: false);
    final selectedId = widget.selectedProductId.trim();

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: FractionallySizedBox(
        heightFactor: 0.86,
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Pilih Barang Customer',
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close_rounded),
                      tooltip: 'Tutup',
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _searchController,
                  decoration: const InputDecoration(
                    labelText: 'Cari master barang',
                    prefixIcon: Icon(Icons.search_rounded),
                  ),
                  textInputAction: TextInputAction.search,
                  onChanged: (value) => setState(() => _query = value),
                ),
                const SizedBox(height: 12),
                Expanded(
                  child: ListView.separated(
                    keyboardDismissBehavior:
                        ScrollViewKeyboardDismissBehavior.onDrag,
                    itemCount: filteredProducts.length + 1,
                    separatorBuilder: (context, index) =>
                        const Divider(height: 1),
                    itemBuilder: (context, index) {
                      if (index == 0) {
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const Icon(Icons.edit_note_rounded),
                          title: const Text('Tanpa master barang'),
                          subtitle: const Text(
                            'Isi deskripsi, koli, berat, dan volume manual.',
                          ),
                          trailing: selectedId.isEmpty
                              ? const Icon(Icons.check_rounded)
                              : null,
                          onTap: () => Navigator.of(context).pop(''),
                        );
                      }

                      final product = filteredProducts[index - 1];
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(
                          Icons.inventory_2_outlined,
                          color: scheme.primary,
                        ),
                        title: Text(product.displayLabel),
                        subtitle: _customerProductSubtitle(product) == null
                            ? null
                            : Text(_customerProductSubtitle(product)!),
                        trailing: product.id == selectedId
                            ? const Icon(Icons.check_rounded)
                            : null,
                        onTap: () => Navigator.of(context).pop(product.id),
                      );
                    },
                  ),
                ),
                if (filteredProducts.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'Master barang tidak ditemukan.',
                      style: TextStyle(
                        color: scheme.onSurface.withValues(alpha: 0.64),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String _customerProductSearchText(CustomerProductOption product) {
  return [
    product.code,
    product.name,
    product.description,
    _customerProductMetrics(product),
  ].whereType<String>().join(' ').toLowerCase();
}

String? _customerProductSubtitle(CustomerProductOption product) {
  final description = (product.description ?? '').trim();
  final metrics = _customerProductMetrics(product);
  final parts = <String>[];
  if (description.isNotEmpty && description != product.name.trim()) {
    parts.add(description);
  }
  if (metrics != null) {
    parts.add(metrics);
  }
  if (parts.isEmpty) return null;
  return parts.join('\n');
}

String? _customerProductMetrics(CustomerProductOption product) {
  final parts = <String>[];
  final qty = _formatDraftNumber(product.defaultQtyKoli);
  if (qty.isNotEmpty) {
    parts.add('Koli $qty');
  }

  final weightValue = product.defaultWeightInputValue ?? product.defaultWeight;
  final weight = _formatDraftNumber(weightValue);
  if (weight.isNotEmpty) {
    parts.add(
      'Berat $weight ${(product.defaultWeightInputUnit ?? 'KG').toUpperCase()}',
    );
  }

  final volumeValue = product.defaultVolumeInputValue ?? product.defaultVolume;
  final volume = _formatDraftNumber(volumeValue);
  if (volume.isNotEmpty) {
    parts.add(
      'Volume $volume '
      '${(product.defaultVolumeInputUnit ?? 'M3').toUpperCase()}',
    );
  }

  if (parts.isEmpty) return null;
  return parts.join(' | ');
}

class _ManifestItemListTile extends StatelessWidget {
  const _ManifestItemListTile({
    required this.item,
    required this.onEdit,
    required this.onRemove,
  });

  final _ManifestItemDraft item;
  final VoidCallback onEdit;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final title = item.description.trim().isNotEmpty
        ? item.description.trim()
        : 'Barang belum diisi';
    final summary = _manifestItemMetricSummary(item);
    final isFilled = item.isFilled;

    return Material(
      color: scheme.surface,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onEdit,
        child: Container(
          padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: scheme.outline.withValues(alpha: 0.26)),
          ),
          child: Row(
            children: [
              Icon(
                isFilled
                    ? Icons.inventory_2_outlined
                    : Icons.inventory_2_rounded,
                color: isFilled
                    ? scheme.primary
                    : scheme.onSurface.withValues(alpha: 0.46),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: scheme.onSurface,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      summary,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: scheme.onSurface.withValues(alpha: 0.64),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                onPressed: onEdit,
                icon: const Icon(Icons.edit_outlined),
                tooltip: 'Edit barang',
              ),
              if (onRemove != null)
                IconButton(
                  onPressed: onRemove,
                  icon: const Icon(Icons.remove_circle_outline_rounded),
                  tooltip: 'Hapus barang',
                ),
            ],
          ),
        ),
      ),
    );
  }
}

String _manifestItemMetricSummary(_ManifestItemDraft item) {
  final parts = <String>[];
  if (item.qtyKoliValue > 0) {
    parts.add(
      '${_formatDraftNumber(item.qtyKoliValue, fractionDigits: 0)} koli',
    );
  }
  if (item.weightInputValueNumber > 0) {
    parts.add(
      '${_formatDraftNumber(item.weightInputValueNumber, fractionDigits: mobileWeightInputFractionDigits(item.weightInputUnit))} ${_normalizeWeightUnit(item.weightInputUnit)}',
    );
  }
  if (item.volumeInputValueNumber > 0) {
    parts.add(
      '${_formatDraftNumber(item.volumeInputValueNumber, fractionDigits: mobileVolumeInputFractionDigits(item.volumeInputUnit))} ${_normalizeVolumeUnit(item.volumeInputUnit)}',
    );
  }
  return parts.isEmpty ? 'Belum ada koli / berat / volume' : parts.join(' / ');
}

class _ManifestItemEditorSheet extends StatefulWidget {
  const _ManifestItemEditorSheet({
    required this.initialItem,
    required this.customerProducts,
    required this.normalizePatch,
    required this.applyCustomerProduct,
    required this.onSave,
  });

  final _ManifestItemDraft initialItem;
  final List<CustomerProductOption> customerProducts;
  final _ManifestItemDraft Function(
    _ManifestItemDraft item, {
    String? customerProductRef,
    String? description,
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  })
  normalizePatch;
  final _ManifestItemDraft Function(
    _ManifestItemDraft item,
    String? customerProductRef,
  )
  applyCustomerProduct;
  final ValueChanged<_ManifestItemDraft> onSave;

  @override
  State<_ManifestItemEditorSheet> createState() =>
      _ManifestItemEditorSheetState();
}

class _ManifestItemEditorSheetState extends State<_ManifestItemEditorSheet> {
  late _ManifestItemDraft _draft;

  @override
  void initState() {
    super.initState();
    _draft = widget.initialItem;
  }

  void _patch({
    String? customerProductRef,
    String? description,
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  }) {
    setState(() {
      _draft = widget.normalizePatch(
        _draft,
        customerProductRef: customerProductRef,
        description: description,
        qtyKoli: qtyKoli,
        weightInputValue: weightInputValue,
        weightInputUnit: weightInputUnit,
        volumeInputValue: volumeInputValue,
        volumeInputUnit: volumeInputUnit,
      );
    });
  }

  void _saveAndClose() {
    FocusManager.instance.primaryFocus?.unfocus();
    widget.onSave(_draft);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: FractionallySizedBox(
        heightFactor: 0.9,
        child: SafeArea(
          top: false,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 8, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Edit Barang',
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w800),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close_rounded),
                      tooltip: 'Tutup',
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                  children: [
                    _ManifestItemCard(
                      item: _draft,
                      customerProducts: widget.customerProducts,
                      onChanged:
                          ({
                            customerProductRef,
                            description,
                            qtyKoli,
                            weightInputValue,
                            weightInputUnit,
                            volumeInputValue,
                            volumeInputUnit,
                          }) => _patch(
                            customerProductRef: customerProductRef,
                            description: description,
                            qtyKoli: qtyKoli,
                            weightInputValue: weightInputValue,
                            weightInputUnit: weightInputUnit,
                            volumeInputValue: volumeInputValue,
                            volumeInputUnit: volumeInputUnit,
                          ),
                      onProductSelected: (value) {
                        setState(() {
                          _draft = widget.applyCustomerProduct(_draft, value);
                        });
                      },
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _saveAndClose,
                    icon: Icon(Icons.save_rounded, color: scheme.onPrimary),
                    label: const Text('Simpan Barang'),
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

class _ManifestItemCard extends StatelessWidget {
  const _ManifestItemCard({
    required this.item,
    required this.customerProducts,
    required this.onChanged,
    required this.onProductSelected,
  });

  final _ManifestItemDraft item;
  final List<CustomerProductOption> customerProducts;
  final void Function({
    String? customerProductRef,
    String? description,
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  })
  onChanged;
  final ValueChanged<String?> onProductSelected;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final customerProductOptions = _dedupeCustomerProducts(customerProducts);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: scheme.outline.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'Barang',
                style: TextStyle(
                  color: scheme.onSurface,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          _CustomerProductSelectorField(
            key: ValueKey('productSelector-${item.id}'),
            value: item.customerProductRef,
            customerProducts: customerProductOptions,
            onChanged: onProductSelected,
          ),
          const SizedBox(height: 12),
          _SyncedTextFormField(
            value: item.description,
            decoration: const InputDecoration(
              labelText: 'Deskripsi Barang',
              hintText: 'Mis. Keramik / Oli Diesel / Beras 50 Kg',
            ),
            onChanged: (value) => onChanged(description: value),
          ),
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, constraints) {
              Widget qtyField() {
                return _SyncedTextFormField(
                  value: item.qtyKoli,
                  keyboardType: mobileNumberKeyboardType(0),
                  inputFormatters: mobileNumberInputFormatters(0),
                  decoration: const InputDecoration(labelText: 'Koli'),
                  onChanged: (value) => onChanged(qtyKoli: value),
                );
              }

              Widget weightField() {
                final fractionDigits = mobileWeightInputFractionDigits(
                  item.weightInputUnit,
                );
                return _SyncedTextFormField(
                  value: item.weightInputValue,
                  keyboardType: mobileNumberKeyboardType(fractionDigits),
                  inputFormatters: mobileNumberInputFormatters(fractionDigits),
                  decoration: const InputDecoration(labelText: 'Berat'),
                  enabled: !item.isWeightLocked,
                  onChanged: (value) => onChanged(weightInputValue: value),
                );
              }

              Widget weightUnitField() {
                final selectedUnit = _normalizeWeightUnit(item.weightInputUnit);
                return MobileUnitSelectorField(
                  key: ValueKey('unitWeight-${item.id}'),
                  value: selectedUnit,
                  options: const ['KG', 'TON'],
                  onChanged: (value) => onChanged(weightInputUnit: value),
                );
              }

              if (constraints.maxWidth < 360) {
                return Column(
                  children: [
                    qtyField(),
                    const SizedBox(height: 12),
                    weightField(),
                    const SizedBox(height: 12),
                    weightUnitField(),
                  ],
                );
              }

              return Row(
                children: [
                  Expanded(child: qtyField()),
                  const SizedBox(width: 10),
                  Expanded(flex: 2, child: weightField()),
                  const SizedBox(width: 10),
                  SizedBox(width: 90, child: weightUnitField()),
                ],
              );
            },
          ),
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, constraints) {
              Widget volumeField() {
                final fractionDigits = mobileVolumeInputFractionDigits(
                  item.volumeInputUnit,
                );
                return _SyncedTextFormField(
                  value: item.volumeInputValue,
                  keyboardType: mobileNumberKeyboardType(fractionDigits),
                  inputFormatters: mobileNumberInputFormatters(fractionDigits),
                  decoration: const InputDecoration(labelText: 'Volume'),
                  onChanged: (value) => onChanged(volumeInputValue: value),
                );
              }

              Widget volumeUnitField() {
                final selectedUnit = _normalizeVolumeUnit(item.volumeInputUnit);
                return MobileUnitSelectorField(
                  key: ValueKey('unitVolume-${item.id}'),
                  value: selectedUnit,
                  options: const ['M3', 'LITER', 'KL'],
                  onChanged: (value) => onChanged(volumeInputUnit: value),
                );
              }

              if (constraints.maxWidth < 360) {
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
                  Expanded(flex: 2, child: volumeField()),
                  const SizedBox(width: 10),
                  SizedBox(width: 100, child: volumeUnitField()),
                ],
              );
            },
          ),
        ],
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
    this.inputFormatters,
    this.textCapitalization = TextCapitalization.none,
    this.validator,
    this.enabled = true,
  });

  final String value;
  final InputDecoration decoration;
  final ValueChanged<String> onChanged;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final TextCapitalization textCapitalization;
  final FormFieldValidator<String>? validator;
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
      textCapitalization: widget.textCapitalization,
      decoration: widget.decoration,
      enabled: widget.enabled,
      scrollPadding: _mobileInputScrollPadding,
      validator: widget.validator,
      onChanged: widget.onChanged,
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.title, required this.message});

  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              color: scheme.onSurface,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            message,
            style: TextStyle(
              color: scheme.onSurface.withValues(alpha: 0.7),
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}
