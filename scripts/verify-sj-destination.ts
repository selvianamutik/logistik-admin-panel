import { loadScriptEnv } from './_env';
loadScriptEnv();
import { listDocuments } from '../src/lib/repositories/document-store';
import { mapDeliveryOrdersToSuratJalanDocuments } from '../src/lib/trip-document-mappers';
import type { DeliveryOrder } from '../src/lib/types';

async function verifyActualDropPointsFlow() {
  console.log('=== VERIFY: actualDropPoints flows to SJ list ===\n');

  const { items: doList } = await listDocuments<{
    _id: string;
    doNumber?: string;
    status: string;
    actualDropPoints?: Array<{ locationName?: string; locationAddress?: string; stopType?: string }>;
    suratJalanRefs?: string[];
    shipperReferences?: Array<{ _key?: string; referenceNumber?: string }>;
  }>('deliveryOrder', {
    page: 1,
    pageSize: 30,
    sortField: 'createdAt',
    sortDir: 'desc',
    countStrategy: 'none',
  });

  let passCount = 0;
  let failCount = 0;

  for (const d of doList) {
    const drops = d.actualDropPoints || [];
    if (drops.length === 0) continue;

    // Simulate what mapDeliveryOrderToSuratJalanDocuments does
    const sjDocs = mapDeliveryOrdersToSuratJalanDocuments([d as unknown as DeliveryOrder], []);
    for (const sj of sjDocs) {
      const sjDrops = sj.actualDropPoints || [];
      const hasLocations = sjDrops.some(dp => dp.locationName || dp.locationAddress);

      if (hasLocations) {
        passCount++;
        console.log(`✅ PASS: ${d.doNumber} -> SJ[${sj.referenceKey || 'primary'}] has ${sjDrops.length} actualDropPoints with locations`);
        for (const dp of sjDrops.slice(0, 2)) {
          console.log(`     "${dp.locationName}" | "${dp.locationAddress}"`);
        }
      } else {
        failCount++;
        console.log(`❌ FAIL: ${d.doNumber} -> SJ[${sj.referenceKey || 'primary'}] has 0 actualDropPoints`);
      }
    }
  }

  console.log('\n=== RESULT ===');
  console.log(`PASS: ${passCount} SJ documents with actualDropPoints locations`);
  console.log(`FAIL: ${failCount} SJ documents missing actualDropPoints`);
  console.log(passCount > 0 && failCount === 0 ? '✅ ALL SJ now have destination data!' : '⚠️ Some SJ still missing data');
}

verifyActualDropPointsFlow().catch(console.error);
