import { loadScriptEnv } from './_env';
loadScriptEnv();
import { listDocuments } from '../src/lib/repositories/document-store';
import { mapDeliveryOrdersToSuratJalanDocuments } from '../src/lib/trip-document-mappers';
import type { DeliveryOrder } from '../src/lib/types';

async function testSuratJalanDestinationFix() {
  console.log('\n=== TEST: Surat Jalan Destination Fix ===\n');

  const { items: doList } = await listDocuments<DeliveryOrder>('deliveryOrder', {
    page: 1,
    pageSize: 50,
    sortField: 'createdAt',
    sortDir: 'desc',
    countStrategy: 'none',
  });

  console.log(`Found ${doList.length} delivery orders\n`);

  let testCount = 0;
  let passCount = 0;
  let failCount = 0;

  // Test Case 1: Primary SJ (no shipper references)
  console.log('\n--- TEST CASE 1: Primary SJ (no shipper references) ---');
  const primaryDOs = doList.filter(d =>
    !d.shipperReferences?.length &&
    (d.actualDropPoints?.length ?? 0) > 0
  );

  for (const d of primaryDOs.slice(0, 3)) {
    testCount++;
    const sjDocs = mapDeliveryOrdersToSuratJalanDocuments([d], []);

    for (const sj of sjDocs) {
      const doDrops = d.actualDropPoints || [];
      const sjDrops = sj.actualDropPoints || [];

      // Filter DO drops that should belong to primary SJ
      const expectedDrops = doDrops.filter(drop =>
        !drop.shipperReferenceKey && !drop.shipperReferenceNumber
      );

      console.log(`\nDO: ${d.doNumber || d._id}`);
      console.log(`  DO actualDropPoints: ${doDrops.length} total`);
      console.log(`  Expected for primary SJ: ${expectedDrops.length}`);
      console.log(`  SJ actualDropPoints: ${sjDrops.length}`);
      console.log(`  Match: ${sjDrops.length === expectedDrops.length ? '✅' : '❌'}`);

      if (sjDrops.length > 0) {
        console.log(`  Sample locations:`);
        sjDrops.slice(0, 3).forEach((drop, i) => {
          console.log(`    ${i+1}. ${drop.locationName || drop.locationAddress || '(no location)'}`);
        });
      }

      if (sjDrops.length === expectedDrops.length) {
        passCount++;
      } else {
        failCount++;
      }
    }
  }

  // Test Case 2: Multi-SJ with different shipperReferenceKey
  console.log('\n--- TEST CASE 2: Multi-SJ with shipperReferenceKey ---');
  const multiSJDOs = doList.filter(d =>
    d.shipperReferences?.length > 1 &&
    (d.actualDropPoints?.length ?? 0) > 0
  );

  for (const d of multiSJDOs.slice(0, 3)) {
    testCount++;
    const sjDocs = mapDeliveryOrdersToSuratJalanDocuments([d], []);

    console.log(`\nDO: ${d.doNumber || d._id}`);
    console.log(`  Shipper References: ${d.shipperReferences?.length}`);
    console.log(`  Total actualDropPoints: ${d.actualDropPoints?.length}`);
    console.log(`  Generated SJ Documents: ${sjDocs.length}`);

    let allMatch = true;
    for (const sj of sjDocs) {
      const sjDrops = sj.actualDropPoints || [];
      const refKey = sj.referenceKey;
      const refNum = sj.suratJalanNumber;

      // Count expected drops for this SJ
      const expectedDrops = (d.actualDropPoints || []).filter(drop => {
        if (!refKey) {
          return !drop.shipperReferenceKey && !drop.shipperReferenceNumber;
        }
        return drop.shipperReferenceKey === refKey || drop.shipperReferenceNumber === refNum;
      });

      const match = sjDrops.length === expectedDrops.length;
      console.log(`  SJ[${refKey || 'primary'}] (${refNum}):`);
      console.log(`    Expected drops: ${expectedDrops.length}`);
      console.log(`    Actual drops: ${sjDrops.length}`);
      console.log(`    Match: ${match ? '✅' : '❌'}`);

      if (sjDrops.length > 0) {
        sjDrops.slice(0, 2).forEach((drop, i) => {
          console.log(`      ${i+1}. ${drop.locationName || drop.locationAddress || '(no location)'}`);
        });
      }

      if (!match) allMatch = false;
    }

    if (allMatch) {
      passCount++;
    } else {
      failCount++;
    }
  }

  // Test Case 3: Single SJ with multiple drop points (same destination repeated)
  console.log('\n--- TEST CASE 3: Single SJ with multiple drops ---');
  const multiDropDOs = doList.filter(d =>
    (d.actualDropPoints?.length ?? 0) >= 3 &&
    (!d.shipperReferences?.length || d.shipperReferences.length === 1)
  );

  for (const d of multiDropDOs.slice(0, 3)) {
    testCount++;
    const sjDocs = mapDeliveryOrdersToSuratJalanDocuments([d], []);

    console.log(`\nDO: ${d.doNumber || d._id}`);
    console.log(`  Total actualDropPoints: ${d.actualDropPoints?.length}`);

    for (const sj of sjDocs) {
      const sjDrops = sj.actualDropPoints || [];
      const uniqueLocations = new Set(
        sjDrops.map(d => d.locationName || d.locationAddress).filter(Boolean)
      );

      console.log(`  SJ drops: ${sjDrops.length}`);
      console.log(`  Unique locations: ${uniqueLocations.size}`);
      console.log(`  Locations: ${Array.from(uniqueLocations).join(', ')}`);

      if (sjDrops.length > 0) {
        passCount++;
      } else {
        failCount++;
        console.log(`  ❌ FAIL: No drops found but DO has ${d.actualDropPoints?.length} drops`);
      }
    }
  }

  // Test Case 4: Edge case - shipperReferenceNumber only (no key)
  console.log('\n--- TEST CASE 4: shipperReferenceNumber only (no key) ---');
  const refNumOnlyDOs = doList.filter(d => {
    return d.actualDropPoints?.some(drop =>
      drop.shipperReferenceNumber && !drop.shipperReferenceKey
    );
  });

  for (const d of refNumOnlyDOs.slice(0, 3)) {
    testCount++;
    const sjDocs = mapDeliveryOrdersToSuratJalanDocuments([d], []);

    console.log(`\nDO: ${d.doNumber || d._id}`);

    for (const sj of sjDocs) {
      const sjDrops = sj.actualDropPoints || [];
      const refNum = sj.suratJalanNumber;

      // Count drops that should match by referenceNumber
      const dropsWithRefNum = (d.actualDropPoints || []).filter(drop =>
        drop.shipperReferenceNumber === refNum
      );

      console.log(`  SJ: ${refNum}`);
      console.log(`  DO drops with this refNum: ${dropsWithRefNum.length}`);
      console.log(`  SJ actualDropPoints: ${sjDrops.length}`);
      console.log(`  Match: ${sjDrops.length >= dropsWithRefNum.length ? '✅' : '❌'}`);

      if (sjDrops.length >= dropsWithRefNum.length) {
        passCount++;
      } else {
        failCount++;
      }
    }
  }

  // Summary
  console.log('\n\n=== TEST SUMMARY ===');
  console.log(`Total Tests: ${testCount}`);
  console.log(`Passed: ${passCount} ✅`);
  console.log(`Failed: ${failCount} ❌`);
  console.log(`Success Rate: ${testCount > 0 ? ((passCount / testCount) * 100).toFixed(1) : 0}%`);

  if (failCount > 0) {
    console.log('\n⚠️  Some tests failed. Please review the logic.');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
  }
}

testSuratJalanDestinationFix().catch(error => {
  console.error('Test failed with error:', error);
  process.exit(1);
});
