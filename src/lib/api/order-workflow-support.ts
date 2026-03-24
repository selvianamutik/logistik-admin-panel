import {
    roundQuantity,
} from '@/lib/order-item-progress';
import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import { getSanityClient, sanityGetById } from '@/lib/sanity';
import type { DeliveryActualDropPoint, DeliveryActualDropType } from '@/lib/types';

import {
    isPlainObject,
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
} from './data-helpers';

export type OrderItemStatusSummary = {
    status?: string;
    qtyKoli?: number;
    weight?: number;
    volume?: number;
    deliveredQtyKoli?: number;
    deliveredWeight?: number;
    deliveredVolume?: number;
    assignedQtyKoli?: number;
    assignedWeight?: number;
    assignedVolume?: number;
    heldQtyKoli?: number;
    heldWeight?: number;
    heldVolume?: number;
};

type CustomerProductOrderSource = {
    _id: string;
    customerRef?: unknown;
    code?: string;
    name?: string;
    description?: string;
    defaultQtyKoli?: number;
    defaultWeight?: number;
    defaultWeightInputValue?: number;
    defaultWeightInputUnit?: WeightInputUnit;
    defaultVolume?: number;
    defaultVolumeInputValue?: number;
    defaultVolumeInputUnit?: VolumeInputUnit;
    active?: boolean;
};

export type NormalizedOrderItemInput = {
    id?: string;
    customerProductRef?: string;
    customerProductCode?: string;
    customerProductName?: string;
    description: string;
    qtyKoli: number;
    weight: number;
    volume?: number;
    weightInputValue?: number;
    weightInputUnit?: WeightInputUnit;
    volumeInputValue?: number;
    volumeInputUnit?: VolumeInputUnit;
    value?: number;
};

export type DeliveryOrderItemSelection = {
    orderItemRef: string;
    qtyKoli: number;
    weightInputValue?: number;
    weightInputUnit?: WeightInputUnit;
    volumeInputValue?: number;
    volumeInputUnit?: VolumeInputUnit;
    holdRemaining: boolean;
    holdReason?: string;
    holdLocation?: string;
};

export type OrderItemProgressSnapshot = {
    _id: string;
    orderRef?: unknown;
    description?: string;
    qtyKoli?: number;
    weight?: number;
    volume?: number;
    weightInputValue?: number;
    weightInputUnit?: WeightInputUnit;
    volumeInputValue?: number;
    volumeInputUnit?: VolumeInputUnit;
    status?: string;
    deliveredQtyKoli?: number;
    deliveredWeight?: number;
    deliveredVolume?: number;
    assignedQtyKoli?: number;
    assignedWeight?: number;
    assignedVolume?: number;
    heldQtyKoli?: number;
    heldWeight?: number;
    heldVolume?: number;
    holdReason?: string;
    holdLocation?: string;
};

export type DeliveryOrderItemCargoSnapshot = {
    _id: string;
    orderItemRef?: unknown;
    shippedQtyKoli?: number;
    shippedWeight?: number;
    orderItemQtyKoli?: number;
    orderItemWeight?: number;
    orderItemVolumeM3?: number;
    orderItemWeightInputValue?: number;
    orderItemWeightInputUnit?: WeightInputUnit;
    orderItemVolumeInputValue?: number;
    orderItemVolumeInputUnit?: VolumeInputUnit;
    actualQtyKoli?: number;
    actualWeightKg?: number;
    actualVolumeM3?: number;
    actualWeightInputValue?: number;
    actualWeightInputUnit?: WeightInputUnit;
    actualVolumeInputValue?: number;
    actualVolumeInputUnit?: VolumeInputUnit;
};

export type NormalizedActualCargoInput = {
    deliveryOrderItemRef: string;
    actualQtyKoli: number;
    actualWeightKg: number;
    actualWeightInputValue?: number;
    actualWeightInputUnit?: WeightInputUnit;
    actualVolumeM3?: number;
    actualVolumeInputValue?: number;
    actualVolumeInputUnit?: VolumeInputUnit;
};

export type NormalizedDeliveryActualDropPoint = DeliveryActualDropPoint & {
    _key: string;
};

export type ActualCargoTotals = {
    qtyKoli: number;
    weightKg: number;
    volumeM3: number;
};

export type ResolvedOrderPartyData = {
    customer: { _id: string; name?: string; address?: string; active?: boolean };
    serviceName?: string;
};

const DELIVERY_ACTUAL_DROP_TYPES = new Set<DeliveryActualDropType>([
    'DROP',
    'HOLD',
    'TRANSIT',
    'EXTRA_DROP',
    'RETURN',
]);

export const DO_STATUS_TRANSITIONS: Record<string, string[]> = {
    CREATED: ['HEADING_TO_PICKUP', 'ON_DELIVERY', 'CANCELLED'],
    HEADING_TO_PICKUP: ['ON_DELIVERY', 'CANCELLED'],
    ON_DELIVERY: ['ARRIVED', 'DELIVERED', 'CANCELLED'],
    ARRIVED: ['DELIVERED', 'CANCELLED'],
    DELIVERED: [],
    CANCELLED: [],
};

export const DRIVER_APPROVAL_REQUESTABLE_DO_STATUSES = new Set(['DELIVERED']);
export const DRIVER_STATUS_REQUEST_FIELDS = [
    'pendingDriverStatus',
    'pendingDriverStatusRequestedAt',
    'pendingDriverStatusRequestedBy',
    'pendingDriverStatusRequestedByName',
    'pendingDriverStatusNote',
];

export function getPeriodFromDate(value: string) {
    const normalized = normalizeText(value);
    const match = normalized.match(/^(\d{4})-(\d{2})-\d{2}$/);
    if (match) {
        return `${match[1]}${match[2]}`;
    }
    return new Date().toISOString().slice(0, 7).replace('-', '');
}

export function normalizeCustomerDoPrefix(value: unknown) {
    const prefix = normalizeOptionalText(value)
        ?.toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return prefix || 'SJ';
}

export function buildDriverRequestedTrackingStatus(status: string) {
    return `DRIVER_REQUESTED_${status}`;
}

export function deriveOrderStatusFromItems(items: OrderItemStatusSummary[]) {
    const allDelivered = items.length > 0 && items.every(item => item.status === 'DELIVERED');
    const anyInProgress = items.some(
        item =>
            item.status === 'DELIVERED' ||
            item.status === 'PARTIAL' ||
            item.status === 'ASSIGNED' ||
            item.status === 'ON_DELIVERY'
    );
    const anyHold = items.some(item => item.status === 'HOLD');

    if (allDelivered) return 'COMPLETE';
    if (anyInProgress) return 'PARTIAL';
    if (anyHold) return 'ON_HOLD';
    return 'OPEN';
}

export async function resolveOrderPartyData(customerRef: string, serviceRef?: string) {
    const customer = await sanityGetById<{ _id: string; name?: string; address?: string; active?: boolean }>(customerRef);
    if (!customer) {
        throw new Error('Customer order tidak ditemukan');
    }
    if (customer.active === false) {
        throw new Error('Customer order tidak aktif');
    }

    let serviceName: string | undefined;
    if (serviceRef) {
        const service = await sanityGetById<{ _id: string; name?: string; active?: boolean }>(serviceRef);
        if (!service) {
            throw new Error('Kategori armada order tidak ditemukan');
        }
        if (service.active === false) {
            throw new Error('Kategori armada order tidak aktif');
        }
        serviceName = service.name || undefined;
    }

    return {
        customer,
        serviceName,
    } satisfies ResolvedOrderPartyData;
}

export async function normalizeOrderItemsInput(customerRef: string, rawItems: unknown[]) {
    const items = rawItems
        .filter(isPlainObject)
        .filter(item => normalizeText(item.description) || normalizeOptionalText(item.customerProductRef))
        .map<NormalizedOrderItemInput>(item => {
            const description = normalizeOptionalText(item.description) || '';
            const customerProductRef = normalizeOptionalText(item.customerProductRef);
            const qtyKoli = normalizeNumber(item.qtyKoli);
            const rawWeightInputValue = normalizeNumber(item.weightInputValue ?? item.weight ?? 0);
            const rawVolumeInputValue = normalizeNumber(item.volumeInputValue ?? item.volume);
            const weightInputUnit: WeightInputUnit = item.weightInputUnit === 'TON' ? 'TON' : 'KG';
            const volumeInputUnit: VolumeInputUnit =
                item.volumeInputUnit === 'LITER' || item.volumeInputUnit === 'KL' ? item.volumeInputUnit : 'M3';
            const value = normalizeNumber(item.value);

            if (!description && !customerProductRef) {
                throw new Error('Pilih barang customer atau isi deskripsi item order');
            }
            if (!Number.isFinite(qtyKoli) || qtyKoli < 0) {
                throw new Error('Jumlah koli item order tidak valid');
            }
            if (!Number.isFinite(rawWeightInputValue) || rawWeightInputValue < 0) {
                throw new Error('Berat item order tidak valid');
            }
            if (Number.isFinite(rawVolumeInputValue) && rawVolumeInputValue < 0) {
                throw new Error('Volume item order tidak valid');
            }

            return {
                id: normalizeOptionalText(item.id),
                customerProductRef,
                description,
                qtyKoli,
                weight: 0,
                volume: undefined,
                weightInputValue: Number.isFinite(rawWeightInputValue) && rawWeightInputValue > 0 ? rawWeightInputValue : undefined,
                weightInputUnit: Number.isFinite(rawWeightInputValue) && rawWeightInputValue > 0 ? weightInputUnit : undefined,
                volumeInputValue: Number.isFinite(rawVolumeInputValue) && rawVolumeInputValue > 0 ? rawVolumeInputValue : undefined,
                volumeInputUnit: Number.isFinite(rawVolumeInputValue) && rawVolumeInputValue > 0 ? volumeInputUnit : undefined,
                value: Number.isFinite(value) && value >= 0 ? value : undefined,
            };
        });

    if (items.length === 0) {
        throw new Error('Minimal 1 item order wajib diisi');
    }

    const customerProductRefs = [
        ...new Set(items.map(item => item.customerProductRef).filter((value): value is string => Boolean(value))),
    ];
    const customerProducts = customerProductRefs.length > 0
        ? await getSanityClient().fetch<CustomerProductOrderSource[]>(
            `*[_type == "customerProduct" && _id in $ids]{
                _id,
                customerRef,
                code,
                name,
                description,
                defaultQtyKoli,
                defaultWeight,
                defaultWeightInputValue,
                defaultWeightInputUnit,
                defaultVolume,
                defaultVolumeInputValue,
                defaultVolumeInputUnit,
                active
            }`,
            { ids: customerProductRefs }
        )
        : [];
    const customerProductMap = new Map(customerProducts.map(item => [item._id, item]));

    for (const item of items) {
        const customerProduct = item.customerProductRef ? customerProductMap.get(item.customerProductRef) : undefined;
        if (item.customerProductRef && !customerProduct) {
            throw new Error('Barang customer yang dipilih tidak ditemukan');
        }
        if (customerProduct) {
            if (normalizeOptionalText(customerProduct.customerRef) !== customerRef) {
                throw new Error('Barang customer harus sesuai dengan customer order yang dipilih');
            }
            if (customerProduct.active === false) {
                throw new Error(`Barang customer ${customerProduct.name || customerProduct.code || ''} tidak aktif`);
            }
            item.customerProductCode = normalizeOptionalText(customerProduct.code);
            item.customerProductName = normalizeOptionalText(customerProduct.name);
            item.description =
                item.description ||
                normalizeOptionalText(customerProduct.description) ||
                normalizeOptionalText(customerProduct.name) ||
                '';
            if (item.qtyKoli <= 0) {
                item.qtyKoli = normalizeNumber(customerProduct.defaultQtyKoli ?? 0);
            }
            if (!item.weightInputValue || item.weightInputValue <= 0) {
                const productWeightUnit = customerProduct.defaultWeightInputUnit === 'TON' ? 'TON' : 'KG';
                const productWeightInputValue =
                    normalizeNumber(customerProduct.defaultWeightInputValue) > 0
                        ? normalizeNumber(customerProduct.defaultWeightInputValue)
                        : convertKgToWeightInputValue(normalizeNumber(customerProduct.defaultWeight ?? 0), productWeightUnit);
                item.weightInputValue = productWeightInputValue > 0 ? productWeightInputValue : undefined;
                item.weightInputUnit = productWeightInputValue > 0 ? productWeightUnit : undefined;
            }
            if (!item.volumeInputValue || item.volumeInputValue <= 0) {
                const productVolumeUnit =
                    customerProduct.defaultVolumeInputUnit === 'LITER'
                        ? 'LITER'
                        : customerProduct.defaultVolumeInputUnit === 'KL'
                            ? 'KL'
                            : 'M3';
                const productVolumeInputValue =
                    normalizeNumber(customerProduct.defaultVolumeInputValue) > 0
                        ? normalizeNumber(customerProduct.defaultVolumeInputValue)
                        : convertM3ToVolumeInputValue(normalizeNumber(customerProduct.defaultVolume ?? 0), productVolumeUnit);
                item.volumeInputValue = productVolumeInputValue > 0 ? productVolumeInputValue : undefined;
                item.volumeInputUnit = productVolumeInputValue > 0 ? productVolumeUnit : undefined;
            }
        }

        if (!item.description) {
            throw new Error('Deskripsi item order wajib diisi');
        }
        if (!Number.isFinite(item.qtyKoli) || item.qtyKoli < 0) {
            throw new Error('Jumlah koli item order tidak valid');
        }

        const finalWeightInputUnit = item.weightInputUnit === 'TON' ? 'TON' : 'KG';
        const finalVolumeInputUnit =
            item.volumeInputUnit === 'LITER' || item.volumeInputUnit === 'KL' ? item.volumeInputUnit : 'M3';
        const finalWeightInputValue = roundQuantity(
            normalizeNumber(item.weightInputValue ?? 0),
            finalWeightInputUnit === 'TON' ? 3 : 2
        );
        const finalVolumeInputValue = roundQuantity(
            normalizeNumber(item.volumeInputValue ?? 0),
            finalVolumeInputUnit === 'LITER' ? 0 : 3
        );
        if (!Number.isFinite(finalWeightInputValue) || finalWeightInputValue < 0) {
            throw new Error('Berat item order tidak valid');
        }
        if (!Number.isFinite(finalVolumeInputValue) || finalVolumeInputValue < 0) {
            throw new Error('Volume item order tidak valid');
        }

        item.weight = finalWeightInputValue > 0 ? convertWeightToKg(finalWeightInputValue, finalWeightInputUnit) : 0;
        item.volume = finalVolumeInputValue > 0 ? convertVolumeToM3(finalVolumeInputValue, finalVolumeInputUnit) : undefined;
        item.weightInputValue = finalWeightInputValue > 0 ? finalWeightInputValue : undefined;
        item.weightInputUnit = finalWeightInputValue > 0 ? finalWeightInputUnit : undefined;
        item.volumeInputValue = finalVolumeInputValue > 0 ? finalVolumeInputValue : undefined;
        item.volumeInputUnit = finalVolumeInputValue > 0 ? finalVolumeInputUnit : undefined;

        if (item.qtyKoli <= 0 && item.weight <= 0 && !item.volume) {
            throw new Error('Item order wajib punya koli, berat, atau volume lebih dari 0');
        }
    }

    return items;
}

export function normalizeDeliveryOrderSelections(data: Record<string, unknown>, orderItems: OrderItemProgressSnapshot[]) {
    const rawSelections = Array.isArray(data.items) ? data.items : [];
    if (rawSelections.length > 0) {
        const selections = rawSelections
            .filter(isPlainObject)
            .map<DeliveryOrderItemSelection>(item => {
                const weightInputUnit: WeightInputUnit = item.weightInputUnit === 'TON' ? 'TON' : 'KG';
                const volumeInputUnit: VolumeInputUnit =
                    item.volumeInputUnit === 'LITER'
                        ? 'LITER'
                        : item.volumeInputUnit === 'KL'
                            ? 'KL'
                            : 'M3';
                const weightInputValue = roundQuantity(normalizeNumber(item.weightInputValue), weightInputUnit === 'TON' ? 3 : 2);
                const volumeInputValue = roundQuantity(normalizeNumber(item.volumeInputValue), volumeInputUnit === 'LITER' ? 0 : 3);
                return {
                    orderItemRef: normalizeText(item.orderItemRef),
                    qtyKoli: normalizeNumber(item.qtyKoli),
                    weightInputValue: weightInputValue > 0 ? weightInputValue : undefined,
                    weightInputUnit: weightInputValue > 0 ? weightInputUnit : undefined,
                    volumeInputValue: volumeInputValue > 0 ? volumeInputValue : undefined,
                    volumeInputUnit: volumeInputValue > 0 ? volumeInputUnit : undefined,
                    holdRemaining: Boolean(item.holdRemaining),
                    holdReason: normalizeOptionalText(item.holdReason),
                    holdLocation: normalizeOptionalText(item.holdLocation),
                };
            });
        return selections.filter(item => item.orderItemRef);
    }

    const rawItemRefs = Array.isArray(data.itemRefs) ? data.itemRefs : [];
    const itemRefs = rawItemRefs.filter((item): item is string => typeof item === 'string' && item.length > 0);
    return orderItems
        .filter(item => itemRefs.includes(item._id))
        .map<DeliveryOrderItemSelection>(item => ({
            orderItemRef: item._id,
            qtyKoli: normalizeNumber(item.qtyKoli),
            weightInputValue:
                normalizeNumber(item.weightInputValue) > 0
                    ? roundQuantity(normalizeNumber(item.weightInputValue), item.weightInputUnit === 'TON' ? 3 : 2)
                    : normalizeNumber(item.weight) > 0
                        ? roundQuantity(convertKgToWeightInputValue(normalizeNumber(item.weight), item.weightInputUnit === 'TON' ? 'TON' : 'KG'), item.weightInputUnit === 'TON' ? 3 : 2)
                        : undefined,
            weightInputUnit:
                normalizeNumber(item.weightInputValue) > 0 || normalizeNumber(item.weight) > 0
                    ? item.weightInputUnit === 'TON' ? 'TON' : 'KG'
                    : undefined,
            volumeInputValue:
                normalizeNumber(item.volumeInputValue) > 0
                    ? roundQuantity(normalizeNumber(item.volumeInputValue), item.volumeInputUnit === 'LITER' ? 0 : 3)
                    : normalizeNumber(item.volume) > 0
                        ? roundQuantity(
                            convertM3ToVolumeInputValue(
                                normalizeNumber(item.volume),
                                item.volumeInputUnit === 'LITER'
                                    ? 'LITER'
                                    : item.volumeInputUnit === 'KL'
                                        ? 'KL'
                                        : 'M3'
                            ),
                            item.volumeInputUnit === 'LITER' ? 0 : 3
                        )
                        : undefined,
            volumeInputUnit:
                normalizeNumber(item.volumeInputValue) > 0 || normalizeNumber(item.volume) > 0
                    ? item.volumeInputUnit === 'LITER'
                        ? 'LITER'
                        : item.volumeInputUnit === 'KL'
                            ? 'KL'
                            : 'M3'
                    : undefined,
            holdRemaining: false,
        }));
}

export function normalizeDeliveryOrderActualCargoInputs(
    data: Record<string, unknown>,
    doItems: DeliveryOrderItemCargoSnapshot[]
) {
    const rawActualItems = Array.isArray(data.actualItems) ? data.actualItems : [];
    const providedActuals = new Map<string, Record<string, unknown>>();
    for (const rawItem of rawActualItems) {
        if (!isPlainObject(rawItem)) {
            continue;
        }
        const deliveryOrderItemRef = normalizeText(rawItem.deliveryOrderItemRef);
        if (!deliveryOrderItemRef) {
            continue;
        }
        providedActuals.set(deliveryOrderItemRef, rawItem);
    }

    const normalized = new Map<string, NormalizedActualCargoInput>();
    for (const item of doItems) {
        const plannedQtyKoli = roundQuantity(normalizeNumber(item.shippedQtyKoli ?? item.orderItemQtyKoli ?? 0));
        const plannedWeightKg = roundQuantity(normalizeNumber(item.shippedWeight ?? item.orderItemWeight ?? 0));
        const plannedVolumeM3 = roundQuantity(normalizeNumber(item.orderItemVolumeM3 ?? 0), 3);

        const rawItem = providedActuals.get(item._id);
        const weightInputUnit: WeightInputUnit =
            rawItem?.actualWeightInputUnit === 'TON'
                ? 'TON'
                : item.actualWeightInputUnit || item.orderItemWeightInputUnit || 'KG';
        const volumeInputUnit: VolumeInputUnit =
            rawItem?.actualVolumeInputUnit === 'LITER'
                ? 'LITER'
                : rawItem?.actualVolumeInputUnit === 'KL'
                    ? 'KL'
                    : item.actualVolumeInputUnit || item.orderItemVolumeInputUnit || 'M3';

        const actualQtyKoli = roundQuantity(
            normalizeNumber(rawItem?.actualQtyKoli ?? item.actualQtyKoli ?? plannedQtyKoli)
        );
        const rawWeightInputValue = roundQuantity(normalizeNumber(
            rawItem?.actualWeightInputValue ??
            item.actualWeightInputValue ??
            (item.actualWeightKg !== undefined
                ? convertKgToWeightInputValue(normalizeNumber(item.actualWeightKg), weightInputUnit)
                : item.orderItemWeightInputValue ?? convertKgToWeightInputValue(plannedWeightKg, weightInputUnit))
        ), weightInputUnit === 'TON' ? 3 : 2);
        const rawVolumeInputValue = roundQuantity(normalizeNumber(
            rawItem?.actualVolumeInputValue ??
            item.actualVolumeInputValue ??
            (item.actualVolumeM3 !== undefined
                ? convertM3ToVolumeInputValue(normalizeNumber(item.actualVolumeM3), volumeInputUnit)
                : item.orderItemVolumeInputValue ?? convertM3ToVolumeInputValue(plannedVolumeM3, volumeInputUnit))
        ), volumeInputUnit === 'LITER' ? 0 : 3);
        const actualWeightKg = roundQuantity(convertWeightToKg(rawWeightInputValue, weightInputUnit));
        const actualVolumeM3 = roundQuantity(convertVolumeToM3(rawVolumeInputValue, volumeInputUnit), 3);

        normalized.set(item._id, {
            deliveryOrderItemRef: item._id,
            actualQtyKoli,
            actualWeightKg,
            actualWeightInputValue: rawWeightInputValue > 0 ? rawWeightInputValue : undefined,
            actualWeightInputUnit: rawWeightInputValue > 0 ? weightInputUnit : undefined,
            actualVolumeM3: actualVolumeM3 > 0 ? actualVolumeM3 : undefined,
            actualVolumeInputValue: rawVolumeInputValue > 0 ? rawVolumeInputValue : undefined,
            actualVolumeInputUnit: rawVolumeInputValue > 0 ? volumeInputUnit : undefined,
        });
    }

    return normalized;
}

export function summarizeActualCargoInputs(actualCargoByDoItemId: Map<string, NormalizedActualCargoInput>): ActualCargoTotals {
    let qtyKoli = 0;
    let weightKg = 0;
    let volumeM3 = 0;

    for (const item of actualCargoByDoItemId.values()) {
        qtyKoli += normalizeNumber(item.actualQtyKoli);
        weightKg += normalizeNumber(item.actualWeightKg);
        volumeM3 += normalizeNumber(item.actualVolumeM3 ?? 0);
    }

    return {
        qtyKoli: roundQuantity(qtyKoli),
        weightKg: roundQuantity(weightKg),
        volumeM3: roundQuantity(volumeM3, 3),
    };
}

export function normalizeDeliveryDropType(value: unknown): DeliveryActualDropType {
    const normalized = normalizeText(value).toUpperCase() as DeliveryActualDropType;
    return DELIVERY_ACTUAL_DROP_TYPES.has(normalized) ? normalized : 'DROP';
}

export function buildDefaultActualDropPoint(
    deliveryOrder: {
        receiverName?: string;
        receiverCompany?: string;
        receiverAddress?: string;
    },
    totals: ActualCargoTotals
): NormalizedDeliveryActualDropPoint {
    return {
        _key: crypto.randomUUID(),
        sequence: 1,
        stopType: 'DROP',
        locationName:
            normalizeOptionalText(deliveryOrder.receiverCompany) ||
            normalizeOptionalText(deliveryOrder.receiverName) ||
            'Tujuan Tagihan',
        locationAddress: normalizeOptionalText(deliveryOrder.receiverAddress),
        qtyKoli: totals.qtyKoli > 0 ? totals.qtyKoli : undefined,
        weightKg: totals.weightKg > 0 ? totals.weightKg : undefined,
        weightInputValue: totals.weightKg > 0 ? convertKgToWeightInputValue(totals.weightKg, 'KG') : undefined,
        weightInputUnit: totals.weightKg > 0 ? 'KG' : undefined,
        volumeM3: totals.volumeM3 > 0 ? totals.volumeM3 : undefined,
        volumeInputValue: totals.volumeM3 > 0 ? convertM3ToVolumeInputValue(totals.volumeM3, 'M3') : undefined,
        volumeInputUnit: totals.volumeM3 > 0 ? 'M3' : undefined,
    };
}

export function normalizeDeliveryActualDropPoints(
    data: Record<string, unknown>,
    deliveryOrder: {
        receiverName?: string;
        receiverCompany?: string;
        receiverAddress?: string;
    },
    actualCargoByDoItemId: Map<string, NormalizedActualCargoInput>
) {
    const actualTotals = summarizeActualCargoInputs(actualCargoByDoItemId);
    const rawDropPoints = Array.isArray(data.actualDropPoints) ? data.actualDropPoints : [];

    if (rawDropPoints.length === 0) {
        return [buildDefaultActualDropPoint(deliveryOrder, actualTotals)];
    }

    const normalized: NormalizedDeliveryActualDropPoint[] = [];
    rawDropPoints.forEach((rawPoint, index) => {
        if (!isPlainObject(rawPoint)) {
            return;
        }

        const locationName = normalizeOptionalText(rawPoint.locationName);
        const locationAddress = normalizeOptionalText(rawPoint.locationAddress);
        const note = normalizeOptionalText(rawPoint.note);
        const qtyKoli = roundQuantity(normalizeNumber(rawPoint.qtyKoli));
        const weightInputUnit: WeightInputUnit = rawPoint.weightInputUnit === 'TON' ? 'TON' : 'KG';
        const rawWeightInputValue = roundQuantity(
            normalizeNumber(rawPoint.weightInputValue ?? rawPoint.weightKg ?? 0),
            weightInputUnit === 'TON' ? 3 : 2
        );
        const volumeInputUnit: VolumeInputUnit =
            rawPoint.volumeInputUnit === 'LITER' || rawPoint.volumeInputUnit === 'KL' ? rawPoint.volumeInputUnit : 'M3';
        const rawVolumeInputValue = roundQuantity(
            normalizeNumber(rawPoint.volumeInputValue ?? rawPoint.volumeM3 ?? 0),
            volumeInputUnit === 'LITER' ? 0 : 3
        );
        const weightKg = roundQuantity(convertWeightToKg(rawWeightInputValue, weightInputUnit));
        const volumeM3 = roundQuantity(convertVolumeToM3(rawVolumeInputValue, volumeInputUnit), 3);

        if (!locationName && !locationAddress) {
            throw new Error(`Titik drop #${index + 1} wajib punya nama atau alamat lokasi`);
        }
        if (qtyKoli < 0 || !Number.isFinite(qtyKoli)) {
            throw new Error(`Qty titik drop #${index + 1} tidak valid`);
        }
        if (!Number.isFinite(rawWeightInputValue) || rawWeightInputValue < 0) {
            throw new Error(`Berat titik drop #${index + 1} tidak valid`);
        }
        if (!Number.isFinite(rawVolumeInputValue) || rawVolumeInputValue < 0) {
            throw new Error(`Volume titik drop #${index + 1} tidak valid`);
        }
        if (qtyKoli <= 0 && weightKg <= 0 && volumeM3 <= 0) {
            throw new Error(`Titik drop #${index + 1} wajib punya qty, berat, atau volume lebih dari 0`);
        }

        normalized.push({
            _key: crypto.randomUUID(),
            sequence: index + 1,
            stopType: normalizeDeliveryDropType(rawPoint.stopType),
            locationName: locationName || locationAddress || `Titik drop ${index + 1}`,
            locationAddress,
            qtyKoli: qtyKoli > 0 ? qtyKoli : undefined,
            weightKg: weightKg > 0 ? weightKg : undefined,
            weightInputValue: rawWeightInputValue > 0 ? rawWeightInputValue : undefined,
            weightInputUnit: rawWeightInputValue > 0 ? weightInputUnit : undefined,
            volumeM3: volumeM3 > 0 ? volumeM3 : undefined,
            volumeInputValue: rawVolumeInputValue > 0 ? rawVolumeInputValue : undefined,
            volumeInputUnit: rawVolumeInputValue > 0 ? volumeInputUnit : undefined,
            note,
        });
    });

    if (normalized.length === 0) {
        return [buildDefaultActualDropPoint(deliveryOrder, actualTotals)];
    }

    const aggregated = normalized.reduce<ActualCargoTotals>(
        (sum, point) => ({
            qtyKoli: roundQuantity(sum.qtyKoli + normalizeNumber(point.qtyKoli ?? 0)),
            weightKg: roundQuantity(sum.weightKg + normalizeNumber(point.weightKg ?? 0)),
            volumeM3: roundQuantity(sum.volumeM3 + normalizeNumber(point.volumeM3 ?? 0), 3),
        }),
        { qtyKoli: 0, weightKg: 0, volumeM3: 0 }
    );

    if (actualTotals.qtyKoli > 0 && Math.abs(aggregated.qtyKoli - actualTotals.qtyKoli) > 0.01) {
        throw new Error('Total qty titik drop harus sama dengan qty aktual DO');
    }
    if (actualTotals.weightKg > 0 && Math.abs(aggregated.weightKg - actualTotals.weightKg) > 0.01) {
        throw new Error('Total berat titik drop harus sama dengan berat aktual DO');
    }
    if (actualTotals.volumeM3 > 0 && Math.abs(aggregated.volumeM3 - actualTotals.volumeM3) > 0.001) {
        throw new Error('Total volume titik drop harus sama dengan volume aktual DO');
    }

    return normalized;
}

export function summarizeSelection(selection: DeliveryOrderItemSelection, description?: string) {
    if (selection.qtyKoli <= 0) {
        const segments: string[] = [];
        if ((selection.weightInputValue || 0) > 0) {
            segments.push(`${roundQuantity(normalizeNumber(selection.weightInputValue), selection.weightInputUnit === 'TON' ? 3 : 2)} ${selection.weightInputUnit === 'TON' ? 'ton' : 'kg'}`);
        }
        if ((selection.volumeInputValue || 0) > 0) {
            const volumeUnitLabel =
                selection.volumeInputUnit === 'LITER'
                    ? 'liter'
                    : selection.volumeInputUnit === 'KL'
                        ? 'KL'
                        : 'm3';
            segments.push(`${roundQuantity(normalizeNumber(selection.volumeInputValue), selection.volumeInputUnit === 'LITER' ? 0 : 3)} ${volumeUnitLabel}`);
        }
        return `${description || selection.orderItemRef}: ${segments.join(' / ') || 'muatan parsial'}${selection.holdRemaining ? ' + sisa hold' : ''}`;
    }
    return `${description || selection.orderItemRef}: ${roundQuantity(selection.qtyKoli)} koli${selection.holdRemaining ? ' + sisa hold' : ''}`;
}
