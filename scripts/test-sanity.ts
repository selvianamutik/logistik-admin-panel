import { createClient } from '@sanity/client';
import { loadScriptEnv, requireEnv } from './_env';

loadScriptEnv();

const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production';
const apiVersion = process.env.SANITY_API_VERSION?.trim() || '2024-01-01';
const token = requireEnv('SANITY_API_TOKEN');

const client = createClient({
    projectId: requireEnv('NEXT_PUBLIC_SANITY_PROJECT_ID'),
    dataset,
    apiVersion,
    token,
    useCdn: false,
});

async function test() {
    console.log(`Testing with project ID: ${process.env.NEXT_PUBLIC_SANITY_PROJECT_ID}`);
    try {
        const result = await client.fetch('*[0..1]');
        console.log('SUCCESS! Found:', result?.length, 'docs');
        console.log(JSON.stringify(result, null, 2));
    } catch (err: unknown) {
        if (err instanceof Error) {
            console.log('FAILED:', err.message);
            return;
        }
        console.log('FAILED:', String(err));
    }
}

test();
