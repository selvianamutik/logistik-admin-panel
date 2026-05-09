import 'package:flutter/material.dart';

import '../data/delivery_order_service.dart';
import '../domain/models.dart';

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

class _DeliveryManifestPageState extends State<DeliveryManifestPage> {
  final _formKey = GlobalKey<FormState>();
  bool _submitting = false;
  late List<_ManifestGroupDraft> _groups;

  @override
  void initState() {
    super.initState();
    _groups = _buildInitialGroups();
  }

  List<_ManifestGroupDraft> _buildInitialGroups() {
    final defaultPickupStopKey = widget.pickupStops.isNotEmpty
        ? widget.pickupStops.first.key
        : '';
    if (widget.initialShipperReferences.isEmpty) {
      return [_ManifestGroupDraft.create(defaultPickupStopKey)];
    }

    return widget.initialShipperReferences
        .map(
          (reference) => _ManifestGroupDraft.create(
            reference.pickupStopKey?.trim().isNotEmpty == true
                ? reference.pickupStopKey!
                : defaultPickupStopKey,
            initialReferenceNumber: reference.referenceNumber,
          ),
        )
        .toList(growable: true);
  }

  void _addGroup() {
    setState(() {
      _groups = [
        ..._groups,
        _ManifestGroupDraft.create(
          widget.pickupStops.isNotEmpty ? widget.pickupStops.first.key : '',
        ),
      ];
    });
  }

  void _removeGroup(String groupId) {
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
    });
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
    setState(() {
      _groups = _groups
          .map(
            (group) => group.id == groupId
                ? group.copyWith(
                    items: [...group.items, _ManifestItemDraft.create()],
                  )
                : group,
          )
          .toList(growable: false);
    });
  }

  void _removeItem(String groupId, String itemId) {
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

  void _updateItem(
    String groupId,
    String itemId, {
    String? customerProductRef,
    String? description,
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  }) {
    setState(() {
      _groups = _groups
          .map((group) {
            if (group.id != groupId) return group;
            return group.copyWith(
              items: group.items
                  .map(
                    (item) => item.id == itemId
                        ? _normalizeManifestItemPatch(
                            item,
                            customerProductRef: customerProductRef,
                            description: description,
                            qtyKoli: qtyKoli,
                            weightInputValue: weightInputValue,
                            weightInputUnit: weightInputUnit,
                            volumeInputValue: volumeInputValue,
                            volumeInputUnit: volumeInputUnit,
                          )
                        : item,
                  )
                  .toList(growable: false),
            );
          })
          .toList(growable: false);
    });
  }

  void _applyCustomerProduct(
    String groupId,
    String itemId,
    String? customerProductRef,
  ) {
    final selectedProduct = widget.customerProducts.firstWhere(
      (product) => product.id == customerProductRef,
      orElse: () =>
          const CustomerProductOption(id: '', customerRef: '', name: ''),
    );
    if (selectedProduct.id.isEmpty) {
      _updateItem(groupId, itemId, customerProductRef: '', description: '');
      return;
    }

    final currentItem = _findItem(groupId, itemId);
    final currentQty = currentItem?.qtyKoliValue ?? 0;
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

    _updateItem(
      groupId,
      itemId,
      customerProductRef: selectedProduct.id,
      description: (selectedProduct.description ?? selectedProduct.name).trim(),
      qtyKoli: _formatNumber(nextQty),
      weightInputValue: _formatNumber(nextWeightValue),
      weightInputUnit: nextWeightUnit,
      volumeInputValue: _formatNumber(
        selectedProduct.defaultVolumeInputValue ??
            selectedProduct.defaultVolume,
      ),
      volumeInputUnit: (selectedProduct.defaultVolumeInputUnit ?? 'M3')
          .toUpperCase(),
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

    final patched = item.copyWith(
      customerProductRef: customerProductRef,
      description: description,
      qtyKoli: qtyKoli,
      weightInputValue: weightInputValue,
      weightInputUnit: weightInputUnit,
      volumeInputValue: volumeInputValue,
      volumeInputUnit: volumeInputUnit,
    );

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
    final weightPerKoliKg = _productWeightPerKoliKg(selectedProduct);
    if (nextQty <= 0 || weightPerKoliKg <= 0) {
      return patched.copyWith(weightInputValue: '');
    }

    return patched.copyWith(
      weightInputValue: _formatNumber(
        _convertKgToWeightInputValue(weightPerKoliKg * nextQty, nextWeightUnit),
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

  double _convertWeightToKg(double value, String unit) {
    return unit.toUpperCase() == 'TON' ? value * 1000 : value;
  }

  double _convertKgToWeightInputValue(double valueKg, String unit) {
    return unit.toUpperCase() == 'TON' ? valueKg / 1000 : valueKg;
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

        cargoItems.add(
          DriverManifestCargoItemInput(
            customerProductRef: item.customerProductRef.trim().isNotEmpty
                ? item.customerProductRef.trim()
                : null,
            description: description,
            qtyKoli: item.qtyKoliValue,
            weightInputValue: item.weightInputValueNumber,
            weightInputUnit: item.weightInputUnit,
            volumeInputValue: item.volumeInputValueNumber,
            volumeInputUnit: item.volumeInputUnit,
            shipperReferenceNumber: referenceNumber,
            pickupStopKey: group.pickupStopKey.trim().isNotEmpty
                ? group.pickupStopKey.trim()
                : null,
          ),
        );
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
      ),
    );
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
  }

  String _formatNumber(double? value) {
    if (value == null || value <= 0) return '';
    if (value == value.roundToDouble()) {
      return value.toInt().toString();
    }
    return value
        .toStringAsFixed(5)
        .replaceFirst(RegExp(r'0+$'), '')
        .replaceFirst(RegExp(r'\.$'), '');
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              Expanded(
                child: ListView(
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
                          ? 'Satu trip bisa punya banyak SJ. Setiap SJ bisa punya banyak barang.'
                          : 'Order ini mengikuti item order/resi. Dari mobile, driver cukup isi nomor SJ dan pickup-nya.',
                    ),
                    const SizedBox(height: 16),
                    ..._groups.map(
                      (group) => Padding(
                        padding: const EdgeInsets.only(bottom: 14),
                        child: _ManifestGroupCard(
                          key: ValueKey(group.id),
                          group: group,
                          pickupStops: widget.pickupStops,
                          customerProducts: widget.customerProducts,
                          allowsDirectCargoInput: widget.allowsDirectCargoInput,
                          onGroupChanged: _updateGroup,
                          onItemChanged: _updateItem,
                          onProductSelected: _applyCustomerProduct,
                          onAddItem: _addItem,
                          onRemoveItem: _removeItem,
                          onRemoveGroup: _groups.length > 1
                              ? _removeGroup
                              : null,
                        ),
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
                        : const Icon(Icons.save_rounded),
                    label: Text(widget.submitLabel),
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

class DeliveryManifestSubmitResult {
  const DeliveryManifestSubmitResult({
    required this.shipperReferences,
    required this.cargoItems,
  });

  final List<DriverManifestShipperReferenceInput> shipperReferences;
  final List<DriverManifestCargoItemInput> cargoItems;
}

class _ManifestGroupDraft {
  const _ManifestGroupDraft({
    required this.id,
    required this.pickupStopKey,
    required this.shipperReferenceNumber,
    required this.items,
  });

  final String id;
  final String pickupStopKey;
  final String shipperReferenceNumber;
  final List<_ManifestItemDraft> items;

  factory _ManifestGroupDraft.create(
    String pickupStopKey, {
    String initialReferenceNumber = '',
  }) {
    return _ManifestGroupDraft(
      id: UniqueKey().toString(),
      pickupStopKey: pickupStopKey,
      shipperReferenceNumber: initialReferenceNumber,
      items: [_ManifestItemDraft.create()],
    );
  }

  _ManifestGroupDraft copyWith({
    String? pickupStopKey,
    String? shipperReferenceNumber,
    List<_ManifestItemDraft>? items,
  }) {
    return _ManifestGroupDraft(
      id: id,
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
    required this.customerProductRef,
    required this.description,
    required this.qtyKoli,
    required this.weightInputValue,
    required this.weightInputUnit,
    required this.volumeInputValue,
    required this.volumeInputUnit,
  });

  final String id;
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
      customerProductRef: '',
      description: '',
      qtyKoli: '',
      weightInputValue: '',
      weightInputUnit: 'KG',
      volumeInputValue: '',
      volumeInputUnit: 'M3',
    )._withId();
  }

  _ManifestItemDraft _withId() {
    return _ManifestItemDraft(
      id: id.isNotEmpty ? id : UniqueKey().toString(),
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

  bool get isWeightLocked =>
      customerProductRef.trim().isNotEmpty &&
      qtyKoliValue > 0 &&
      weightInputValueNumber > 0;

  double get qtyKoliValue => double.tryParse(qtyKoli.replaceAll(',', '.')) ?? 0;
  double get weightInputValueNumber =>
      double.tryParse(weightInputValue.replaceAll(',', '.')) ?? 0;
  double get volumeInputValueNumber =>
      double.tryParse(volumeInputValue.replaceAll(',', '.')) ?? 0;

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

class _ManifestGroupCard extends StatelessWidget {
  const _ManifestGroupCard({
    super.key,
    required this.group,
    required this.pickupStops,
    required this.customerProducts,
    required this.allowsDirectCargoInput,
    required this.onGroupChanged,
    required this.onItemChanged,
    required this.onProductSelected,
    required this.onAddItem,
    required this.onRemoveItem,
    required this.onRemoveGroup,
  });

  final _ManifestGroupDraft group;
  final List<DeliveryPickupStop> pickupStops;
  final List<CustomerProductOption> customerProducts;
  final bool allowsDirectCargoInput;
  final void Function(
    String groupId, {
    String? pickupStopKey,
    String? shipperReferenceNumber,
  })
  onGroupChanged;
  final void Function(
    String groupId,
    String itemId, {
    String? customerProductRef,
    String? description,
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  })
  onItemChanged;
  final void Function(String groupId, String itemId, String? customerProductRef)
  onProductSelected;
  final void Function(String groupId) onAddItem;
  final void Function(String groupId, String itemId) onRemoveItem;
  final void Function(String groupId)? onRemoveGroup;

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
                Text(
                  'SJ Pengirim',
                  style: TextStyle(
                    color: scheme.onSurface,
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
                const Spacer(),
                if (onRemoveGroup != null)
                  IconButton(
                    onPressed: () => onRemoveGroup!(group.id),
                    tooltip: 'Hapus SJ',
                    icon: const Icon(Icons.delete_outline_rounded),
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
            DropdownButtonFormField<String>(
              key: ValueKey('pickup-${group.id}-${group.pickupStopKey}'),
              isExpanded: true,
              initialValue:
                  pickupStops.any((stop) => stop.key == group.pickupStopKey)
                  ? group.pickupStopKey
                  : (pickupStops.isNotEmpty ? pickupStops.first.key : null),
              decoration: const InputDecoration(labelText: 'Titik Pickup'),
              items: pickupStops
                  .map(
                    (stop) => DropdownMenuItem(
                      value: stop.key,
                      child: Text(
                        '${stop.displayLabel} - ${stop.pickupAddress}',
                      ),
                    ),
                  )
                  .toList(growable: false),
              onChanged: pickupStops.isEmpty
                  ? null
                  : (value) =>
                        onGroupChanged(group.id, pickupStopKey: value ?? ''),
            ),
            const SizedBox(height: 12),
            if (allowsDirectCargoInput) ...[
              ...group.items.map(
                (item) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _ManifestItemCard(
                    key: ValueKey(item.id),
                    item: item,
                    customerProducts: customerProducts,
                    onChanged:
                        ({
                          customerProductRef,
                          description,
                          qtyKoli,
                          weightInputValue,
                          weightInputUnit,
                          volumeInputValue,
                          volumeInputUnit,
                        }) => onItemChanged(
                          group.id,
                          item.id,
                          customerProductRef: customerProductRef,
                          description: description,
                          qtyKoli: qtyKoli,
                          weightInputValue: weightInputValue,
                          weightInputUnit: weightInputUnit,
                          volumeInputValue: volumeInputValue,
                          volumeInputUnit: volumeInputUnit,
                        ),
                    onProductSelected: (value) =>
                        onProductSelected(group.id, item.id, value),
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

class _ManifestItemCard extends StatelessWidget {
  const _ManifestItemCard({
    super.key,
    required this.item,
    required this.customerProducts,
    required this.onChanged,
    required this.onProductSelected,
    this.onRemove,
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
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(16),
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
              const Spacer(),
              if (onRemove != null)
                IconButton(
                  onPressed: onRemove,
                  icon: const Icon(Icons.remove_circle_outline_rounded),
                  tooltip: 'Hapus barang',
                ),
            ],
          ),
          if (customerProducts.isNotEmpty) ...[
            DropdownButtonFormField<String>(
              key: ValueKey('product-${item.id}-${item.customerProductRef}'),
              isExpanded: true,
              initialValue: item.customerProductRef.isNotEmpty
                  ? item.customerProductRef
                  : null,
              decoration: const InputDecoration(
                labelText: 'Master Barang Customer',
              ),
              items: customerProducts
                  .map(
                    (product) => DropdownMenuItem(
                      value: product.id,
                      child: Text(product.displayLabel),
                    ),
                  )
                  .toList(growable: false),
              onChanged: onProductSelected,
            ),
            const SizedBox(height: 12),
          ],
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
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(labelText: 'Koli'),
                  onChanged: (value) => onChanged(qtyKoli: value),
                );
              }

              Widget weightField() {
                return _SyncedTextFormField(
                  value: item.weightInputValue,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(labelText: 'Berat'),
                  enabled: !item.isWeightLocked,
                  onChanged: (value) => onChanged(weightInputValue: value),
                );
              }

              Widget weightUnitField() {
                return DropdownButtonFormField<String>(
                  key: ValueKey(
                    'weight-unit-${item.id}-${item.weightInputUnit}',
                  ),
                  isExpanded: true,
                  initialValue: item.weightInputUnit,
                  decoration: const InputDecoration(labelText: 'Unit'),
                  items: const [
                    DropdownMenuItem(value: 'KG', child: Text('KG')),
                    DropdownMenuItem(value: 'TON', child: Text('TON')),
                  ],
                  onChanged: (value) =>
                      onChanged(weightInputUnit: value ?? item.weightInputUnit),
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
                return _SyncedTextFormField(
                  value: item.volumeInputValue,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(labelText: 'Volume'),
                  onChanged: (value) => onChanged(volumeInputValue: value),
                );
              }

              Widget volumeUnitField() {
                return DropdownButtonFormField<String>(
                  key: ValueKey(
                    'volume-unit-${item.id}-${item.volumeInputUnit}',
                  ),
                  isExpanded: true,
                  initialValue: item.volumeInputUnit,
                  decoration: const InputDecoration(labelText: 'Unit'),
                  items: const [
                    DropdownMenuItem(value: 'M3', child: Text('M3')),
                    DropdownMenuItem(value: 'LITER', child: Text('LITER')),
                    DropdownMenuItem(value: 'KL', child: Text('KL')),
                  ],
                  onChanged: (value) =>
                      onChanged(volumeInputUnit: value ?? item.volumeInputUnit),
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
    this.textCapitalization = TextCapitalization.none,
    this.validator,
    this.enabled = true,
  });

  final String value;
  final InputDecoration decoration;
  final ValueChanged<String> onChanged;
  final TextInputType? keyboardType;
  final TextCapitalization textCapitalization;
  final FormFieldValidator<String>? validator;
  final bool enabled;

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
      textCapitalization: widget.textCapitalization,
      decoration: widget.decoration,
      enabled: widget.enabled,
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
        borderRadius: BorderRadius.circular(14),
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
