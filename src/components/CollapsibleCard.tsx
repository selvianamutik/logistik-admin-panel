import type { ReactNode } from 'react';

type CollapsibleCardProps = {
    title: string;
    subtitle?: string;
    defaultOpen?: boolean;
    children: ReactNode;
};

export default function CollapsibleCard({ title, subtitle, defaultOpen = false, children }: CollapsibleCardProps) {
    return (
        <details className="collapsible-card" open={defaultOpen}>
            <summary className="collapsible-card-summary">
                <div>
                    <div className="collapsible-card-title">{title}</div>
                    {subtitle && <div className="collapsible-card-subtitle">{subtitle}</div>}
                </div>
            </summary>
            <div className="collapsible-card-body">
                {children}
            </div>
        </details>
    );
}
