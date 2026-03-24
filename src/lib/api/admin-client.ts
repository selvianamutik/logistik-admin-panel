export async function fetchAdminData<T>(url: string, fallbackMessage: string): Promise<T> {
    const res = await fetch(url);
    const payload = await res.json();
    if (!res.ok) {
        throw new Error(payload.error || fallbackMessage);
    }
    return payload.data as T;
}
