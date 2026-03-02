/* ============================================================
   LOGISTIK — Sanity Client
   Server-side Sanity client for GROQ queries and mutations
   ============================================================ */

import { createClient } from '@sanity/client';

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 'p6do50hl';
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production';
const token = process.env.SANITY_API_TOKEN || 'sky7V0P7lW7gtRk3CP3GHuYd18QmYN5BYgzPZyLF7AiH4AcDc9M19pSEvef7RAAGqVoewy7sZd5hozupK9WXcXSNb3a1tS76KAduc16IzBBOwT6kx9ErKJgVKSYdQhd3pDLJi5bUtFlyAfYVtXFwJ8oNlpa793MONpBKyscK2Z75tXfpCdQ4';
const apiVersion = process.env.SANITY_API_VERSION || '2024-01-01';

// Read-only client (for GROQ queries)
export const sanityClient = createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: false, // always fresh data for admin panel
    token,
});

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
    company: 'companyProfile',
};

// ── GROQ: Fetch all documents of a type ──
export async function sanityGetAll<T = Record<string, unknown>>(docType: string): Promise<T[]> {
    const query = `*[_type == $type] | order(_createdAt desc)`;
    return sanityClient.fetch<T[]>(query, { type: docType });
}

// ── GROQ: Fetch single document by _id ──
export async function sanityGetById<T = Record<string, unknown>>(id: string): Promise<T | null> {
    const query = `*[_id == $id][0]`;
    return sanityClient.fetch<T | null>(query, { id });
}

// ── GROQ: Fetch documents with filter ──
export async function sanityGetByFilter<T = Record<string, unknown>>(
    docType: string,
    filterObj: Record<string, unknown>
): Promise<T[]> {
    // Build dynamic GROQ filter conditions
    const conditions = Object.entries(filterObj)
        .filter(([, v]) => v !== '' && v !== null && v !== undefined)
        .map(([key]) => `${key} == $${key}`);

    if (conditions.length === 0) {
        return sanityGetAll<T>(docType);
    }

    const filterStr = conditions.join(' && ');
    const query = `*[_type == $type && ${filterStr}] | order(_createdAt desc)`;
    const params = { type: docType, ...filterObj };
    return sanityClient.fetch<T[]>(query, params);
}

// ── Mutation: Create document ──
export async function sanityCreate<T = Record<string, unknown>>(
    doc: { _type: string;[key: string]: unknown }
): Promise<T> {
    const result = await sanityClient.create(doc);
    return result as T;
}

// ── Mutation: Update document (patch) ──
export async function sanityUpdate<T = Record<string, unknown>>(
    id: string,
    updates: Record<string, unknown>
): Promise<T> {
    const result = await sanityClient.patch(id).set(updates).commit();
    return result as T;
}

// ── Mutation: Delete document ──
export async function sanityDelete(id: string): Promise<boolean> {
    await sanityClient.delete(id);
    return true;
}

// ── Get Company Profile (singleton) ──
export async function sanityGetCompanyProfile() {
    const query = `*[_type == "companyProfile"][0]`;
    return sanityClient.fetch(query);
}

// ── Generate next number (sequential numbering) ──
export async function sanityGetNextNumber(prefix: string): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const datePrefix = `${year}${month}`;

    const prefixMap: Record<string, { type: string; field: string; format: string }> = {
        resi: { type: 'order', field: 'masterResi', format: `R-20${datePrefix}-` },
        do: { type: 'deliveryOrder', field: 'doNumber', format: `DO-20${datePrefix}-` },
        invoice: { type: 'invoice', field: 'invoiceNumber', format: `INV-20${datePrefix}-` },
        incident: { type: 'incident', field: 'incidentNumber', format: `INC-20${datePrefix}-` },
    };

    const config = prefixMap[prefix];
    if (!config) return `${prefix}-${Date.now()}`;

    // Count existing docs with same prefix this month
    const query = `count(*[_type == $type && ${config.field} match $pattern])`;
    const count = await sanityClient.fetch<number>(query, {
        type: config.type,
        pattern: `${config.format}*`,
    });

    const nextNum = String((count || 0) + 1).padStart(4, '0');
    return `${config.format}${nextNum}`;
}
