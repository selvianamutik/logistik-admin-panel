import { loadScriptEnv, requireAnyEnv } from './_env';
import { isMissingSupabaseTableError, RELATIONAL_RESET_TABLES } from './_supabase-relational';

loadScriptEnv();

const supabaseUrl = requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
const serviceRoleKey = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE']);
const PRESERVED_RESEED_TABLES = new Set(['trip_route_rates']);
const REMOVED_DEMO_TRIP_RATE_IDS = Array.from({ length: 9 }, (_, index) => `trip-rate-00${index + 1}`);

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

async function reset() {
    for (const table of RELATIONAL_RESET_TABLES) {
        if (PRESERVED_RESEED_TABLES.has(table)) {
            console.log(`Preserving Supabase table during reseed: ${table}`);
            continue;
        }
        console.log(`Resetting Supabase table: ${table}`);
        try {
            await supabaseRequest(`${table}?source_document_id=not.is.null`, {
                method: 'DELETE',
            });
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
    console.log('Cleaning removed demo trip route rates only.');
    try {
        await supabaseRequest(`trip_route_rates?source_document_id=in.(${REMOVED_DEMO_TRIP_RATE_IDS.join(',')})`, {
            method: 'DELETE',
        });
    } catch (error) {
        if (isMissingSupabaseTableError(error)) {
            console.warn('Skipping cleanup for trip_route_rates: table not found');
        } else {
            throw error;
        }
    }
    console.log('Reset selesai.');
}

reset().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
