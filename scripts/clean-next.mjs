import fs from 'node:fs/promises';
import path from 'node:path';

const NEXT_DIR = path.resolve('.next');
const RETRY_DELAY_MS = 250;
const MAX_ATTEMPTS = 12;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(target) {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

async function cleanNextDir() {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
            await fs.rm(NEXT_DIR, {
                recursive: true,
                force: true,
                maxRetries: 5,
                retryDelay: RETRY_DELAY_MS,
            });
        } catch (error) {
            if (attempt === MAX_ATTEMPTS) {
                throw error;
            }
        }

        if (!(await pathExists(NEXT_DIR))) {
            return;
        }

        if (attempt < MAX_ATTEMPTS) {
            await sleep(RETRY_DELAY_MS * attempt);
        }
    }

    throw new Error('Gagal membersihkan folder .next sebelum build');
}

await cleanNextDir();
