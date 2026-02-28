/* ============================================================
   LOGISTIK — Mock Data Store
   In-memory data layer with seed data for demo
   ============================================================ */

import {
    User, CompanyProfile, Customer, Service, ExpenseCategory, Driver,
    Order, OrderItem, DeliveryOrder, DeliveryOrderItem, TrackingLog,
    Invoice, InvoiceItem, Payment, Income, Expense,
    Vehicle, Maintenance, TireEvent, Incident, IncidentActionLog, AuditLog
} from './types';

// ── Helper: Generate IDs ──
let idCounter = 100;
export function generateId(prefix: string = 'doc'): string {
    idCounter++;
    return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

// ── In-Memory Store ──
interface DataStore {
    users: User[];
    companyProfile: CompanyProfile;
    customers: Customer[];
    services: Service[];
    expenseCategories: ExpenseCategory[];
    drivers: Driver[];
    orders: Order[];
    orderItems: OrderItem[];
    deliveryOrders: DeliveryOrder[];
    deliveryOrderItems: DeliveryOrderItem[];
    trackingLogs: TrackingLog[];
    invoices: Invoice[];
    invoiceItems: InvoiceItem[];
    payments: Payment[];
    incomes: Income[];
    expenses: Expense[];
    vehicles: Vehicle[];
    maintenances: Maintenance[];
    tireEvents: TireEvent[];
    incidents: Incident[];
    incidentActionLogs: IncidentActionLog[];
    auditLogs: AuditLog[];
}

// ── Password hash for TEST1234 (pre-computed bcrypt) ──
const OWNER_PASSWORD_HASH = '$2a$10$dummyhashforTEST1234ownerpassword';

// ── Seed Data ──
const seedData: DataStore = {
    users: [
        {
            _id: 'user-owner-001',
            _type: 'user',
            name: 'Owner Utama',
            email: 'owner@company.local',
            role: 'OWNER',
            passwordHash: OWNER_PASSWORD_HASH,
            active: true,
            createdAt: '2026-01-01T00:00:00Z'
        }
    ],

    companyProfile: {
        _id: 'company-001',
        _type: 'companyProfile',
        name: 'PT Ekspedisi Nusantara',
        address: 'Jl. Raya Logistik No. 88, Jakarta Utara 14120',
        phone: '021-555-8888',
        email: 'info@ekspedisi-nusantara.co.id',
        npwp: '01.234.567.8-012.000',
        bankName: 'Bank BCA',
        bankAccount: '123-456-7890',
        bankHolder: 'PT Ekspedisi Nusantara',
        numberingSettings: {
            resiPrefix: 'R',
            resiCounter: 1,
            doPrefix: 'DO',
            doCounter: 2,
            invoicePrefix: 'INV',
            invoiceCounter: 1,
            incidentPrefix: 'INC',
            incidentCounter: 1
        },
        invoiceSettings: {
            defaultTermDays: 14,
            dueDateDays: 14,
            footerNote: 'Pembayaran dapat ditransfer ke rekening perusahaan. Harap sertakan nomor invoice sebagai referensi.',
            invoiceMode: 'ORDER'
        },
        documentSettings: {
            showContact: true,
            dateFormat: 'dd/MM/yyyy'
        }
    },

    customers: [
        {
            _id: 'cust-001',
            _type: 'customer',
            name: 'PT Maju Sejahtera',
            address: 'Jl. Industri Raya No. 45, Bekasi 17530',
            contactPerson: 'Budi Santoso',
            phone: '081-234-5678',
            email: 'budi@majusejahtera.co.id',
            defaultPaymentTerm: 14,
            npwp: '02.345.678.9-013.000',
            active: true
        },
        {
            _id: 'cust-002',
            _type: 'customer',
            name: 'CV Berkah Logistik',
            address: 'Jl. Perdagangan No. 12, Surabaya 60175',
            contactPerson: 'Siti Rahayu',
            phone: '082-345-6789',
            email: 'siti@berkahlogistik.com',
            defaultPaymentTerm: 30,
            active: true
        }
    ],

    services: [
        { _id: 'svc-001', _type: 'service', name: 'Reguler', description: 'Pengiriman reguler 3-5 hari kerja', active: true },
        { _id: 'svc-002', _type: 'service', name: 'Express', description: 'Pengiriman express 1-2 hari kerja', active: true },
        { _id: 'svc-003', _type: 'service', name: 'Cargo', description: 'Pengiriman cargo untuk barang besar/berat', active: true }
    ],

    expenseCategories: [
        { _id: 'expcat-001', _type: 'expenseCategory', name: 'BBM / Solar', active: true },
        { _id: 'expcat-002', _type: 'expenseCategory', name: 'Tol & Parkir', active: true },
        { _id: 'expcat-003', _type: 'expenseCategory', name: 'Perawatan Kendaraan', active: true },
        { _id: 'expcat-004', _type: 'expenseCategory', name: 'Ban', active: true },
        { _id: 'expcat-005', _type: 'expenseCategory', name: 'Gaji & Upah', active: true },
        { _id: 'expcat-006', _type: 'expenseCategory', name: 'Operasional Kantor', active: true },
        { _id: 'expcat-007', _type: 'expenseCategory', name: 'Perbaikan Insiden', active: true }
    ],

    drivers: [
        { _id: 'drv-001', _type: 'driver', name: 'Ahmad Supardi', phone: '085-111-2222', licenseNumber: 'SIM-B2-001', active: true },
        { _id: 'drv-002', _type: 'driver', name: 'Joko Widodo', phone: '085-333-4444', licenseNumber: 'SIM-B2-002', active: true }
    ],

    orders: [
        {
            _id: 'order-001',
            _type: 'order',
            masterResi: 'R-202602-0001',
            customerRef: 'cust-001',
            customerName: 'PT Maju Sejahtera',
            receiverName: 'Andi Kusuma',
            receiverPhone: '087-888-9999',
            receiverAddress: 'Jl. Pabrik No. 22, Semarang 50123',
            receiverCompany: 'PT Penerima Barang',
            serviceRef: 'svc-001',
            serviceName: 'Reguler',
            status: 'PARTIAL',
            notes: 'Penerima hanya bisa terima 1 item dulu, sisanya menyusul',
            createdAt: '2026-02-20T08:00:00Z',
            createdBy: 'user-owner-001'
        }
    ],

    orderItems: [
        {
            _id: 'oi-001',
            _type: 'orderItem',
            orderRef: 'order-001',
            description: 'Elektronik - TV LED 55 inch',
            qtyKoli: 1,
            weight: 50,
            volume: 0.5,
            value: 8000000,
            status: 'DELIVERED'
        },
        {
            _id: 'oi-002',
            _type: 'orderItem',
            orderRef: 'order-001',
            description: 'Spare Part Mesin Industri',
            qtyKoli: 2,
            weight: 30,
            status: 'HOLD'
        },
        {
            _id: 'oi-003',
            _type: 'orderItem',
            orderRef: 'order-001',
            description: 'Dokumen Penting & Kontrak',
            qtyKoli: 1,
            weight: 5,
            value: 500000,
            status: 'PENDING'
        }
    ],

    deliveryOrders: [
        {
            _id: 'do-001',
            _type: 'deliveryOrder',
            doNumber: 'DO-202602-0001',
            orderRef: 'order-001',
            masterResi: 'R-202602-0001',
            vehicleRef: 'veh-001',
            vehiclePlate: 'B 1234 XYZ',
            driverRef: 'drv-001',
            driverName: 'Ahmad Supardi',
            date: '2026-02-21',
            status: 'DELIVERED',
            notes: 'Pengiriman tahap 1 - hanya TV LED',
            podReceiverName: 'Andi Kusuma',
            podReceivedDate: '2026-02-22',
            podNote: 'Barang diterima dalam kondisi baik',
            customerName: 'PT Maju Sejahtera',
            receiverName: 'Andi Kusuma',
            receiverAddress: 'Jl. Pabrik No. 22, Semarang 50123'
        }
    ],

    deliveryOrderItems: [
        {
            _id: 'doi-001',
            _type: 'deliveryOrderItem',
            deliveryOrderRef: 'do-001',
            orderItemRef: 'oi-001',
            orderItemDescription: 'Elektronik - TV LED 55 inch',
            orderItemQtyKoli: 1,
            orderItemWeight: 50
        }
    ],

    trackingLogs: [
        {
            _id: 'tl-001', _type: 'trackingLog', refType: 'DO', refRef: 'do-001',
            status: 'CREATED', note: 'Surat jalan dibuat', timestamp: '2026-02-21T08:00:00Z', userName: 'Owner Utama'
        },
        {
            _id: 'tl-002', _type: 'trackingLog', refType: 'DO', refRef: 'do-001',
            status: 'ON_DELIVERY', note: 'Kendaraan berangkat dari gudang Jakarta', locationText: 'Gudang Jakarta Utara', timestamp: '2026-02-21T10:00:00Z', userName: 'Owner Utama'
        },
        {
            _id: 'tl-003', _type: 'trackingLog', refType: 'DO', refRef: 'do-001',
            status: 'DELIVERED', note: 'Barang diterima oleh Andi Kusuma', locationText: 'Semarang', timestamp: '2026-02-22T14:00:00Z', userName: 'Owner Utama'
        }
    ],

    invoices: [
        {
            _id: 'inv-001',
            _type: 'invoice',
            invoiceNumber: 'INV-202602-0001',
            mode: 'ORDER',
            orderRef: 'order-001',
            customerRef: 'cust-001',
            customerName: 'PT Maju Sejahtera',
            masterResi: 'R-202602-0001',
            issueDate: '2026-02-22',
            dueDate: '2026-03-08',
            status: 'PARTIAL',
            totalAmount: 1500000,
            notes: 'Invoice untuk order R-202602-0001'
        }
    ],

    invoiceItems: [
        { _id: 'ii-001', _type: 'invoiceItem', invoiceRef: 'inv-001', description: 'Biaya Kirim Reguler - 85 kg', qty: 1, price: 1200000, subtotal: 1200000 },
        { _id: 'ii-002', _type: 'invoiceItem', invoiceRef: 'inv-001', description: 'Biaya Packing Khusus', qty: 1, price: 300000, subtotal: 300000 }
    ],

    payments: [
        {
            _id: 'pay-001',
            _type: 'payment',
            invoiceRef: 'inv-001',
            date: '2026-02-25',
            amount: 500000,
            method: 'TRANSFER',
            note: 'DP pembayaran pertama via BCA'
        }
    ],

    incomes: [
        {
            _id: 'inc-001',
            _type: 'income',
            sourceType: 'INVOICE_PAYMENT',
            paymentRef: 'pay-001',
            date: '2026-02-25',
            amount: 500000,
            note: 'Pembayaran invoice INV-202602-0001'
        }
    ],

    expenses: [
        {
            _id: 'exp-001',
            _type: 'expense',
            categoryRef: 'expcat-004',
            categoryName: 'Ban',
            date: '2026-02-23',
            amount: 850000,
            note: 'Ganti ban depan kiri - ban meletus di tol',
            description: 'Pembelian ban baru Bridgestone 195/70 R14',
            privacyLevel: 'internal',
            relatedVehicleRef: 'veh-001',
            relatedIncidentRef: 'inc-001'
        },
        {
            _id: 'exp-002',
            _type: 'expense',
            categoryRef: 'expcat-001',
            categoryName: 'BBM / Solar',
            date: '2026-02-21',
            amount: 450000,
            note: 'Solar perjalanan Jakarta-Semarang',
            description: 'Pengisian solar untuk DO-202602-0001',
            privacyLevel: 'internal',
            relatedVehicleRef: 'veh-001'
        },
        {
            _id: 'exp-003',
            _type: 'expense',
            categoryRef: 'expcat-005',
            categoryName: 'Gaji & Upah',
            date: '2026-02-28',
            amount: 5000000,
            note: 'Gaji driver bulan Februari',
            description: 'Pembayaran gaji driver',
            privacyLevel: 'ownerOnly'
        }
    ],

    vehicles: [
        {
            _id: 'veh-001',
            _type: 'vehicle',
            unitCode: 'TRK-001',
            plateNumber: 'B 1234 XYZ',
            vehicleType: 'Truck',
            brandModel: 'Mitsubishi Colt Diesel FE 74 HD',
            year: 2022,
            capacityKg: 5000,
            capacityVolume: 20,
            chassisNumber: 'MHMFE74P5MK123456',
            engineNumber: '4D34T-AB1234',
            status: 'ACTIVE',
            base: 'Jakarta',
            notes: 'Unit utama rute Jawa',
            lastOdometer: 45200,
            lastOdometerAt: '2026-02-22'
        }
    ],

    maintenances: [
        {
            _id: 'mnt-001',
            _type: 'maintenance',
            vehicleRef: 'veh-001',
            vehiclePlate: 'B 1234 XYZ',
            type: 'Servis Berkala 50.000 km',
            scheduleType: 'ODOMETER',
            plannedOdometer: 50000,
            status: 'SCHEDULED',
            notes: 'Ganti oli mesin, filter oli, filter udara, cek rem',
        }
    ],

    tireEvents: [
        {
            _id: 'te-001',
            _type: 'tireEvent',
            vehicleRef: 'veh-001',
            vehiclePlate: 'B 1234 XYZ',
            date: '2026-02-23',
            odometer: 45100,
            tirePosition: 'FRONT_LEFT',
            action: 'REPLACE_NEW',
            cause: 'BLOWOUT',
            notes: 'Ban meletus di tol Cikampek KM 45. Diganti ban baru Bridgestone.',
            relatedExpenseRef: 'exp-001'
        }
    ],

    incidents: [
        {
            _id: 'inc-001',
            _type: 'incident',
            incidentNumber: 'INC-202602-0001',
            dateTime: '2026-02-22T16:30:00Z',
            vehicleRef: 'veh-001',
            vehiclePlate: 'B 1234 XYZ',
            driverRef: 'drv-001',
            driverName: 'Ahmad Supardi',
            relatedDeliveryOrderRef: 'do-001',
            relatedDONumber: 'DO-202602-0001',
            incidentType: 'BLOWOUT_TIRE',
            urgency: 'MEDIUM',
            locationText: 'Tol Cikampek KM 45, arah Semarang',
            odometer: 45100,
            description: 'Ban depan kiri meletus saat di tol Cikampek. Kendaraan berhasil menepi dengan aman. Tidak ada cedera. Ban diganti dengan ban cadangan, kemudian dilanjutkan ke Semarang. Ban baru dipasang keesokan harinya.',
            status: 'RESOLVED',
            assignedToUserRef: 'user-owner-001',
            assignedToUserName: 'Owner Utama'
        }
    ],

    incidentActionLogs: [
        {
            _id: 'ial-001', _type: 'incidentActionLog', incidentRef: 'inc-001',
            timestamp: '2026-02-22T16:30:00Z', note: 'Laporan insiden diterima: ban depan kiri meletus di tol', userName: 'Owner Utama'
        },
        {
            _id: 'ial-002', _type: 'incidentActionLog', incidentRef: 'inc-001',
            timestamp: '2026-02-22T17:00:00Z', note: 'Driver mengganti ban cadangan, perjalanan dilanjutkan', userName: 'Owner Utama'
        },
        {
            _id: 'ial-003', _type: 'incidentActionLog', incidentRef: 'inc-001',
            timestamp: '2026-02-23T09:00:00Z', note: 'Ban baru Bridgestone dipasang. Insiden selesai ditangani.', userName: 'Owner Utama'
        }
    ],

    auditLogs: [
        {
            _id: 'al-001', _type: 'auditLog', actorUserRef: 'user-owner-001', actorUserName: 'Owner Utama',
            action: 'LOGIN', entityType: 'auth', changesSummary: 'Login berhasil', timestamp: '2026-02-20T07:50:00Z'
        },
        {
            _id: 'al-002', _type: 'auditLog', actorUserRef: 'user-owner-001', actorUserName: 'Owner Utama',
            action: 'CREATE', entityType: 'order', entityRef: 'order-001', changesSummary: 'Order R-202602-0001 dibuat untuk PT Maju Sejahtera', timestamp: '2026-02-20T08:00:00Z'
        },
        {
            _id: 'al-003', _type: 'auditLog', actorUserRef: 'user-owner-001', actorUserName: 'Owner Utama',
            action: 'CREATE', entityType: 'deliveryOrder', entityRef: 'do-001', changesSummary: 'DO-202602-0001 dibuat untuk order R-202602-0001', timestamp: '2026-02-21T08:00:00Z'
        }
    ]
};

// ── Global store (server-side in-memory, simulating database) ──
let store: DataStore = JSON.parse(JSON.stringify(seedData));

// ── CRUD Operations ──
export function getStore(): DataStore {
    return store;
}

export function resetStore(): void {
    store = JSON.parse(JSON.stringify(seedData));
}

// Generic CRUD
export function getAll<T>(collection: keyof DataStore): T[] {
    const data = store[collection];
    if (Array.isArray(data)) return data as unknown as T[];
    return [data] as unknown as T[];
}

export function getById<T extends { _id: string }>(collection: keyof DataStore, id: string): T | undefined {
    const data = store[collection];
    if (Array.isArray(data)) {
        return (data as unknown as T[]).find(item => item._id === id);
    }
    if ((data as unknown as T)._id === id) return data as unknown as T;
    return undefined;
}

export function getByFilter<T extends Record<string, unknown>>(collection: keyof DataStore, filter: Partial<T>): T[] {
    const data = store[collection];
    if (!Array.isArray(data)) return [];
    return (data as unknown as T[]).filter(item => {
        return Object.entries(filter).every(([key, value]) => item[key] === value);
    });
}

export function create<T extends { _id: string }>(collection: keyof DataStore, item: T): T {
    const data = store[collection];
    if (Array.isArray(data)) {
        (data as unknown as T[]).push(item);
    }
    return item;
}

export function update<T extends { _id: string }>(collection: keyof DataStore, id: string, updates: Partial<T>): T | undefined {
    const data = store[collection];
    if (Array.isArray(data)) {
        const arr = data as unknown as T[];
        const index = arr.findIndex(item => item._id === id);
        if (index !== -1) {
            arr[index] = { ...arr[index], ...updates };
            return arr[index];
        }
    } else if ((data as unknown as T)._id === id) {
        Object.assign(data as unknown as T, updates);
        return data as unknown as T;
    }
    return undefined;
}

export function remove(collection: keyof DataStore, id: string): boolean {
    const data = store[collection];
    if (Array.isArray(data)) {
        const index = data.findIndex((item: { _id: string }) => item._id === id);
        if (index !== -1) {
            data.splice(index, 1);
            return true;
        }
    }
    return false;
}

// ── Numbering ──
export function getNextNumber(type: 'resi' | 'do' | 'invoice' | 'incident'): string {
    const profile = store.companyProfile;
    const now = new Date();
    const monthYear = `${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getFullYear().toString().slice(-2)}`;

    let prefix: string;
    let counter: number;

    switch (type) {
        case 'resi':
            prefix = profile.numberingSettings.resiPrefix;
            counter = profile.numberingSettings.resiCounter;
            profile.numberingSettings.resiCounter++;
            break;
        case 'do':
            prefix = profile.numberingSettings.doPrefix;
            counter = profile.numberingSettings.doCounter;
            profile.numberingSettings.doCounter++;
            break;
        case 'invoice':
            prefix = profile.numberingSettings.invoicePrefix;
            counter = profile.numberingSettings.invoiceCounter;
            profile.numberingSettings.invoiceCounter++;
            break;
        case 'incident':
            prefix = profile.numberingSettings.incidentPrefix;
            counter = profile.numberingSettings.incidentCounter;
            profile.numberingSettings.incidentCounter++;
            break;
    }

    return `${prefix}-2026${monthYear.slice(0, 2)}-${counter.toString().padStart(4, '0')}`;
}
