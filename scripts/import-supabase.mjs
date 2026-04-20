import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { seedRelationalTables, summarizeUnsupportedSeedDocTypes } from './_supabase-relational.mjs';

const inputFile = process.argv[2];

if (!inputFile) {
    throw new Error('Usage: node scripts/import-supabase.mjs <path-to-export.json>');
}

const supabaseUrl = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
const serviceRoleKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase import env. Expected NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

const raw = await readFile(path.resolve(process.cwd(), inputFile), 'utf8');
const documents = JSON.parse(raw);

if (!Array.isArray(documents)) {
    throw new Error('Import file must contain a JSON array.');
}

for (const doc of documents) {
    if (!doc || typeof doc !== 'object') {
        throw new Error('Found invalid document payload in import file.');
    }
    if (typeof doc._id !== 'string' || !doc._id.trim()) {
        doc._id = randomUUID();
    }
}

const skipped = summarizeUnsupportedSeedDocTypes(documents);
if (skipped.length > 0) {
    console.warn('Skipping non-relational import document types:');
    for (const entry of skipped) {
        console.warn(`  - ${entry.type}: ${entry.count}`);
    }
}

await seedRelationalTables(supabaseRequest, documents);
console.log(`Imported ${documents.length} documents into relational Supabase tables`);

function cleanEnv(value) {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.replace(/^['"]+|['"]+$/g, '');
}

async function supabaseRequest(path, init = {}) {
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
