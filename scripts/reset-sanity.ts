/* ============================================================
   LOGISTIK - Sanity Reset Script
   Run: npm run reset:sanity
   ============================================================ */

import { createClient } from '@sanity/client';

import { loadScriptEnv, requireEnv } from './_env';

loadScriptEnv();

const client = createClient({
    projectId: requireEnv('NEXT_PUBLIC_SANITY_PROJECT_ID'),
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production',
    apiVersion: process.env.SANITY_API_VERSION?.trim() || '2024-01-01',
    token: requireEnv('SANITY_API_TOKEN'),
    useCdn: false,
});

const RESET_TYPES = [
    'auditLog',
    'incidentActionLog',
    'incident',
    'trackingLog',
    'driverVoucherItem',
    'driverVoucher',
    'driverBoronganItem',
    'driverBorongan',
    'freightNotaItem',
    'freightNota',
    'invoiceItem',
    'invoice',
    'payment',
    'income',
    'expense',
    'maintenance',
    'tireEvent',
    'deliveryOrderItem',
    'deliveryOrder',
    'orderItem',
    'order',
    'bankTransaction',
    'bankAccount',
    'driver',
    'vehicle',
    'customer',
    'service',
    'expenseCategory',
    'companyProfile',
    'user',
];

async function fetchIds() {
    return client.fetch<Array<{ _id: string; _type: string }>>(
        `*[_type in $types]{ _id, _type }`,
        { types: RESET_TYPES }
    );
}

async function reset() {
    console.log(`Resetting Sanity dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
    const docs = await fetchIds();

    if (docs.length === 0) {
        console.log('Tidak ada dokumen yang perlu dihapus.');
        return;
    }

    console.log(`Found ${docs.length} documents.`);
    const batchSize = 50;

    for (let index = 0; index < docs.length; index += batchSize) {
        const batch = docs.slice(index, index + batchSize);
        let transaction = client.transaction();
        for (const doc of batch) {
            transaction = transaction.delete(doc._id);
        }
        await transaction.commit();
        console.log(`  Deleted ${Math.min(index + batch.length, docs.length)}/${docs.length}`);
    }

    console.log('Reset selesai.');
}

reset().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
