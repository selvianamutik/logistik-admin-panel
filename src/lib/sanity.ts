/* ============================================================
   LOGISTIK — Sanity Client
   Server-side Sanity client for GROQ queries and mutations
   ============================================================ */

import { createClient } from '@sanity/client';

type SanityConfig = {
    projectId: string;
    dataset: string;
    apiVersion: string;
    token?: string;
};

type SanityListOptions = {
    filterObj?: Record<string, unknown>;
    orFilters?: Array<{ fields: string[]; value: string | number | boolean }>;
    definedFields?: string[];
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    sortClause?: string;
};

type SanityListResult<T> = {
    items: T[];
    total: number;
};

const FILTER_KEY_RE = /^[_a-zA-Z][_a-zA-Z0-9]*(?:\[\])?(?:\.[_a-zA-Z][_a-zA-Z0-9]*(?:\[\])?)*$/;

function isScalarFilterValue(value: unknown) {
    return (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    );
}

function normalizePositiveInteger(value: unknown, fallback: number, max?: number) {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    if (typeof max === 'number' && parsed > max) {
        return max;
    }
    return parsed;
}

function validateFieldPath(field: string, label: string) {
    if (!FILTER_KEY_RE.test(field)) {
        throw new Error(`Invalid ${label}: ${field}`);
    }
}

function buildListConditions(filterObj: Record<string, unknown>) {
    return Object.entries(filterObj)
        .filter(([, value]) => {
            if (Array.isArray(value)) {
                return value.length > 0;
            }
            return value !== '' && value !== null && value !== undefined;
        })
        .map(([key, value]) => (Array.isArray(value) ? `${key} in $${key}` : `${key} == $${key}`));
}

function validateFilterObject(filterObj: Record<string, unknown>) {
    for (const [key, value] of Object.entries(filterObj)) {
        validateFieldPath(key, 'filter field');

        if (Array.isArray(value)) {
            if (value.length === 0) {
                continue;
            }
            if (!value.every(isScalarFilterValue)) {
                throw new Error(`Invalid filter value for: ${key}`);
            }
            continue;
        }

        if (value !== '' && value !== null && value !== undefined && !isScalarFilterValue(value)) {
            throw new Error(`Invalid filter value for: ${key}`);
        }
    }
}

function cleanEnv(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.replace(/^['"]+|['"]+$/g, '');
}

function requireSanityEnv(name: 'NEXT_PUBLIC_SANITY_PROJECT_ID' | 'NEXT_PUBLIC_SANITY_DATASET') {
    const value = cleanEnv(process.env[name]);
    if (!value) {
        throw new Error(`Missing required env: ${name}`);
    }
    return value;
}

function getSanityConfig(): SanityConfig {
    const projectId = requireSanityEnv('NEXT_PUBLIC_SANITY_PROJECT_ID');
    const dataset = requireSanityEnv('NEXT_PUBLIC_SANITY_DATASET');
    const apiVersion = cleanEnv(process.env.SANITY_API_VERSION) || '2024-01-01';
    const token = cleanEnv(process.env.SANITY_API_TOKEN);

    if (!/^[a-z0-9-]+$/.test(projectId)) {
        throw new Error(
            `Invalid NEXT_PUBLIC_SANITY_PROJECT_ID: "${projectId}". Use lowercase letters, numbers, or dashes.`
        );
    }

    if (!/^[a-z0-9_]+$/.test(dataset)) {
        throw new Error(
            `Invalid NEXT_PUBLIC_SANITY_DATASET: "${dataset}". Use lowercase letters, numbers, or underscores.`
        );
    }

    return { projectId, dataset, apiVersion, token };
}

let cachedClient: ReturnType<typeof createClient> | null = null;
const NUMBERING_CONFIG = {
    resi: { prefixField: 'resiPrefix', counterField: 'resiCounter', periodField: 'resiPeriod', defaultPrefix: 'R-', docType: 'order', docField: 'masterResi' },
    do: { prefixField: 'doPrefix', counterField: 'doCounter', periodField: 'doPeriod', defaultPrefix: 'DO-', docType: 'deliveryOrder', docField: 'doNumber' },
    invoice: { prefixField: 'invoicePrefix', counterField: 'invoiceCounter', periodField: 'invoicePeriod', defaultPrefix: 'INV-', docType: 'invoice', docField: 'invoiceNumber' },
    nota: { prefixField: 'notaPrefix', counterField: 'notaCounter', periodField: 'notaPeriod', defaultPrefix: 'NOTA-', docType: 'freightNota', docField: 'notaNumber' },
    receipt: { prefixField: 'receiptPrefix', counterField: 'receiptCounter', periodField: 'receiptPeriod', defaultPrefix: 'RCV-', docType: 'customerReceipt', docField: 'receiptNumber' },
    borong: { prefixField: 'boronganPrefix', counterField: 'boronganCounter', periodField: 'boronganPeriod', defaultPrefix: 'BRG-', docType: 'driverBorongan', docField: 'boronganNumber' },
    bon: { prefixField: 'bonPrefix', counterField: 'bonCounter', periodField: 'bonPeriod', defaultPrefix: 'BON-', docType: 'driverVoucher', docField: 'bonNumber' },
    incident: { prefixField: 'incidentPrefix', counterField: 'incidentCounter', periodField: 'incidentPeriod', defaultPrefix: 'INC-', docType: 'incident', docField: 'incidentNumber' },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePrefix(prefix: unknown, fallback: string) {
    const value = typeof prefix === 'string' && prefix.trim() ? prefix.trim() : fallback;
    return value.endsWith('-') ? value : `${value}-`;
}

function numberFromUnknown(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Build client lazily so misconfigured env does not crash route-module import time.
export function getSanityClient() {
    if (cachedClient) return cachedClient;
    const config = getSanityConfig();
    cachedClient = createClient({
        ...config,
        useCdn: false, // always fresh data for admin panel
    });
    return cachedClient;
}

// ── Sanity _type mapping ──
// URL entity name -> Sanity document _type
export const SANITY_TYPE_MAP: Record<string, string> = {
    users: 'user',
    customers: 'customer',
    'customer-products': 'customerProduct',
    services: 'service',
    'expense-categories': 'expenseCategory',
    drivers: 'driver',
    orders: 'order',
    'order-items': 'orderItem',
    'delivery-orders': 'deliveryOrder',
    'delivery-order-items': 'deliveryOrderItem',
    'tracking-logs': 'trackingLog',
    invoices: 'invoice',
    'invoice-items': 'invoiceItem',
    payments: 'payment',
    'customer-receipts': 'customerReceipt',
    'invoice-adjustments': 'invoiceAdjustment',
    incomes: 'income',
    expenses: 'expense',
    vehicles: 'vehicle',
    maintenances: 'maintenance',
    'tire-events': 'tireEvent',
    incidents: 'incident',
    'incident-action-logs': 'incidentActionLog',
    'audit-logs': 'auditLog',
    'bank-accounts': 'bankAccount',
    'bank-transactions': 'bankTransaction',
    'driver-vouchers': 'driverVoucher',
    'driver-voucher-disbursements': 'driverVoucherDisbursement',
    'driver-voucher-items': 'driverVoucherItem',
    'freight-notas': 'freightNota',
    'freight-nota-items': 'freightNotaItem',
    'driver-borongans': 'driverBorongan',
    'driver-borogan-items': 'driverBoronganItem',
    'driver-borongan-items': 'driverBoronganItem',
    company: 'companyProfile',
};

// ── GROQ: Fetch all documents of a type ──
export async function sanityGetAll<T = Record<string, unknown>>(docType: string): Promise<T[]> {
    const query = `*[_type == $type] | order(_createdAt desc)`;
    return getSanityClient().fetch<T[]>(query, { type: docType });
}

// ── GROQ: Fetch single document by _id ──
export async function sanityGetById<T = Record<string, unknown>>(id: string): Promise<T | null> {
    const query = `*[_id == $id][0]`;
    return getSanityClient().fetch<T | null>(query, { id });
}

// ── GROQ: Fetch documents with filter ──
export async function sanityGetByFilter<T = Record<string, unknown>>(
    docType: string,
    filterObj: Record<string, unknown>
): Promise<T[]> {
    validateFilterObject(filterObj);

    // Build dynamic GROQ filter conditions
    const conditions = buildListConditions(filterObj);

    if (conditions.length === 0) {
        return sanityGetAll<T>(docType);
    }

    const filterStr = conditions.join(' && ');
    const query = `*[_type == $type && ${filterStr}] | order(_createdAt desc)`;
    const params = { type: docType, ...filterObj };
    return getSanityClient().fetch<T[]>(query, params);
}

export async function sanityList<T = Record<string, unknown>>(
    docType: string,
    options: SanityListOptions = {}
): Promise<SanityListResult<T>> {
    const filterObj = options.filterObj ?? {};
    const orFilters = options.orFilters ?? [];
    const definedFields = options.definedFields ?? [];
    validateFilterObject(filterObj);
    orFilters.forEach((orFilter, index) => {
        if (!Array.isArray(orFilter.fields) || orFilter.fields.length === 0) {
            throw new Error(`Invalid or filter fields at index ${index}`);
        }
        orFilter.fields.forEach(field => validateFieldPath(field, 'or filter field'));
        if (!isScalarFilterValue(orFilter.value)) {
            throw new Error(`Invalid or filter value at index ${index}`);
        }
    });
    definedFields.forEach(field => validateFieldPath(field, 'defined field'));

    const page = normalizePositiveInteger(options.page, 1);
    const pageSize = normalizePositiveInteger(options.pageSize, 10, 500);
    const offset = (page - 1) * pageSize;
    const end = offset + pageSize;
    const sortClause = options.sortClause?.trim();
    const sortField = options.sortField?.trim() || '_createdAt';
    const sortDir = options.sortDir === 'asc' ? 'asc' : 'desc';
    if (!sortClause) {
        validateFieldPath(sortField, 'sort field');
    }

    const searchFields = (options.searchFields ?? [])
        .map(field => field.trim())
        .filter(Boolean);
    searchFields.forEach(field => validateFieldPath(field, 'search field'));

    const conditions = buildListConditions(filterObj);
    const params: Record<string, unknown> = {
        type: docType,
        offset,
        end,
        ...filterObj,
    };
    if (definedFields.length > 0) {
        conditions.push(...definedFields.map(field => `defined(${field})`));
    }
    orFilters.forEach((orFilter, index) => {
        params[`orFilterValue${index}`] = orFilter.value;
    });

    if (orFilters.length > 0) {
        conditions.push(
            ...orFilters.map((orFilter, index) => `(${orFilter.fields.map(field => `${field} == $orFilterValue${index}`).join(' || ')})`)
        );
    }

    if (options.search && searchFields.length > 0) {
        params.search = `*${options.search.trim()}*`;
        conditions.push(`(${searchFields.map(field => `${field} match $search`).join(' || ')})`);
    }

    const whereClause = conditions.length > 0
        ? `_type == $type && ${conditions.join(' && ')}`
        : `_type == $type`;
    const orderClause = sortClause || `${sortField} ${sortDir}`;
    const query = `{
        "total": count(*[${whereClause}]),
        "items": *[${whereClause}] | order(${orderClause})[$offset...$end]
    }`;

    const result = await getSanityClient().fetch<SanityListResult<T>>(query, params);
    return {
        items: Array.isArray(result?.items) ? result.items : [],
        total: typeof result?.total === 'number' ? result.total : 0,
    };
}

// ── Mutation: Create document ──
export async function sanityCreate<T = Record<string, unknown>>(
    doc: { _type: string;[key: string]: unknown }
): Promise<T> {
    const result = await getSanityClient().create(doc);
    return result as T;
}

// ── Mutation: Update document (patch) ──
export async function sanityUpdate<T = Record<string, unknown>>(
    id: string,
    updates: Record<string, unknown>
): Promise<T> {
    const result = await getSanityClient().patch(id).set(updates).commit();
    return result as T;
}

// ── Mutation: Delete document ──
export async function sanityDelete(id: string): Promise<boolean> {
    await getSanityClient().delete(id);
    return true;
}

// ── Get Company Profile (singleton) ──
export async function sanityGetCompanyProfile() {
    const query = `*[_type == "companyProfile"][0]`;
    return getSanityClient().fetch(query);
}

// ── Generate next number (sequential numbering) ──
export async function sanityGetNextNumber(prefix: string): Promise<string> {
    const config = NUMBERING_CONFIG[prefix as keyof typeof NUMBERING_CONFIG];
    if (!config) return `${prefix}-${Date.now()}`;

    const now = new Date();
    const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const company = await sanityGetCompanyProfile() as {
            _id?: string;
            _rev?: string;
            numberingSettings?: Record<string, unknown>;
        } | null;

        if (!company?._id || !company._rev) {
            break;
        }

        const settings = isRecord(company.numberingSettings) ? company.numberingSettings : {};
        const normalizedPrefix = normalizePrefix(settings[config.prefixField], config.defaultPrefix);
        const currentPeriod =
            typeof settings[config.periodField] === 'string' ? settings[config.periodField] : '';
        const currentCounter = currentPeriod === period ? numberFromUnknown(settings[config.counterField]) : 0;
        const existingCount = await getSanityClient().fetch<number>(
            `count(*[_type == $type && ${config.docField} match $pattern])`,
            {
                type: config.docType,
                pattern: `${normalizedPrefix}${period}-*`,
            }
        );
        const nextCounter = Math.max(currentCounter, existingCount || 0) + 1;
        const nextNumber = `${normalizedPrefix}${period}-${String(nextCounter).padStart(4, '0')}`;

        try {
            await getSanityClient()
                .patch(company._id)
                .ifRevisionId(company._rev)
                .set({
                    numberingSettings: {
                        ...settings,
                        [config.prefixField]: normalizedPrefix,
                        [config.counterField]: nextCounter,
                        [config.periodField]: period,
                    },
                })
                .commit();
            return nextNumber;
        } catch (error) {
            if (attempt === 4) {
                throw error;
            }
        }
    }

    return `${normalizePrefix(undefined, config.defaultPrefix)}${period}-${String(Date.now()).slice(-4)}`;
}
