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

function cleanEnv(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.replace(/^['"]+|['"]+$/g, '');
}

function requireEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY') {
    const value = cleanEnv(process.env[name]);
    if (!value) {
        throw new Error(`Missing required env: ${name}`);
    }
    return value;
}

function getSupabaseConfig(): SupabaseConfig {
    return {
        url: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
        serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    };
}

async function supabaseFetch(path: string, init: RequestInit = {}) {
    const config = getSupabaseConfig();
    const headers = new Headers(init.headers);
    headers.set('apikey', config.serviceRoleKey);
    headers.set('Authorization', `Bearer ${config.serviceRoleKey}`);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(`${config.url}/rest/v1/${path}`, {
        ...init,
        headers,
        cache: 'no-store',
    });

    if (!response.ok) {
        const rawText = await response.text();
        let message = rawText || `Supabase request failed with status ${response.status}`;
        let payload: SupabaseErrorPayload | undefined;
        try {
            payload = JSON.parse(rawText) as SupabaseErrorPayload;
            message = payload.message || payload.error || payload.hint || message;
        } catch {
            // Keep the raw Supabase response when it is not JSON.
        }
        throw new SupabaseServiceError(response.status, message, {
            code: payload?.code,
            details: payload?.details,
            hint: payload?.hint,
            payload,
            rawText,
        });
    }

    return response;
}

export function getSupabaseClient() {
    return {
        fetch: supabaseFetch,
    };
}
