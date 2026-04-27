import fs from 'node:fs/promises';
import path from 'node:path';
import { deriveTripSuratJalanDocs } from './_trip-surat-jalan-seed-utils.mjs';

async function main() {
    const inputArg = process.argv.find(arg => arg.startsWith('--input=')) || '';
    const outputArg = process.argv.find(arg => arg.startsWith('--output=')) || '';
    const modeArg = process.argv.find(arg => arg.startsWith('--mode=')) || '';

    const inputPath = inputArg ? inputArg.slice('--input='.length) : path.join('artifacts', 'default-supabase-seed.json');
    const outputPath = outputArg ? outputArg.slice('--output='.length) : path.join('artifacts', 'default-supabase-seed.trip-surat-jalan.json');
    const mode = modeArg ? modeArg.slice('--mode='.length) : 'append';

    const raw = await fs.readFile(path.resolve(process.cwd(), inputPath), 'utf8');
    const docs = JSON.parse(raw);
    if (!Array.isArray(docs)) {
        throw new Error('Seed input must be a JSON array.');
    }

    const nonLegacyDocs = docs.filter(doc => doc && doc._type !== 'deliveryOrder' && doc._type !== 'deliveryOrderItem');
    const {
        deliveryOrders,
        deliveryOrderItems,
        tripDocs,
        suratJalanDocs,
        suratJalanItemDocs,
    } = deriveTripSuratJalanDocs(docs);

    const outputDocs = mode === 'replace-legacy'
        ? [...nonLegacyDocs, ...tripDocs, ...suratJalanDocs, ...suratJalanItemDocs]
        : [...docs, ...tripDocs, ...suratJalanDocs, ...suratJalanItemDocs];

    await fs.writeFile(path.resolve(process.cwd(), outputPath), `${JSON.stringify(outputDocs, null, 2)}\n`, 'utf8');

    console.log('Seed conversion complete');
    console.log(`- Input: ${inputPath}`);
    console.log(`- Output: ${outputPath}`);
    console.log(`- Mode: ${mode}`);
    console.log(`- Delivery orders source: ${deliveryOrders.length}`);
    console.log(`- Delivery order items source: ${deliveryOrderItems.length}`);
    console.log(`- Generated trips: ${tripDocs.length}`);
    console.log(`- Generated surat jalan docs: ${suratJalanDocs.length}`);
    console.log(`- Generated surat jalan items: ${suratJalanItemDocs.length}`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
