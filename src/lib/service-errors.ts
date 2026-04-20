type ServiceErrorInfo = {
    status: number;
    message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseServiceErrorPayload(error: unknown) {
    if (!isRecord(error)) {
        return {
            code: undefined as string | undefined,
            details: undefined as string | undefined,
            hint: undefined as string | undefined,
            statusCode: undefined as number | undefined,
            message: error instanceof Error ? error.message : undefined,
        };
    }

    return {
        code: typeof error.code === 'string' ? error.code : undefined,
        details: typeof error.details === 'string' ? error.details : undefined,
        hint: typeof error.hint === 'string' ? error.hint : undefined,
        statusCode: typeof error.statusCode === 'number'
            ? error.statusCode
            : typeof error.status === 'number'
                ? error.status
                : undefined,
        message: typeof error.message === 'string'
            ? error.message
            : error instanceof Error
                ? error.message
                : undefined,
    };
}

export function getDataServiceErrorInfo(
    error: unknown,
    fallbackMessage = 'Layanan data sedang tidak tersedia. Coba lagi beberapa saat.'
): ServiceErrorInfo | null {
    const parsed = parseServiceErrorPayload(error);
    const message = [parsed.message, parsed.details, parsed.hint].filter(Boolean).join(' ');

    if (
        parsed.statusCode === 429 ||
        (typeof parsed.statusCode === 'number' && parsed.statusCode >= 500) ||
        /fetch failed/i.test(message) ||
        /schema cache/i.test(message)
    ) {
        return {
            status: 503,
            message: fallbackMessage,
        };
    }

    return null;
}
