'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
    LayoutDashboard, Package, Truck, Users, Layers, FileText, Wallet, Tags,
    BarChart3, Car, Wrench, AlertTriangle, User, Lock, Building2, UserCog,
    ScrollText, ChevronLeft, Menu, LogOut, X, CheckCircle, XCircle, Info, AlertCircle, Landmark,
    UserCircle, Receipt
} from 'lucide-react';
import { getSidebarMenu } from '@/lib/rbac';
import type { SessionUser, ToastMessage, CompanyProfile } from '@/lib/types';

// ── Color helpers for theme generation ──
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l * 100];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h * 360, s * 100, l * 100];
}
function hslToHex(h: number, s: number, l: number): string {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
    const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// ── Icon map ──
const ICON_MAP: Record<string, React.ReactNode> = {
    LayoutDashboard: <LayoutDashboard size={20} />,
    Package: <Package size={20} />,
    Truck: <Truck size={20} />,
    Users: <Users size={20} />,
    Layers: <Layers size={20} />,
    FileText: <FileText size={20} />,
    Wallet: <Wallet size={20} />,
    Tags: <Tags size={20} />,
    BarChart3: <BarChart3 size={20} />,
    Car: <Car size={20} />,
    Wrench: <Wrench size={20} />,
    AlertTriangle: <AlertTriangle size={20} />,
    User: <User size={20} />,
    Lock: <Lock size={20} />,
    Building2: <Building2 size={20} />,
    UserCog: <UserCog size={20} />,
    ScrollText: <ScrollText size={20} />,
    Landmark: <Landmark size={20} />,
    UserCircle: <UserCircle size={20} />,
    Receipt: <Receipt size={20} />,
};

// ── Toast Context ──
interface ToastContextType {
    toasts: ToastMessage[];
    addToast: (type: ToastMessage['type'], message: string) => void;
    removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType>({
    toasts: [],
    addToast: () => { },
    removeToast: () => { },
});

export function useToast() {
    return useContext(ToastContext);
}

// ── App Context ──
interface AppContextType {
    user: SessionUser | null;
    setUser: (user: SessionUser | null) => void;
}

const AppContext = createContext<AppContextType>({
    user: null,
    setUser: () => { },
});

export function useApp() {
    return useContext(AppContext);
}

// ── Admin Layout ──
export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [user, setUser] = useState<SessionUser | null>(null);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [isMobile, setIsMobile] = useState(false);

    // Generate theme palette from a single hex color
    const applyTheme = useCallback((hex: string) => {
        if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return;
        const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        const hsl = rgbToHsl(r, g, b);
        const root = document.documentElement;
        root.style.setProperty('--color-primary', hex);
        root.style.setProperty('--color-primary-hover', hslToHex(hsl[0], hsl[1], Math.max(0, hsl[2] - 8)));
        root.style.setProperty('--color-primary-light', hslToHex(hsl[0], Math.min(100, hsl[1] + 20), 96));
        root.style.setProperty('--color-primary-50', hslToHex(hsl[0], Math.min(100, hsl[1] + 10), 93));
        root.style.setProperty('--color-primary-100', hslToHex(hsl[0], Math.min(100, hsl[1] + 5), 88));
        root.style.setProperty('--color-primary-200', hslToHex(hsl[0], hsl[1], 80));
        root.style.setProperty('--color-primary-600', hex);
        root.style.setProperty('--color-primary-700', hslToHex(hsl[0], hsl[1], Math.max(0, hsl[2] - 8)));
        root.style.setProperty('--color-primary-800', hslToHex(hsl[0], hsl[1], Math.max(0, hsl[2] - 16)));
        // Sidebar active colors from theme
        root.style.setProperty('--sidebar-active-bg', hex + '33');
        root.style.setProperty('--sidebar-active-text', hslToHex(hsl[0], Math.min(100, hsl[1] + 15), Math.min(85, hsl[2] + 30)));
    }, []);

    // Fetch session + company profile
    useEffect(() => {
        const loadAppContext = async () => {
            try {
                const [sessionRes, companyRes] = await Promise.all([
                    fetch('/api/auth/session'),
                    fetch('/api/data?entity=company').catch(() => null),
                ]);

                if (!sessionRes.ok) {
                    throw new Error('Sesi tidak valid');
                }

                const session = await sessionRes.json();
                const co = companyRes ? await companyRes.json() : { data: null };

                if (session.user) {
                    setUser(session.user);
                } else {
                    router.push('/login');
                }
                if (companyRes?.ok && co.data) {
                    setCompany(co.data);
                    if (co.data.themeColor) applyTheme(co.data.themeColor);
                    if (co.data.name) {
                        document.title = `Sistem Manajemen - ${co.data.name}`;
                    }
                }
            } catch {
                router.push('/login');
            } finally {
                setLoading(false);
            }
        };

        void loadAppContext();
        // Track mobile state using matchMedia (matches CSS @media breakpoint exactly)
        const mobileQuery = window.matchMedia('(max-width: 768px)');
        const checkMobile = (e: MediaQueryList | MediaQueryListEvent) => setIsMobile(e.matches);
        checkMobile(mobileQuery);
        mobileQuery.addEventListener('change', checkMobile);
        return () => mobileQuery.removeEventListener('change', checkMobile);
    }, [router, applyTheme]);

    const addToast = useCallback((type: ToastMessage['type'], message: string) => {
        const id = Math.random().toString(36).substring(7);
        setToasts(prev => [...prev, { id, type, message }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const handleLogout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/login');
        router.refresh();
    };

    if (loading || !user) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
                <div className="spinner" style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#4f46e5', borderRadius: '50%' }} />
            </div>
        );
    }

    const menuGroups = getSidebarMenu(user.role);
    const nonNavigableBreadcrumbs = new Set(['/fleet', '/settings']);

    // Breadcrumbs
    const pathParts = pathname.split('/').filter(Boolean);
    const breadcrumbs = pathParts.map((part, idx) => {
        const href = '/' + pathParts.slice(0, idx + 1).join('/');
        const labels: Record<string, string> = {
            dashboard: 'Dashboard', orders: 'Order', 'delivery-orders': 'Surat Jalan',
            invoices: 'Nota Ongkos', customers: 'Customer', services: 'Layanan',
            'expense-categories': 'Kategori Biaya', expenses: 'Pengeluaran',
            reports: 'Laporan', fleet: 'Armada', vehicles: 'Kendaraan',
            maintenance: 'Maintenance', incidents: 'Insiden', settings: 'Pengaturan',
            profile: 'Profil', password: 'Password', company: 'Perusahaan',
            users: 'User', 'audit-logs': 'Audit Log', new: 'Baru', edit: 'Edit',
            tires: 'Ban', 'bank-accounts': 'Rekening & Kas', borongan: 'Borongan Supir', 'driver-vouchers': 'Bon Supir',
        };
        return {
            label: labels[part] || part,
            href,
            isLast: idx === pathParts.length - 1,
            isNavigable: !nonNavigableBreadcrumbs.has(href),
        };
    });

    return (
        <AppContext.Provider value={{ user, setUser }}>
            <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
                <div className="admin-layout" suppressHydrationWarning>
                    {/* Sidebar Overlay (Mobile) */}
                    <div
                        className={`sidebar-overlay ${mobileOpen ? 'active' : ''}`}
                        onClick={() => setMobileOpen(false)}
                    />

                    {/* Sidebar */}
                    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
                        <div className="sidebar-logo">
                            {company?.logoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={company.logoUrl} alt="" className="sidebar-logo-img" />
                            ) : (
                                <div className="sidebar-logo-icon">{(company?.name || 'L').charAt(0)}</div>
                            )}
                            <div className="sidebar-logo-text-wrap">
                                <span className="sidebar-logo-text">{company?.name || 'LOGISTIK'}</span>
                                <span className="sidebar-logo-subtitle">Sistem Manajemen</span>
                            </div>
                        </div>

                        <nav className="sidebar-nav">
                            {menuGroups.map(group => (
                                <div key={group.label} className="sidebar-group">
                                    <div className="sidebar-group-label">{group.label}</div>
                                    {group.items.map(item => {
                                        const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
                                        return (
                                            <Link
                                                key={item.href}
                                                href={item.href}
                                                className={`sidebar-item ${isActive ? 'active' : ''}`}
                                                onClick={() => setMobileOpen(false)}
                                            >
                                                <span className="sidebar-item-icon">{ICON_MAP[item.icon]}</span>
                                                <span className="sidebar-item-label">{item.label}</span>
                                                {item.badge && item.badge > 0 && (
                                                    <span className="sidebar-item-badge">{item.badge}</span>
                                                )}
                                            </Link>
                                        );
                                    })}
                                </div>
                            ))}
                        </nav>

                        <div className="sidebar-footer">
                            <button className="sidebar-item" onClick={handleLogout} style={{ width: '100%' }}>
                                <span className="sidebar-item-icon"><LogOut size={20} /></span>
                                <span className="sidebar-item-label">Keluar</span>
                            </button>
                        </div>
                    </aside>

                    {/* Main Content */}
                    <div className={`admin-content ${sidebarCollapsed ? 'collapsed' : ''}`}>
                        {/* Topbar */}
                        <header className={`topbar ${sidebarCollapsed ? 'collapsed' : ''}`}>
                            <div className="topbar-left">
                                <button
                                    className="topbar-toggle"
                                    onClick={() => {
                                        // On mobile, toggle mobile menu
                                        if (isMobile) {
                                            setMobileOpen(!mobileOpen);
                                        } else {
                                            setSidebarCollapsed(!sidebarCollapsed);
                                        }
                                    }}
                                    aria-label="Toggle sidebar"
                                >
                                    {isMobile ? (mobileOpen ? <X size={20} /> : <Menu size={20} />) : (sidebarCollapsed ? <Menu size={20} /> : <ChevronLeft size={20} />)}
                                </button>

                                <nav className="breadcrumbs">
                                    {breadcrumbs.map((crumb, idx) => (
                                        <React.Fragment key={crumb.href}>
                                            {idx > 0 && <span className="breadcrumbs-separator">/</span>}
                                            {crumb.isLast || !crumb.isNavigable ? (
                                                <span className="breadcrumbs-current">{crumb.label}</span>
                                            ) : (
                                                <Link href={crumb.href}>{crumb.label}</Link>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </nav>
                            </div>

                            <div className="topbar-right">
                                <div className="topbar-user" onClick={handleLogout} title="Klik untuk keluar">
                                    <div className="topbar-avatar">
                                        {user.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="topbar-user-info">
                                        <div className="topbar-user-name">{user.name}</div>
                                        <div className="topbar-user-role">{user.role}</div>
                                    </div>
                                </div>
                            </div>
                        </header>

                        {/* Page Content */}
                        <main className="page-container">
                            {children}
                        </main>
                    </div>

                    {/* Toast Container */}
                    <div className="toast-container">
                        {toasts.map(toast => (
                            <div key={toast.id} className={`toast ${toast.type}`}>
                                <span className="toast-icon">
                                    {toast.type === 'success' && <CheckCircle size={20} />}
                                    {toast.type === 'error' && <XCircle size={20} />}
                                    {toast.type === 'info' && <Info size={20} />}
                                    {toast.type === 'warning' && <AlertCircle size={20} />}
                                </span>
                                <span className="toast-message">{toast.message}</span>
                                <button className="toast-close" onClick={() => removeToast(toast.id)}>
                                    <X size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            </ToastContext.Provider>
        </AppContext.Provider>
    );
}
