import fs from 'node:fs';
import path from 'node:path';

function parseEnvLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    const separator = trimmed.indexOf('=');
    if (separator < 0) return null;

    const key = trimmed.slice(0, separator).trim();
    if (!key) return null;

    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^['"]+|['"]+$/g, '');
    return { key, value };
}

export function loadScriptEnv(baseDir = process.cwd()) {
    const envFiles = ['.env.production', '.env.local'];

    for (const file of envFiles) {
        const fullPath = path.join(baseDir, file);
        if (!fs.existsSync(fullPath)) continue;

        const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
        for (const line of lines) {
            const parsed = parseEnvLine(line);
            if (!parsed) continue;
            process.env[parsed.key] = parsed.value;
        }
    }
}

export function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
