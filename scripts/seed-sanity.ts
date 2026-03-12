/* ============================================================
   LOGISTIK - Sanity Seed Script
   Run: npm run seed:sanity
   ============================================================ */

import { createClient } from '@sanity/client';

import { loadScriptEnv, requireEnv } from './_env';

loadScriptEnv();

type SeedDoc = {
    _id: string;
    _type: string;
    [key: string]: unknown;
};

const client = createClient({
    projectId: requireEnv('NEXT_PUBLIC_SANITY_PROJECT_ID'),
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production',
    apiVersion: process.env.SANITY_API_VERSION?.trim() || '2024-01-01',
    token: requireEnv('SANITY_API_TOKEN'),
    useCdn: false,
});

const OWNER_PASSWORD_HASH = '$2b$10$gmQQXBYsr6av5en3FKDsRuW/ZiOXB6hOqzD2EXmGWICdq2EADL2YW';
const ADMIN_PASSWORD_HASH = '$2b$10$RTJAvsAXXjPgBPdE/rXYqeQM6mn7lJG7qK8u/wML.qZZ2Bg7SB4Be';
const DRIVER_ONE_PASSWORD_HASH = '$2b$10$D4kimoQ66Hcb8hBAlx0sxOdwDzd8FyMuR/63Liu6.kUUbXEKFag0e';
const DRIVER_TWO_PASSWORD_HASH = '$2b$10$jRoY/qk5DRivnljBs34Q5OdUWBsEBy4jkqQHc0HSSYZXJjSj3BSRy';

const documents: SeedDoc[] = [];

const bankAccounts = {
    'bank-bca-001': {
        _id: 'bank-bca-001',
        _type: 'bankAccount',
        bankName: 'BCA',
        accountNumber: '1234567890',
        accountHolder: 'PT Logistik Nusantara',
        initialBalance: 100_000_000,
        currentBalance: 100_000_000,
        active: true,
        notes: 'Rekening operasional utama',
    },
    'bank-mandiri-001': {
        _id: 'bank-mandiri-001',
        _type: 'bankAccount',
        bankName: 'Mandiri',
        accountNumber: '0987654321',
        accountHolder: 'PT Logistik Nusantara',
        initialBalance: 50_000_000,
        currentBalance: 50_000_000,
        active: true,
        notes: 'Rekening cadangan operasional',
    },
} satisfies Record<string, SeedDoc & { currentBalance: number; initialBalance: number; bankName: string }>;

function push(...docs: SeedDoc[]) {
    documents.push(...docs);
}

function postBankTransaction(input: {
    _id: string;
    bankAccountRef: keyof typeof bankAccounts;
    type: 'CREDIT' | 'DEBIT' | 'TRANSFER_IN' | 'TRANSFER_OUT';
    amount: number;
    date: string;
    description: string;
    relatedPaymentRef?: string;
    relatedExpenseRef?: string;
    relatedTransferRef?: string;
    relatedVoucherRef?: string;
}) {
    const account = bankAccounts[input.bankAccountRef];
    const isCredit = input.type === 'CREDIT' || input.type === 'TRANSFER_IN';
    account.currentBalance += isCredit ? input.amount : -input.amount;

    push({
        _id: input._id,
        _type: 'bankTransaction',
        bankAccountRef: account._id,
        bankAccountName: account.bankName,
        type: input.type,
        amount: input.amount,
        date: input.date,
        description: input.description,
        balanceAfter: account.currentBalance,
        relatedPaymentRef: input.relatedPaymentRef,
        relatedExpenseRef: input.relatedExpenseRef,
        relatedTransferRef: input.relatedTransferRef,
        relatedVoucherRef: input.relatedVoucherRef,
    });
}

function buildSeedDocuments() {
    push(
        {
            _id: 'user-owner-001',
            _type: 'user',
            name: 'Owner Utama',
            email: 'owner@company.local',
            role: 'OWNER',
            passwordHash: OWNER_PASSWORD_HASH,
            active: true,
            createdAt: '2026-01-01T08:00:00Z',
        },
        {
            _id: 'user-admin-001',
            _type: 'user',
            name: 'Admin Operasional',
            email: 'admin@company.local',
            role: 'ADMIN',
            passwordHash: ADMIN_PASSWORD_HASH,
            active: true,
            createdAt: '2026-01-10T08:00:00Z',
        },
        {
            _id: 'user-driver-001',
            _type: 'user',
            name: 'Driver Supri',
            email: 'driver.supri@company.local',
            role: 'DRIVER',
            driverRef: 'drv-001',
            driverName: 'Supri Anto',
            passwordHash: DRIVER_ONE_PASSWORD_HASH,
            active: true,
            createdAt: '2026-01-12T08:00:00Z',
        },
        {
            _id: 'user-driver-002',
            _type: 'user',
            name: 'Driver Joko',
            email: 'driver.joko@company.local',
            role: 'DRIVER',
            driverRef: 'drv-002',
            driverName: 'Joko Prasetyo',
            passwordHash: DRIVER_TWO_PASSWORD_HASH,
            active: true,
            createdAt: '2026-01-12T08:30:00Z',
        },
        {
            _id: 'company-001',
            _type: 'companyProfile',
            name: 'PT Logistik Nusantara',
            address: 'Jl. Raya Industri No. 88, Bekasi 17520',
            phone: '021-89001234',
            email: 'info@logistiknusantara.co.id',
            npwp: '01.234.567.8-901.000',
            bankName: 'BCA',
            bankAccount: '1234567890',
            bankHolder: 'PT Logistik Nusantara',
            themeColor: '#0f766e',
            numberingSettings: {
                resiPrefix: 'R',
                resiCounter: 2,
                doPrefix: 'DO',
                doCounter: 2,
                invoicePrefix: 'INV',
                invoiceCounter: 1,
                bonPrefix: 'BON',
                bonCounter: 2,
                incidentPrefix: 'INC',
                incidentCounter: 1,
            },
            invoiceSettings: {
                defaultTermDays: 14,
                dueDateDays: 14,
                footerNote: 'Mohon transfer sesuai nomor rekening perusahaan.',
                invoiceMode: 'ORDER',
            },
            documentSettings: {
                showContact: true,
                dateFormat: 'dd/MM/yyyy',
            },
        },
        {
            _id: 'cust-001',
            _type: 'customer',
            name: 'PT Maju Sejahtera',
            address: 'Jl. Industri Raya No. 45, Bekasi 17530',
            contactPerson: 'Budi Santoso',
            phone: '081234567890',
            email: 'budi@majusejahtera.co.id',
            defaultPaymentTerm: 14,
            npwp: '02.345.678.9-012.000',
            active: true,
        },
        {
            _id: 'cust-002',
            _type: 'customer',
            name: 'CV Berkah Logistik',
            address: 'Jl. Pelabuhan No. 12, Tanjung Priok, Jakarta 14310',
            contactPerson: 'Siti Rahayu',
            phone: '082345678901',
            email: 'siti@berkahlogistik.com',
            defaultPaymentTerm: 30,
            active: true,
        },
        {
            _id: 'svc-001',
            _type: 'service',
            name: 'Reguler',
            description: 'Pengiriman reguler antar kota',
            active: true,
        },
        {
            _id: 'svc-002',
            _type: 'service',
            name: 'Express',
            description: 'Pengiriman express 1-2 hari kerja',
            active: true,
        },
        {
            _id: 'svc-003',
            _type: 'service',
            name: 'Cargo',
            description: 'Pengiriman cargo untuk barang besar/berat',
            active: true,
        },
        { _id: 'expcat-001', _type: 'expenseCategory', name: 'BBM / Solar', active: true },
        { _id: 'expcat-002', _type: 'expenseCategory', name: 'Tol & Parkir', active: true },
        { _id: 'expcat-003', _type: 'expenseCategory', name: 'Servis Kendaraan', active: true },
        { _id: 'expcat-004', _type: 'expenseCategory', name: 'Gaji Driver', active: true },
        { _id: 'expcat-005', _type: 'expenseCategory', name: 'Operasional Kantor', active: true },
        { _id: 'expcat-006', _type: 'expenseCategory', name: 'Borongan Supir', active: true },
        {
            _id: 'drv-001',
            _type: 'driver',
            name: 'Supri Anto',
            phone: '08711112222',
            licenseNumber: 'SIM-B2-001',
            ktpNumber: '3174010101010001',
            simExpiry: '2028-01-01',
            address: 'Bekasi Timur',
            active: true,
        },
        {
            _id: 'drv-002',
            _type: 'driver',
            name: 'Joko Prasetyo',
            phone: '08533334444',
            licenseNumber: 'SIM-B2-002',
            ktpNumber: '3174010101010002',
            simExpiry: '2027-09-01',
            address: 'Tanjung Priok',
            active: true,
        },
        {
            _id: 'veh-001',
            _type: 'vehicle',
            unitCode: 'TRK-001',
            plateNumber: 'B 1234 XYZ',
            vehicleType: 'TRUCK',
            brandModel: 'Mitsubishi Colt Diesel FE 74',
            year: 2022,
            capacityKg: 4000,
            status: 'ACTIVE',
            base: 'Bekasi',
            lastOdometer: 45200,
            lastOdometerAt: '2026-02-07',
            notes: 'Armada reguler area Jabodetabek',
        },
        {
            _id: 'veh-002',
            _type: 'vehicle',
            unitCode: 'TRK-002',
            plateNumber: 'B 5678 ABC',
            vehicleType: 'TRUCK',
            brandModel: 'Hino Dutro 110 SDL',
            year: 2021,
            capacityKg: 5000,
            status: 'ACTIVE',
            base: 'Jakarta',
            lastOdometer: 62150,
            lastOdometerAt: '2026-02-14',
            notes: 'Armada untuk rute pelabuhan',
        }
    );

    push(
        {
            _id: 'order-001',
            _type: 'order',
            masterResi: 'R-202602-0001',
            customerRef: 'cust-001',
            customerName: 'PT Maju Sejahtera',
            receiverName: 'Andi Kusuma',
            receiverPhone: '0819990000',
            receiverAddress: 'Jl. Thamrin No. 10, Jakarta Pusat',
            receiverCompany: 'PT Maju Sejahtera Cabang Jakarta',
            pickupAddress: 'Gudang Bekasi',
            serviceRef: 'svc-001',
            serviceName: 'Reguler',
            status: 'COMPLETE',
            notes: 'Seluruh barang sudah terkirim.',
            createdAt: '2026-02-06T08:00:00Z',
            createdBy: 'user-owner-001',
        },
        {
            _id: 'order-002',
            _type: 'order',
            masterResi: 'R-202602-0002',
            customerRef: 'cust-002',
            customerName: 'CV Berkah Logistik',
            receiverName: 'Siti Rahayu',
            receiverPhone: '082345678901',
            receiverAddress: 'Jl. Pelabuhan No. 12, Tanjung Priok',
            pickupAddress: 'Gudang Cikarang',
            serviceRef: 'svc-003',
            serviceName: 'Cargo',
            status: 'PARTIAL',
            notes: 'Sebagian barang masih menunggu release gudang.',
            createdAt: '2026-02-09T09:00:00Z',
            createdBy: 'user-admin-001',
        },
        {
            _id: 'oi-001',
            _type: 'orderItem',
            orderRef: 'order-001',
            description: 'Elektronik - TV LED 55 inch',
            qtyKoli: 2,
            weight: 60,
            volume: 0.6,
            value: 16_000_000,
            status: 'DELIVERED',
        },
        {
            _id: 'oi-002',
            _type: 'orderItem',
            orderRef: 'order-001',
            description: 'Spare part mesin industri',
            qtyKoli: 4,
            weight: 40,
            volume: 0.4,
            value: 9_000_000,
            status: 'DELIVERED',
        },
        {
            _id: 'oi-003',
            _type: 'orderItem',
            orderRef: 'order-002',
            description: 'Bahan baku plastik palletized',
            qtyKoli: 8,
            weight: 200,
            volume: 1.5,
            value: 22_000_000,
            status: 'DELIVERED',
        },
        {
            _id: 'oi-004',
            _type: 'orderItem',
            orderRef: 'order-002',
            description: 'Dokumen customs & supporting files',
            qtyKoli: 1,
            weight: 5,
            volume: 0.05,
            value: 500_000,
            status: 'PENDING',
        },
        {
            _id: 'do-001',
            _type: 'deliveryOrder',
            doNumber: 'DO-202602-0001',
            orderRef: 'order-001',
            masterResi: 'R-202602-0001',
            vehicleRef: 'veh-001',
            vehiclePlate: 'B 1234 XYZ',
            driverRef: 'drv-001',
            driverName: 'Supri Anto',
            customerName: 'PT Maju Sejahtera',
            receiverName: 'Andi Kusuma',
            receiverAddress: 'Jl. Thamrin No. 10, Jakarta Pusat',
            date: '2026-02-07',
            status: 'DELIVERED',
            notes: 'Pengiriman selesai di hari yang sama.',
            podReceiverName: 'Andi Kusuma',
            podReceivedDate: '2026-02-07',
            podNote: 'Barang diterima baik.',
            taripBorongan: 9000,
            keteranganBorongan: 'Tarif borongan reguler Jabodetabek',
        },
        {
            _id: 'do-002',
            _type: 'deliveryOrder',
            doNumber: 'DO-202602-0002',
            orderRef: 'order-002',
            masterResi: 'R-202602-0002',
            vehicleRef: 'veh-002',
            vehiclePlate: 'B 5678 ABC',
            driverRef: 'drv-002',
            driverName: 'Joko Prasetyo',
            customerName: 'CV Berkah Logistik',
            receiverName: 'Siti Rahayu',
            receiverAddress: 'Jl. Pelabuhan No. 12, Tanjung Priok',
            date: '2026-02-12',
            status: 'DELIVERED',
            notes: 'Satu batch terkirim, batch kedua menunggu release.',
            podReceiverName: 'Siti Rahayu',
            podReceivedDate: '2026-02-12',
            podNote: '8 koli diterima.',
            taripBorongan: 3250,
            keteranganBorongan: 'Tarif borongan rute pelabuhan',
        },
        {
            _id: 'doi-001',
            _type: 'deliveryOrderItem',
            deliveryOrderRef: 'do-001',
            orderItemRef: 'oi-001',
            orderItemDescription: 'Elektronik - TV LED 55 inch',
            orderItemQtyKoli: 2,
            orderItemWeight: 60,
        },
        {
            _id: 'doi-002',
            _type: 'deliveryOrderItem',
            deliveryOrderRef: 'do-001',
            orderItemRef: 'oi-002',
            orderItemDescription: 'Spare part mesin industri',
            orderItemQtyKoli: 4,
            orderItemWeight: 40,
        },
        {
            _id: 'doi-003',
            _type: 'deliveryOrderItem',
            deliveryOrderRef: 'do-002',
            orderItemRef: 'oi-003',
            orderItemDescription: 'Bahan baku plastik palletized',
            orderItemQtyKoli: 8,
            orderItemWeight: 200,
        },
        {
            _id: 'tl-001',
            _type: 'trackingLog',
            refType: 'DO',
            refRef: 'do-001',
            status: 'CREATED',
            note: 'Surat jalan dibuat.',
            timestamp: '2026-02-07T07:30:00Z',
            userRef: 'user-owner-001',
            userName: 'Owner Utama',
        },
        {
            _id: 'tl-002',
            _type: 'trackingLog',
            refType: 'DO',
            refRef: 'do-001',
            status: 'DELIVERED',
            note: 'Barang diterima customer.',
            timestamp: '2026-02-07T15:45:00Z',
            userRef: 'user-admin-001',
            userName: 'Admin Operasional',
        },
        {
            _id: 'tl-003',
            _type: 'trackingLog',
            refType: 'DO',
            refRef: 'do-002',
            status: 'CREATED',
            note: 'DO cargo dibuat.',
            timestamp: '2026-02-12T08:10:00Z',
            userRef: 'user-admin-001',
            userName: 'Admin Operasional',
        },
        {
            _id: 'tl-004',
            _type: 'trackingLog',
            refType: 'DO',
            refRef: 'do-002',
            status: 'DELIVERED',
            note: 'Pengiriman batch pertama selesai.',
            timestamp: '2026-02-12T17:20:00Z',
            userRef: 'user-admin-001',
            userName: 'Admin Operasional',
        }
    );

    push(
        {
            _id: 'nota-001',
            _type: 'freightNota',
            notaNumber: 'NOTA-202602-0001',
            customerRef: 'cust-001',
            customerName: 'PT Maju Sejahtera',
            issueDate: '2026-02-08',
            dueDate: '2026-02-22',
            status: 'PARTIAL',
            totalAmount: 1_800_000,
            totalCollie: 6,
            totalWeightKg: 100,
            bankAccountRef: 'bank-bca-001',
            notes: 'Termin 1 untuk pengiriman reguler.',
        },
        {
            _id: 'notaitem-001',
            _type: 'freightNotaItem',
            notaRef: 'nota-001',
            doRef: 'do-001',
            doNumber: 'DO-202602-0001',
            vehiclePlate: 'B 1234 XYZ',
            date: '2026-02-07',
            noSJ: 'DO-202602-0001',
            dari: 'Gudang Bekasi',
            tujuan: 'Jakarta Pusat',
            barang: 'Elektronik & Spare Part',
            collie: 6,
            beratKg: 100,
            tarip: 18_000,
            uangRp: 1_800_000,
            ket: 'Sesuai tarif kontrak',
        },
        {
            _id: 'inv-001',
            _type: 'invoice',
            invoiceNumber: 'INV-202602-0001',
            mode: 'ORDER',
            orderRef: 'order-002',
            doRef: 'do-002',
            customerRef: 'cust-002',
            customerName: 'CV Berkah Logistik',
            masterResi: 'R-202602-0002',
            issueDate: '2026-02-14',
            dueDate: '2026-02-28',
            status: 'PAID',
            totalAmount: 2_500_000,
            notes: 'Invoice cargo batch pertama.',
        },
        {
            _id: 'ii-001',
            _type: 'invoiceItem',
            invoiceRef: 'inv-001',
            description: 'Biaya pengiriman cargo 200 kg',
            qty: 1,
            price: 2_300_000,
            subtotal: 2_300_000,
        },
        {
            _id: 'ii-002',
            _type: 'invoiceItem',
            invoiceRef: 'inv-001',
            description: 'Handling pelabuhan',
            qty: 1,
            price: 200_000,
            subtotal: 200_000,
        },
        {
            _id: 'pay-001',
            _type: 'payment',
            invoiceRef: 'nota-001',
            bankAccountRef: 'bank-bca-001',
            bankAccountName: 'BCA',
            date: '2026-02-08',
            amount: 700_000,
            method: 'TRANSFER',
            note: 'Pembayaran termin 1 nota ongkos',
        },
        {
            _id: 'pay-002',
            _type: 'payment',
            invoiceRef: 'inv-001',
            bankAccountRef: 'bank-mandiri-001',
            bankAccountName: 'Mandiri',
            date: '2026-02-14',
            amount: 2_500_000,
            method: 'TRANSFER',
            note: 'Pelunasan invoice cargo',
        },
        {
            _id: 'inc-001',
            _type: 'income',
            sourceType: 'INVOICE_PAYMENT',
            paymentRef: 'pay-001',
            date: '2026-02-08',
            amount: 700_000,
            note: 'Pembayaran nota ongkos NOTA-202602-0001',
        },
        {
            _id: 'inc-002',
            _type: 'income',
            sourceType: 'INVOICE_PAYMENT',
            paymentRef: 'pay-002',
            date: '2026-02-14',
            amount: 2_500_000,
            note: 'Pembayaran invoice INV-202602-0001',
        }
    );

    push(
        {
            _id: 'bor-001',
            _type: 'driverBorongan',
            boronganNumber: 'BRG-202602-0001',
            driverRef: 'drv-001',
            driverName: 'Supri Anto',
            periodStart: '2026-02-01',
            periodEnd: '2026-02-07',
            status: 'PAID',
            totalAmount: 900_000,
            totalCollie: 6,
            totalWeightKg: 100,
            notes: 'Borongan pengiriman reguler Jabodetabek',
            paidDate: '2026-02-10',
            paidMethod: 'TRANSFER',
            paidBankRef: 'bank-bca-001',
        },
        {
            _id: 'boritem-001',
            _type: 'driverBoronganItem',
            boronganRef: 'bor-001',
            doRef: 'do-001',
            doNumber: 'DO-202602-0001',
            vehiclePlate: 'B 1234 XYZ',
            date: '2026-02-07',
            noSJ: 'DO-202602-0001',
            tujuan: 'Jakarta Pusat',
            barang: 'Elektronik & Spare Part',
            collie: 6,
            beratKg: 100,
            tarip: 9_000,
            uangRp: 900_000,
            ket: 'Sesuai tarif DO',
        },
        {
            _id: 'bor-002',
            _type: 'driverBorongan',
            boronganNumber: 'BRG-202602-0002',
            driverRef: 'drv-002',
            driverName: 'Joko Prasetyo',
            periodStart: '2026-02-08',
            periodEnd: '2026-02-14',
            status: 'UNPAID',
            totalAmount: 650_000,
            totalCollie: 8,
            totalWeightKg: 200,
            notes: 'Belum dibayarkan karena masih menunggu batch kedua',
        },
        {
            _id: 'boritem-002',
            _type: 'driverBoronganItem',
            boronganRef: 'bor-002',
            doRef: 'do-002',
            doNumber: 'DO-202602-0002',
            vehiclePlate: 'B 5678 ABC',
            date: '2026-02-12',
            noSJ: 'DO-202602-0002',
            tujuan: 'Tanjung Priok',
            barang: 'Bahan baku plastik',
            collie: 8,
            beratKg: 200,
            tarip: 3_250,
            uangRp: 650_000,
            ket: 'Menunggu pembayaran',
        }
    );

    push(
        {
            _id: 'voucher-001',
            _type: 'driverVoucher',
            bonNumber: 'BON-202602-0001',
            driverRef: 'drv-001',
            driverName: 'Supri Anto',
            deliveryOrderRef: 'do-001',
            doNumber: 'DO-202602-0001',
            vehicleRef: 'veh-001',
            vehiclePlate: 'B 1234 XYZ',
            route: 'Bekasi - Jakarta Pusat',
            issuedDate: '2026-02-11',
            cashGiven: 800_000,
            issueBankRef: 'bank-mandiri-001',
            issueBankName: 'Mandiri',
            totalSpent: 550_000,
            balance: 250_000,
            status: 'SETTLED',
            notes: 'Bon perjalanan reguler',
            settledDate: '2026-02-13',
            settledBy: 'Owner Utama',
            settlementBankRef: 'bank-mandiri-001',
            settlementBankName: 'Mandiri',
        },
        {
            _id: 'voucher-002',
            _type: 'driverVoucher',
            bonNumber: 'BON-202602-0002',
            driverRef: 'drv-002',
            driverName: 'Joko Prasetyo',
            deliveryOrderRef: 'do-002',
            doNumber: 'DO-202602-0002',
            vehicleRef: 'veh-002',
            vehiclePlate: 'B 5678 ABC',
            route: 'Cikarang - Tanjung Priok',
            issuedDate: '2026-02-09',
            cashGiven: 600_000,
            issueBankRef: 'bank-bca-001',
            issueBankName: 'BCA',
            totalSpent: 350_000,
            balance: 250_000,
            status: 'ISSUED',
            notes: 'Bon untuk perjalanan cargo batch pertama',
        },
        {
            _id: 'vitem-001',
            _type: 'driverVoucherItem',
            voucherRef: 'voucher-001',
            category: 'Solar/BBM',
            description: 'Isi solar sebelum berangkat',
            amount: 300_000,
        },
        {
            _id: 'vitem-002',
            _type: 'driverVoucherItem',
            voucherRef: 'voucher-001',
            category: 'Tol',
            description: 'Tol perjalanan Bekasi - Jakarta',
            amount: 250_000,
        },
        {
            _id: 'vitem-003',
            _type: 'driverVoucherItem',
            voucherRef: 'voucher-002',
            category: 'Parkir',
            description: 'Parkir bongkar muat pelabuhan',
            amount: 200_000,
        },
        {
            _id: 'vitem-004',
            _type: 'driverVoucherItem',
            voucherRef: 'voucher-002',
            category: 'Makan',
            description: 'Uang makan perjalanan',
            amount: 150_000,
        }
    );

    push(
        {
            _id: 'exp-001',
            _type: 'expense',
            categoryRef: 'expcat-005',
            categoryName: 'Operasional Kantor',
            date: '2026-02-07',
            amount: 1_200_000,
            note: 'Pembelian alat tulis dan kebutuhan gudang',
            description: 'ATK dan barang habis pakai',
            privacyLevel: 'internal',
            bankAccountRef: 'bank-bca-001',
            bankAccountName: 'BCA',
        },
        {
            _id: 'exp-bor-001',
            _type: 'expense',
            categoryRef: 'driver-borongan',
            categoryName: 'Borongan Supir',
            date: '2026-02-10',
            amount: 900_000,
            note: 'Pembayaran borongan BRG-202602-0001',
            description: 'Upah borongan supir Supri Anto - BRG-202602-0001',
            privacyLevel: 'internal',
            bankAccountRef: 'bank-bca-001',
            bankAccountName: 'BCA',
            boronganRef: 'bor-001',
        },
        {
            _id: 'exp-vc-001',
            _type: 'expense',
            categoryRef: 'driver-voucher-solar-bbm',
            categoryName: 'Solar/BBM',
            date: '2026-02-13',
            amount: 300_000,
            note: 'Bon supir BON-202602-0001',
            description: 'Isi solar sebelum berangkat',
            privacyLevel: 'internal',
            relatedVehicleRef: 'veh-001',
            voucherRef: 'voucher-001',
        },
        {
            _id: 'exp-vc-002',
            _type: 'expense',
            categoryRef: 'driver-voucher-tol',
            categoryName: 'Tol',
            date: '2026-02-13',
            amount: 250_000,
            note: 'Bon supir BON-202602-0001',
            description: 'Tol perjalanan Bekasi - Jakarta',
            privacyLevel: 'internal',
            relatedVehicleRef: 'veh-001',
            voucherRef: 'voucher-001',
        }
    );

    push(
        {
            _id: 'mnt-001',
            _type: 'maintenance',
            vehicleRef: 'veh-001',
            vehiclePlate: 'B 1234 XYZ',
            type: 'Servis Berkala 50.000 km',
            scheduleType: 'DATE',
            plannedDate: '2026-03-01',
            status: 'SCHEDULED',
            vendor: 'Bengkel Resmi Mitsubishi',
            notes: 'Ganti oli dan pengecekan rem',
        },
        {
            _id: 'tire-001',
            _type: 'tireEvent',
            vehicleRef: 'veh-001',
            vehiclePlate: 'B 1234 XYZ',
            posisi: 'FRONT_LEFT',
            tireType: 'Tubeless',
            tireBrand: 'Bridgestone',
            tireSize: '205/75R16',
            installDate: '2026-01-10',
            notes: 'Ban baru terpasang',
        },
        {
            _id: 'incident-001',
            _type: 'incident',
            incidentNumber: 'INC-202602-0001',
            dateTime: '2026-02-16T09:30:00Z',
            vehicleRef: 'veh-002',
            vehiclePlate: 'B 5678 ABC',
            driverRef: 'drv-002',
            driverName: 'Joko Prasetyo',
            relatedDeliveryOrderRef: 'do-002',
            relatedDONumber: 'DO-202602-0002',
            incidentType: 'ENGINE_TROUBLE',
            urgency: 'MEDIUM',
            locationText: 'Area Pelabuhan Tanjung Priok',
            odometer: 62150,
            description: 'Mesin sempat overheat saat antre bongkar muat.',
            status: 'RESOLVED',
            assignedToUserRef: 'user-admin-001',
            assignedToUserName: 'Admin Operasional',
        },
        {
            _id: 'ial-001',
            _type: 'incidentActionLog',
            incidentRef: 'incident-001',
            timestamp: '2026-02-16T09:45:00Z',
            note: 'Supir melaporkan lampu indikator panas menyala.',
            userRef: 'user-admin-001',
            userName: 'Admin Operasional',
        },
        {
            _id: 'ial-002',
            _type: 'incidentActionLog',
            incidentRef: 'incident-001',
            timestamp: '2026-02-16T11:30:00Z',
            note: 'Kendaraan diperiksa, radiator ditambah coolant dan perjalanan dilanjutkan.',
            userRef: 'user-owner-001',
            userName: 'Owner Utama',
        }
    );

    const transferRef = 'trf-001';
    postBankTransaction({
        _id: 'btx-001',
        bankAccountRef: 'bank-bca-001',
        type: 'TRANSFER_OUT',
        amount: 5_000_000,
        date: '2026-02-05',
        description: 'Transfer ke Mandiri',
        relatedTransferRef: transferRef,
    });
    postBankTransaction({
        _id: 'btx-002',
        bankAccountRef: 'bank-mandiri-001',
        type: 'TRANSFER_IN',
        amount: 5_000_000,
        date: '2026-02-05',
        description: 'Transfer dari BCA',
        relatedTransferRef: transferRef,
    });
    postBankTransaction({
        _id: 'btx-003',
        bankAccountRef: 'bank-bca-001',
        type: 'DEBIT',
        amount: 1_200_000,
        date: '2026-02-07',
        description: 'Pembelian alat tulis dan kebutuhan gudang',
        relatedExpenseRef: 'exp-001',
    });
    postBankTransaction({
        _id: 'btx-004',
        bankAccountRef: 'bank-bca-001',
        type: 'CREDIT',
        amount: 700_000,
        date: '2026-02-08',
        description: 'Pembayaran invoice masuk',
        relatedPaymentRef: 'pay-001',
    });
    postBankTransaction({
        _id: 'btx-005',
        bankAccountRef: 'bank-bca-001',
        type: 'DEBIT',
        amount: 600_000,
        date: '2026-02-09',
        description: 'Pencairan bon supir BON-202602-0002',
        relatedVoucherRef: 'voucher-002',
    });
    postBankTransaction({
        _id: 'btx-006',
        bankAccountRef: 'bank-bca-001',
        type: 'DEBIT',
        amount: 900_000,
        date: '2026-02-10',
        description: 'Pembayaran borongan BRG-202602-0001',
        relatedExpenseRef: 'exp-bor-001',
    });
    postBankTransaction({
        _id: 'btx-007',
        bankAccountRef: 'bank-mandiri-001',
        type: 'DEBIT',
        amount: 800_000,
        date: '2026-02-11',
        description: 'Pencairan bon supir BON-202602-0001',
        relatedVoucherRef: 'voucher-001',
    });
    postBankTransaction({
        _id: 'btx-008',
        bankAccountRef: 'bank-mandiri-001',
        type: 'CREDIT',
        amount: 250_000,
        date: '2026-02-13',
        description: 'Pengembalian sisa bon BON-202602-0001',
        relatedVoucherRef: 'voucher-001',
    });
    postBankTransaction({
        _id: 'btx-009',
        bankAccountRef: 'bank-mandiri-001',
        type: 'CREDIT',
        amount: 2_500_000,
        date: '2026-02-14',
        description: 'Pembayaran invoice masuk',
        relatedPaymentRef: 'pay-002',
    });

    push(...Object.values(bankAccounts));
}

async function seed() {
    buildSeedDocuments();

    console.log(`Seeding ${documents.length} documents to Sanity...`);
    console.log(`Project: ${process.env.NEXT_PUBLIC_SANITY_PROJECT_ID} | Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
    console.log('---');

    let success = 0;
    let failed = 0;

    for (const doc of documents) {
        try {
            await client.createOrReplace(doc);
            console.log(`  OK    ${doc._type} [${doc._id}]`);
            success++;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  FAIL  ${doc._type} [${doc._id}] - ${msg}`);
            failed++;
        }
    }

    console.log('---');
    console.log(`Done! ${success} upserted, ${failed} failed`);

    if (failed > 0) {
        process.exitCode = 1;
    }
}

seed().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
