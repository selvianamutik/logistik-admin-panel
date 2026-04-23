import 'server-only';

type SupabaseConfig = {
    url: string;
    serviceRoleKey: string;
};

type SupabaseErrorPayload = {
    code?: string;
    details?: string;
    error?: string;
    hint?: string;
    message?: string;
};

const TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504]);
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;
const DEFAULT_FETCH_TIMEOUT_MS = 15000;

export class SupabaseServiceError extends Error {
    code?: string;
    details?: string;
    hint?: string;
    payload?: SupabaseErrorPayload;
    rawText?: string;
    status: number;
    statusCode: number;

    constructor(status: number, message: string, options: {
        code?: string;
        details?: string;
        hint?: string;
        payload?: SupabaseErrorPayload;
        rawText?: string;
    } = {}) {
        super(message);
        this.name = 'SupabaseServiceError';
        this.status = status;
        this.statusCode = status;
        this.code = options.code;
        this.details = options.details;
        this.hint = options.hint;
        this.payload = options.payload;
        this.rawText = options.rawText;
    }
}

export class SupabaseConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SupabaseConfigError';
    }
}

export function isSupabaseConfigError(error: unknown): error is SupabaseConfigError {
    return error instanceof SupabaseConfigError || (
        typeof error === 'object'
        && error !== null
        && 'name' in error
        && error.name === 'SupabaseConfigError'
    );
}

function cleanEnv(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.replace(/^['"]+|['"]+$/g, '');
}

function readEnv(names: string[]) {
    for (const name of names) {
        const value = cleanEnv(process.env[name]);
        if (value) {
            return value;
        }
    }
    return undefined;
}

function requireAnyEnv(names: string[]) {
    const value = readEnv(names);
    if (!value) {
        throw new SupabaseConfigError(`Missing required Supabase env. Expected one of: ${names.join(', ')}`);
    }
    return value;
}

function getSupabaseConfig(): SupabaseConfig {
    return {
        url: requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']),
        serviceRoleKey: requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE']),
    };
}

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getFetchTimeoutMs() {
    const rawValue = Number.parseInt(process.env.SUPABASE_FETCH_TIMEOUT_MS || '', 10);
    return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : DEFAULT_FETCH_TIMEOUT_MS;
}

function createTimeoutSignal(signal: AbortSignal | null | undefined) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getFetchTimeoutMs());
    let abortHandler: (() => void) | null = null;

    if (signal) {
        if (signal.aborted) {
            controller.abort();
        } else {
            abortHandler = () => controller.abort();
            signal.addEventListener('abort', abortHandler, { once: true });
        }
    }

    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timeout);
            if (signal && abortHandler) {
                signal.removeEventListener('abort', abortHandler);
            }
        },
    };
}

function isTransientSupabaseResponse(status: number, rawText: string) {
    return TRANSIENT_STATUS_CODES.has(status) || /bad gateway|temporarily unavailable|gateway timeout/i.test(rawText);
}

function isTransientFetchError(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    return /fetch failed|network|econnreset|etimedout|socket|terminated|aborted|abort/i.test(message);
}

function buildSupabaseServiceError(status: number, rawText: string) {
    let message = rawText || `Supabase request failed with status ${status}`;
    let payload: SupabaseErrorPayload | undefined;
    try {
        payload = JSON.parse(rawText) as SupabaseErrorPayload;
        message = payload.message || payload.error || payload.hint || message;
    } catch {
        // Keep the raw Supabase response when it is not JSON.
    }
    return new SupabaseServiceError(status, message, {
        code: payload?.code,
        details: payload?.details,
        hint: payload?.hint,
        payload,
        rawText,
    });
}

async function supabaseFetch(path: string, init: RequestInit = {}) {
    const config = getSupabaseConfig();
    const headers = new Headers(init.headers);
    headers.set('apikey', config.serviceRoleKey);
    headers.set('Authorization', `Bearer ${config.serviceRoleKey}`);
    headers.set('Content-Type', 'application/json');

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
        try {
            const timeout = createTimeoutSignal(init.signal);
            let response: Response;
            try {
                response = await fetch(`${config.url}/rest/v1/${path}`, {
                    ...init,
                    headers,
                    cache: 'no-store',
                    signal: timeout.signal,
                });
            } finally {
                timeout.cleanup();
            }

            if (response.ok) {
                return response;
            }

            const rawText = await response.text();
            const error = buildSupabaseServiceError(response.status, rawText);
            lastError = error;

            if (!isTransientSupabaseResponse(response.status, rawText) || attempt === MAX_FETCH_ATTEMPTS) {
                throw error;
            }
        } catch (error) {
            lastError = error;
            if (error instanceof SupabaseServiceError || !isTransientFetchError(error) || attempt === MAX_FETCH_ATTEMPTS) {
                throw error;
            }
        }

        await delay(RETRY_BASE_DELAY_MS * attempt);
    }

    throw lastError instanceof Error ? lastError : new Error('Supabase request failed');
}

export function getSupabaseClient() {
    return {
        fetch: supabaseFetch,
    };
}
