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

    return (
        <button
            type="button"
            className={['btn-back', className].filter(Boolean).join(' ')}
            onClick={() => router.push(targetHref)}
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
