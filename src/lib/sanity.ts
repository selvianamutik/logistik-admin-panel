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

function cleanEnv(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.replace(/^['"]+|['"]+$/g, '');
}

function getSanityConfig(): SanityConfig {
    const projectId = cleanEnv(process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) || 'p6do50hl';
    const dataset = cleanEnv(process.env.NEXT_PUBLIC_SANITY_DATASET) || 'production';
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
    'driver-voucher-items': 'driverVoucherItem',
    'freight-notas': 'freightNota',
    'freight-nota-items': 'freightNotaItem',
    'driver-borongans': 'driverBorongan',
    'driver-borogan-items': 'driverBoronganItem',
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
    // Build dynamic GROQ filter conditions
    const conditions = Object.entries(filterObj)
        .filter(([, value]) => {
            if (Array.isArray(value)) {
                return value.length > 0;
            }
            return value !== '' && value !== null && value !== undefined;
        })
        .map(([key, value]) => (Array.isArray(value) ? `${key} in $${key}` : `${key} == $${key}`));

    if (conditions.length === 0) {
        return sanityGetAll<T>(docType);
    }

    const filterStr = conditions.join(' && ');
    const query = `*[_type == $type && ${filterStr}] | order(_createdAt desc)`;
    const params = { type: docType, ...filterObj };
    return getSanityClient().fetch<T[]>(query, params);
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
