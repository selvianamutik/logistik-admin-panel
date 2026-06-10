const DEFAULT_REFERENCE_PAGE_SIZE = 500;
const ADMIN_FETCH_TIMEOUT_MS = 20000;
const inFlightAdminRequests = new Map<string, Promise<unknown>>();

type OptionalAdminFetchOptions = {
    onError?: (message: string) => void;
    silentAccessDenied?: boolean;
};

function isAccessDeniedMessage(message: string) {
    return /forbidden|tidak punya|akses|permission|unauthorized/i.test(message);
}

export function withAdminCollectionPageSize(url: string, pageSize: number = DEFAULT_REFERENCE_PAGE_SIZE): string {
    const resolvedUrl = new URL(url, 'http://localhost');
    if (!resolvedUrl.searchParams.has('page')) {
        resolvedUrl.searchParams.set('page', '1');
    }
    if (!resolvedUrl.searchParams.has('pageSize')) {
        resolvedUrl.searchParams.set('pageSize', String(pageSize));
    }
    return `${resolvedUrl.pathname}${resolvedUrl.search}`;
}

export async function fetchAdminData<T>(url: string, fallbackMessage: string): Promise<T> {
    const payload = await fetchAdminPayload<{ data: T }>(url, fallbackMessage);
    return payload.data as T;
}

export async function fetchAdminListPayload<T>(
    url: string,
    fallbackMessage: string
): Promise<{ data?: T[]; meta?: { total?: number } }> {
    return fetchAdminPayload<{ data?: T[]; meta?: { total?: number } }>(url, fallbackMessage);
}

/**
 * Fetch a single page of admin collection data (no auto-pagination).
 * Use this for pages that handle pagination on the client side.
 */
export async function fetchAdminPageData<T>(
    url: string,
    fallbackMessage: string,
    page: number = 1,
    pageSize: number = DEFAULT_REFERENCE_PAGE_SIZE
): Promise<{ data?: T[]; meta?: { total?: number } }> {
    const resolvedUrl = new URL(url, 'http://localhost');
    resolvedUrl.searchParams.set('page', String(page));
    resolvedUrl.searchParams.set('pageSize', String(pageSize));
    return fetchAdminListPayload<T>(`${resolvedUrl.pathname}${resolvedUrl.search}`, fallbackMessage);
}

export async function fetchAdminCollectionData<T>(
    url: string,
    fallbackMessage: string,
    pageSize: number = DEFAULT_REFERENCE_PAGE_SIZE
): Promise<T> {
    return (await fetchAllAdminCollectionData<unknown>(url, fallbackMessage, pageSize)) as T;
}

export async function fetchAllAdminCollectionData<T>(
    url: string,
    fallbackMessage: string,
    pageSize: number = DEFAULT_REFERENCE_PAGE_SIZE
): Promise<T[]> {
    const resolvedUrl = new URL(withAdminCollectionPageSize(url, pageSize), 'http://localhost');
    const allItems: T[] = [];
    let currentPage = Number(resolvedUrl.searchParams.get('page') || '1');
    let total = 0;

    do {
        resolvedUrl.searchParams.set('page', String(currentPage));
        const payload = await fetchAdminPayload<{ data?: T[]; meta?: { total?: number } }>(
            `${resolvedUrl.pathname}${resolvedUrl.search}`,
            fallbackMessage
        );

        const nextItems = (payload.data || []) as T[];
        total = payload.meta?.total || nextItems.length;
        allItems.push(...nextItems);
        if (nextItems.length === 0) break;
        currentPage += 1;
    } while (allItems.length < total);

    return allItems;
}

export async function fetchOptionalAdminData<T>(
    url: string,
    fallbackMessage: string,
    options: OptionalAdminFetchOptions = {}
): Promise<T | null> {
    try {
        return await fetchAdminData<T>(url, fallbackMessage);
    } catch (error) {
        const message = getErrorMessage(error, fallbackMessage);
        if (!(options.silentAccessDenied && isAccessDeniedMessage(message))) {
            options.onError?.(message);
        }
        return null;
    }
}

export async function fetchOptionalAdminCollectionData<T>(
    url: string,
    fallbackMessage: string,
    pageSize: number = DEFAULT_REFERENCE_PAGE_SIZE,
    options: OptionalAdminFetchOptions = {}
): Promise<T[]> {
    try {
        return await fetchAllAdminCollectionData<T>(url, fallbackMessage, pageSize);
    } catch (error) {
        const message = getErrorMessage(error, fallbackMessage);
        if (!(options.silentAccessDenied && isAccessDeniedMessage(message))) {
            options.onError?.(message);
        }
        return [];
    }
}

async function fetchAdminPayload<T>(url: string, fallbackMessage: string): Promise<T> {
    const existing = inFlightAdminRequests.get(url);
    if (existing) {
        return existing as Promise<T>;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ADMIN_FETCH_TIMEOUT_MS);
    const request = fetch(url, {
        cache: 'no-store',
        signal: controller.signal,
    })
        .then(async response => {
            const payload = await readJsonPayload(response);
            if (!response.ok) {
                throw new Error(getPayloadError(payload) || fallbackMessage);
            }
            return payload as T;
        })
        .catch(error => {
            if (error instanceof Error && /abort/i.test(error.name)) {
                throw new Error(`${fallbackMessage}: request timeout`);
            }
            throw error;
        })
        .finally(() => {
            clearTimeout(timeout);
            if (inFlightAdminRequests.get(url) === request) {
                inFlightAdminRequests.delete(url);
            }
        });

    inFlightAdminRequests.set(url, request);
    return request;
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
    return error instanceof Error && error.message.trim()
        ? error.message
        : fallbackMessage;
}

async function readJsonPayload(response: Response): Promise<unknown> {
    const rawText = await response.text();
    if (!rawText) {
        return {};
    }

    try {
        return JSON.parse(rawText);
    } catch {
        return { error: rawText };
    }
}

function getPayloadError(payload: unknown) {
    if (payload && typeof payload === 'object' && 'error' in payload) {
        const error = (payload as { error?: unknown }).error;
        return typeof error === 'string' && error.trim() ? error : null;
    }
    return null;
}
