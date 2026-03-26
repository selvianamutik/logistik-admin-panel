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
        const res = await fetch(`${resolvedUrl.pathname}${resolvedUrl.search}`);
        const payload = await res.json();
        if (!res.ok) {
            throw new Error(payload.error || fallbackMessage);
        }

        const nextItems = (payload.data || []) as T[];
        total = payload.meta?.total || nextItems.length;
        allItems.push(...nextItems);
        if (nextItems.length === 0) break;
        currentPage += 1;
    } while (allItems.length < total);

    return allItems;
}
