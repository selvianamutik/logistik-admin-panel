import {
    getSupabaseClient,
} from '@/lib/supabase';
import { getBusinessDateValue, parseBusinessDateValue } from '@/lib/business-date';
import {
    relationalCountByPrefix,
    relationalDeleteDocument,
    relationalFindDocumentByIdAcrossTypes,
    relationalGetAll,
    relationalGetByFilter,
    relationalGetById,
    relationalList,
    relationalUpsertDocument,
    supportsRelationalDocType,
} from '@/lib/supabase-relational';

type CompanyProfileNumberingRow = {
    source_document_id: string;
    numbering_settings?: Record<string, unknown> | null;
    synced_at?: string | null;
};

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

function buildNumberingPeriod(key: keyof typeof NUMBERING_CONFIG, dateValue?: string) {
    const parts =
        (typeof dateValue === 'string' ? parseBusinessDateValue(dateValue) : null)
        || parseBusinessDateValue(getBusinessDateValue());

    if (!parts) {
        return key === 'do' ? '01012000' : '200001';
    }

    if (key === 'do') {
        return `${parts.day}${parts.month}${parts.year}`;
    }

    return `${parts.year}${parts.month}`;
}

async function getRelationalCompanyProfileRow() {
    const response = await getSupabaseClient().fetch('company_profiles?select=source_document_id,numbering_settings,synced_at&limit=1');
    const rows = await response.json() as CompanyProfileNumberingRow[];
    return rows[0] || null;
}

async function getRelationalNextNumber(prefix: string, dateValue?: string) {
    const config = NUMBERING_CONFIG[prefix as keyof typeof NUMBERING_CONFIG];
    if (!config) {
        return `${prefix}-${Date.now()}`;
    }

    const numberingKey = prefix as keyof typeof NUMBERING_CONFIG;
    const period = buildNumberingPeriod(numberingKey, dateValue);

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const company = await getRelationalCompanyProfileRow();
        if (!company?.source_document_id) {
            break;
        }

        const settings = isRecord(company.numbering_settings) ? company.numbering_settings : {};
        const normalizedPrefix = normalizePrefix(settings[config.prefixField], config.defaultPrefix);
        const currentPeriod =
            typeof settings[config.periodField] === 'string' ? settings[config.periodField] : '';
        const currentCounter = currentPeriod === period ? numberFromUnknown(settings[config.counterField]) : 0;

        const existingCount =
            await relationalCountByPrefix(config.docType, config.docField, `${normalizedPrefix}${period}-`)
            ?? 0;

        const nextCounter = Math.max(currentCounter, existingCount) + 1;
        const nextNumber = `${normalizedPrefix}${period}-${String(nextCounter).padStart(4, '0')}`;
        const nextSyncedAt = new Date().toISOString();

        const response = await getSupabaseClient().fetch(
            `company_profiles?source_document_id=eq.${encodeURIComponent(company.source_document_id)}&synced_at=eq.${encodeURIComponent(company.synced_at || '')}`,
            {
                method: 'PATCH',
                headers: {
                    Prefer: 'return=representation',
                },
                body: JSON.stringify({
                    numbering_settings: {
                        ...settings,
                        [config.prefixField]: normalizedPrefix,
                        [config.counterField]: nextCounter,
                        [config.periodField]: period,
                    },
                    synced_at: nextSyncedAt,
                }),
            }
        );
        const rows = await response.json() as CompanyProfileNumberingRow[];
        if (rows.length > 0) {
            return nextNumber;
        }
    }

    return `${normalizePrefix(undefined, config.defaultPrefix)}${period}-${String(Date.now()).slice(-4)}`;
}

export async function getDocumentById<T = Record<string, unknown>>(id: string, docType?: string) {
    if (docType && supportsRelationalDocType(docType)) {
        return relationalGetById<T>(docType, id);
    }

    const relationalDoc = await relationalFindDocumentByIdAcrossTypes<T>(id);
    if (relationalDoc) {
        return relationalDoc;
    }

    return null;
}

export async function listDocumentsByFilter<T = Record<string, unknown>>(
    docType: string,
    filterObj: Record<string, unknown>
) {
    if (supportsRelationalDocType(docType)) {
        return relationalGetByFilter<T>(docType, filterObj);
    }
    return [];
}

export async function getAllDocuments<T = Record<string, unknown>>(docType: string) {
    if (supportsRelationalDocType(docType)) {
        return relationalGetAll<T>(docType);
    }
    return [];
}

type DocumentListOptions = {
    filterObj?: Record<string, unknown>;
    orFilters?: Array<{ fields: string[]; value: string | number | boolean }>;
    definedFields?: string[];
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    sortPreset?: string | null;
};

export async function listDocuments<T = Record<string, unknown>>(
    docType: string,
    options: DocumentListOptions = {}
) {
    if (supportsRelationalDocType(docType)) {
        return relationalList<T>(docType, options);
    }
    return { items: [], total: 0 };
}

export async function createDocument<T = Record<string, unknown>>(
    doc: { _type: string; [key: string]: unknown }
) {
    if (supportsRelationalDocType(doc._type)) {
        const created = await relationalUpsertDocument<T>(doc);
        if (!created) {
            throw new Error(`Failed to create relational document for type: ${doc._type}`);
        }
        return created;
    }
    throw new Error(`Unsupported relational document type: ${doc._type}`);
}

export async function updateDocument<T = Record<string, unknown>>(
    id: string,
    updates: Record<string, unknown>,
    docType?: string
) {
    const existing = await getDocumentById<Record<string, unknown> & { _type?: string }>(id, docType);
    if (!existing?._type) {
        throw new Error(`Document not found: ${id}`);
    }

    if (supportsRelationalDocType(existing._type)) {
        const updated = await relationalUpsertDocument<T>({
            ...existing,
            ...updates,
            _id: id,
            _type: existing._type,
        });
        if (!updated) {
            throw new Error(`Failed to update relational document for type: ${existing._type}`);
        }
        return updated;
    }

    throw new Error(`Unsupported relational document type for update: ${existing._type}`);
}

export async function deleteDocument(id: string) {
    const existing = await getDocumentById<{ _type?: string }>(id);
    if (!existing?._type) {
        return true;
    }

    if (existing?._type && supportsRelationalDocType(existing._type)) {
        await relationalDeleteDocument(existing._type, id);
        return true;
    }

    return true;
}

export async function getCompanyProfile<T = Record<string, unknown>>() {
    const relationalCompany = await relationalGetAll<T>('companyProfile');
    return relationalCompany[0] || null;
}

export async function getNextNumber(prefix: string, dateValue?: string) {
    return getRelationalNextNumber(prefix, dateValue);
}
