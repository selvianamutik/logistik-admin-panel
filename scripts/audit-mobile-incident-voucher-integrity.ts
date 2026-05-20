import { loadScriptEnv } from './_env';

loadScriptEnv();

import { normalizeBusinessDateTimeForStorage } from '../src/lib/business-date';
import { sortDriverVoucherDisbursementsChronologically } from '../src/lib/driver-voucher-detail-support';
import { listDocumentsByFilter } from '../src/lib/repositories/document-store';
import type { DeliveryOrder, Driver, DriverVoucher, DriverVoucherDisbursement } from '../src/lib/types';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function auditStep(message: string) {
    console.log(`[audit:mobile-incident-voucher] ${message}`);
}

function assertTimestampNormalization() {
    const localJakarta = normalizeBusinessDateTimeForStorage('2026-05-20T10:50');
    assert(
        localJakarta === '2026-05-20T03:50:00.000Z',
        `Expected Jakarta local incident time to store as UTC instant, received ${localJakarta}`
    );

    const utcFromPhone = normalizeBusinessDateTimeForStorage('2026-05-20T03:50:27.862Z');
    assert(
        utcFromPhone === '2026-05-20T03:50:27.862Z',
        `Expected phone UTC timestamp to remain stable, received ${utcFromPhone}`
    );

    auditStep('incident timestamp normalization ok');
}

function assertDisbursementOrdering() {
    const sample = [
        {
            _id: 'z-initial',
            _type: 'driverVoucherDisbursement',
            voucherRef: 'voucher-a',
            date: '2026-05-20',
            amount: 100000,
            kind: 'INITIAL',
            status: 'ACTIVE',
            _createdAt: '2026-05-20T03:55:00.000Z',
        },
        {
            _id: 'z-top-up-100',
            _type: 'driverVoucherDisbursement',
            voucherRef: 'voucher-a',
            date: '2026-05-20',
            amount: 100000,
            kind: 'TOP_UP',
            status: 'ACTIVE',
            _createdAt: '2026-05-20T03:56:00.000Z',
        },
        {
            _id: 'a-top-up-50',
            _type: 'driverVoucherDisbursement',
            voucherRef: 'voucher-a',
            date: '2026-05-20',
            amount: 50000,
            kind: 'TOP_UP',
            status: 'ACTIVE',
            _createdAt: '2026-05-20T04:05:00.000Z',
        },
    ] satisfies DriverVoucherDisbursement[];

    const orderedAmounts = sortDriverVoucherDisbursementsChronologically(sample).map(item => item.amount);
    assert(
        orderedAmounts.join(',') === '100000,100000,50000',
        `Expected bon order to follow creation time, received ${orderedAmounts.join(',')}`
    );

    auditStep('voucher disbursement order ok');
}

async function assertRizkyVoucherShape() {
    const drivers = await listDocumentsByFilter<Driver>('driver', {});
    const driver = drivers.find(item => /rizk[yi]\s+maulana/i.test(item.name || ''));
    if (!driver) {
        auditStep('Rizky/Rizqi Maulana driver not found; live-data voucher shape skipped');
        return;
    }

    const vouchers = await listDocumentsByFilter<DriverVoucher>('driverVoucher', { driverRef: driver._id });
    const voucherIds = new Set(vouchers.map(item => item._id));
    assert(
        voucherIds.size === vouchers.length,
        `Expected mobile voucher cards to be unique per bon, received ${vouchers.length} rows for ${voucherIds.size} bon ids`
    );

    const deliveryOrderRefs = vouchers
        .map(item => item.deliveryOrderRef || '')
        .filter(Boolean);
    const deliveryOrders = deliveryOrderRefs.length > 0
        ? await listDocumentsByFilter<DeliveryOrder>('deliveryOrder', { _id: deliveryOrderRefs })
        : [];
    const deliveryOrderById = new Map(deliveryOrders.map(item => [item._id, item]));

    const disbursements = voucherIds.size > 0
        ? await listDocumentsByFilter<DriverVoucherDisbursement>('driverVoucherDisbursement', {
            voucherRef: [...voucherIds],
        })
        : [];
    const disbursementsByVoucher = new Map<string, DriverVoucherDisbursement[]>();
    for (const disbursement of disbursements) {
        const current = disbursementsByVoucher.get(disbursement.voucherRef) || [];
        current.push(disbursement);
        disbursementsByVoucher.set(disbursement.voucherRef, current);
    }

    let totalDisplayedDisbursements = 0;
    for (const voucher of vouchers) {
        const ordered = sortDriverVoucherDisbursementsChronologically(disbursementsByVoucher.get(voucher._id) || []);
        totalDisplayedDisbursements += ordered.length;

        const topUpsWithCreatedAt = ordered.filter(item => item.kind === 'TOP_UP' && item._createdAt);
        for (let index = 1; index < topUpsWithCreatedAt.length; index += 1) {
            assert(
                String(topUpsWithCreatedAt[index - 1]._createdAt) <= String(topUpsWithCreatedAt[index]._createdAt),
                `Top-up order mismatch for ${voucher.bonNumber || voucher._id}`
            );
        }

        const deliveryOrder = voucher.deliveryOrderRef
            ? deliveryOrderById.get(voucher.deliveryOrderRef)
            : undefined;
        auditStep(
            `${voucher.bonNumber || voucher._id}: DO ${deliveryOrder?.doNumber || voucher.doNumber || '-'} ` +
            `status ${deliveryOrder?.status || '-'} has ${ordered.length} pencairan in one bon card`
        );
    }

    assert(
        totalDisplayedDisbursements >= vouchers.length || vouchers.length === 0,
        'Expected disbursements to remain nested under bon cards, not replace bon-card count'
    );
    auditStep(`Rizky Maulana voucher shape ok: ${vouchers.length} bon card(s), ${totalDisplayedDisbursements} pencairan detail`);
}

async function main() {
    assertTimestampNormalization();
    assertDisbursementOrdering();
    await assertRizkyVoucherShape();
    auditStep('all checks passed');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
