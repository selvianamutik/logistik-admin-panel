import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadScriptEnv, requireAnyEnv } from './_env.mjs';
import { seedRelationalTables, summarizeUnsupportedSeedDocTypes } from './_supabase-relational.mjs';
import { deriveTripSuratJalanDocs } from './_trip-surat-jalan-seed-utils.mjs';

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

const supabaseUrl = requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
const serviceRoleKey = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE']);

function getArgValue(flag, fallback = '') {
    const match = process.argv.find(arg => arg.startsWith(`${flag}=`));
    return match ? match.slice(flag.length + 1) : fallback;
}

function hasFlag(flag) {
    return process.argv.includes(flag);
}

function getCsvArgValues(flag) {
    const value = getArgValue(flag, '');
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

async function supabaseRequest(pathname, init = {}) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
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

function logSkippedTypes(seedDocuments) {
    const skipped = summarizeUnsupportedSeedDocTypes(seedDocuments);
    if (skipped.length === 0) return;

    console.warn('Skipping non-relational seed document types:');
    for (const entry of skipped) {
        console.warn(`  - ${entry.type}: ${entry.count}`);
    }
}

async function main() {
    const seedFile = getArgValue('--input', path.join('artifacts', 'default-supabase-seed.json'));
    const raw = await readFile(path.resolve(process.cwd(), seedFile), 'utf8');
    const parsedSeedDocuments = JSON.parse(raw);

    if (!Array.isArray(parsedSeedDocuments)) {
        throw new Error('Seed input must be a JSON array.');
    }

    const skipWorkflowTransactions = hasFlag('--skip-workflow-transactions');
    const deriveTripSuratJalan = hasFlag('--derive-trip-surat-jalan') && !skipWorkflowTransactions;
    const seedDocuments = deriveTripSuratJalan
        ? (() => {
            const baseDocuments = parsedSeedDocuments.filter(doc =>
                doc &&
                typeof doc === 'object' &&
                !['trip', 'suratJalan', 'suratJalanItem'].includes(doc._type)
            );
            const { tripDocs, suratJalanDocs, suratJalanItemDocs } = deriveTripSuratJalanDocs(baseDocuments);
            console.log('Deriving Trip / Surat Jalan seed docs in-memory...');
            console.log(`  - trips: ${tripDocs.length}`);
            console.log(`  - surat jalan: ${suratJalanDocs.length}`);
            console.log(`  - surat jalan items: ${suratJalanItemDocs.length}`);
            return [...baseDocuments, ...tripDocs, ...suratJalanDocs, ...suratJalanItemDocs];
        })()
        : parsedSeedDocuments;

    const skipDocTypes = new Set(getCsvArgValues('--skip-doc-types'));
    if (skipWorkflowTransactions) {
        WORKFLOW_TRANSACTION_DOC_TYPES.forEach(type => skipDocTypes.add(type));
    }
    const seedDocumentsToImport = skipDocTypes.size > 0
        ? seedDocuments.filter(doc => !skipDocTypes.has(doc?._type))
        : seedDocuments;

    if (skipDocTypes.size > 0) {
        console.log(`Skipping seed document types: ${Array.from(skipDocTypes).sort().join(', ')}`);
    }

    logSkippedTypes(seedDocumentsToImport);
    console.log(`Seeding relational tables from ${seedFile}${deriveTripSuratJalan ? ' with direct Trip / Surat Jalan derivation' : ''}...`);
    await seedRelationalTables(supabaseRequest, seedDocumentsToImport);
    console.log('Seed selesai.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
