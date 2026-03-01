import { createClient } from '@sanity/client';

// Test with 'l' (lowercase L) at the end
const client = createClient({
    projectId: 'p6do50hl',
    dataset: 'production',
    apiVersion: '2024-01-01',
    token: 'skJtNtmXpKUQtDZmYTPwCdlk4t6l3OCXQNWfZzLLyJUcxhtdWNbcE7sZP5xlA8KG8TiQsFZSp3qG2B2sXARgjtLMWu7grNc1p9uEnHOgmZ8tDQK6JyzRW0LhBi3OYJbfGTslrCp6LOR28kLWAZgmC3Rli5AgFlnPcVnkVM7sJLvKgaHACB8F',
    useCdn: false,
});

async function test() {
    console.log('Testing with project ID: p6do50hl (lowercase L)');
    try {
        const result = await client.fetch('*[0..1]');
        console.log('SUCCESS! Found:', result?.length, 'docs');
        console.log(JSON.stringify(result, null, 2));
    } catch (err: unknown) {
        const statusCode = typeof err === 'object' && err !== null && 'statusCode' in err ? (err as { statusCode?: number }).statusCode : undefined;
        const message = err instanceof Error ? err.message : String(err);
        console.log('FAILED:', statusCode, message);
    }

    // Also test with digit 1
    console.log('\nTesting with project ID: p6do50h1 (digit 1)');
    const client2 = createClient({
        projectId: 'p6do50h1',
        dataset: 'production',
        apiVersion: '2024-01-01',
        token: 'skJtNtmXpKUQtDZmYTPwCdlk4t6l3OCXQNWfZzLLyJUcxhtdWNbcE7sZP5xlA8KG8TiQsFZSp3qG2B2sXARgjtLMWu7grNc1p9uEnHOgmZ8tDQK6JyzRW0LhBi3OYJbfGTslrCp6LOR28kLWAZgmC3Rli5AgFlnPcVnkVM7sJLvKgaHACB8F',
        useCdn: false,
    });
    try {
        const result = await client2.fetch('*[0..1]');
        console.log('SUCCESS! Found:', result?.length, 'docs');
        console.log(JSON.stringify(result, null, 2));
    } catch (err: unknown) {
        const statusCode = typeof err === 'object' && err !== null && 'statusCode' in err ? (err as { statusCode?: number }).statusCode : undefined;
        const message = err instanceof Error ? err.message : String(err);
        console.log('FAILED:', statusCode, message);
    }
}

test();
