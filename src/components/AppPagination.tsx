'use client';

import type { ReactNode } from 'react';

type PaginationRenderMeta = {
    startIndex: number;
    endIndex: number;
    totalItems: number;
    currentPage: number;
    totalPages: number;
};

type AppPaginationProps = {
    page: number;
    pageSize: number;
    totalItems: number;
    onPageChange: (page: number) => void;
    info?: ReactNode | ((meta: PaginationRenderMeta) => ReactNode);
};

export default function AppPagination({
    page,
    pageSize,
    totalItems,
    onPageChange,
    info,
}: AppPaginationProps) {
    const totalPages = Math.max(1, Math.ceil(totalItems / Math.max(1, pageSize)));
    const currentPage = Math.min(Math.max(1, page || 1), totalPages);
    const startIndex = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const endIndex = totalItems === 0 ? 0 : Math.min(currentPage * pageSize, totalItems);
    const meta: PaginationRenderMeta = { startIndex, endIndex, totalItems, currentPage, totalPages };

    const pageNumbers = Array.from(
        new Set(
            [1, currentPage - 1, currentPage, currentPage + 1, totalPages]
                .filter(pageNumber => pageNumber >= 1 && pageNumber <= totalPages)
        )
    ).sort((left, right) => left - right);

    return (
        <div className="pagination">
            <div className="pagination-info">
                {typeof info === 'function'
                    ? info(meta)
                    : info ?? `Menampilkan ${startIndex}-${endIndex} dari ${totalItems} data`}
            </div>
            {totalPages > 1 && (
                <div className="pagination-controls">
                    <button
                        type="button"
                        className="pagination-btn"
                        disabled={currentPage <= 1}
                        onClick={() => onPageChange(currentPage - 1)}
                    >
                        ‹
                    </button>
                    {pageNumbers.map(pageNumber => (
                        <button
                            key={pageNumber}
                            type="button"
                            className={`pagination-btn${pageNumber === currentPage ? ' active' : ''}`}
                            onClick={() => onPageChange(pageNumber)}
                        >
                            {pageNumber}
                        </button>
                    ))}
                    <button
                        type="button"
                        className="pagination-btn"
                        disabled={currentPage >= totalPages}
                        onClick={() => onPageChange(currentPage + 1)}
                    >
                        ›
                    </button>
                </div>
            )}
        </div>
    );
}
