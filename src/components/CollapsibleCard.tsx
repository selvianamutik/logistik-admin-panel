'use client';

import { useState, type ReactNode } from 'react';

type CollapsibleCardProps = {
    title: string;
    subtitle?: string;
    defaultOpen?: boolean;
    onOpenChange?: (isOpen: boolean) => void;
    children: ReactNode;
};

export default function CollapsibleCard({ title, subtitle, defaultOpen = false, onOpenChange, children }: CollapsibleCardProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    const handleToggle = () => {
        const nextOpen = !isOpen;
        setIsOpen(nextOpen);
        onOpenChange?.(nextOpen);
    };

    return (
        <section className={`collapsible-card${isOpen ? ' is-open' : ''}`}>
            <button
                type="button"
                className="collapsible-card-summary"
                aria-expanded={isOpen}
                onClick={handleToggle}
            >
                <div>
                    <div className="collapsible-card-title">{title}</div>
                    {subtitle && <div className="collapsible-card-subtitle">{subtitle}</div>}
                </div>
            </button>
            {isOpen && (
                <div className="collapsible-card-body">
                    {children}
                </div>
            )}
        </section>
    );
}
