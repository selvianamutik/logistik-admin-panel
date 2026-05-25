import type { AppModule } from './rbac';

export type MasterDataImportTarget = 'customers' | 'suppliers' | 'warehouse-items';
export type MasterDataImportMode = 'createOnly' | 'updateOnly' | 'upsert';

export type MasterDataImportField = {
  key: string;
  label: string;
  required?: boolean;
  help?: string;
  aliases?: string[];
  example?: string;
};

export type MasterDataImportTargetConfig = {
  target: MasterDataImportTarget;
  entity: string;
  docType: string;
  module: AppModule;
  label: string;
  description: string;
  keyLabel: string;
  fields: MasterDataImportField[];
  templateRows: Record<string, string>[];
};

export const MASTER_DATA_IMPORT_MODES: Array<{
  value: MasterDataImportMode;
  label: string;
  description: string;
}> = [
  {
    value: 'createOnly',
    label: 'Tambah baru saja',
    description: 'Baris yang sudah ada akan dilewati. Cocok untuk upload master data awal.',
  },
  {
    value: 'updateOnly',
    label: 'Update data yang sudah ada',
    description: 'Baris yang belum ada akan dilewati. Cocok untuk koreksi massal.',
  },
  {
    value: 'upsert',
    label: 'Tambah atau update',
    description: 'Data yang sudah ada diperbarui, data baru ditambahkan.',
  },
];

export const MASTER_DATA_IMPORT_TARGETS: MasterDataImportTargetConfig[] = [
  {
    target: 'customers',
    entity: 'customers',
    docType: 'customer',
    module: 'customers',
    label: 'Customer',
    description: 'Import master customer. Kunci cocok data memakai nama customer.',
    keyLabel: 'Nama Customer',
    fields: [
      { key: 'name', label: 'Nama Customer', required: true, aliases: ['nama', 'nama customer', 'customer', 'customer name'], example: 'PT Contoh Logistik' },
      { key: 'address', label: 'Alamat', aliases: ['alamat', 'address'], example: 'Jl. Industri No. 1' },
      { key: 'contactPerson', label: 'PIC', aliases: ['pic', 'kontak', 'contact person'], example: 'Budi' },
      { key: 'phone', label: 'Telepon', aliases: ['telepon', 'telp', 'hp', 'phone'], example: '08123456789' },
      { key: 'email', label: 'Email', aliases: ['email'], example: 'billing@contoh.co.id' },
      { key: 'defaultPaymentTerm', label: 'Termin Default', aliases: ['termin', 'termin default', 'default payment term'], example: '14' },
      { key: 'creditLimitAmount', label: 'Limit Piutang', aliases: ['limit piutang', 'credit limit', 'credit limit amount'], example: '50000000' },
      { key: 'npwp', label: 'NPWP', aliases: ['npwp'], example: '01.234.567.8-901.000' },
      { key: 'deliveryOrderPrefix', label: 'Prefix SJ', aliases: ['prefix sj', 'format sj', 'delivery order prefix'], example: 'SJ' },
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif' },
    ],
    templateRows: [
      {
        name: 'PT Contoh Logistik',
        address: 'Jl. Industri No. 1',
        contactPerson: 'Budi',
        phone: '08123456789',
        email: 'billing@contoh.co.id',
        defaultPaymentTerm: '14',
        creditLimitAmount: '50000000',
        npwp: '',
        deliveryOrderPrefix: 'SJ',
        active: 'Aktif',
      },
    ],
  },
  {
    target: 'suppliers',
    entity: 'suppliers',
    docType: 'supplier',
    module: 'suppliers',
    label: 'Supplier',
    description: 'Import master supplier. Kunci cocok data memakai kode supplier.',
    keyLabel: 'Kode Supplier',
    fields: [
      { key: 'supplierCode', label: 'Kode Supplier', required: true, aliases: ['kode', 'kode supplier', 'supplier code'], example: 'SUP-001' },
      { key: 'name', label: 'Nama Supplier', required: true, aliases: ['nama', 'nama supplier', 'supplier'], example: 'PT Supplier Ban' },
      { key: 'contactPerson', label: 'PIC', aliases: ['pic', 'kontak', 'contact person'], example: 'Sari' },
      { key: 'phone', label: 'Telepon', aliases: ['telepon', 'telp', 'hp', 'phone'], example: '0811111111' },
      { key: 'address', label: 'Alamat', aliases: ['alamat', 'address'], example: 'Jl. Raya Gudang' },
      { key: 'defaultTermDays', label: 'Termin Default', aliases: ['termin', 'termin default', 'default term days'], example: '14' },
      { key: 'notes', label: 'Catatan', aliases: ['catatan', 'notes'], example: '' },
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif' },
    ],
    templateRows: [
      {
        supplierCode: 'SUP-001',
        name: 'PT Supplier Ban',
        contactPerson: 'Sari',
        phone: '0811111111',
        address: 'Jl. Raya Gudang',
        defaultTermDays: '14',
        notes: '',
        active: 'Aktif',
      },
    ],
  },
  {
    target: 'warehouse-items',
    entity: 'warehouse-items',
    docType: 'warehouseItem',
    module: 'warehouseItems',
    label: 'Barang Gudang',
    description: 'Import master barang gudang. Stok awal tidak diimport di sini agar ledger stok tetap benar.',
    keyLabel: 'Kode Barang',
    fields: [
      { key: 'itemCode', label: 'Kode Barang', required: true, aliases: ['kode', 'kode barang', 'item code'], example: 'BRG-001' },
      { key: 'name', label: 'Nama Barang', required: true, aliases: ['nama', 'nama barang', 'barang'], example: 'Ban Truk 11R22.5 Bridgestone' },
      { key: 'category', label: 'Kategori', aliases: ['kategori', 'category'], example: 'Ban' },
      { key: 'unit', label: 'Satuan', aliases: ['satuan', 'unit'], example: 'PCS' },
      { key: 'trackingMode', label: 'Mode Tracking', aliases: ['mode tracking', 'tracking mode'], example: 'TIRE_ASSET' },
      { key: 'minStockQty', label: 'Stok Minimum', aliases: ['stok minimum', 'min stok', 'min stock qty'], example: '0' },
      { key: 'defaultSupplierCode', label: 'Kode Supplier Default', aliases: ['kode supplier default', 'default supplier code'], example: 'SUP-001' },
      { key: 'defaultSupplierName', label: 'Nama Supplier Default', aliases: ['supplier default', 'default supplier', 'default supplier name'], example: '' },
      { key: 'defaultPurchasePrice', label: 'Harga Beli Default', aliases: ['harga beli default', 'default purchase price'], example: '2850000' },
      { key: 'tireTypeDefault', label: 'Jenis Ban Default', aliases: ['jenis ban', 'jenis ban default', 'tire type default'], example: 'ORI kawat / radial' },
      { key: 'tireBrandDefault', label: 'Merk Ban Default', aliases: ['merk ban', 'merk ban default', 'tire brand default'], example: 'Bridgestone' },
      { key: 'tireSizeDefault', label: 'Ukuran Ban Default', aliases: ['ukuran ban', 'ukuran ban default', 'tire size default'], example: '11R22.5' },
      { key: 'notes', label: 'Catatan', aliases: ['catatan', 'notes'], example: '' },
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif' },
    ],
    templateRows: [
      {
        itemCode: 'BRG-001',
        name: 'Ban Truk 11R22.5 Bridgestone',
        category: 'Ban',
        unit: 'PCS',
        trackingMode: 'TIRE_ASSET',
        minStockQty: '0',
        defaultSupplierCode: 'SUP-001',
        defaultSupplierName: '',
        defaultPurchasePrice: '2850000',
        tireTypeDefault: 'ORI kawat / radial',
        tireBrandDefault: 'Bridgestone',
        tireSizeDefault: '11R22.5',
        notes: '',
        active: 'Aktif',
      },
      {
        itemCode: 'BRG-002',
        name: 'Oli Mesin 15W-40',
        category: 'Sparepart',
        unit: 'LITER',
        trackingMode: 'STANDARD',
        minStockQty: '10',
        defaultSupplierCode: '',
        defaultSupplierName: '',
        defaultPurchasePrice: '65000',
        tireTypeDefault: '',
        tireBrandDefault: '',
        tireSizeDefault: '',
        notes: '',
        active: 'Aktif',
      },
    ],
  },
];

export function getMasterDataImportTargetConfig(target: string | null | undefined) {
  return MASTER_DATA_IMPORT_TARGETS.find((item) => item.target === target) || null;
}
