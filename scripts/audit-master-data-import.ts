import { loadScriptEnv } from './_env';

loadScriptEnv();

import ExcelJS from 'exceljs';
import { handleMasterDataImport } from '../src/lib/api/master-data-import';
import { MASTER_DATA_IMPORT_TARGETS } from '../src/lib/master-data-import-config';
import type { MasterDataImportTargetConfig } from '../src/lib/master-data-import-config';
import {
  buildMasterDataImportTemplateWorkbook,
  parseMasterDataImportXlsx,
} from '../src/lib/master-data-import-file';
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

async function expectXlsxBufferParseError(buffer: unknown, config: MasterDataImportTargetConfig, expectedText: string) {
  let rejected = false;
  try {
    await parseMasterDataImportXlsx(buffer as ArrayBuffer, config);
  } catch (error) {
    rejected = true;
    assert(error instanceof Error && error.message.includes(expectedText), `Pesan error Excel harus memuat "${expectedText}", dapat: ${error instanceof Error ? error.message : String(error)}`);
  }
  assert(rejected, `Excel invalid harus ditolak: ${expectedText}`);
}

async function expectXlsxParseError(workbook: ExcelJS.Workbook, config: MasterDataImportTargetConfig, expectedText: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  await expectXlsxBufferParseError(buffer, config, expectedText);
}

async function auditImportFileTemplates() {
  console.log('[audit-master-data-import] xlsx template and parser guards');
  for (const config of MASTER_DATA_IMPORT_TARGETS) {
    const buffer = await buildMasterDataImportTemplateWorkbook(config);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    assert(workbook.worksheets.length === 2, `Template ${config.label} harus punya sheet Template dan Panduan`);
    assert(Boolean(workbook.getWorksheet('Template')), `Sheet Template ${config.label} tidak ditemukan`);
    assert(Boolean(workbook.getWorksheet('Panduan')), `Sheet Panduan ${config.label} tidak ditemukan`);

    const template = workbook.getWorksheet('Template');
    assert(template, `Sheet Template ${config.label} tidak terbaca`);
    const headerValues = config.fields.map((_, index) => String(template.getCell(5, index + 1).value || ''));
    assert(headerValues.join('|') === config.fields.map((field) => field.key).join('|'), `Header template ${config.label} mismatch`);
    assert(template.getCell(5, 1).value === config.fields[0].key, `Header pertama ${config.label} harus di kolom A`);
    assert(template.getCell(5, 2).value === config.fields[1].key, `Header kedua ${config.label} harus di kolom B, bukan tergabung satu kolom`);

    const parsed = await parseMasterDataImportXlsx(buffer as unknown as ArrayBuffer, config);
    assert(parsed.headers.length === config.fields.length, `Jumlah header Excel ${config.label} mismatch`);
    assert(parsed.rows.length === config.templateRows.length, `Jumlah contoh row Excel ${config.label} mismatch`);
    assert(parsed.rows[0]?.[config.fields[0].key] === config.templateRows[0]?.[config.fields[0].key], `Contoh row Excel ${config.label} mismatch`);
  }

  const supplierConfig = MASTER_DATA_IMPORT_TARGETS.find((item) => item.target === 'suppliers') || MASTER_DATA_IMPORT_TARGETS[0];
  const customerConfig = MASTER_DATA_IMPORT_TARGETS.find((item) => item.target === 'customers') || MASTER_DATA_IMPORT_TARGETS[0];
  const warehouseConfig = MASTER_DATA_IMPORT_TARGETS.find((item) => item.target === 'warehouse-items') || MASTER_DATA_IMPORT_TARGETS[0];

  const supplierTemplateBuffer = await buildMasterDataImportTemplateWorkbook(supplierConfig);
  await expectXlsxBufferParseError(supplierTemplateBuffer, customerConfig, 'Header Excel tidak dikenali');

  const aliasHeaderWorkbook = new ExcelJS.Workbook();
  const aliasHeaderSheet = aliasHeaderWorkbook.addWorksheet('Template');
  aliasHeaderSheet.addRow(['Kode Supplier', 'Nama Supplier', 'Status Aktif']);
  aliasHeaderSheet.addRow(['SUP-ALIAS', 'PT Alias Supplier', 'Aktif']);
  const aliasHeaderBuffer = await aliasHeaderWorkbook.xlsx.writeBuffer();
  const aliasParsed = await parseMasterDataImportXlsx(aliasHeaderBuffer as unknown as ArrayBuffer, supplierConfig);
  assert(aliasParsed.headers.join('|') === 'Kode Supplier|Nama Supplier|Status Aktif', 'Header alias Excel harus tetap diterima');
  assert(aliasParsed.rows[0]?.['Kode Supplier'] === 'SUP-ALIAS', 'Row alias Excel supplier mismatch');

  const unknownHeaderWorkbook = new ExcelJS.Workbook();
  const unknownHeaderSheet = unknownHeaderWorkbook.addWorksheet('Template');
  unknownHeaderSheet.addRow(['supplierCode', 'name', 'kolomAnehTidakAda']);
  unknownHeaderSheet.addRow(['SUP-1', 'PT Header Aneh', 'harus ditolak']);
  await expectXlsxParseError(unknownHeaderWorkbook, supplierConfig, 'Header Excel tidak dikenali');

  const stockHeaderWorkbook = new ExcelJS.Workbook();
  const stockHeaderSheet = stockHeaderWorkbook.addWorksheet('Template');
  stockHeaderSheet.addRow(['itemCode', 'name', 'stock']);
  stockHeaderSheet.addRow(['BRG-STOCK', 'Barang Dengan Stok Diabaikan', '99']);
  const stockHeaderBuffer = await stockHeaderWorkbook.xlsx.writeBuffer();
  const stockHeaderParsed = await parseMasterDataImportXlsx(stockHeaderBuffer as unknown as ArrayBuffer, warehouseConfig);
  assert(stockHeaderParsed.headers.includes('stock'), 'Header stok Barang Gudang harus tetap terbaca agar backend bisa memberi warning');

  const missingRequiredHeaderWorkbook = new ExcelJS.Workbook();
  const missingRequiredHeaderSheet = missingRequiredHeaderWorkbook.addWorksheet('Template');
  missingRequiredHeaderSheet.addRow(['name', 'contactPerson']);
  missingRequiredHeaderSheet.addRow(['PT Tanpa Kode', 'PIC']);
  await expectXlsxParseError(missingRequiredHeaderWorkbook, supplierConfig, 'Header Excel wajib belum ada');

  const duplicateHeaderWorkbook = new ExcelJS.Workbook();
  const duplicateSheet = duplicateHeaderWorkbook.addWorksheet('Template');
  duplicateSheet.addRow(['supplierCode', 'supplierCode', 'name']);
  duplicateSheet.addRow(['SUP-1', 'SUP-2', 'PT Duplikat']);
  await expectXlsxParseError(duplicateHeaderWorkbook, supplierConfig, 'duplikat');

  const duplicateAliasHeaderWorkbook = new ExcelJS.Workbook();
  const duplicateAliasHeaderSheet = duplicateAliasHeaderWorkbook.addWorksheet('Template');
  duplicateAliasHeaderSheet.addRow(['supplierCode', 'Kode Supplier', 'name']);
  duplicateAliasHeaderSheet.addRow(['SUP-1', 'SUP-2', 'PT Duplikat Alias']);
  await expectXlsxParseError(duplicateAliasHeaderWorkbook, supplierConfig, 'duplikat');

  const extraColumnWorkbook = new ExcelJS.Workbook();
  const extraColumnSheet = extraColumnWorkbook.addWorksheet('Template');
  extraColumnSheet.addRow(['supplierCode', 'name']);
  extraColumnSheet.addRow(['SUP-1', 'PT Kolom Ekstra', 'tidak boleh']);
  await expectXlsxParseError(extraColumnWorkbook, supplierConfig, 'kolom lebih banyak');
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
    await auditImportFileTemplates();

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

    console.log('[audit-master-data-import] preview unknown api column');
    const unknownColumnPreview = await readResponse(await handleMasterDataImport(session, {
      action: 'preview',
      target: 'suppliers',
      mode: 'createOnly',
      rows: [{
        supplierCode,
        name: 'Audit Supplier Import',
        kolomAnehTidakAda: 'harus ditolak',
      }],
    }) as Response, 'preview unknown api column');
    assert(unknownColumnPreview.data?.summary.errors === 1, 'Kolom asing dari API harus error');
    assert(unknownColumnPreview.data.rows[0]?.errors.some((error) => error.includes('tidak dikenali')), 'Pesan kolom asing API tidak muncul');

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
