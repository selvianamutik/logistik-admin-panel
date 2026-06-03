import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const operations = read('src/lib/api/operations-workflows.ts');
const route = read('src/app/api/data/route.ts');
const incidentUi = read('src/app/(admin)/fleet/incidents/[id]/page.tsx');
const inventoryUsage = read('src/lib/inventory-material-usage.ts');
const itemDetail = read('src/app/(admin)/inventory/items/[id]/page.tsx');
const maintenanceWorkflows = read('src/lib/api/maintenance-workflows.ts');

const checks = [];
function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}

function before(text, first, second) {
  const a = text.indexOf(first);
  const b = text.indexOf(second);
  return a >= 0 && b >= 0 && a < b;
}

check(
  'direct incident material categories exclude tire',
  operations.includes("const INCIDENT_MATERIAL_HANDLING_CATEGORIES = new Set(['REPAIR', 'SPAREPART'])"),
);
check(
  'tire-tracked warehouse items are rejected in generic incident handling',
  operations.includes('Ban tertracking harus dikelola lewat modul Ban'),
);
check(
  'warehouse mode rejects duplicate item refs before mutation',
  operations.includes('Barang gudang insiden tidak boleh duplikat'),
);
check(
  'direct leftover receipt stock is cumulative per warehouse item',
  operations.includes('receiptStockBalances') &&
    operations.includes('receiptStockBalances.set(receiptItem._id, nextReceiptStockQty)'),
);
check(
  'direct allocation limit is checked before direct stock mutation loop',
  before(operations, 'if (allocatedTotal > lineAmount)', 'for (const plan of directPlans)'),
);
check(
  'warehouse stock/date plans are validated before warehouse stock mutation loop',
  before(operations, 'const warehousePlans = warehouseItems.map', 'for (const { item, input, nextStockQty'),
);
check(
  'warehouse mode posts MAINTENANCE_USAGE stock movement',
  operations.includes("sourceType: 'MAINTENANCE_USAGE'") &&
    operations.includes('await postStockMovementJournal(session, movementDoc, unitCostSnapshot)'),
);
check(
  'direct leftover uses MANUAL_IN stock movement',
  operations.includes("sourceType: 'MANUAL_IN'") &&
    operations.includes('Sisa pembelian lokal dari insiden'),
);
check(
  'direct purchase material is marked costAlreadyPosted and not counted as maintenance material cost',
  operations.includes("sourceType: 'DIRECT_PURCHASE'") &&
    operations.includes('costAlreadyPosted: true') &&
    operations.includes("const materialCostTotal = sourceMode === 'WAREHOUSE_STOCK'"),
);
check(
  'direct incident line is linked only after maintenance document is created',
  before(operations, 'await createDocument(maintenanceDoc', 'linkedMaintenanceRef: maintenanceRef'),
);
check(
  'record-maintenance-handling route is registered',
  route.includes('handleIncidentMaintenanceHandlingCreate') &&
    route.includes("action === 'record-maintenance-handling'"),
);
check(
  'incident UI exposes warehouse and direct purchase actions',
  incidentUi.includes('Catat Pemakaian') &&
    incidentUi.includes('Catat Penanganan'),
);
check(
  'incident UI direct purchase action excludes tire while tire action remains separate',
  incidentUi.includes("(line.category === 'REPAIR' || line.category === 'SPAREPART')") &&
    incidentUi.includes("line.category === 'TIRE'"),
);
check(
  'inventory material usage report only reads warehouse-stock usage',
  inventoryUsage.includes('isWarehouseStockMaintenanceMaterialUsage'),
);
check(
  'inventory item detail only reads warehouse-stock usage',
  itemDetail.includes('isWarehouseStockMaintenanceMaterialUsage(usage)'),
);
check(
  'regular maintenance completion stores stock movement ref',
  maintenanceWorkflows.includes('stockMovementRef: movementDoc._id'),
);

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length > 0) {
  process.exitCode = 1;
}
