import { loadScriptEnv } from './_env';
loadScriptEnv();
import { mapDeliveryOrdersToSuratJalanDocuments } from '../src/lib/trip-document-mappers';
import type { DeliveryOrder } from '../src/lib/types';

/**
 * Test logical consistency: ensure no drops are lost, duplicated, or misassigned
 */
async function testLogicalConsistency() {
  console.log('\n=== LOGICAL CONSISTENCY TESTS ===\n');

  let passCount = 0;
  let failCount = 0;

  // Test 1: No drops should be lost
  console.log('--- TEST 1: No drops lost (conservation of drops) ---');
  const testDO1: Partial<DeliveryOrder> = {
    _id: 'test-conservation',
    _type: 'deliveryOrder',
    doNumber: 'TEST-CONSERVATION',
    orderRef: 'test-order',
    date: '2026-06-09',
    status: 'DELIVERED',
    shipperReferences: [
      { _key: 'ref-a', sequence: 1, referenceNumber: 'SJ-A' },
      { _key: 'ref-b', sequence: 2, referenceNumber: 'SJ-B' },
    ],
    actualDropPoints: [
      { _key: 'd1', sequence: 1, stopType: 'DROP', shipperReferenceKey: 'ref-a', locationName: 'A1', qtyKoli: 5 },
      { _key: 'd2', sequence: 2, stopType: 'DROP', shipperReferenceKey: 'ref-a', locationName: 'A2', qtyKoli: 3 },
      { _key: 'd3', sequence: 3, stopType: 'DROP', shipperReferenceKey: 'ref-b', locationName: 'B1', qtyKoli: 7 },
      { _key: 'd4', sequence: 4, stopType: 'DROP', shipperReferenceKey: 'ref-b', locationName: 'B2', qtyKoli: 4 },
    ],
  };

  const sjDocs1 = mapDeliveryOrdersToSuratJalanDocuments([testDO1 as DeliveryOrder], []);
  const totalDODrops = testDO1.actualDropPoints?.length || 0;
  const totalSJDrops = sjDocs1.reduce((sum, sj) => sum + (sj.actualDropPoints?.length || 0), 0);

  console.log(`DO has ${totalDODrops} drops`);
  console.log(`All SJ documents combined have ${totalSJDrops} drops`);

  if (totalDODrops === totalSJDrops) {
    console.log('✅ PASS: No drops lost, conservation law holds');
    passCount++;
  } else {
    console.log(`❌ FAIL: Drop count mismatch! Lost ${totalDODrops - totalSJDrops} drops`);
    failCount++;
  }

  // Test 2: No drops should be duplicated across SJ documents
  console.log('\n--- TEST 2: No drop duplication across SJs ---');
  const allDropKeys = new Set<string>();
  let hasDuplicates = false;

  for (const sj of sjDocs1) {
    const sjDrops = sj.actualDropPoints || [];
    for (const drop of sjDrops) {
      const key = drop._key || `${drop.locationName}-${drop.sequence}`;
      if (allDropKeys.has(key)) {
        console.log(`❌ FAIL: Duplicate drop found: ${key}`);
        hasDuplicates = true;
        failCount++;
      }
      allDropKeys.add(key);
    }
  }

  if (!hasDuplicates) {
    console.log('✅ PASS: No duplicate drops across SJs');
    passCount++;
  }

  // Test 3: Drops should be correctly partitioned by reference
  console.log('\n--- TEST 3: Correct drop partitioning by reference ---');
  let correctPartition = true;

  for (const sj of sjDocs1) {
    const sjDrops = sj.actualDropPoints || [];
    console.log(`\nSJ: ${sj.suratJalanNumber} (key: ${sj.referenceKey})`);

    for (const drop of sjDrops) {
      const expectedRefKey = drop.shipperReferenceKey;
      const expectedRefNum = drop.shipperReferenceNumber;

      // Check if drop belongs to this SJ
      const belongsHere =
        (!sj.referenceKey && !expectedRefKey && !expectedRefNum) ||
        (sj.referenceKey === expectedRefKey) ||
        (sj.suratJalanNumber === expectedRefNum);

      if (!belongsHere) {
        console.log(`  ❌ FAIL: Drop "${drop.locationName}" doesn't belong here`);
        console.log(`    Drop has refKey: ${expectedRefKey}, refNum: ${expectedRefNum}`);
        console.log(`    SJ has refKey: ${sj.referenceKey}, refNum: ${sj.suratJalanNumber}`);
        correctPartition = false;
        failCount++;
      } else {
        console.log(`  ✅ ${drop.locationName} - correctly assigned`);
      }
    }
  }

  if (correctPartition) {
    console.log('\n✅ PASS: All drops correctly partitioned');
    passCount++;
  }

  // Test 4: Primary SJ should only contain drops without references
  console.log('\n--- TEST 4: Primary SJ isolation (no reference contamination) ---');
  const testDO2: Partial<DeliveryOrder> = {
    _id: 'test-primary-isolation',
    _type: 'deliveryOrder',
    doNumber: 'TEST-PRIMARY',
    orderRef: 'test-order',
    date: '2026-06-09',
    status: 'DELIVERED',
    actualDropPoints: [
      { _key: 'd1', sequence: 1, stopType: 'DROP', locationName: 'Primary 1', qtyKoli: 5 },
      { _key: 'd2', sequence: 2, stopType: 'DROP', locationName: 'Primary 2', qtyKoli: 3 },
      { _key: 'd3', sequence: 3, stopType: 'DROP', shipperReferenceKey: 'some-ref', locationName: 'Should not appear', qtyKoli: 99 },
    ],
  };

  const sjDocs2 = mapDeliveryOrdersToSuratJalanDocuments([testDO2 as DeliveryOrder], []);
  const primarySJ = sjDocs2[0];
  const primaryDrops = primarySJ.actualDropPoints || [];

  console.log(`Primary SJ has ${primaryDrops.length} drops`);
  const hasContamination = primaryDrops.some(d => d.shipperReferenceKey || d.shipperReferenceNumber);

  if (!hasContamination && primaryDrops.length === 2) {
    console.log('✅ PASS: Primary SJ correctly isolated (only 2 drops without references)');
    passCount++;
  } else {
    console.log('❌ FAIL: Primary SJ has contamination or wrong count');
    primaryDrops.forEach(d => {
      console.log(`  - ${d.locationName} (refKey: ${d.shipperReferenceKey || 'none'}, refNum: ${d.shipperReferenceNumber || 'none'})`);
    });
    failCount++;
  }

  // Test 5: Reference-based SJ should not contain primary drops
  console.log('\n--- TEST 5: Reference SJ isolation (no primary contamination) ---');
  const testDO3: Partial<DeliveryOrder> = {
    _id: 'test-ref-isolation',
    _type: 'deliveryOrder',
    doNumber: 'TEST-REF-ISO',
    orderRef: 'test-order',
    date: '2026-06-09',
    status: 'DELIVERED',
    shipperReferences: [
      { _key: 'ref-x', sequence: 1, referenceNumber: 'SJ-X' },
    ],
    actualDropPoints: [
      { _key: 'd1', sequence: 1, stopType: 'DROP', locationName: 'Primary drop (should be ignored)', qtyKoli: 99 },
      { _key: 'd2', sequence: 2, stopType: 'DROP', shipperReferenceKey: 'ref-x', locationName: 'Ref X drop 1', qtyKoli: 5 },
      { _key: 'd3', sequence: 3, stopType: 'DROP', shipperReferenceKey: 'ref-x', locationName: 'Ref X drop 2', qtyKoli: 3 },
    ],
  };

  const sjDocs3 = mapDeliveryOrdersToSuratJalanDocuments([testDO3 as DeliveryOrder], []);
  const refXSJ = sjDocs3.find(sj => sj.referenceKey === 'ref-x');
  const refXDrops = refXSJ?.actualDropPoints || [];

  console.log(`Reference SJ-X has ${refXDrops.length} drops`);
  const hasPrimaryContamination = refXDrops.some(d => !d.shipperReferenceKey && !d.shipperReferenceNumber);

  if (!hasPrimaryContamination && refXDrops.length === 2) {
    console.log('✅ PASS: Reference SJ correctly isolated (only 2 drops with ref-x)');
    passCount++;
  } else {
    console.log('❌ FAIL: Reference SJ has primary contamination or wrong count');
    refXDrops.forEach(d => {
      console.log(`  - ${d.locationName} (refKey: ${d.shipperReferenceKey || 'none'})`);
    });
    failCount++;
  }

  // Test 6: shipperReferenceNumber matching should work
  console.log('\n--- TEST 6: shipperReferenceNumber matching (the fix) ---');
  const testDO4: Partial<DeliveryOrder> = {
    _id: 'test-refnum-match',
    _type: 'deliveryOrder',
    doNumber: 'TEST-REFNUM',
    orderRef: 'test-order',
    date: '2026-06-09',
    status: 'DELIVERED',
    shipperReferences: [
      { _key: 'ref-z', sequence: 1, referenceNumber: 'SJ-Z-123' },
    ],
    actualDropPoints: [
      // This drop uses shipperReferenceNumber instead of shipperReferenceKey
      { _key: 'd1', sequence: 1, stopType: 'DROP', shipperReferenceNumber: 'SJ-Z-123', locationName: 'Matched by refNum', qtyKoli: 10 },
      // This drop uses shipperReferenceKey
      { _key: 'd2', sequence: 2, stopType: 'DROP', shipperReferenceKey: 'ref-z', locationName: 'Matched by refKey', qtyKoli: 5 },
    ],
  };

  const sjDocs4 = mapDeliveryOrdersToSuratJalanDocuments([testDO4 as DeliveryOrder], []);
  const refZSJ = sjDocs4.find(sj => sj.suratJalanNumber === 'SJ-Z-123');
  const refZDrops = refZSJ?.actualDropPoints || [];

  console.log(`SJ-Z-123 has ${refZDrops.length} drops`);
  const hasBothTypes = refZDrops.some(d => d.shipperReferenceNumber) &&
                       refZDrops.some(d => d.shipperReferenceKey);

  if (refZDrops.length === 2 && hasBothTypes) {
    console.log('✅ PASS: shipperReferenceNumber matching works (both types captured)');
    refZDrops.forEach(d => {
      console.log(`  - ${d.locationName}`);
    });
    passCount++;
  } else {
    console.log('❌ FAIL: shipperReferenceNumber matching failed');
    console.log(`  Expected 2 drops, got ${refZDrops.length}`);
    failCount++;
  }

  // Summary
  console.log('\n\n=== LOGICAL CONSISTENCY SUMMARY ===');
  console.log(`Total Tests: ${passCount + failCount}`);
  console.log(`Passed: ${passCount} ✅`);
  console.log(`Failed: ${failCount} ❌`);
  console.log(`Success Rate: ${passCount + failCount > 0 ? ((passCount / (passCount + failCount)) * 100).toFixed(1) : 0}%`);

  if (failCount > 0) {
    console.log('\n⚠️  LOGICAL INCONSISTENCY DETECTED!');
    console.log('The fix has introduced logical errors.');
    process.exit(1);
  } else {
    console.log('\n✅ ALL LOGICAL CONSISTENCY TESTS PASSED!');
    console.log('The fix is sound and does not introduce logical fallacies.');
  }
}

testLogicalConsistency().catch(error => {
  console.error('Logical consistency test failed with error:', error);
  process.exit(1);
});
