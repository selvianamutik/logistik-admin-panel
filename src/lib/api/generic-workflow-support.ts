import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import { getSanityClient, sanityGetById } from '@/lib/sanity';

import {
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
} from './data-helpers';

const CUSTOMER_DO_PREFIX_RE = /^[A-Z0-9][A-Z0-9-]{0,7}$/;
const CUSTOMER_PRODUCT_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,19}$/;

export function normalizeCustomerDoPrefix(value: unknown) {
    const prefix = normalizeOptionalText(value)
        ?.toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!prefix) {
        return 'SJ';
    }
    if (!CUSTOMER_DO_PREFIX_RE.test(prefix)) {
        throw new Error('Prefix surat jalan customer hanya boleh berisi huruf/angka singkat, misalnya SJ atau BK');
    }
    return prefix;
}

export function normalizeCustomerProductCode(value: unknown) {
    const code = normalizeOptionalText(value)
        ?.toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!code) {
        return undefined;
    }
    if (!CUSTOMER_PRODUCT_CODE_RE.test(code)) {
        throw new Error('Kode barang customer hanya boleh berisi huruf/angka singkat, misalnya BRG-001');
    }
    return code;
}

export function normalizeCustomerPayload(data: Record<string, unknown>, existing?: Record<string, unknown>) {
    const next: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(data, 'name') || !existing) {
        const name = normalizeText(data.name);
        if (!name) {
            throw new Error('Nama customer wajib diisi');
        }
        next.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'address') || !existing) {
        next.address = normalizeOptionalText(data.address) || '';
    }

    if (Object.prototype.hasOwnProperty.call(data, 'contactPerson') || !existing) {
        next.contactPerson = normalizeOptionalText(data.contactPerson) || '';
    }

    if (Object.prototype.hasOwnProperty.call(data, 'phone') || !existing) {
        next.phone = normalizeOptionalText(data.phone) || '';
    }

    if (Object.prototype.hasOwnProperty.call(data, 'email') || !existing) {
        next.email = normalizeOptionalText(data.email) || '';
    }

    if (Object.prototype.hasOwnProperty.call(data, 'npwp') || !existing) {
        next.npwp = normalizeOptionalText(data.npwp);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'defaultPaymentTerm') || !existing) {
        const defaultPaymentTerm = normalizeNumber(data.defaultPaymentTerm);
        if (!Number.isFinite(defaultPaymentTerm) || defaultPaymentTerm < 0) {
            throw new Error('Termin pembayaran customer tidak valid');
        }
        next.defaultPaymentTerm = Math.round(defaultPaymentTerm);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'deliveryOrderPrefix') || !existing) {
        next.deliveryOrderPrefix = normalizeCustomerDoPrefix(data.deliveryOrderPrefix);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'active') || !existing) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status customer tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    if (existing) {
        next.deliveryOrderCounter =
            typeof existing.deliveryOrderCounter === 'number' && Number.isFinite(existing.deliveryOrderCounter)
                ? existing.deliveryOrderCounter
                : 0;
        next.deliveryOrderPeriod =
            typeof existing.deliveryOrderPeriod === 'string' ? existing.deliveryOrderPeriod : undefined;
    } else {
        next.deliveryOrderCounter = 0;
    }

    return next;
}

export function normalizeBankAccountPayload(data: Record<string, unknown>, existing?: Record<string, unknown>) {
    const next: Record<string, unknown> = {};

    if (Object.prototype.hasOwnProperty.call(data, 'bankName') || !existing) {
        const bankName = normalizeText(data.bankName);
        if (!bankName) {
            throw new Error('Nama rekening / kas wajib diisi');
        }
        next.bankName = bankName;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'accountNumber') || !existing) {
        const accountNumber = normalizeText(data.accountNumber);
        if (!accountNumber) {
            throw new Error('Nomor rekening / kode kas wajib diisi');
        }
        next.accountNumber = accountNumber;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'accountHolder') || !existing) {
        const accountHolder = normalizeText(data.accountHolder);
        if (!accountHolder) {
            throw new Error('Atas nama rekening / kas wajib diisi');
        }
        next.accountHolder = accountHolder;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'initialBalance') || !existing) {
        const initialBalance = normalizeNumber(data.initialBalance);
        if (!Number.isFinite(initialBalance) || initialBalance < 0) {
            throw new Error('Saldo awal rekening / kas tidak valid');
        }
        next.initialBalance = initialBalance;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'notes') || !existing) {
        next.notes = normalizeOptionalText(data.notes);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'active') || !existing) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status rekening / kas tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    return next;
}

export async function normalizeCustomerProductPayload(data: Record<string, unknown>, existing?: Record<string, unknown>) {
    const next: Record<string, unknown> = {};
    const existingId = typeof existing?._id === 'string' ? existing._id : undefined;
    const customerRef =
        Object.prototype.hasOwnProperty.call(data, 'customerRef') || !existing
            ? normalizeText(data.customerRef)
            : normalizeOptionalText(existing?.customerRef) || '';
    if (!customerRef) {
        throw new Error('Customer barang wajib dipilih');
    }

    const customer = await sanityGetById<{ _id: string; name?: string; active?: boolean }>(customerRef);
    if (!customer) {
        throw new Error('Customer barang tidak ditemukan');
    }
    if (customer.active === false && (!existing || customerRef !== normalizeOptionalText(existing.customerRef))) {
        throw new Error('Customer tidak aktif dan tidak bisa dipakai untuk master barang baru');
    }

    const name =
        Object.prototype.hasOwnProperty.call(data, 'name') || !existing
            ? normalizeText(data.name)
            : normalizeOptionalText(existing?.name) || '';
    if (!name) {
        throw new Error('Nama barang customer wajib diisi');
    }

    const code =
        Object.prototype.hasOwnProperty.call(data, 'code') || !existing
            ? normalizeCustomerProductCode(data.code)
            : normalizeCustomerProductCode(existing?.code);
    if (code) {
        const duplicateCode = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "customerProduct" && customerRef == $customerRef && code == $code && _id != $excludeId][0]{ _id }`,
            { customerRef, code, excludeId: existingId || '' }
        );
        if (duplicateCode) {
            throw new Error('Kode barang customer sudah digunakan');
        }
    }

    const description =
        Object.prototype.hasOwnProperty.call(data, 'description') || !existing
            ? normalizeOptionalText(data.description)
            : normalizeOptionalText(existing?.description);
    const defaultQtyRaw =
        Object.prototype.hasOwnProperty.call(data, 'defaultQtyKoli') || !existing
            ? normalizeNumber(data.defaultQtyKoli ?? 1)
            : normalizeNumber(existing?.defaultQtyKoli ?? 1);
    if (!Number.isFinite(defaultQtyRaw) || defaultQtyRaw < 0) {
        throw new Error('Default koli barang customer tidak valid');
    }

    const weightInputUnit: WeightInputUnit =
        (Object.prototype.hasOwnProperty.call(data, 'defaultWeightInputUnit')
            ? data.defaultWeightInputUnit
            : existing?.defaultWeightInputUnit) === 'TON'
            ? 'TON'
            : 'KG';
    const defaultWeightInputValue =
        Object.prototype.hasOwnProperty.call(data, 'defaultWeightInputValue') ||
        Object.prototype.hasOwnProperty.call(data, 'defaultWeight') ||
        !existing
            ? normalizeNumber(data.defaultWeightInputValue ?? data.defaultWeight ?? 0)
            : normalizeNumber(
                existing?.defaultWeightInputValue ??
                convertKgToWeightInputValue(normalizeNumber(existing?.defaultWeight ?? 0), weightInputUnit)
            );
    if (!Number.isFinite(defaultWeightInputValue) || defaultWeightInputValue < 0) {
        throw new Error('Default berat barang customer tidak valid');
    }
    const defaultWeight = defaultWeightInputValue > 0 ? convertWeightToKg(defaultWeightInputValue, weightInputUnit) : undefined;

    const volumeInputUnit: VolumeInputUnit =
        (Object.prototype.hasOwnProperty.call(data, 'defaultVolumeInputUnit')
            ? data.defaultVolumeInputUnit
            : existing?.defaultVolumeInputUnit) === 'LITER'
            ? 'LITER'
            : (Object.prototype.hasOwnProperty.call(data, 'defaultVolumeInputUnit')
                ? data.defaultVolumeInputUnit
                : existing?.defaultVolumeInputUnit) === 'KL'
                ? 'KL'
                : 'M3';
    const defaultVolumeInputValue =
        Object.prototype.hasOwnProperty.call(data, 'defaultVolumeInputValue') ||
        Object.prototype.hasOwnProperty.call(data, 'defaultVolume') ||
        !existing
            ? normalizeNumber(data.defaultVolumeInputValue ?? data.defaultVolume ?? 0)
            : normalizeNumber(
                existing?.defaultVolumeInputValue ??
                convertM3ToVolumeInputValue(normalizeNumber(existing?.defaultVolume ?? 0), volumeInputUnit)
            );
    if (!Number.isFinite(defaultVolumeInputValue) || defaultVolumeInputValue < 0) {
        throw new Error('Default volume barang customer tidak valid');
    }
    const defaultVolume = defaultVolumeInputValue > 0 ? convertVolumeToM3(defaultVolumeInputValue, volumeInputUnit) : undefined;

    next.customerRef = customerRef;
    next.customerName = customer.name || '';
    next.code = code;
    next.name = name;
    next.description = description || name;
    next.defaultQtyKoli = defaultQtyRaw > 0 ? Math.round(defaultQtyRaw) : undefined;
    next.defaultWeight = defaultWeight;
    next.defaultWeightInputValue = defaultWeightInputValue > 0 ? defaultWeightInputValue : undefined;
    next.defaultWeightInputUnit = defaultWeightInputValue > 0 ? weightInputUnit : undefined;
    next.defaultVolume = defaultVolume;
    next.defaultVolumeInputValue = defaultVolumeInputValue > 0 ? defaultVolumeInputValue : undefined;
    next.defaultVolumeInputUnit = defaultVolumeInputValue > 0 ? volumeInputUnit : undefined;
    next.notes =
        Object.prototype.hasOwnProperty.call(data, 'notes') || !existing
            ? normalizeOptionalText(data.notes)
            : normalizeOptionalText(existing?.notes);
    if (Object.prototype.hasOwnProperty.call(data, 'active') || !existing) {
        if (data.active !== undefined && typeof data.active !== 'boolean') {
            throw new Error('Status barang customer tidak valid');
        }
        next.active = typeof data.active === 'boolean' ? data.active : true;
    }

    return next;
}
