export const DEFAULT_PAGE_SIZE = 10;

export type PaginationSlice<T> = {
    items: T[];
    currentPage: number;
    totalPages: number;
    totalItems: number;
    startIndex: number;
    endIndex: number;
};

export function paginateItems<T>(
    items: T[],
    page: number,
    pageSize: number = DEFAULT_PAGE_SIZE
): PaginationSlice<T> {
    const totalItems = items.length;
    const safePageSize = Math.max(1, pageSize);
    const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
    const currentPage = Math.min(Math.max(1, page || 1), totalPages);
    const startIndex = totalItems === 0 ? 0 : (currentPage - 1) * safePageSize + 1;
    const endIndex = totalItems === 0 ? 0 : Math.min(currentPage * safePageSize, totalItems);

    return {
        items: items.slice(startIndex > 0 ? startIndex - 1 : 0, endIndex),
        currentPage,
        totalPages,
        totalItems,
        startIndex,
        endIndex,
    };
}
