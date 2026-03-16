/* ============================================================
   Gading Mas Surya - Sanity Seed Script
   Run: npm run seed:sanity
   ============================================================ */

import { createClient } from '@sanity/client';

import { loadScriptEnv, requireEnv } from './_env';

loadScriptEnv();

type SeedDoc = {
    _id: string;
    _type: string;
    [key: string]: unknown;
};

const client = createClient({
    projectId: requireEnv('NEXT_PUBLIC_SANITY_PROJECT_ID'),
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production',
    apiVersion: process.env.SANITY_API_VERSION?.trim() || '2024-01-01',
    token: requireEnv('SANITY_API_TOKEN'),
    useCdn: false,
});

const OWNER_PASSWORD_HASH = '$2b$10$gmQQXBYsr6av5en3FKDsRuW/ZiOXB6hOqzD2EXmGWICdq2EADL2YW';
const ADMIN_PASSWORD_HASH = '$2b$10$RTJAvsAXXjPgBPdE/rXYqeQM6mn7lJG7qK8u/wML.qZZ2Bg7SB4Be';

const documents: SeedDoc[] = [
    {
        _id: 'user-owner-001',
        _type: 'user',
        name: 'Owner Utama',
        email: 'owner@company.local',
        role: 'OWNER',
        passwordHash: OWNER_PASSWORD_HASH,
        active: true,
        createdAt: '2026-03-16T00:00:00Z',
    },
    {
        _id: 'user-admin-001',
        _type: 'user',
        name: 'Admin Operasional',
        email: 'admin@company.local',
        role: 'ADMIN',
        passwordHash: ADMIN_PASSWORD_HASH,
        active: true,
        createdAt: '2026-03-16T00:00:00Z',
    },
    {
        _id: 'company-001',
        _type: 'companyProfile',
        name: 'Gading Mas Surya',
        address: 'JL. KEMANTREN 08 - KEC. TULANGAN, KAB. SIDOARJO - JATIM - INDONESIA',
        phone: '(031) 8853000',
        email: 'gadingmassurya@gmail.com',
        themeColor: '#0f766e',
        numberingSettings: {
            resiPrefix: 'R',
            resiCounter: 0,
            doPrefix: 'DO',
            doCounter: 0,
            invoicePrefix: 'INV',
            invoiceCounter: 0,
            notaPrefix: 'NOTA',
            notaCounter: 0,
            notaSeriesCode: '1',
            boronganPrefix: 'BOR',
            boronganCounter: 0,
            bonPrefix: 'BON',
            bonCounter: 0,
            incidentPrefix: 'INC',
            incidentCounter: 0,
        },
        invoiceSettings: {
            defaultTermDays: 14,
            dueDateDays: 14,
            footerNote: 'Pembayaran hanya dilakukan ke rekening resmi perusahaan.',
            invoiceMode: 'ORDER',
        },
        documentSettings: {
            showContact: true,
            dateFormat: 'dd/MM/yyyy',
        },
    },
];

async function seed() {
    console.log(`Seeding Sanity dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
    const batchSize = 50;

    for (let index = 0; index < documents.length; index += batchSize) {
        const batch = documents.slice(index, index + batchSize);
        let transaction = client.transaction();

        for (const doc of batch) {
            transaction = transaction.createOrReplace(doc);
        }

        await transaction.commit();
        console.log(`  Upserted ${Math.min(index + batch.length, documents.length)}/${documents.length}`);
    }

    console.log('Seed selesai.');
}

seed().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
