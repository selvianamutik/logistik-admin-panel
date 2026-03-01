/* ============================================================
   LOGISTIK — Sanity Seed Script
   Run: npx tsx scripts/seed-sanity.ts
   ============================================================ */

import { createClient } from '@sanity/client';

const projectId = 'p6do50hl';
const dataset = 'production';
const apiVersion = '2024-01-01';

const client = createClient({
    projectId,
    dataset,
    apiVersion,
    token: 'sky7V0P7lW7gtRk3CP3GHuYd18QmYN5BYgzPZyLF7AiH4AcDc9M19pSEvef7RAAGqVoewy7sZd5hozupK9WXcXSNb3a1tS76KAduc16IzBBOwT6kx9ErKJgVKSYdQhd3pDLJi5bUtFlyAfYVtXFwJ8oNlpa793MONpBKyscK2Z75tXfpCdQ4',
    useCdn: false,
});

const OWNER_PASSWORD_HASH = '$2a$10$dummyhashforTEST1234ownerpassword';

interface SeedDoc {
    _id: string;
    _type: string;
    [key: string]: unknown;
}

const seedDocuments: SeedDoc[] = [
    // ── Users ──
    {
        _id: 'user-owner-001', _type: 'user',
        name: 'Owner Utama', email: 'owner@company.local',
        role: 'OWNER', passwordHash: OWNER_PASSWORD_HASH,
        active: true, createdAt: '2026-01-01T00:00:00Z',
    },
    {
        _id: 'user-admin-001', _type: 'user',
        name: 'Admin Operasional', email: 'admin@company.local',
        role: 'ADMIN', passwordHash: OWNER_PASSWORD_HASH,
        active: true, createdAt: '2026-01-15T00:00:00Z',
    },

    // ── Company Profile ──
    {
        _id: 'company-001', _type: 'companyProfile',
        name: 'PT Logistik Nusantara',
        legalName: 'PT Logistik Nusantara Sejahtera',
        address: 'Jl. Raya Industri No. 88, Kawasan Industrial MM2100, Bekasi 17520',
        phone: '021-89001234', email: 'info@logistiknusantara.co.id',
        website: 'www.logistiknusantara.co.id',
        npwp: '01.234.567.8-901.000',
        bankAccounts: [
            { bankName: 'BCA', accountNumber: '1234567890', accountHolder: 'PT Logistik Nusantara' },
            { bankName: 'Mandiri', accountNumber: '0987654321', accountHolder: 'PT Logistik Nusantara' },
        ],
        numberFormats: {
            resiPrefix: 'R', doPrefix: 'DO', invoicePrefix: 'INV',
            incidentPrefix: 'INC', invoiceMode: 'ORDER',
        },
        documentSettings: { showContact: true, dateFormat: 'dd/MM/yyyy' },
    },

    // ── Customers ──
    {
        _id: 'cust-001', _type: 'customer',
        name: 'PT Maju Sejahtera',
        address: 'Jl. Industri Raya No. 45, Bekasi 17530',
        contactPerson: 'Budi Santoso', phone: '081-234-5678',
        email: 'budi@majusejahtera.co.id',
        defaultPaymentTerm: 14, npwp: '02.345.678.9-012.000', active: true,
    },
    {
        _id: 'cust-002', _type: 'customer',
        name: 'CV Berkah Logistik',
        address: 'Jl. Pelabuhan No. 12, Tanjung Priok, Jakarta 14310',
        contactPerson: 'Siti Rahayu', phone: '082-345-6789',
        email: 'siti@berkahlogistik.com',
        defaultPaymentTerm: 30, active: true,
    },

    // ── Services ──
    { _id: 'svc-001', _type: 'service', name: 'Reguler', description: 'Pengiriman reguler 3-5 hari kerja', active: true },
    { _id: 'svc-002', _type: 'service', name: 'Express', description: 'Pengiriman express 1-2 hari kerja', active: true },
    { _id: 'svc-003', _type: 'service', name: 'Cargo', description: 'Pengiriman cargo untuk barang besar/berat', active: true },

    // ── Expense Categories ──
    { _id: 'expcat-001', _type: 'expenseCategory', name: 'BBM / Solar', active: true },
    { _id: 'expcat-002', _type: 'expenseCategory', name: 'Tol & Parkir', active: true },
    { _id: 'expcat-003', _type: 'expenseCategory', name: 'Servis Kendaraan', active: true },
    { _id: 'expcat-004', _type: 'expenseCategory', name: 'Ban', active: true },
    { _id: 'expcat-005', _type: 'expenseCategory', name: 'Gaji Driver', active: true },
    { _id: 'expcat-006', _type: 'expenseCategory', name: 'Asuransi', active: true },
    { _id: 'expcat-007', _type: 'expenseCategory', name: 'Operasional Kantor', active: true },

    // ── Drivers ──
    { _id: 'drv-001', _type: 'driver', name: 'Supri Anto', phone: '087-111-2222', licenseNumber: 'SIM-B2-001', active: true },
    { _id: 'drv-002', _type: 'driver', name: 'Joko Widodo', phone: '085-333-4444', licenseNumber: 'SIM-B2-002', active: true },

    // ── Vehicles ──
    {
        _id: 'veh-001', _type: 'vehicle',
        plateNumber: 'B 1234 XYZ', brandModel: 'Mitsubishi Colt Diesel FE 74S',
        year: 2022, type: 'TRUCK', status: 'ACTIVE',
        chassisNumber: 'MHMFE74P5MK123456', engineNumber: '4D34-TL123456',
        stnkExpiry: '2027-05-15', kirExpiry: '2027-01-20',
        lastOdometer: 45000,
    },
    {
        _id: 'veh-002', _type: 'vehicle',
        plateNumber: 'B 5678 ABC', brandModel: 'Hino Dutro 110 SDL',
        year: 2021, type: 'TRUCK', status: 'ACTIVE',
        chassisNumber: 'MJEC1JG45MK654321', engineNumber: 'W04D-TR654321',
        stnkExpiry: '2026-11-30', kirExpiry: '2026-08-10',
        lastOdometer: 62000,
    },

    // ── Orders ──
    {
        _id: 'order-001', _type: 'order',
        masterResi: 'R-202602-0001',
        customerRef: 'cust-001', customerName: 'PT Maju Sejahtera',
        receiverName: 'Andi Kusuma',
        receiverAddress: 'Jl. Thamrin No. 10, Jakarta Pusat 10340',
        receiverPhone: '081-999-0000',
        serviceRef: 'svc-001', serviceName: 'Reguler',
        status: 'PARTIAL',
        notes: 'Penerima hanya bisa terima 1 item dulu, sisanya menyusul',
        createdAt: '2026-02-20T08:00:00Z', createdBy: 'user-owner-001',
    },

    // ── Order Items ──
    {
        _id: 'oi-001', _type: 'orderItem',
        orderRef: 'order-001', description: 'Elektronik - TV LED 55 inch',
        qtyKoli: 1, weight: 50, volume: 0.5, value: 12000000, status: 'DELIVERED',
    },
    {
        _id: 'oi-002', _type: 'orderItem',
        orderRef: 'order-001', description: 'Peralatan Kantor - 5 Box',
        qtyKoli: 5, weight: 30, volume: 0.3, value: 5000000, status: 'DELIVERED',
    },
    {
        _id: 'oi-003', _type: 'orderItem',
        orderRef: 'order-001', description: 'Dokumen Penting & Kontrak',
        qtyKoli: 1, weight: 5, value: 500000, status: 'PENDING',
    },

    // ── Delivery Orders ──
    {
        _id: 'do-001', _type: 'deliveryOrder',
        doNumber: 'DO-202602-0001',
        orderRef: 'order-001', masterResi: 'R-202602-0001',
        vehicleRef: 'veh-001', vehiclePlate: 'B 1234 XYZ',
        driverRef: 'drv-001', driverName: 'Supri Anto',
        status: 'DELIVERED',
        departureDate: '2026-02-21', arrivalDate: '2026-02-23',
        origin: 'Gudang Bekasi', destination: 'Jl. Thamrin No. 10',
        notes: 'Item 1: TV LED 55 inch', createdAt: '2026-02-21T08:00:00Z',
    },

    // ── DO Items ──
    {
        _id: 'doi-001', _type: 'deliveryOrderItem',
        deliveryOrderRef: 'do-001', orderItemRef: 'oi-001',
        orderItemDescription: 'Elektronik - TV LED 55 inch',
        orderItemQtyKoli: 1, orderItemWeight: 50,
    },

    // ── Tracking Logs ──
    { _id: 'tl-001', _type: 'trackingLog', refType: 'DO', refRef: 'do-001', status: 'CREATED', note: 'Surat jalan dibuat', timestamp: '2026-02-21T08:00:00Z', userName: 'Owner Utama' },
    { _id: 'tl-002', _type: 'trackingLog', refType: 'DO', refRef: 'do-001', status: 'PICKED_UP', note: 'Barang diambil dari gudang', timestamp: '2026-02-21T09:30:00Z', userName: 'Supri Anto' },
    { _id: 'tl-003', _type: 'trackingLog', refType: 'DO', refRef: 'do-001', status: 'DELIVERED', note: 'Barang diterima oleh Andi Kusuma', timestamp: '2026-02-23T14:00:00Z', userName: 'Supri Anto' },

    // ── Invoices ──
    {
        _id: 'inv-001', _type: 'invoice',
        invoiceNumber: 'INV-202602-0001',
        orderRef: 'order-001', customerRef: 'cust-001',
        customerName: 'PT Maju Sejahtera',
        masterResi: 'R-202602-0001',
        issueDate: '2026-02-22', dueDate: '2026-03-08',
        status: 'PARTIAL', totalAmount: 1500000,
        notes: 'Invoice untuk order R-202602-0001',
    },

    // ── Invoice Items ──
    { _id: 'ii-001', _type: 'invoiceItem', invoiceRef: 'inv-001', description: 'Biaya Kirim Reguler - 85 kg', qty: 1, price: 1200000, subtotal: 1200000 },
    { _id: 'ii-002', _type: 'invoiceItem', invoiceRef: 'inv-001', description: 'Asuransi Pengiriman', qty: 1, price: 300000, subtotal: 300000 },

    // ── Payments ──
    {
        _id: 'pay-001', _type: 'payment',
        invoiceRef: 'inv-001', date: '2026-02-25',
        amount: 500000, method: 'TRANSFER',
        reference: 'TRF-BCA-001', note: 'DP 500rb via BCA',
        recordedBy: 'user-owner-001', recordedByName: 'Owner Utama',
    },

    // ── Incomes ──
    {
        _id: 'inc-001', _type: 'income',
        sourceType: 'INVOICE_PAYMENT', paymentRef: 'pay-001',
        date: '2026-02-25', amount: 500000,
        note: 'Pembayaran invoice INV-202602-0001',
    },

    // ── Expenses ──
    {
        _id: 'exp-001', _type: 'expense',
        categoryRef: 'expcat-004', categoryName: 'Ban',
        date: '2026-02-23', amount: 850000,
        note: 'Ganti ban depan kiri B 1234 XYZ',
        description: 'Bridgestone 205/75R16', privacyLevel: 'internal',
    },
    {
        _id: 'exp-002', _type: 'expense',
        categoryRef: 'expcat-001', categoryName: 'BBM / Solar',
        date: '2026-02-25', amount: 450000,
        note: 'Solar full tank B 1234 XYZ',
        description: 'SPBU Bekasi', privacyLevel: 'internal',
    },
    {
        _id: 'exp-003', _type: 'expense',
        categoryRef: 'expcat-005', categoryName: 'Gaji Driver',
        date: '2026-02-28', amount: 5000000,
        note: 'Gaji driver bulan Februari',
        description: 'Pembayaran gaji driver', privacyLevel: 'ownerOnly',
    },

    // ── Maintenances ──
    {
        _id: 'mnt-001', _type: 'maintenance',
        vehicleRef: 'veh-001', vehiclePlate: 'B 1234 XYZ',
        type: 'SCHEDULED', description: 'Servis rutin 45.000 km',
        scheduledDate: '2026-03-01', status: 'PENDING',
        estimatedCost: 2500000,
    },

    // ── Incidents ──
    {
        _id: 'incident-001', _type: 'incident',
        incidentNumber: 'INC-202602-0001',
        vehicleRef: 'veh-002', vehiclePlate: 'B 5678 ABC',
        driverRef: 'drv-002', driverName: 'Joko Widodo',
        date: '2026-02-15', type: 'MINOR_ACCIDENT',
        description: 'Kendaraan menabrak pembatas jalan saat parkir di gudang',
        status: 'RESOLVED', location: 'Gudang Priok',
    },

    // ── Incident Action Logs ──
    {
        _id: 'ial-001', _type: 'incidentActionLog',
        incidentRef: 'incident-001',
        action: 'Laporan diterima dan ditindaklanjuti',
        timestamp: '2026-02-15T10:00:00Z', userName: 'Owner Utama',
    },
    {
        _id: 'ial-002', _type: 'incidentActionLog',
        incidentRef: 'incident-001',
        action: 'Kendaraan dibawa ke bengkel untuk perbaikan bumper',
        timestamp: '2026-02-16T08:00:00Z', userName: 'Admin Operasional',
    },
];

async function seed() {
    console.log(`Seeding ${seedDocuments.length} documents to Sanity...`);
    console.log(`Project: ${projectId} | Dataset: ${dataset}`);
    console.log('---');

    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (const doc of seedDocuments) {
        try {
            // Check if doc already exists
            const existing = await client.fetch(`*[_id == $id][0]._id`, { id: doc._id });
            if (existing) {
                console.log(`  SKIP  ${doc._type} [${doc._id}] — already exists`);
                skipped++;
                continue;
            }

            await client.createOrReplace(doc);
            console.log(`  OK    ${doc._type} [${doc._id}]`);
            success++;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  FAIL  ${doc._type} [${doc._id}] — ${msg}`);
            failed++;
        }
    }

    console.log('---');
    console.log(`Done! ${success} created, ${skipped} skipped, ${failed} failed`);
}

seed().catch(console.error);
