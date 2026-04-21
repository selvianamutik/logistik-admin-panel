'use client';

import { useState, type ReactNode } from 'react';

type CollapsibleCardProps = {
    title: string;
    subtitle?: string;
    defaultOpen?: boolean;
    children: ReactNode;
};

export default function CollapsibleCard({ title, subtitle, defaultOpen = false, children }: CollapsibleCardProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <section className={`collapsible-card${isOpen ? ' is-open' : ''}`}>
            <button
                type="button"
                className="collapsible-card-summary"
                aria-expanded={isOpen}
                onClick={() => setIsOpen(open => !open)}
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
