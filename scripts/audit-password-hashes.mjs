import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadScriptEnv, readAnyEnv } from './_env.mjs';

loadScriptEnv();

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

function getArgValue(flag, fallback = '') {
    const match = process.argv.find(arg => arg.startsWith(`${flag}=`));
    return match ? match.slice(flag.length + 1) : fallback;
}

function hasFlag(flag) {
    return process.argv.includes(flag);
}

async function readSeedUsers(seedFile) {
    const raw = await readFile(path.resolve(process.cwd(), seedFile), 'utf8');
    const docs = JSON.parse(raw);
    if (!Array.isArray(docs)) {
        throw new Error(`Seed file ${seedFile} must contain a JSON array.`);
    }
    return docs
        .filter(doc => doc && doc._type === 'user')
        .map(doc => ({
            id: doc._id,
            email: doc.email,
            passwordHash: doc.passwordHash,
            source: seedFile,
        }));
}

async function readSupabaseUsers() {
    const supabaseUrl = readAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
    const serviceRoleKey = readAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE']);
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Supabase env is required for --supabase. Expected SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/app_users?select=source_document_id,email,password_hash`, {
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
        },
    });
    if (!response.ok) {
        throw new Error(await response.text());
    }
    const rows = await response.json();
    return rows.map(row => ({
        id: row.source_document_id,
        email: row.email,
        passwordHash: row.password_hash,
        source: 'supabase:app_users',
    }));
}

function assertBcryptUsers(users) {
    const invalid = users.filter(user => typeof user.passwordHash !== 'string' || !BCRYPT_HASH_RE.test(user.passwordHash));
    if (invalid.length > 0) {
        console.error('Invalid user password hashes found:');
        for (const user of invalid) {
            console.error(`- ${user.source} ${user.id || '-'} ${user.email || '-'} (${typeof user.passwordHash})`);
        }
        process.exitCode = 1;
        return;
    }
    console.log(`Password hash audit OK: ${users.length} user rows use bcrypt hashes.`);
}

async function main() {
    const seedFile = getArgValue('--input', path.join('artifacts', 'default-supabase-seed.json'));
    const users = hasFlag('--supabase')
        ? await readSupabaseUsers()
        : await readSeedUsers(seedFile);
    assertBcryptUsers(users);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
