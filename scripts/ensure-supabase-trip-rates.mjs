import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadScriptEnv, requireAnyEnv } from './_env.mjs';
import { seedRelationalTables } from './_supabase-relational.mjs';

loadScriptEnv();

const supabaseUrl = requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
const serviceRoleKey = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE']);

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

async function countTripRouteRates() {
    const response = await supabaseRequest('trip_route_rates?select=source_document_id&limit=1', {
        headers: {
            Prefer: 'count=exact',
        },
    });
    const contentRange = response.headers.get('content-range') || '';
    const match = contentRange.match(/\/(\d+)$/);
    if (match) {
        return Number.parseInt(match[1], 10) || 0;
    }
    const rows = await response.json();
    return Array.isArray(rows) ? rows.length : 0;
}

async function main() {
    const existingCount = await countTripRouteRates();
    if (existingCount > 0) {
        console.log(`Trip route rates preserved: ${existingCount} rows. No seed overwrite.`);
        return;
    }

    const seedFile = path.resolve(process.cwd(), 'artifacts', 'default-supabase-seed.json');
    const docs = JSON.parse(await readFile(seedFile, 'utf8'));
    const serviceDocs = docs.filter(doc => doc && doc._type === 'service');
    const tripRateDocs = docs.filter(doc => doc && doc._type === 'tripRouteRate');
    if (tripRateDocs.length === 0) {
        throw new Error('Tidak ada dokumen tripRouteRate di artifacts/default-supabase-seed.json');
    }

    await seedRelationalTables(supabaseRequest, [...serviceDocs, ...tripRateDocs]);
    console.log(`Services/trip route rates restored from seed: ${serviceDocs.length}/${tripRateDocs.length} rows.`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
