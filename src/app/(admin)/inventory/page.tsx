'use client';

import Link from 'next/link';
import { ArrowRight, Package, Receipt, Truck } from 'lucide-react';

import { hasPageAccess } from '@/lib/rbac';

import { useApp } from '../layout';

type InventoryModuleCard = {
  href: string;
  title: string;
  description: string;
  icon: typeof Package;
};

const MODULES: InventoryModuleCard[] = [
  {
    href: '/suppliers',
    title: 'Supplier',
    description: 'Kelola pemasok aktif, termin default, dan data kontak pembelian.',
    icon: Truck,
  },
  {
    href: '/inventory/items',
    title: 'Barang Gudang',
    description: 'Pantau stok, stok minimum, supplier default, mutasi stok manual, dan master ban tertracking.',
    icon: Package,
  },
  {
    href: '/inventory/purchases',
    title: 'Pembelian',
    description: 'Buat pembelian supplier, terima barang, bayar supplier, dan cek outstanding.',
    icon: Receipt,
  },
];

export default function InventoryOverviewPage() {
  const { user } = useApp();
  const allowedModules = MODULES.filter((module) => {
    if (!user) return false;
    if (module.href === '/suppliers') return hasPageAccess(user.role, 'suppliers');
    if (module.href === '/inventory/items') return hasPageAccess(user.role, 'warehouseItems');
    if (module.href === '/inventory/purchases') return hasPageAccess(user.role, 'purchases');
    return false;
  });

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Inventory</h1>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-body">
          <div className="text-muted" style={{ maxWidth: 720, lineHeight: 1.7 }}>
            Pusat pembelian supplier dan stok gudang. Mulai dari master supplier, barang gudang,
            sampai pembelian yang terhubung ke penerimaan barang dan arus kas bank/kas.
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
        }}
      >
        {allowedModules.map((module) => {
          const Icon = module.icon;
          return (
            <Link
              key={module.href}
              href={module.href}
              className="card"
              style={{
                textDecoration: 'none',
                color: 'inherit',
                border: '1px solid var(--color-border)',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              }}
            >
              <div className="card-body" style={{ display: 'grid', gap: '0.9rem' }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--color-primary-50)',
                    color: 'var(--color-primary)',
                  }}
                >
                  <Icon size={22} />
                </div>
                <div>
                  <div className="font-semibold" style={{ fontSize: '1.05rem', marginBottom: '0.35rem' }}>
                    {module.title}
                  </div>
                  <div className="text-muted" style={{ lineHeight: 1.6 }}>
                    {module.description}
                  </div>
                </div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    color: 'var(--color-primary)',
                    fontWeight: 600,
                  }}
                >
                  Buka modul
                  <ArrowRight size={16} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
