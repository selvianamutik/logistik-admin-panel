'use client';

import { ArrowDown, ArrowDownUp, ArrowUp } from 'lucide-react';

export type SortDirection = 'asc' | 'desc';

type SortableTableHeaderProps = {
    label: string;
    direction: SortDirection | null;
    onToggle: () => void;
    align?: 'left' | 'center' | 'right';
};

export default function SortableTableHeader({
    label,
    direction,
    onToggle,
    align = 'left',
}: SortableTableHeaderProps) {
    const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowDownUp;

    return (
        <button
            type="button"
            onClick={onToggle}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                border: 'none',
                background: 'transparent',
                padding: 0,
                font: 'inherit',
                color: 'inherit',
                cursor: 'pointer',
                width: '100%',
                justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
            }}
            aria-label={`Urutkan ${label}`}
        >
            <span>{label}</span>
            <span
                aria-hidden="true"
                style={{
                    color: direction ? 'var(--color-primary)' : 'var(--color-gray-400)',
                    display: 'inline-flex',
                }}
            >
                <Icon size={13} strokeWidth={2.2} />
            </span>
        </button>
    );
}
