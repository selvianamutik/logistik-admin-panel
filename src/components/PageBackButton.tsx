'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

type PageBackButtonProps = {
    href: string;
    label?: string;
    className?: string;
};

export default function PageBackButton({ href, label = 'Kembali', className = '' }: PageBackButtonProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const returnTo = searchParams.get('returnTo');
    const targetHref =
        returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
            ? returnTo
            : href;
    const handleBack = () => {
        if (typeof window !== 'undefined') {
            const hasSameOriginReferrer =
                Boolean(document.referrer) &&
                (() => {
                    try {
                        return new URL(document.referrer).origin === window.location.origin;
                    } catch {
                        return false;
                    }
                })();
            if (hasSameOriginReferrer && window.history.length > 1 && targetHref === href) {
                router.back();
                return;
            }
        }
        router.push(targetHref);
    };

    return (
        <button
            type="button"
            className={['btn-back', className].filter(Boolean).join(' ')}
            onClick={handleBack}
            aria-label={label}
            title={label}
        >
            <span className="btn-back-icon">
                <ArrowLeft size={16} />
            </span>
            <span className="btn-back-label">{label}</span>
        </button>
    );
}
