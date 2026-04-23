const DEFAULT_REFERENCE_PAGE_SIZE = 500;
const ADMIN_FETCH_TIMEOUT_MS = 20000;
const inFlightAdminRequests = new Map<string, Promise<unknown>>();

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
