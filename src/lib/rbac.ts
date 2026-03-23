/* ============================================================
   LOGISTIK - RBAC + RLC Privacy System
   Role-based access control with record/field-level privacy
   ============================================================ */

import type { Expense, UserRole, Vehicle } from './types';

export interface ModulePermissions {
    view: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
    export: boolean;
    print: boolean;
}

export type EffectiveUserRole = Exclude<UserRole, 'ADMIN'>;
export type InternalUserRole = Exclude<EffectiveUserRole, 'DRIVER'>;
export type AppModule =
    | 'dashboard'
    | 'orders'
    | 'deliveryOrders'
    | 'invoices'
    | 'customers'
    | 'services'
    | 'expenseCategories'
    | 'expenses'
    | 'reports'
    | 'vehicles'
    | 'maintenance'
    | 'incidents'
    | 'companySettings'
    | 'userManagement'
    | 'auditLogs'
    | 'profile'
    | 'tires'
    | 'drivers'
    | 'bankAccounts'
    | 'driverVouchers'
    | 'freightNotas'
    | 'driverBorongans';

const DENY_ALL: ModulePermissions = {
    view: false,
    create: false,
    update: false,
    delete: false,
    export: false,
    print: false,
};

const OWNER_FULL: ModulePermissions = {
    view: true,
    create: true,
    update: true,
    delete: true,
    export: true,
    print: true,
};

export const INTERNAL_USER_ROLE_OPTIONS: InternalUserRole[] = [
    'OWNER',
    'OPERASIONAL',
    'FINANCE',
    'ARMADA',
];

export function normalizeUserRole(role: UserRole): EffectiveUserRole {
    return role === 'ADMIN' ? 'OPERASIONAL' : role;
}

const permissionMatrix: Record<AppModule, Partial<Record<EffectiveUserRole, ModulePermissions>>> = {
    dashboard: {
        OWNER: { ...DENY_ALL, view: true },
        OPERASIONAL: { ...DENY_ALL, view: true },
        FINANCE: { ...DENY_ALL, view: true },
        ARMADA: { ...DENY_ALL, view: true },
    },
    orders: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: { ...DENY_ALL, view: true },
        ARMADA: { ...DENY_ALL, view: true },
    },
    deliveryOrders: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: { ...DENY_ALL, view: true, print: true },
        ARMADA: { ...DENY_ALL, view: true, print: true },
    },
    invoices: {
        OWNER: OWNER_FULL,
        FINANCE: OWNER_FULL,
        OPERASIONAL: { ...DENY_ALL, view: true, print: true },
    },
    customers: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: { ...DENY_ALL, view: true },
    },
    services: {
        OWNER: OWNER_FULL,
        OPERASIONAL: { ...DENY_ALL, view: true },
        ARMADA: { ...DENY_ALL, view: true },
    },
    expenseCategories: {
        OWNER: OWNER_FULL,
        OPERASIONAL: { ...DENY_ALL, view: true },
        FINANCE: { ...DENY_ALL, view: true },
    },
    expenses: {
        OWNER: OWNER_FULL,
        OPERASIONAL: { ...DENY_ALL, view: true, create: true },
        FINANCE: OWNER_FULL,
    },
    reports: {
        OWNER: { ...DENY_ALL, view: true, export: true, print: true },
        FINANCE: { ...DENY_ALL, view: true, export: true, print: true },
    },
    vehicles: {
        OWNER: OWNER_FULL,
        OPERASIONAL: { ...DENY_ALL, view: true, print: true },
        ARMADA: OWNER_FULL,
    },
    maintenance: {
        OWNER: OWNER_FULL,
        OPERASIONAL: { ...DENY_ALL, view: true },
        ARMADA: OWNER_FULL,
    },
    incidents: {
        OWNER: OWNER_FULL,
        OPERASIONAL: { ...DENY_ALL, view: true, create: true, update: true, export: true, print: true },
        ARMADA: OWNER_FULL,
    },
    companySettings: {
        OWNER: { ...DENY_ALL, view: true, update: true },
    },
    userManagement: {
        OWNER: OWNER_FULL,
    },
    auditLogs: {
        OWNER: { ...DENY_ALL, view: true, export: true },
    },
    profile: {
        OWNER: { ...DENY_ALL, view: true, update: true },
        OPERASIONAL: { ...DENY_ALL, view: true, update: true },
        FINANCE: { ...DENY_ALL, view: true, update: true },
        ARMADA: { ...DENY_ALL, view: true, update: true },
    },
    tires: {
        OWNER: OWNER_FULL,
        OPERASIONAL: { ...DENY_ALL, view: true },
        ARMADA: OWNER_FULL,
    },
    drivers: {
        OWNER: OWNER_FULL,
        OPERASIONAL: { ...DENY_ALL, view: true },
        ARMADA: OWNER_FULL,
    },
    bankAccounts: {
        OWNER: OWNER_FULL,
        OPERASIONAL: { ...DENY_ALL, view: true },
        FINANCE: { ...DENY_ALL, view: true, create: true, update: true, export: true },
    },
    driverVouchers: {
        OWNER: OWNER_FULL,
        OPERASIONAL: OWNER_FULL,
        FINANCE: { ...DENY_ALL, view: true, export: true, print: true },
    },
    freightNotas: {
        OWNER: OWNER_FULL,
        OPERASIONAL: { ...DENY_ALL, view: true, print: true },
        FINANCE: OWNER_FULL,
    },
    driverBorongans: {
        OWNER: OWNER_FULL,
        OPERASIONAL: { ...DENY_ALL, view: true },
        FINANCE: { ...DENY_ALL, view: true, export: true, print: true },
    },
};

export function hasPermission(role: UserRole, module: AppModule, action: keyof ModulePermissions): boolean {
    const normalizedRole = normalizeUserRole(role);
    const modulePerms = permissionMatrix[module];
    if (!modulePerms) return false;
    const rolePerms = modulePerms[normalizedRole];
    if (!rolePerms) return false;
    return rolePerms[action];
}

export function getModulePermissions(role: UserRole, module: AppModule): ModulePermissions {
    const normalizedRole = normalizeUserRole(role);
    return permissionMatrix[module]?.[normalizedRole] || DENY_ALL;
}

export function filterExpensesByRole(expenses: Expense[], role: UserRole): Expense[] {
    if (normalizeUserRole(role) === 'OWNER') return expenses;
    return expenses.filter(expense => expense.privacyLevel !== 'ownerOnly');
}

export function sanitizeVehicleForRole(vehicle: Vehicle, role: UserRole): Vehicle {
    if (normalizeUserRole(role) === 'OWNER') return vehicle;
    return {
        ...vehicle,
        chassisNumber: undefined,
        engineNumber: undefined,
    };
}

export interface SidebarMenuItem {
    label: string;
    href: string;
    icon: string;
    module: AppModule;
    badge?: number;
}

export interface SidebarMenuGroup {
    label: string;
    items: SidebarMenuItem[];
}

export function getSidebarMenu(role: UserRole): SidebarMenuGroup[] {
    const normalizedRole = normalizeUserRole(role);
    if (normalizedRole === 'DRIVER') {
        return [];
    }

    const groups: SidebarMenuGroup[] = [
        {
            label: 'Utama',
            items: [{ label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard', module: 'dashboard' }],
        },
        {
            label: 'Kerja Harian',
            items: [
                { label: 'Order / Resi', href: '/orders', icon: 'Package', module: 'orders' },
                { label: 'Surat Jalan', href: '/delivery-orders', icon: 'Truck', module: 'deliveryOrders' },
                { label: 'Uang Jalan Trip', href: '/driver-vouchers', icon: 'Wallet', module: 'driverVouchers' },
                { label: 'Pengeluaran', href: '/expenses', icon: 'Wallet', module: 'expenses' },
            ],
        },
        {
            label: 'Tagihan & Kas',
            items: [
                { label: 'Tagihan / Nota', href: '/invoices', icon: 'FileText', module: 'freightNotas' },
                { label: 'Rekening & Kas', href: '/bank-accounts', icon: 'Landmark', module: 'bankAccounts' },
                { label: 'Laporan', href: '/reports', icon: 'BarChart3', module: 'reports' },
            ],
        },
        {
            label: 'Master Data',
            items: [
                { label: 'Customer', href: '/customers', icon: 'Users', module: 'customers' },
                { label: 'Jenis Armada', href: '/services', icon: 'Layers', module: 'services' },
                { label: 'Kategori Biaya', href: '/expense-categories', icon: 'Tags', module: 'expenseCategories' },
            ],
        },
        {
            label: 'Armada',
            items: [
                { label: 'Kendaraan', href: '/fleet/vehicles', icon: 'Car', module: 'vehicles' },
                { label: 'Supir', href: '/fleet/drivers', icon: 'UserCircle', module: 'drivers' },
                { label: 'Maintenance', href: '/fleet/maintenance', icon: 'Wrench', module: 'maintenance' },
                { label: 'Ban', href: '/fleet/tires', icon: 'Wrench', module: 'tires' },
                { label: 'Insiden', href: '/fleet/incidents', icon: 'AlertTriangle', module: 'incidents' },
            ],
        },
        {
            label: 'Pengaturan',
            items: [
                { label: 'Profil Saya', href: '/settings/profile', icon: 'User', module: 'profile' },
                { label: 'Ubah Password', href: '/settings/password', icon: 'Lock', module: 'profile' },
                { label: 'Perusahaan', href: '/settings/company', icon: 'Building2', module: 'companySettings' },
                { label: 'Pengguna', href: '/settings/users', icon: 'UserCog', module: 'userManagement' },
                { label: 'Audit Aktivitas', href: '/settings/audit-logs', icon: 'ScrollText', module: 'auditLogs' },
            ],
        },
    ];

    return groups
        .map(group => ({
            ...group,
            items: group.items.filter(item => hasPermission(normalizedRole, item.module, 'view')),
        }))
        .filter(group => group.items.length > 0);
}
