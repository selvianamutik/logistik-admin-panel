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

async function main() {
    for (const table of RELATIONAL_RESET_TABLES) {
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

    console.log('Reset selesai.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
