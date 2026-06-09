import { loadScriptEnv } from './_env';
loadScriptEnv();
import { listDocuments } from '../src/lib/repositories/document-store';
import { getReferenceIdentity } from '../src/lib/trip-document-mappers';
import type { DeliveryOrderShipperReference } from '../src/lib/types';

async function debugFailCases() {
  const { items: doList } = await listDocuments<{
    _id: string;
    doNumber?: string;
    actualDropPoints?: Array<{ locationName?: string; shipperReferenceKey?: string }>;
    shipperReferences?: Array<{ _key?: string; referenceNumber?: string }>;
  }>('deliveryOrder', {
    page: 1,
    pageSize: 30,
    sortField: 'createdAt',
    sortDir: 'desc',
    countStrategy: 'none',
  });

  // The 2 fail cases: DO-202603-0001:sj-do-001-1 and DO-31052026-0001:sj-7b7db497
  const failCases = [
    { doId: 'DO-202603-0001', sjKey: 'sj-do-001-1' },
    { doId: 'DO-31052026-0001', sjKey: '7b7db497' },
  ];

  for (const fc of failCases) {
    const d = doList.find(o => o.doNumber === fc.doId);
    if (!d) {
      // Try by ID pattern
      console.log(`\nLooking for DO with doNumber "${fc.doId}"...`);
      const match = doList.find(o => String(o._id).includes(fc.doId.replace(/\D/g, '')));
      console.log('Found by partial ID:', match ? match.doNumber : 'NOT FOUND');
      continue;
    }
    console.log(`\n=== ${d._id} ===`);
    console.log('shipperReferences:', (d.shipperReferences?.length || 0));
    d.shipperReferences?.forEach((sr, i) => {
      console.log(`  [${i}] _key="${sr._key}" refNum="${sr.referenceNumber}" identity="${getReferenceIdentity(sr as DeliveryOrderShipperReference, i)}"`);
    });
    console.log('actualDropPoints:', (d.actualDropPoints?.length || 0));
    d.actualDropPoints?.forEach((dp, i) => {
      console.log(`  [${i}] location="${dp.locationName}" shipperRefKey="${dp.shipperReferenceKey}"`);
    });
  }
}

debugFailCases().catch(console.error);
