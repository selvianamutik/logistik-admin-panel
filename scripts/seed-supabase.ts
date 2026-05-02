import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadScriptEnv, requireAnyEnv } from './_env';
import { seedRelationalTables, summarizeUnsupportedSeedDocTypes } from './_supabase-relational';

loadScriptEnv();

const WORKFLOW_TRANSACTION_DOC_TYPES = [
    'order',
    'orderItem',
    'deliveryOrder',
    'deliveryOrderItem',
    'trip',
    'suratJalan',
    'suratJalanItem',
    'trackingLog',
    'driverVoucher',
    'driverVoucherDisbursement',
    'driverVoucherItem',
    'driverBorongan',
    'driverBoronganItem',
    'invoice',
    'invoiceItem',
    'freightNota',
    'freightNotaItem',
    'payment',
    'customerReceipt',
    'invoiceAdjustment',
    'customerOverpaymentRefund',
    'income',
    'maintenance',
    'incident',
    'incidentSettlementLine',
    'incidentActionLog',
];

type SeedDoc = {
    _id: string;
    _type: string;
    _createdAt?: string;
    _updatedAt?: string;
    [key: string]: unknown;
};

const supabaseUrl = requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
const serviceRoleKey = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE']);

async function supabaseRequest(path: string, init: RequestInit = {}) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        ...init,
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });

    if (!response.ok) {
        throw new Error(await response.text());
    }

    return response;
}

function getArgValue(flag: string, fallback = '') {
    const match = process.argv.find(arg => arg.startsWith(`${flag}=`));
    return match ? match.slice(flag.length + 1) : fallback;
}

function hasFlag(flag: string) {
    return process.argv.includes(flag);
}

function getCsvArgValues(flag: string) {
    const value = getArgValue(flag, '');
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function logSkippedTypes(seedDocuments: SeedDoc[]) {
    const skipped = summarizeUnsupportedSeedDocTypes(seedDocuments);
    if (skipped.length === 0) {
        return;
    }

    console.warn('Skipping non-relational seed document types:');
    for (const entry of skipped) {
        console.warn(`  - ${entry.type}: ${entry.count}`);
    }
}

async function seed() {
    const seedFile = path.join(process.cwd(), 'artifacts', 'default-supabase-seed.json');
    const raw = await readFile(seedFile, 'utf8');
    const seedDocuments = JSON.parse(raw) as SeedDoc[];
    const skipDocTypes = new Set(getCsvArgValues('--skip-doc-types'));
    if (hasFlag('--skip-workflow-transactions')) {
        WORKFLOW_TRANSACTION_DOC_TYPES.forEach(type => skipDocTypes.add(type));
    }
    const seedDocumentsToImport = skipDocTypes.size > 0
        ? seedDocuments.filter(doc => !skipDocTypes.has(doc?._type))
        : seedDocuments;

    if (skipDocTypes.size > 0) {
        console.log(`Skipping seed document types: ${Array.from(skipDocTypes).sort().join(', ')}`);
    }

    logSkippedTypes(seedDocumentsToImport);
    console.log('Seeding relational tables only...');
    await seedRelationalTables(supabaseRequest, seedDocumentsToImport);
    console.log('Seed selesai.');
}

seed().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
