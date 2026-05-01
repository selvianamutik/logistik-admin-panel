import { loadScriptEnv, requireAnyEnv } from './_env.mjs';
import { isMissingSupabaseTableError, RELATIONAL_RESET_TABLES } from './_supabase-relational.mjs';

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

function hasFlag(flag) {
    return process.argv.includes(flag);
}

async function resetTable(table, resetAllRows) {
    if (!resetAllRows) {
        await supabaseRequest(`${table}?source_document_id=not.is.null`, {
            method: 'DELETE',
        });
        return;
    }

    await supabaseRequest(`${table}?source_document_id=not.is.null`, {
        method: 'DELETE',
    });
    await supabaseRequest(`${table}?source_document_id=is.null`, {
        method: 'DELETE',
    });
}

async function main() {
    const preserveTables = new Set();
    const resetAllRows = hasFlag('--all-managed-data');
    if (hasFlag('--preserve-users')) {
        preserveTables.add('app_users');
    }
    if (hasFlag('--preserve-trip-rates')) {
        preserveTables.add('services');
        preserveTables.add('trip_route_rates');
    }

    for (const table of RELATIONAL_RESET_TABLES) {
        if (preserveTables.has(table)) {
            console.log(`Preserving Supabase table: ${table}`);
            continue;
        }
        console.log(`Resetting Supabase table: ${table}${resetAllRows ? ' (all rows)' : ''}`);
        try {
            await resetTable(table, resetAllRows);
        } catch (error) {
            if (isMissingSupabaseTableError(error)) {
                console.warn(`Skipping reset for ${table}: table not found`);
                continue;
            }
            throw error;
        }
    }

    console.log('Resetting Supabase table: rate_limit_buckets');
    try {
        await supabaseRequest('rate_limit_buckets?id=not.is.null', {
            method: 'DELETE',
        });
    } catch (error) {
        if (isMissingSupabaseTableError(error)) {
            console.warn('Skipping reset for rate_limit_buckets: table not found');
        } else {
            throw error;
        }
    }

    console.log('Reset selesai.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
