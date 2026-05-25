import { loadScriptEnv } from './_env';

loadScriptEnv();

import { handleMasterDataImport } from '../src/lib/api/master-data-import';
import {
  deleteDocument,
  getDocumentById,
  listDocumentsByFilter,
} from '../src/lib/repositories/document-store';
import type { Customer, Supplier, WarehouseItem } from '../src/lib/types';

type ImportPayload = {
  data?: {
    summary: {
      errors: number;
      create: number;
      update: number;
      skip: number;
      imported: number;
    };
    rows: Array<{
      status: string;
      action: string;
      importedId?: string;
      errors: string[];
      warnings: string[];
    }>;
  };
  error?: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readResponse(response: Response, label: string): Promise<ImportPayload> {
  const body = await response.text();
  const parsed = body ? JSON.parse(body) as ImportPayload : {};
  if (!response.ok) {
    throw new Error(`${label} ${response.status}: ${body}`);
  }
  return parsed;
}

async function readErrorResponse(response: Response, label: string, expectedStatus: number): Promise<ImportPayload> {
  const body = await response.text();
  const parsed = body ? JSON.parse(body) as ImportPayload : {};
  if (response.status !== expectedStatus) {
    throw new Error(`${label} expected ${expectedStatus}, got ${response.status}: ${body}`);
  }
  return parsed;
}

async function deleteRows(docType: string, rows: Array<{ _id: string }>) {
  for (const row of rows) {
    await deleteDocument(row._id, docType).catch(() => undefined);
  }
}

async function cleanup(ids: string[]) {
  for (const id of ids) {
    const auditLogs = await listDocumentsByFilter<{ _id: string }>('auditLog', { entityRef: id }).catch(() => []);
    await deleteRows('auditLog', auditLogs);
  }
  for (const id of ids) {
    await deleteDocument(id, 'warehouseItem').catch(() => undefined);
    await deleteDocument(id, 'supplier').catch(() => undefined);
    await deleteDocument(id, 'customer').catch(() => undefined);
  }
}

async function main() {
  const suffix = Date.now().toString(36).toUpperCase();
  const createdIds: string[] = [];
  const [ownerUser] = await listDocumentsByFilter<{ _id: string; name?: string; email?: string; role?: string }>('user', { role: 'OWNER' });
  assert(ownerUser?._id, 'Audit membutuhkan user OWNER');
  const session = {
    _id: ownerUser._id,
    name: ownerUser.name || 'Audit Import',
    email: ownerUser.email,
    role: 'OWNER' as const,
  };
  const supplierCode = `AUD-SUP-${suffix}`;
  const itemCode = `AUD-BRG-${suffix}`;
  const customerName = `PT Audit Import ${suffix}`;

  try {
    console.log('[audit-master-data-import] invalid request guards');
    const invalidAction = await readErrorResponse(await handleMasterDataImport(session, {
      action: 'execute',
      target: 'suppliers',
      mode: 'createOnly',
      rows: [{ supplierCode, name: 'Audit Supplier Import' }],
    }) as Response, 'invalid action', 400);
    assert(invalidAction.error?.includes('Aksi import'), 'Aksi import invalid harus ditolak eksplisit');
    const malformedRows = await readErrorResponse(await handleMasterDataImport(session, {
      action: 'preview',
      target: 'suppliers',
      mode: 'createOnly',
      rows: [{ supplierCode, name: 'Audit Supplier Import' }, 'baris-rusak'],
    }) as Response, 'malformed rows', 400);
    assert(malformedRows.error?.includes('Baris import 3'), 'Baris non-object harus ditolak eksplisit');

    console.log('[audit-master-data-import] preview supplier create');
    const supplierPreview = await readResponse(await handleMasterDataImport(session, {
      action: 'preview',
      target: 'suppliers',
      mode: 'createOnly',
      rows: [{
        supplierCode,
        name: 'Audit Supplier Import',
        defaultTermDays: '21',
        active: 'Aktif',
      }],
    }) as Response, 'preview supplier');
    assert(supplierPreview.data?.summary.errors === 0, 'Preview supplier harus valid');
    assert(supplierPreview.data.summary.create === 1, 'Preview supplier harus siap create');

    console.log('[audit-master-data-import] preview duplicate alias columns');
    const duplicateAliasPreview = await readResponse(await handleMasterDataImport(session, {
      action: 'preview',
      target: 'suppliers',
      mode: 'createOnly',
      rows: [{
        supplierCode,
        name: 'Audit Supplier Import',
        'Kode Supplier': `${supplierCode}-OTHER`,
      }],
    }) as Response, 'preview duplicate alias');
    assert(duplicateAliasPreview.data?.summary.errors === 1, 'Kolom alias duplikat harus error');
    assert(duplicateAliasPreview.data.rows[0]?.errors.some((error) => error.includes('duplikat')), 'Pesan kolom alias duplikat tidak muncul');

    console.log('[audit-master-data-import] commit supplier create');
    const supplierCommit = await readResponse(await handleMasterDataImport(session, {
      action: 'commit',
      target: 'suppliers',
      mode: 'createOnly',
      rows: [{
        supplierCode,
        name: 'Audit Supplier Import',
        defaultTermDays: '21',
        active: 'Aktif',
      }],
    }) as Response, 'commit supplier');
    const supplierId = supplierCommit.data?.rows[0]?.importedId;
    assert(supplierId, 'Commit supplier harus mengembalikan importedId');
    createdIds.push(supplierId);
    const supplier = await getDocumentById<Supplier>(supplierId, 'supplier');
    assert(supplier?.supplierCode === supplierCode, 'Supplier code mismatch');
    assert(supplier.defaultTermDays === 21, 'Termin supplier mismatch');

    console.log('[audit-master-data-import] preview duplicate supplier create-only skip');
    const duplicatePreview = await readResponse(await handleMasterDataImport(session, {
      action: 'preview',
      target: 'suppliers',
      mode: 'createOnly',
      rows: [{ supplierCode, name: 'Audit Supplier Import' }],
    }) as Response, 'preview duplicate supplier');
    assert(duplicatePreview.data?.summary.skip === 1, 'Supplier existing harus dilewati di createOnly');

    console.log('[audit-master-data-import] commit supplier update-only');
    const supplierUpdate = await readResponse(await handleMasterDataImport(session, {
      action: 'commit',
      target: 'suppliers',
      mode: 'updateOnly',
      rows: [{ supplierCode, name: 'Audit Supplier Import Updated', defaultTermDays: '30' }],
    }) as Response, 'commit supplier update');
    assert(supplierUpdate.data?.summary.update === 1 && supplierUpdate.data.summary.imported === 1, 'Supplier update harus imported');
    const supplierAfterUpdate = await getDocumentById<Supplier>(supplierId, 'supplier');
    assert(supplierAfterUpdate?.name === 'Audit Supplier Import Updated', 'Nama supplier tidak terupdate');
    assert(supplierAfterUpdate.defaultTermDays === 30, 'Termin supplier tidak terupdate');

    console.log('[audit-master-data-import] commit warehouse item with supplier link');
    const itemCommit = await readResponse(await handleMasterDataImport(session, {
      action: 'commit',
      target: 'warehouse-items',
      mode: 'createOnly',
      rows: [{
        itemCode,
        name: 'Audit Ban Import',
        category: 'Ban',
        unit: 'PCS',
        trackingMode: 'TIRE_ASSET',
        minStockQty: '0',
        defaultSupplierCode: supplierCode,
        defaultPurchasePrice: '2850000',
        tireTypeDefault: 'ORI kawat / radial',
        tireBrandDefault: 'Audit Tire',
        tireSizeDefault: '11R22.5',
        active: 'Aktif',
      }],
    }) as Response, 'commit warehouse item');
    const itemId = itemCommit.data?.rows[0]?.importedId;
    assert(itemId, 'Commit barang gudang harus mengembalikan importedId');
    createdIds.push(itemId);
    const warehouseItem = await getDocumentById<WarehouseItem>(itemId, 'warehouseItem');
    assert(warehouseItem?.itemCode === itemCode, 'Kode barang gudang mismatch');
    assert(warehouseItem.defaultSupplierRef === supplierId, 'Supplier default barang tidak tertaut');
    assert(warehouseItem.currentStockQty === 0, 'Import master barang tidak boleh mengisi stok awal');
    assert(warehouseItem.trackingMode === 'TIRE_ASSET', 'Mode tracking barang ban mismatch');

    console.log('[audit-master-data-import] preview ignored stock warning');
    const stockPreview = await readResponse(await handleMasterDataImport(session, {
      action: 'preview',
      target: 'warehouse-items',
      mode: 'updateOnly',
      rows: [{
        itemCode,
        name: 'Audit Ban Import',
        stock: '99',
      }],
    }) as Response, 'preview stock warning');
    assert(stockPreview.data?.rows[0]?.warnings.some((warning) => warning.includes('Stok awal') || warning.includes('stok')), 'Kolom stok harus diberi warning');

    console.log('[audit-master-data-import] preview invalid tire row');
    const invalidTire = await readResponse(await handleMasterDataImport(session, {
      action: 'preview',
      target: 'warehouse-items',
      mode: 'createOnly',
      rows: [{
        itemCode: `AUD-BAD-${suffix}`,
        name: 'Audit Ban Invalid',
        unit: 'PCS',
        trackingMode: 'TIRE_ASSET',
        tireTypeDefault: 'ORI kawat / radial',
        tireSizeDefault: '11R22.5',
      }],
    }) as Response, 'preview invalid tire');
    assert(invalidTire.data?.summary.errors === 1, 'Ban tertracking tanpa merk harus error');

    console.log('[audit-master-data-import] commit customer create and update');
    const customerCommit = await readResponse(await handleMasterDataImport(session, {
      action: 'commit',
      target: 'customers',
      mode: 'createOnly',
      rows: [{
        name: customerName,
        address: 'Audit Address',
        contactPerson: 'Audit PIC',
        phone: '0800000000',
        defaultPaymentTerm: '7',
        creditLimitAmount: '1000000',
        deliveryOrderPrefix: 'AI',
        active: 'Aktif',
      }],
    }) as Response, 'commit customer');
    const customerId = customerCommit.data?.rows[0]?.importedId;
    assert(customerId, 'Commit customer harus mengembalikan importedId');
    createdIds.push(customerId);
    const customer = await getDocumentById<Customer>(customerId, 'customer');
    assert(customer?.name === customerName, 'Customer name mismatch');
    assert(customer.defaultPaymentTerm === 7, 'Termin customer mismatch');
    assert(customer.deliveryOrderPrefix === 'AI', 'Prefix SJ customer mismatch');

    const customerUpdate = await readResponse(await handleMasterDataImport(session, {
      action: 'commit',
      target: 'customers',
      mode: 'updateOnly',
      rows: [{ name: customerName, phone: '0819999999', creditLimitAmount: '2000000' }],
    }) as Response, 'commit customer update');
    assert(customerUpdate.data?.summary.update === 1 && customerUpdate.data.summary.imported === 1, 'Customer update harus imported');
    const customerAfterUpdate = await getDocumentById<Customer>(customerId, 'customer');
    assert(customerAfterUpdate?.phone === '0819999999', 'Phone customer tidak terupdate');
    assert(customerAfterUpdate.creditLimitAmount === 2000000, 'Limit customer tidak terupdate');

    console.log('[audit-master-data-import] PASS');
  } finally {
    await cleanup(createdIds);
  }
}

main().catch((error) => {
  console.error('[audit-master-data-import] FAIL');
  console.error(error);
  process.exit(1);
});
