import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'Portal Driver - Gading Mas Surya',
    description: 'Portal driver untuk update pengiriman, lokasi live, dan status trip.',
};

export default function DriverLayout({ children }: { children: ReactNode }) {
    return children;
}
