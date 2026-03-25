const DEFAULT_REFERENCE_PAGE_SIZE = 500;

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
    const res = await fetch(url);
    const payload = await res.json();
    if (!res.ok) {
        throw new Error(payload.error || fallbackMessage);
    }
    return payload.data as T;
}

export async function fetchAdminCollectionData<T>(
    url: string,
    fallbackMessage: string,
    pageSize: number = DEFAULT_REFERENCE_PAGE_SIZE
): Promise<T> {
    return fetchAdminData<T>(withAdminCollectionPageSize(url, pageSize), fallbackMessage);
}
