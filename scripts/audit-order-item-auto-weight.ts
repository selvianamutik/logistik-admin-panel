import assert from 'node:assert/strict';

import {
    applyCustomerProductToOrderItem,
    applyOrderItemAutoWeightFromQty,
    updateOrderItemWeightUnit,
    type OrderItemForm,
} from '../src/lib/order-create-page-support';
import type { CustomerProduct } from '../src/lib/types';

const baseItem: OrderItemForm = {
    customerProductRef: '',
    description: '',
    qtyKoli: 0,
    weightInputValue: 0,
    weightInputUnit: 'KG',
    volumeInputValue: 0,
    volumeInputUnit: 'M3',
    pickupStopKey: 'pickup-1',
    shipperReferenceNumber: 'SJ-TEST',
    value: 0,
};

const asbesProduct: CustomerProduct = {
    _id: 'product-asbes',
    _type: 'customerProduct',
    customerRef: 'customer-1',
    code: 'ASBES12',
    name: 'ASBES',
    defaultQtyKoli: 1,
    defaultWeight: 0.4,
    defaultWeightInputValue: 0.4,
    defaultWeightInputUnit: 'KG',
    active: true,
};

const keramikProduct: CustomerProduct = {
    _id: 'product-keramik',
    _type: 'customerProduct',
    customerRef: 'customer-1',
    code: 'KRM',
    name: 'Keramik',
    defaultQtyKoli: 1,
    defaultWeight: 12,
    defaultWeightInputValue: 12,
    defaultWeightInputUnit: 'KG',
    active: true,
};

const asbesItem = applyCustomerProductToOrderItem(baseItem, asbesProduct);
assert.equal(asbesItem.qtyKoli, 1);
assert.equal(asbesItem.weightInputValue, 0.4);
assert.equal(asbesItem.autoWeightBasisQtyKoli, 1);
assert.equal(asbesItem.autoWeightBasisWeightKg, 0.4);

const twoKoliAsbes = applyOrderItemAutoWeightFromQty(asbesItem, 2);
assert.equal(twoKoliAsbes.qtyKoli, 2);
assert.equal(twoKoliAsbes.weightInputValue, 0.8);

const twoKoliKeramik = applyCustomerProductToOrderItem(twoKoliAsbes, keramikProduct);
assert.equal(twoKoliKeramik.qtyKoli, 2);
assert.equal(twoKoliKeramik.weightInputValue, 24);
assert.equal(twoKoliKeramik.autoWeightBasisQtyKoli, 2);
assert.equal(twoKoliKeramik.autoWeightBasisWeightKg, 24);

const threeKoliKeramik = applyOrderItemAutoWeightFromQty(twoKoliKeramik, 3);
assert.equal(threeKoliKeramik.weightInputValue, 36);

const keramikInTon = updateOrderItemWeightUnit(twoKoliKeramik, 'TON');
assert.equal(keramikInTon.weightInputValue, 0.024);

const legacyProductWithoutInputUnit = {
    ...keramikProduct,
    defaultWeightInputUnit: undefined,
};
const legacyProductAppliedToTonRow = applyCustomerProductToOrderItem(
    { ...baseItem, qtyKoli: 2, weightInputUnit: 'TON' },
    legacyProductWithoutInputUnit
);
assert.equal(legacyProductAppliedToTonRow.weightInputUnit, 'TON');
assert.equal(legacyProductAppliedToTonRow.weightInputValue, 0.024);

console.log('Order item auto weight audit OK');
