import type { AuditLog } from './types';

type AuditLogTargetInput = Pick<AuditLog, 'action' | 'entityType' | 'entityRef'>;

function cleanValue(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeEntityType(value: unknown) {
    return cleanValue(value)
        .replace(/_/g, '-')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase();
}

function pathWithEncodedTarget(basePath: string, entityRef: string) {
    return `${basePath}/${encodeURIComponent(entityRef)}`;
}

export function getAuditLogTargetHref(log: AuditLogTargetInput) {
    const entityRef = cleanValue(log.entityRef);
    const entityType = normalizeEntityType(log.entityType);

    if (!entityRef || log.action === 'DELETE') {
        return null;
    }

    switch (entityType) {
        case 'orders':
        case 'order':
            return pathWithEncodedTarget('/orders', entityRef);
        case 'delivery-orders':
        case 'delivery-order':
            return pathWithEncodedTarget('/delivery-orders', entityRef);
        case 'trip-records':
        case 'trip-record':
        case 'trips':
        case 'trip':
            return pathWithEncodedTarget('/trips', entityRef);
        case 'surat-jalan-records':
        case 'surat-jalan-record':
        case 'surat-jalan':
            return pathWithEncodedTarget('/surat-jalan', entityRef);
        case 'driver-vouchers':
        case 'driver-voucher':
            return pathWithEncodedTarget('/driver-vouchers', entityRef);
        case 'freight-notas':
        case 'freight-nota':
        case 'invoices':
        case 'invoice':
            return pathWithEncodedTarget('/invoices', entityRef);
        case 'customers':
        case 'customer':
            return pathWithEncodedTarget('/customers', entityRef);
        case 'suppliers':
        case 'supplier':
            return pathWithEncodedTarget('/suppliers', entityRef);
        case 'purchases':
        case 'purchase':
            return pathWithEncodedTarget('/inventory/purchases', entityRef);
        case 'warehouse-items':
        case 'warehouse-item':
            return pathWithEncodedTarget('/inventory/items', entityRef);
        case 'vehicles':
        case 'vehicle':
            return pathWithEncodedTarget('/fleet/vehicles', entityRef);
        case 'drivers':
        case 'driver':
            return pathWithEncodedTarget('/fleet/drivers', entityRef);
        case 'incidents':
        case 'incident':
            return pathWithEncodedTarget('/fleet/incidents', entityRef);
        case 'maintenances':
        case 'maintenance':
            return '/fleet/maintenance';
        case 'tire-events':
        case 'tire-event':
        case 'tire-history-logs':
        case 'tire-history-log':
            return '/fleet/tires';
        case 'bank-accounts':
        case 'bank-account':
            return pathWithEncodedTarget('/bank-accounts', entityRef);
        case 'bank-transactions':
        case 'bank-transaction':
            return '/bank-accounts';
        case 'expenses':
        case 'expense':
            return '/expenses';
        case 'expense-categories':
        case 'expense-category':
            return '/expense-categories';
        case 'services':
        case 'service':
            return '/services';
        case 'trip-rates':
        case 'trip-rate':
        case 'trip-route-rates':
        case 'trip-route-rate':
            return '/trip-rates';
        case 'driver-borongans':
        case 'driver-borongan':
        case 'driver-borongan-items':
        case 'driver-borongan-item':
        case 'driver-borogan-items':
        case 'driver-borogan-item':
            return pathWithEncodedTarget('/borongan', entityRef);
        case 'journal-entries':
        case 'journal-entry':
            return '/accounting/journals';
        case 'chart-of-accounts':
        case 'chart-of-account':
            return '/accounting/accounts';
        case 'company-profile':
            return '/settings/company';
        case 'users':
        case 'user':
            return '/settings/users';
        default:
            return null;
    }
}
