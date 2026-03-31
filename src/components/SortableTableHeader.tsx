'use client';

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
            <span style={{ fontSize: '0.78em', color: direction ? 'var(--color-primary)' : 'var(--color-gray-400)' }}>
                {direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕'}
            </span>
        </button>
    );
}
