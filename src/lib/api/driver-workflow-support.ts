import {
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
} from './data-helpers';

export type DriverVoucherTotals = {
    totalSpent: number;
    operationalBalance: number;
    driverFeeAmount: number;
    totalClaimAmount: number;
    balance: number;
};

export type DriverBoronganDeliveryOrderItemSummarySource = {
    deliveryOrderRef?: string;
    orderItemDescription?: string;
    orderItemQtyKoli?: number;
    orderItemWeight?: number;
};

export function buildRouteLabel(origin?: string, destination?: string) {
    const from = normalizeOptionalText(origin);
    const to = normalizeOptionalText(destination);
    if (from && to) {
        return `${from} -> ${to}`;
    }
    return from || to || undefined;
}

export function computeDriverVoucherTotals(
    cashGiven: number,
    operationalSpent: number,
    driverFeeAmount: number
): DriverVoucherTotals {
    const safeCashGiven = Number.isFinite(cashGiven) ? cashGiven : 0;
    const safeOperationalSpent = Number.isFinite(operationalSpent) ? operationalSpent : 0;
    const safeDriverFeeAmount = Number.isFinite(driverFeeAmount) ? driverFeeAmount : 0;
    const operationalBalance = safeCashGiven - safeOperationalSpent;
    const totalClaimAmount = safeOperationalSpent + safeDriverFeeAmount;

    return {
        totalSpent: safeOperationalSpent,
        operationalBalance,
        driverFeeAmount: safeDriverFeeAmount,
        totalClaimAmount,
        balance: safeCashGiven - totalClaimAmount,
    };
}

export function getDriverVoucherIssuedAmount(value: {
    totalIssuedAmount?: number | null;
    cashGiven?: number | null;
}) {
    if (typeof value.totalIssuedAmount === 'number' && Number.isFinite(value.totalIssuedAmount)) {
        return Math.max(value.totalIssuedAmount, 0);
    }
    if (typeof value.cashGiven === 'number' && Number.isFinite(value.cashGiven)) {
        return Math.max(value.cashGiven, 0);
    }
    return 0;
}

export function getDriverVoucherInitialCash(value: {
    initialCashGiven?: number | null;
    cashGiven?: number | null;
}) {
    if (typeof value.initialCashGiven === 'number' && Number.isFinite(value.initialCashGiven)) {
        return Math.max(value.initialCashGiven, 0);
    }
    if (typeof value.cashGiven === 'number' && Number.isFinite(value.cashGiven)) {
        return Math.max(value.cashGiven, 0);
    }
    return 0;
}

export function summarizeBoronganDeliveryOrderItems(items: DriverBoronganDeliveryOrderItemSummarySource[]) {
    const descriptions = [
        ...new Set(
            items
                .map(item => normalizeOptionalText(item.orderItemDescription))
                .filter((value): value is string => Boolean(value))
        ),
    ];
    const collie = items.reduce((sum, item) => sum + normalizeNumber(item.orderItemQtyKoli || 0), 0);
    const beratKg = items.reduce((sum, item) => sum + normalizeNumber(item.orderItemWeight || 0), 0);

    return {
        barang: descriptions.join(', '),
        collie,
        beratKg,
    };
}

export function isDriverBoronganRowEmpty(row: Record<string, unknown>) {
    return (
        !normalizeOptionalText(row.doRef) &&
        !normalizeText(row.noSJ) &&
        !normalizeText(row.tujuan) &&
        !normalizeText(row.barang) &&
        normalizeNumber(row.collie || 0) === 0 &&
        normalizeNumber(row.beratKg || 0) === 0 &&
        normalizeNumber(row.tarip || 0) === 0
    );
}

export function toCategoryRef(categoryName: string) {
    const slug = categoryName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `driver-voucher-${slug || 'misc'}`;
}
