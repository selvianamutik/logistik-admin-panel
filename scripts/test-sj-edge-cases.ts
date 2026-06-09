import { loadScriptEnv } from './_env';
loadScriptEnv();
import { createDocument } from '../src/lib/repositories/document-store';
import { mapDeliveryOrdersToSuratJalanDocuments } from '../src/lib/trip-document-mappers';
import type { DeliveryOrder, DeliveryActualDropPoint } from '../src/lib/types';

/**
 * Edge case testing for complex multi-SJ scenarios
 */
async function testEdgeCases() {
  console.log('\n=== EDGE CASE TESTS: Multi-SJ with Complex Drop Points ===\n');

  let passCount = 0;
  let failCount = 0;

  // Edge Case 1: 2 SJ, each with 3 drop points
  console.log('--- EDGE CASE 1: 2 SJ, each with 3 drops ---');
  const testDO1: Partial<DeliveryOrder> = {
    _id: 'test-do-001',
    _type: 'deliveryOrder',
    doNumber: 'TEST-DO-001',
    orderRef: 'test-order-001',
    date: '2026-06-09',
    status: 'DELIVERED',
    shipperReferences: [
      {
        _key: 'ref-a',
        referenceNumber: 'SJ-A-001',
        receiverName: 'Customer A',
      },
      {
        _key: 'ref-b',
        referenceNumber: 'SJ-B-001',
        receiverName: 'Customer B',
      },
    ],
    actualDropPoints: [
      // SJ-A drops
      {
        _key: 'drop-a1',
        sequence: 1,
        stopType: 'DROP',
        shipperReferenceKey: 'ref-a',
        locationName: 'Warehouse A1',
        locationAddress: 'Jl. A No. 1',
        qtyKoli: 10,
        weightKg: 100,
      },
      {
        _key: 'drop-a2',
        sequence: 2,
        stopType: 'DROP',
        shipperReferenceKey: 'ref-a',
        locationName: 'Warehouse A2',
        locationAddress: 'Jl. A No. 2',
        qtyKoli: 5,
        weightKg: 50,
      },
      {
        _key: 'drop-a3',
        sequence: 3,
        stopType: 'DROP',
        shipperReferenceKey: 'ref-a',
        locationName: 'Warehouse A3',
        locationAddress: 'Jl. A No. 3',
        qtyKoli: 3,
        weightKg: 30,
      },
      // SJ-B drops
      {
        _key: 'drop-b1',
        sequence: 4,
        stopType: 'DROP',
        shipperReferenceKey: 'ref-b',
        locationName: 'Warehouse B1',
        locationAddress: 'Jl. B No. 1',
        qtyKoli: 8,
        weightKg: 80,
      },
      {
        _key: 'drop-b2',
        sequence: 5,
        stopType: 'DROP',
        shipperReferenceKey: 'ref-b',
        locationName: 'Warehouse B2',
        locationAddress: 'Jl. B No. 2',
        qtyKoli: 6,
        weightKg: 60,
      },
      {
        _key: 'drop-b3',
        sequence: 6,
        stopType: 'DROP',
        shipperReferenceKey: 'ref-b',
        locationName: 'Warehouse B3',
        locationAddress: 'Jl. B No. 3',
        qtyKoli: 4,
        weightKg: 40,
      },
    ],
  };

  const sjDocs1 = mapDeliveryOrdersToSuratJalanDocuments([testDO1 as DeliveryOrder], []);

  console.log(`Generated ${sjDocs1.length} SJ documents`);
  if (sjDocs1.length !== 2) {
    console.log('❌ FAIL: Expected 2 SJ documents');
    failCount++;
  } else {
    console.log('✅ PASS: Correct number of SJ documents');
    passCount++;
  }

  for (const sj of sjDocs1) {
    const sjDrops = sj.actualDropPoints || [];
    console.log(`\nSJ: ${sj.suratJalanNumber} (key: ${sj.referenceKey})`);
    console.log(`  actualDropPoints: ${sjDrops.length}`);
    console.log(`  Locations:`);
    sjDrops.forEach(d => {
      console.log(`    - ${d.locationName} (${d.qtyKoli} koli, ${d.weightKg} kg)`);
    });

    if (sjDrops.length !== 3) {
      console.log(`  ❌ FAIL: Expected 3 drops, got ${sjDrops.length}`);
      failCount++;
    } else {
      console.log(`  ✅ PASS: Correct number of drops`);
      passCount++;
    }
  }

  // Edge Case 2: Mixed references - some with key, some with referenceNumber only
  console.log('\n--- EDGE CASE 2: Mixed reference types ---');
  const testDO2: Partial<DeliveryOrder> = {
    _id: 'test-do-002',
    _type: 'deliveryOrder',
    doNumber: 'TEST-DO-002',
    orderRef: 'test-order-002',
    date: '2026-06-09',
    status: 'DELIVERED',
    shipperReferences: [
      {
        _key: 'ref-x',
        referenceNumber: 'SJ-X-001',
        receiverName: 'Customer X',
      },
      {
        referenceNumber: 'SJ-Y-001',
        receiverName: 'Customer Y',
      },
    ],
    actualDropPoints: [
      {
        _key: 'drop-x1',
        sequence: 1,
        stopType: 'DROP',
        shipperReferenceKey: 'ref-x',
        locationName: 'Location X1',
        qtyKoli: 5,
      },
      {
        _key: 'drop-x2',
        sequence: 2,
        stopType: 'DROP',
        shipperReferenceKey: 'ref-x',
        locationName: 'Location X2',
        qtyKoli: 3,
      },
      {
        _key: 'drop-y1',
        sequence: 3,
        stopType: 'DROP',
        shipperReferenceNumber: 'SJ-Y-001',
        locationName: 'Location Y1',
        qtyKoli: 7,
      },
      {
        _key: 'drop-y2',
        sequence: 4,
        stopType: 'DROP',
        shipperReferenceNumber: 'SJ-Y-001',
        locationName: 'Location Y2',
        qtyKoli: 4,
      },
    ],
  };

  const sjDocs2 = mapDeliveryOrdersToSuratJalanDocuments([testDO2 as DeliveryOrder], []);

  console.log(`Generated ${sjDocs2.length} SJ documents`);
  for (const sj of sjDocs2) {
    const sjDrops = sj.actualDropPoints || [];
    console.log(`\nSJ: ${sj.suratJalanNumber} (key: ${sj.referenceKey})`);
    console.log(`  actualDropPoints: ${sjDrops.length}`);
    sjDrops.forEach(d => {
      console.log(`    - ${d.locationName} (${d.qtyKoli} koli)`);
    });

    const expectedCount = sj.suratJalanNumber === 'SJ-X-001' ? 2 : 2;
    if (sjDrops.length !== expectedCount) {
      console.log(`  ❌ FAIL: Expected ${expectedCount} drops, got ${sjDrops.length}`);
      failCount++;
    } else {
      console.log(`  ✅ PASS: Correct number of drops`);
      passCount++;
    }
  }

  // Edge Case 3: Primary SJ with drops that have NO reference markers
  console.log('\n--- EDGE CASE 3: Primary SJ (no references at all) ---');
  const testDO3: Partial<DeliveryOrder> = {
    _id: 'test-do-003',
    _type: 'deliveryOrder',
    doNumber: 'TEST-DO-003',
    orderRef: 'test-order-003',
    date: '2026-06-09',
    status: 'DELIVERED',
    suratJalanNumber: 'SJ-PRIMARY-001',
    shipperReferences: [],
    actualDropPoints: [
      {
        _key: 'drop-1',
        sequence: 1,
        stopType: 'DROP',
        locationName: 'Main Warehouse',
        qtyKoli: 10,
      },
      {
        _key: 'drop-2',
        sequence: 2,
        stopType: 'DROP',
        locationName: 'Secondary Warehouse',
        qtyKoli: 5,
      },
      {
        _key: 'drop-3',
        sequence: 3,
        stopType: 'HOLD',
        locationName: 'Hold Storage',
        qtyKoli: 2,
      },
    ],
  };

  const sjDocs3 = mapDeliveryOrdersToSuratJalanDocuments([testDO3 as DeliveryOrder], []);

  console.log(`Generated ${sjDocs3.length} SJ documents`);
  const primarySJ = sjDocs3[0];
  const sjDrops3 = primarySJ.actualDropPoints || [];

  console.log(`\nSJ: ${primarySJ.suratJalanNumber}`);
  console.log(`  actualDropPoints: ${sjDrops3.length}`);
  sjDrops3.forEach(d => {
    console.log(`    - ${d.locationName} [${d.stopType}] (${d.qtyKoli} koli)`);
  });

  if (sjDrops3.length !== 3) {
    console.log(`  ❌ FAIL: Expected 3 drops, got ${sjDrops3.length}`);
    failCount++;
  } else {
    console.log(`  ✅ PASS: All drops captured in primary SJ`);
    passCount++;
  }

  // Edge Case 4: One SJ with 10+ drop points (stress test)
  console.log('\n--- EDGE CASE 4: Single SJ with 10 drops (stress test) ---');
  const testDO4: Partial<DeliveryOrder> = {
    _id: 'test-do-004',
    _type: 'deliveryOrder',
    doNumber: 'TEST-DO-004',
    orderRef: 'test-order-004',
    date: '2026-06-09',
    status: 'DELIVERED',
    suratJalanNumber: 'SJ-STRESS-001',
    actualDropPoints: Array.from({ length: 10 }, (_, i) => ({
      _key: `drop-${i + 1}`,
      sequence: i + 1,
      stopType: 'DROP' as const,
      locationName: `Location ${i + 1}`,
      locationAddress: `Address ${i + 1}`,
      qtyKoli: (i + 1) * 2,
      weightKg: (i + 1) * 10,
    })),
  };

  const sjDocs4 = mapDeliveryOrdersToSuratJalanDocuments([testDO4 as DeliveryOrder], []);
  const stressSJ = sjDocs4[0];
  const sjDrops4 = stressSJ.actualDropPoints || [];

  console.log(`\nSJ: ${stressSJ.suratJalanNumber}`);
  console.log(`  actualDropPoints: ${sjDrops4.length}`);
  console.log(`  First 3 locations:`);
  sjDrops4.slice(0, 3).forEach(d => {
    console.log(`    - ${d.locationName}`);
  });

  if (sjDrops4.length !== 10) {
    console.log(`  ❌ FAIL: Expected 10 drops, got ${sjDrops4.length}`);
    failCount++;
  } else {
    console.log(`  ✅ PASS: All 10 drops captured`);
    passCount++;
  }

  // Summary
  console.log('\n\n=== EDGE CASE TEST SUMMARY ===');
  console.log(`Total Assertions: ${passCount + failCount}`);
  console.log(`Passed: ${passCount} ✅`);
  console.log(`Failed: ${failCount} ❌`);
  console.log(`Success Rate: ${passCount + failCount > 0 ? ((passCount / (passCount + failCount)) * 100).toFixed(1) : 0}%`);

  if (failCount > 0) {
    console.log('\n⚠️  Some edge case tests failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All edge case tests passed!');
  }
}

testEdgeCases().catch(error => {
  console.error('Edge case test failed with error:', error);
  process.exit(1);
});
