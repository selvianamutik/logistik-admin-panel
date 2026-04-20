import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const requiredPaths = [
  'supabase/README.md',
  'src/lib/supabase.ts',
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
    mustInclude: ['getDocumentById<', "listDocumentsByFilter<OrderItemStatusSummary>('orderItem'", 'updateDocument(orderRef, { status: nextStatus })'],
  },
  {
    name: 'handleOrderItemHoldSet',
    mustInclude: ['isSupabaseBackendEnabled()', 'getDocumentById<OrderItemProgressSnapshot', 'updateDocument(id, {'],
  },
  {
    name: 'handleOrderItemHoldRelease',
    mustInclude: ['isSupabaseBackendEnabled()', 'getDocumentById<OrderItemProgressSnapshot', 'updateDocument(id, updates)'],
  },
  {
    name: 'handleOrderDelete',
    mustInclude: ['isSupabaseBackendEnabled()', "listDocumentsByFilter<{ _id: string }>('deliveryOrder'", "listDocumentsByFilter<{ _id: string }>('invoice'", 'deleteDocument(orderItem._id)', 'deleteDocument(id)'],
  },
  {
    name: 'handleOrderCreate',
    mustInclude: [
      "const masterResi = await getNextNumber('resi')",
      'await createDocument(orderDoc);',
      'await updateDocument(customer._id, { updatedAt: createdAt });',
      'await createDocument(buildOrderItemDraftDocument(orderId, item));',
    ],
  },
  {
    name: 'handleOrderUpdateWithItems',
    mustInclude: [
      "const order = await getDocumentById<{",
      "listDocumentsByFilter<{ _id: string }>('deliveryOrder', { orderRef: id })",
      "await updateDocument(id, {",
      'await deleteDocument(existingItem._id);',
      'await createDocument(buildOrderItemDraftDocument(id, item));',
    ],
  },
  {
    name: 'handleOrderHeaderBookingUpdate',
    mustInclude: [
      "const order = await getDocumentById<{",
      "listDocumentsByFilter<{ _id: string }>('deliveryOrder', { orderRef: id })",
      "await updateDocument(id, { notes })",
      "updatedOrder = await updateDocument(id, {",
    ],
  },
  {
    name: 'handleOrderTargetRevision',
    mustInclude: [
      "const order = await getDocumentById<{ _id: string; _rev?: string; masterResi?: string; notes?: string; cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER' }>(id)",
      'const updatedOrder = await getDocumentById(id)',
    ],
  },
  {
    name: 'releaseDriverTrackingLockIfOwned',
    mustInclude: ['getDocumentById<{ _id: string; _rev?: string; activeTrackingDeliveryOrderRef?: unknown }>(driverId)', 'isSupabaseBackendEnabled()', 'await updateDocument(driverId, {'],
  },
  {
    name: 'handleDeliveryOrderTripResourceAssign',
    mustInclude: [
      "const deliveryOrder = await getDocumentById<{",
      "listDocumentsByFilter<{ _id: string; bonNumber?: string }>('driverVoucher', {",
      "listDocumentsByFilter<{ _id: string }>('driverBoronganItem', {",
      "await updateDocument(id, {",
      'const unchangedDeliveryOrder = await getDocumentById(id)',
    ],
  },
  {
    name: 'handleDeliveryOrderShipperReferenceUpdate',
    mustInclude: [
      "const deliveryOrder = await getDocumentById<{",
      "listDocumentsByFilter<{ _id: string; notaRef?: string }>('freightNotaItem', {",
      "listDocumentsByFilter<{ _id: string; boronganRef?: string }>('driverBoronganItem', {",
      'const unchangedDeliveryOrder = await getDocumentById(id)',
      "await updateDocument(id, { customerDoNumber })",
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
      'await updateDocument(id, deliveryOrderUpdates);',
      'await createDocument({',
      'const orderItem = await getDocumentById<OrderItemProgressSnapshot & { _rev?: string }>(orderItemRef);',
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
      'pendingDriverStatus: undefined,',
    ],
  },
];

const supportFunctionChecks = [
  {
    name: 'resolveOrderPartyData',
    mode: 'file',
    mustInclude: ['getDocumentById<{ _id: string; _rev?: string; name?: string; address?: string; active?: boolean }>(customerRef)', 'getDocumentById<{ _id: string; _rev?: string; name?: string; active?: boolean }>(serviceRef)'],
  },
  {
    name: 'resolveOrderRecipientData',
    mode: 'file',
    mustInclude: ['getDocumentById<ResolvedCustomerRecipientData>(customerRecipientRef)'],
  },
  {
    name: 'resolveOrderPickupData',
    mode: 'file',
    mustInclude: ['getDocumentById<ResolvedCustomerPickupData>(customerPickupRef)'],
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
      "const deliveryOrder = await getDocumentById<{ _id: string; status?: string }>(deliveryOrderRef)",
      "const orderItem = await getDocumentById<{ _id: string }>(orderItemRef)",
      "const assignments = await listDocumentsByFilter<{ _id: string; deliveryOrderRef?: string; orderItemRef?: string }>('deliveryOrderItem', {",
      'if (isSupabaseBackendEnabled()) {',
      'created = await createDocument<Record<string, unknown> & { _id: string }>(newDoc);',
      "await updateDocument(newDoc.driverRef, { updatedAt: new Date().toISOString() });",
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
      "const driver = await getDocumentById<{ _id: string; _rev?: string; name?: string; active?: boolean }>(normalizedDriverRef)",
      "await listDocumentsByFilter<{ _id: string; role?: string; driverRef?: string }>('user', {",
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
      "listDocumentsByFilter<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind'>>('driverVoucherDisbursement', {",
      "listDocumentsByFilter<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>('driverVoucherItem', {",
    ],
    mustNotInclude: ['getSanityClient().fetch<', 'sanityCreate('],
  },
];

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
