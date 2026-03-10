/* ============================================================
   LOGISTIK — RBAC + RLC Privacy System
   Role-based access control with record/field-level privacy
   ============================================================ */

import { UserRole, Expense, Vehicle } from './types';

// ── Permission Matrix ──
export interface ModulePermissions {
    view: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
    export: boolean;
    print: boolean;
}

const permissionMatrix: Record<string, Record<UserRole, ModulePermissions>> = {
    dashboard: {
        OWNER: { view: true, create: false, update: false, delete: false, export: false, print: false },
        ADMIN: { view: true, create: false, update: false, delete: false, export: false, print: false },
    },
    orders: {
        OWNER: { view: true, create: true, update: true, delete: true, export: true, print: true },
        ADMIN: { view: true, create: true, update: true, delete: true, export: true, print: true },
    },
    deliveryOrders: {
        OWNER: { view: true, create: true, update: true, delete: true, export: true, print: true },
        ADMIN: { view: true, create: true, update: true, delete: true, export: true, print: true },
    },
    invoices: {
        OWNER: { view: true, create: true, update: true, delete: true, export: true, print: true },
        ADMIN: { view: true, create: true, update: false, delete: false, export: true, print: true },
    },
    customers: {
        OWNER: { view: true, create: true, update: true, delete: true, export: true, print: false },
        ADMIN: { view: true, create: true, update: true, delete: true, export: true, print: false },
    },
    services: {
        OWNER: { view: true, create: true, update: true, delete: true, export: false, print: false },
        ADMIN: { view: true, create: false, update: false, delete: false, export: false, print: false },
    },
    expenseCategories: {
        OWNER: { view: true, create: true, update: true, delete: true, export: false, print: false },
        ADMIN: { view: true, create: false, update: false, delete: false, export: false, print: false },
    },
    expenses: {
        OWNER: { view: true, create: true, update: true, delete: true, export: true, print: false },
        ADMIN: { view: true, create: true, update: false, delete: false, export: false, print: false },
    },
    reports: {
        OWNER: { view: true, create: false, update: false, delete: false, export: true, print: true },
        ADMIN: { view: false, create: false, update: false, delete: false, export: false, print: false },
    },
    vehicles: {
        OWNER: { view: true, create: true, update: true, delete: true, export: true, print: true },
        ADMIN: { view: true, create: true, update: true, delete: true, export: true, print: true },
    },
    maintenance: {
        OWNER: { view: true, create: true, update: true, delete: true, export: false, print: false },
        ADMIN: { view: true, create: true, update: true, delete: false, export: false, print: false },
    },
    incidents: {
        OWNER: { view: true, create: true, update: true, delete: true, export: true, print: true },
        ADMIN: { view: true, create: true, update: true, delete: false, export: true, print: true },
    },
    companySettings: {
        OWNER: { view: true, create: false, update: true, delete: false, export: false, print: false },
        ADMIN: { view: false, create: false, update: false, delete: false, export: false, print: false },
    },
    userManagement: {
        OWNER: { view: true, create: true, update: true, delete: true, export: false, print: false },
        ADMIN: { view: false, create: false, update: false, delete: false, export: false, print: false },
    },
    auditLogs: {
        OWNER: { view: true, create: false, update: false, delete: false, export: true, print: false },
        ADMIN: { view: false, create: false, update: false, delete: false, export: false, print: false },
    },
    profile: {
        OWNER: { view: true, create: false, update: true, delete: false, export: false, print: false },
        ADMIN: { view: true, create: false, update: true, delete: false, export: false, print: false },
    },
    tires: {
        OWNER: { view: true, create: true, update: true, delete: true, export: false, print: false },
        ADMIN: { view: true, create: true, update: true, delete: false, export: false, print: false },
    },
    drivers: {
        OWNER: { view: true, create: true, update: true, delete: true, export: false, print: false },
        ADMIN: { view: true, create: true, update: true, delete: false, export: false, print: false },
    },
    bankAccounts: {
        OWNER: { view: true, create: true, update: true, delete: true, export: true, print: false },
        ADMIN: { view: true, create: false, update: false, delete: false, export: false, print: false },
    },
    driverVouchers: {
        OWNER: { view: true, create: true, update: true, delete: true, export: true, print: true },
        ADMIN: { view: true, create: true, update: true, delete: false, export: true, print: true },
    },
    freightNotas: {
        OWNER: { view: true, create: true, update: true, delete: true, export: true, print: true },
        ADMIN: { view: true, create: true, update: true, delete: false, export: true, print: true },
    },
    driverBorongans: {
        OWNER: { view: true, create: true, update: true, delete: true, export: true, print: true },
        ADMIN: { view: true, create: true, update: true, delete: false, export: true, print: true },
    },
};

// ── Check Permission ──
export function hasPermission(role: UserRole, module: string, action: keyof ModulePermissions): boolean {
    const modulePerms = permissionMatrix[module];
    if (!modulePerms) return false;
    const rolePerms = modulePerms[role];
    if (!rolePerms) return false;
    return rolePerms[action];
}

export function getModulePermissions(role: UserRole, module: string): ModulePermissions {
    return permissionMatrix[module]?.[role] || {
        view: false, create: false, update: false, delete: false, export: false, print: false,
    };
}

// ── RLC: Filter expenses by privacy ──
export function filterExpensesByRole(expenses: Expense[], role: UserRole): Expense[] {
    if (role === 'OWNER') return expenses;
    return expenses.filter(e => e.privacyLevel !== 'ownerOnly');
}

// ── RLC: Sanitize vehicle data for ADMIN ──
export function sanitizeVehicleForRole(vehicle: Vehicle, role: UserRole): Vehicle {
    if (role === 'OWNER') return vehicle;
    // Remove sensitive fields for ADMIN
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { chassisNumber: _c, engineNumber: _e, ...safe } = vehicle;
    return { ...safe, chassisNumber: undefined, engineNumber: undefined };
}

// ── Sidebar Menu Items ──
export interface SidebarMenuItem {
    label: string;
    href: string;
    icon: string;
    module: string;
    badge?: number;
}

export interface SidebarMenuGroup {
    label: string;
    items: SidebarMenuItem[];
}

export function getSidebarMenu(role: UserRole): SidebarMenuGroup[] {
    const groups: SidebarMenuGroup[] = [
        {
            label: 'Utama',
            items: [
                { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard', module: 'dashboard' },
            ],
        },
        {
            label: 'Operasional',
            items: [
                { label: 'Order / Resi', href: '/orders', icon: 'Package', module: 'orders' },
                { label: 'Surat Jalan', href: '/delivery-orders', icon: 'Truck', module: 'deliveryOrders' },
                { label: 'Customer', href: '/customers', icon: 'Users', module: 'customers' },
                { label: 'Layanan', href: '/services', icon: 'Layers', module: 'services' },
            ],
        },
        {
            label: 'Keuangan',
            items: [
                { label: 'Nota Ongkos Angkut', href: '/invoices', icon: 'FileText', module: 'freightNotas' },
                { label: 'Borongan Supir', href: '/borongan', icon: 'Receipt', module: 'driverBorongans' },
                { label: 'Bon Supir', href: '/driver-vouchers', icon: 'Wallet', module: 'driverVouchers' },
                { label: 'Pengeluaran', href: '/expenses', icon: 'Wallet', module: 'expenses' },
                { label: 'Kategori Biaya', href: '/expense-categories', icon: 'Tags', module: 'expenseCategories' },
                { label: 'Rekening Bank', href: '/bank-accounts', icon: 'Landmark', module: 'bankAccounts' },
                ...(role === 'OWNER' ? [{ label: 'Laporan', href: '/reports', icon: 'BarChart3', module: 'reports' }] : []),
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
                ...(role === 'OWNER' ? [
                    { label: 'Perusahaan', href: '/settings/company', icon: 'Building2', module: 'companySettings' },
                    { label: 'User Management', href: '/settings/users', icon: 'UserCog', module: 'userManagement' },
                    { label: 'Audit Log', href: '/settings/audit-logs', icon: 'ScrollText', module: 'auditLogs' },
                ] : []),
            ],
        },
    ];

    // Filter groups based on role permissions
    return groups.map(group => ({
        ...group,
        items: group.items.filter(item => hasPermission(role, item.module, 'view')),
    })).filter(group => group.items.length > 0);
}
