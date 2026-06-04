import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const requiredPaths = [
  'supabase/README.md',
  'src/lib/supabase.ts',
  'src/lib/supabase-relational.ts',
  'src/lib/repositories/document-store.ts',
  'src/lib/data-backend.ts',
  'scripts/seed-supabase.ts',
  'scripts/reset-supabase.ts',
  'scripts/import-supabase.mjs',
];

const workflowFile = 'src/lib/api/order-workflows.ts';
const supportFile = 'src/lib/api/order-workflow-support.ts';
const genericWorkflowFile = 'src/lib/api/generic-workflows.ts';
const supportWorkflowFile = 'src/lib/api/support-workflows.ts';
const dataRouteFile = 'src/app/api/data/route.ts';
const relationalFile = 'src/lib/supabase-relational.ts';
const documentStoreFile = 'src/lib/repositories/document-store.ts';
const resetSupabaseFile = 'scripts/reset-supabase.ts';
const migrationHotspots = [
  'src/lib/auth.ts',
  'src/app/api/data/route.ts',
  'src/lib/api/generic-workflows.ts',
  'src/lib/api/order-workflows.ts',
  'src/lib/api/order-workflow-support.ts',
];

const functionChecks = [
  {
    name: 'syncOrderStatusFromItems',
    mustInclude: ['getDocumentById<', "listDocumentsByFilter<OrderItemStatusSummary>('orderItem'", "updateDocument(orderRef, { status: nextStatus }, 'order')"],
  },
  {
    name: 'handleOrderItemHoldSet',
    mustInclude: ['isSupabaseBackendEnabled()', 'getDocumentById<OrderItemProgressSnapshot', 'updateDocument(id, {'],
  },
  {
    name: 'handleOrderItemHoldRelease',
    mustInclude: ['isSupabaseBackendEnabled()', 'getDocumentById<OrderItemProgressSnapshot', "updateDocument(id, updates, 'orderItem')"],
  },
  {
    name: 'handleOrderDelete',
    mustInclude: [
      'isSupabaseBackendEnabled()',
      "listDocumentsByFilter<{ _id: string }>('deliveryOrder'",
      "listDocumentsByFilter<{ _id: string }>('invoice'",
      "Promise.all(orderItems.map(orderItem => deleteDocument(orderItem._id, 'orderItem')))",
      "await deleteDocument(id, 'order');",
    ],
  },
  {
    name: 'handleOrderCreate',
    mustInclude: [
      "const masterResi = await getNextNumber('resi')",
      'await createDocument(orderDoc);',
      '...items.map(item => createDocument(buildOrderItemDraftDocument(orderId, item)))',
    ],
  },
  {
    name: 'handleOrderUpdateWithItems',
    mustInclude: [
      "const order = await getDocumentById<{",
      "listDocumentsByFilter<{ _id: string }>('deliveryOrder', { orderRef: id })",
      'const touchPromises: Array<Promise<unknown>> = [',
      "updateDocument(id, {",
      "Promise.all(existingItems.map(existingItem => deleteDocument(existingItem._id, 'orderItem')))",
      'Promise.all(items.map(item => createDocument(buildOrderItemDraftDocument(id, item))))',
    ],
  },
  {
    name: 'handleOrderHeaderBookingUpdate',
    mustInclude: [
      "const order = await getDocumentById<{",
      "listDocumentsByFilter<{ _id: string }>('deliveryOrder', { orderRef: id })",
      "await updateDocument(id, { notes }, 'order')",
      "updatedOrder = await updateDocument(id, {",
    ],
  },
  {
    name: 'handleOrderTargetRevision',
    mustInclude: [
      "const order = await getDocumentById<{ _id: string; _rev?: string; masterResi?: string; notes?: string; cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER' }>(id, 'order')",
      "const updatedOrder = await getDocumentById(id, 'order')",
    ],
  },
  {
    name: 'releaseDriverTrackingLockIfOwned',
    mustInclude: ["getDocumentById<{ _id: string; _rev?: string; activeTrackingDeliveryOrderRef?: unknown }>(driverId, 'driver')", 'isSupabaseBackendEnabled()', 'await updateDocument(driverId, {'],
  },
  {
    name: 'handleDeliveryOrderTripResourceAssign',
    mustInclude: [
      "const deliveryOrder = await getDocumentById<{",
      "listDocumentsByFilter<{ _id: string; bonNumber?: string }>('driverVoucher', {",
      "listDocumentsByFilter<{ _id: string }>('driverBoronganItem', {",
      "await updateDocument(id, {",
      "const unchangedDeliveryOrder = await getDocumentById(id, 'deliveryOrder')",
    ],
  },
  {
    name: 'handleDeliveryOrderShipperReferenceUpdate',
    mustInclude: [
      "const deliveryOrder = await getDocumentById<{",
      "listDocumentsByFilter<{ _id: string; notaRef?: string; status?: string }>('freightNotaItem', {",
      "item.status !== 'VOID'",
      "listDocumentsByFilter<{ _id: string; boronganRef?: string }>('driverBoronganItem', {",
      "const unchangedDeliveryOrder = await getDocumentById(id, 'deliveryOrder')",
      "await updateDocument(id, {",
    ],
  },
  {
    name: 'handleDeliveryOrderCreate',
    mustInclude: [
      "const order = await getDocumentById<{",
      "await getDocumentById<{",
      "const existingOrderItems = await listDocumentsByFilter<{",
      "selectedItems = (await Promise.all(",
      "const doNumber = await getNextNumber('do', doDate)",
      'const companyProfile = await getCompanyProfile<',
      'await createDocument(doDoc);',
      "await createDocument({",
      'await updateDocument(item._id, {',
    ],
  },
  {
    name: 'handleDeliveryOrderStatusUpdate',
    mustInclude: [
      "const deliveryOrder = await getDocumentById<{",
      "listDocumentsByFilter<DeliveryOrderItemCargoSnapshot & { _rev?: string }>('deliveryOrderItem', { deliveryOrderRef: id })",
      "await updateDocument(id, deliveryOrderUpdates, 'deliveryOrder');",
      'await createDocument({',
      "const orderItem = await getDocumentById<OrderItemProgressSnapshot & { _rev?: string }>(orderItemRef, 'orderItem');",
    ],
  },
  {
    name: 'handleDeliveryOrderDriverStatusRequest',
    mustInclude: [
      "const deliveryOrder = await getDocumentById<{",
      "const doItems = await listDocumentsByFilter<{",
      "'deliveryOrderItem', { deliveryOrderRef: id })",
      'await updateDocument(id, {',
      "status: buildDriverRequestedTrackingStatus(status)",
      'pendingDriverActualCargoItems,',
    ],
  },
  {
    name: 'handleDeliveryOrderDriverStatusRequestReject',
    mustInclude: [
      "const deliveryOrder = await getDocumentById<{",
      'await updateDocument(id, {',
      "status: 'DRIVER_REQUEST_REJECTED'",
      'pendingDriverStatus: null,',
    ],
  },
];

const supportFunctionChecks = [
  {
    name: 'resolveOrderPartyData',
    mode: 'file',
    mustInclude: ["getDocumentById<{ _id: string; _rev?: string; name?: string; address?: string; active?: boolean }>(customerRef, 'customer')", "getDocumentById<{ _id: string; _rev?: string; name?: string; active?: boolean }>(serviceRef, 'service')"],
  },
  {
    name: 'resolveOrderRecipientData',
    mode: 'file',
    mustInclude: ["getDocumentById<ResolvedCustomerRecipientData>(customerRecipientRef, 'customerRecipient')"],
  },
  {
    name: 'resolveOrderPickupData',
    mode: 'file',
    mustInclude: ["getDocumentById<ResolvedCustomerPickupData>(customerPickupRef, 'customerPickupLocation')"],
  },
  {
    name: 'normalizeOrderItemsInput',
    mode: 'file',
    mustInclude: ["listDocumentsByFilter<CustomerProductOrderSource>('customerProduct', { _id: customerProductRefs })"],
    mustNotInclude: ['getSanityClient().fetch<CustomerProductOrderSource[]>('],
  },
];

const genericWorkflowChecks = [
  {
    name: 'handleGenericCreate',
    mode: 'file',
    mustInclude: [
      "const deliveryOrder = await getDocumentById<{ _id: string; status?: string }>(deliveryOrderRef, 'deliveryOrder')",
      "const orderItem = await getDocumentById<{ _id: string }>(orderItemRef, 'orderItem')",
      "const assignments = await listDocumentsByFilter<{ _id: string; deliveryOrderRef?: string; orderItemRef?: string }>('deliveryOrderItem', {",
      'if (isSupabaseBackendEnabled()) {',
      'created = await createDocument<Record<string, unknown> & { _id: string }>(newDoc);',
      "await updateDocument(newDoc.driverRef, { updatedAt: new Date().toISOString() }, 'driver');",
    ],
  },
];

const supportWorkflowChecks = [
  {
    name: 'normalizeUserCreatePayload',
    mode: 'file',
    mustInclude: [
      'isSupabaseBackendEnabled()',
      "listDocumentsByFilter<{ _id: string; email?: string }>('user', { email })",
      'validateDriverAccountLink(data.driverRef)',
      "listDocumentsByFilter<{ _id: string; role?: string; driverRef?: string }>('user', {",
    ],
  },
];

const dataRouteChecks = [
  {
    name: 'data-route-aggregations',
    mode: 'file',
    mustInclude: [
      "const allocationRows = await listDocumentsByFilter<{ receiptRef?: string; amount?: unknown }>('payment', {",
      "await createDocument({",
      "const txRows = await listDocumentsByFilter<Pick<BankTransaction, 'bankAccountRef' | 'type' | 'amount'>>('bankTransaction', {",
      "const boronganItems = await listDocumentsByFilter<{",
      "listDocumentsByFilter<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind' | 'status'>>('driverVoucherDisbursement', {",
      "listDocumentsByFilter<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>('driverVoucherItem', {",
      'sortPreset,',
    ],
    mustNotInclude: ['getSanityClient().fetch<', 'sanityCreate(', 'sortClause: getListSortClause'],
  },
];

const relationalAdapterChecks = [
  {
    name: 'work-queue-sort-presets',
    mode: 'file',
    mustInclude: [
      'function getSortPresetComparator',
      "docType === 'order'",
      "docType === 'deliveryOrder'",
      "docType === 'maintenance'",
      "docType === 'incident'",
      'const presetComparator = getSortPresetComparator(docType, options.sortPreset);',
      '? [...filtered].sort(presetComparator)',
    ],
    mustNotInclude: ['sortClause'],
  },
  {
    name: 'numbering-max-suffix',
    mode: 'file',
    mustInclude: [
      'export async function relationalMaxNumericSuffixByPrefix',
      "params.set(column, `like.${prefix}*`)",
      'Math.max(max, sequence)',
    ],
  },
];

const expectedTripRouteRatePhotoSources = new Map([
  ['Engkel Jawa Timur', 80],
  ['Tronton dan Trailer Jawa Timur', 81],
  ['Tronton dan Trailer Jawa Tengah', 80],
]);
const bcryptHashRe = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function getFunctionBody(source, functionName) {
  let exportIndex = source.indexOf(`export async function ${functionName}`);
  if (exportIndex === -1) {
    exportIndex = source.indexOf(`async function ${functionName}`);
  }
  if (exportIndex === -1) {
    return null;
  }

  const bodyStart = source.indexOf('{', exportIndex);
  if (bodyStart === -1) {
    return null;
  }

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart, index + 1);
      }
    }
  }

  return null;
}

function countMatches(source, pattern) {
  const matches = source.match(pattern);
  return matches ? matches.length : 0;
}

console.log('Supabase migration audit');
console.log('');

console.log('Required files');
for (const relativePath of requiredPaths) {
  const absolutePath = path.join(repoRoot, relativePath);
  const ok = existsSync(absolutePath);
  console.log(`- ${ok ? 'OK ' : 'MISS'} ${relativePath}`);
  if (!ok) {
    fail(`Missing required migration asset: ${relativePath}`);
  }
}

console.log('');
console.log('Workflow function checks');
const workflowSource = readFileSync(path.join(repoRoot, workflowFile), 'utf8');
for (const check of functionChecks) {
  const body = getFunctionBody(workflowSource, check.name);
  if (!body) {
    fail(`Could not locate function body for ${check.name}`);
    continue;
  }

  const missing = check.mustInclude.filter(fragment => !body.includes(fragment));
  const forbidden = (check.mustNotInclude || []).filter(fragment => body.includes(fragment));
  if (missing.length > 0 || forbidden.length > 0) {
    console.log(`- FAIL ${check.name}`);
    for (const fragment of missing) {
      console.log(`  missing: ${fragment}`);
    }
    for (const fragment of forbidden) {
      console.log(`  forbidden: ${fragment}`);
    }
    fail(`Workflow function ${check.name} failed Supabase migration markers`);
    continue;
  }

  console.log(`- OK   ${check.name}`);
}

console.log('');
console.log('Support function checks');
const supportSource = readFileSync(path.join(repoRoot, supportFile), 'utf8');
for (const check of supportFunctionChecks) {
  const haystack = check.mode === 'file' ? supportSource : getFunctionBody(supportSource, check.name);
  if (!haystack) {
    fail(`Could not locate function body for ${check.name}`);
    continue;
  }

  const missing = check.mustInclude.filter(fragment => !haystack.includes(fragment));
  const forbidden = (check.mustNotInclude || []).filter(fragment => haystack.includes(fragment));
  if (missing.length > 0 || forbidden.length > 0) {
    console.log(`- FAIL ${check.name}`);
    for (const fragment of missing) {
      console.log(`  missing: ${fragment}`);
    }
    for (const fragment of forbidden) {
      console.log(`  forbidden: ${fragment}`);
    }
    fail(`Support function ${check.name} failed Supabase migration markers`);
    continue;
  }

  console.log(`- OK   ${check.name}`);
}

console.log('');
console.log('Generic workflow checks');
const genericWorkflowSource = readFileSync(path.join(repoRoot, genericWorkflowFile), 'utf8');
for (const check of genericWorkflowChecks) {
  const haystack = check.mode === 'file' ? genericWorkflowSource : getFunctionBody(genericWorkflowSource, check.name);
  if (!haystack) {
    fail(`Could not locate function body for ${check.name}`);
    continue;
  }

  const missing = check.mustInclude.filter(fragment => !haystack.includes(fragment));
  const forbidden = (check.mustNotInclude || []).filter(fragment => haystack.includes(fragment));
  if (missing.length > 0 || forbidden.length > 0) {
    console.log(`- FAIL ${check.name}`);
    for (const fragment of missing) {
      console.log(`  missing: ${fragment}`);
    }
    for (const fragment of forbidden) {
      console.log(`  forbidden: ${fragment}`);
    }
    fail(`Generic workflow ${check.name} failed Supabase migration markers`);
    continue;
  }

  console.log(`- OK   ${check.name}`);
}

console.log('');
console.log('Support workflow checks');
const supportWorkflowSource = readFileSync(path.join(repoRoot, supportWorkflowFile), 'utf8');
for (const check of supportWorkflowChecks) {
  const haystack = check.mode === 'file' ? supportWorkflowSource : getFunctionBody(supportWorkflowSource, check.name);
  if (!haystack) {
    fail(`Could not locate function body for ${check.name}`);
    continue;
  }

  const missing = check.mustInclude.filter(fragment => !haystack.includes(fragment));
  const forbidden = (check.mustNotInclude || []).filter(fragment => haystack.includes(fragment));
  if (missing.length > 0 || forbidden.length > 0) {
    console.log(`- FAIL ${check.name}`);
    for (const fragment of missing) {
      console.log(`  missing: ${fragment}`);
    }
    for (const fragment of forbidden) {
      console.log(`  forbidden: ${fragment}`);
    }
    fail(`Support workflow ${check.name} failed Supabase migration markers`);
    continue;
  }

  console.log(`- OK   ${check.name}`);
}

console.log('');
console.log('Data route checks');
const dataRouteSource = readFileSync(path.join(repoRoot, dataRouteFile), 'utf8');
for (const check of dataRouteChecks) {
  const haystack = check.mode === 'file' ? dataRouteSource : getFunctionBody(dataRouteSource, check.name);
  if (!haystack) {
    fail(`Could not locate content for ${check.name}`);
    continue;
  }

  const missing = (check.mustInclude || []).filter(fragment => !haystack.includes(fragment));
  const forbidden = (check.mustNotInclude || []).filter(fragment => haystack.includes(fragment));
  if (missing.length > 0 || forbidden.length > 0) {
    console.log(`- FAIL ${check.name}`);
    for (const fragment of missing) {
      console.log(`  missing: ${fragment}`);
    }
    for (const fragment of forbidden) {
      console.log(`  forbidden: ${fragment}`);
    }
    fail(`Data route check ${check.name} failed`);
    continue;
  }

  console.log(`- OK   ${check.name}`);
}

console.log('');
console.log('Relational adapter checks');
const relationalSource = readFileSync(path.join(repoRoot, relationalFile), 'utf8');
for (const check of relationalAdapterChecks) {
  const haystack = check.mode === 'file' ? relationalSource : getFunctionBody(relationalSource, check.name);
  if (!haystack) {
    fail(`Could not locate content for ${check.name}`);
    continue;
  }

  const missing = (check.mustInclude || []).filter(fragment => !haystack.includes(fragment));
  const forbidden = (check.mustNotInclude || []).filter(fragment => haystack.includes(fragment));
  if (missing.length > 0 || forbidden.length > 0) {
    console.log(`- FAIL ${check.name}`);
    for (const fragment of missing) {
      console.log(`  missing: ${fragment}`);
    }
    for (const fragment of forbidden) {
      console.log(`  forbidden: ${fragment}`);
    }
    fail(`Relational adapter check ${check.name} failed`);
    continue;
  }

  console.log(`- OK   ${check.name}`);
}
const documentStoreSource = readFileSync(path.join(repoRoot, documentStoreFile), 'utf8');
if (
  !documentStoreSource.includes('relationalMaxNumericSuffixByPrefix') ||
  !documentStoreSource.includes('const maxExistingSuffix') ||
  !documentStoreSource.includes('Math.max(currentCounter, maxExistingSuffix) + 1') ||
  documentStoreSource.includes('relationalCountByPrefix') ||
  !documentStoreSource.includes("'is.null'")
) {
  fail('Document numbering harus memakai suffix maksimum existing dan lock synced_at null-safe, bukan count row.');
} else {
  console.log('- OK   document numbering max suffix and null-safe lock');
}

console.log('');
console.log('Seed data checks');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
if (!String(packageJson.scripts?.['reseed:supabase'] || '').includes('backfill:accounting')) {
  fail('reseed:supabase harus menjalankan backfill:accounting agar jurnal finance tidak stale setelah reset/seed.');
} else {
  console.log('- OK   reseed:supabase runs accounting backfill');
}
const resetSupabaseSource = readFileSync(path.join(repoRoot, resetSupabaseFile), 'utf8');
if (
  !resetSupabaseSource.includes("hasFlag('--preserve-trip-rates')") ||
  !resetSupabaseSource.includes("preserveTables.add('services')") ||
  !resetSupabaseSource.includes("preserveTables.add('trip_route_rates')") ||
  !resetSupabaseSource.includes("hasFlag('--preserve-users')") ||
  !resetSupabaseSource.includes("preserveTables.add('app_users')") ||
  !resetSupabaseSource.includes("hasFlag('--all-managed-data')") ||
  !resetSupabaseSource.includes('source_document_id=is.null')
) {
  fail('Reset Supabase safe workflow harus bisa reset semua data managed, preserve user login, dan preserve layanan/upah trip saat diminta.');
} else {
  console.log('- OK   reset:supabase supports safe full reset with preserved users and trip rates');
}
const safeReseedScript = String(packageJson.scripts?.['reseed:supabase:safe-workflow'] || '');
const safeSeedScript = String(packageJson.scripts?.['seed:supabase:safe-workflow'] || '');
if (
  !safeSeedScript.includes('--skip-doc-types=user,service,tripRouteRate') ||
  !safeSeedScript.includes('--derive-trip-surat-jalan') ||
  !safeReseedScript.includes('--all-managed-data') ||
  !safeReseedScript.includes('--preserve-users') ||
  !safeReseedScript.includes('--preserve-trip-rates') ||
  !safeReseedScript.includes('backfill:accounting')
) {
  fail('Safe Supabase reseed harus derive Trip/SJ terbaru, skip user/service/tripRouteRate seed, preserve data tersebut saat reset, dan menjalankan backfill accounting.');
} else {
  console.log('- OK   safe Supabase reseed derives Trip/SJ, preserves login users, services, trip rates, and backfills accounting');
}
const seedPath = path.join(repoRoot, 'artifacts/default-supabase-seed.json');
const seedDocuments = JSON.parse(readFileSync(seedPath, 'utf8'));
const seedUsers = seedDocuments.filter(doc => doc?._type === 'user');
const invalidSeedPasswordUsers = seedUsers.filter(user => typeof user.passwordHash !== 'string' || !bcryptHashRe.test(user.passwordHash));
if (invalidSeedPasswordUsers.length > 0) {
  fail(`Seed user masih punya passwordHash bukan bcrypt valid: ${invalidSeedPasswordUsers.map(user => user.email || user._id).slice(0, 5).join(', ')}`);
} else {
  console.log(`- OK   seed user password hashes bcrypt-valid (${seedUsers.length} users)`);
}
const tripRouteRates = seedDocuments.filter(doc => doc?._type === 'tripRouteRate');
const tripRouteRateSourceCounts = new Map();
const tripRouteRateKeys = new Set();
const duplicateTripRouteRateKeys = [];
const removedDemoTripRateRefs = new Set(Array.from({ length: 9 }, (_, index) => `trip-rate-00${index + 1}`));
const staleRemovedDemoTripRateRefs = [];
let invalidTripRouteRates = 0;
let tripRouteRatesWithoutPhotoSource = 0;

for (const rate of tripRouteRates) {
  const photoSource = typeof rate.photoSource === 'string' ? rate.photoSource.trim() : '';
  if (!photoSource) {
    tripRouteRatesWithoutPhotoSource += 1;
  }
  tripRouteRateSourceCounts.set(photoSource, (tripRouteRateSourceCounts.get(photoSource) || 0) + 1);

  if (
    typeof rate.originArea !== 'string' ||
    !rate.originArea.trim() ||
    typeof rate.destinationArea !== 'string' ||
    !rate.destinationArea.trim() ||
    typeof rate.serviceRef !== 'string' ||
    !rate.serviceRef.trim() ||
    typeof rate.rate !== 'number' ||
    !Number.isFinite(rate.rate) ||
    rate.rate <= 0
  ) {
    invalidTripRouteRates += 1;
  }

  const key = [
    String(rate.originArea || '').trim().toLowerCase(),
    String(rate.destinationArea || '').trim().toLowerCase(),
    String(rate.serviceRef || '').trim().toLowerCase(),
  ].join('|');
  if (tripRouteRateKeys.has(key)) {
    duplicateTripRouteRateKeys.push(key);
  }
  tripRouteRateKeys.add(key);
}

if (tripRouteRatesWithoutPhotoSource > 0) {
  fail(`Seed biaya trip masih punya ${tripRouteRatesWithoutPhotoSource} data tanpa photoSource.`);
} else {
  console.log('- OK   trip-route-rates all photo-backed');
}

for (const [photoSource, expectedCount] of expectedTripRouteRatePhotoSources.entries()) {
  const actualCount = tripRouteRateSourceCounts.get(photoSource) || 0;
  if (actualCount !== expectedCount) {
    fail(`Seed biaya trip ${photoSource} harus ${expectedCount}, sekarang ${actualCount}.`);
  }
}

if (invalidTripRouteRates > 0) {
  fail(`Seed biaya trip punya ${invalidTripRouteRates} data tidak valid.`);
} else {
  console.log('- OK   trip-route-rates required fields valid');
}

if (duplicateTripRouteRateKeys.length > 0) {
  fail(`Seed biaya trip punya duplikasi rute/kategori: ${duplicateTripRouteRateKeys.slice(0, 5).join(', ')}`);
} else {
  console.log(`- OK   trip-route-rates photo counts ${tripRouteRates.length} and no duplicate route/service keys`);
}

for (const doc of seedDocuments) {
  for (const [key, value] of Object.entries(doc)) {
    if (removedDemoTripRateRefs.has(value)) {
      staleRemovedDemoTripRateRefs.push(`${doc._type}/${doc._id}.${key}=${value}`);
    }
  }
}

if (staleRemovedDemoTripRateRefs.length > 0) {
  fail(`Seed masih mereferensikan biaya trip demo yang sudah dihapus: ${staleRemovedDemoTripRateRefs.slice(0, 5).join(', ')}`);
} else {
  console.log('- OK   removed demo trip-route-rate refs are not referenced by seed docs');
}

console.log('');
console.log('Direct Sanity usage snapshot');
for (const relativePath of migrationHotspots) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    console.log(`- SKIP ${relativePath} (not found)`);
    continue;
  }

  const source = readFileSync(absolutePath, 'utf8');
  const importCount = countMatches(source, /from ['"]@\/lib\/sanity['"]/g);
  const clientCount = countMatches(source, /getSanityClient\(/g);
  const byIdCount = countMatches(source, /sanityGetById\(/g);
  const nextNumberCount = countMatches(source, /sanityGetNextNumber\(/g);

  console.log(
    `- ${relativePath}: import=${importCount}, client=${clientCount}, byId=${byIdCount}, nextNumber=${nextNumberCount}`
  );
}

if (process.exitCode) {
  console.log('');
  console.log('Audit finished with issues.');
} else {
  console.log('');
  console.log('Audit finished successfully.');
}
