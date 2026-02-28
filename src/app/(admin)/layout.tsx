'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
    LayoutDashboard, Package, Truck, Users, Layers, FileText, Wallet, Tags,
    BarChart3, Car, Wrench, AlertTriangle, User, Lock, Building2, UserCog,
    ScrollText, ChevronLeft, Menu, LogOut, X, CheckCircle, XCircle, Info, AlertCircle, Landmark
} from 'lucide-react';
import { getSidebarMenu } from '@/lib/rbac';
import type { SessionUser, ToastMessage } from '@/lib/types';

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
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [loading, setLoading] = useState(true);

    // Fetch session
    useEffect(() => {
        fetch('/api/auth/session')
            .then(res => res.json())
            .then(data => {
                if (data.user) {
                    setUser(data.user);
                } else {
                    router.push('/login');
                }
                setLoading(false);
            })
            .catch(() => {
                router.push('/login');
                setLoading(false);
            });
    }, [router]);

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

    // Breadcrumbs
    const pathParts = pathname.split('/').filter(Boolean);
    const breadcrumbs = pathParts.map((part, idx) => {
        const href = '/' + pathParts.slice(0, idx + 1).join('/');
        const labels: Record<string, string> = {
            dashboard: 'Dashboard', orders: 'Order', 'delivery-orders': 'Surat Jalan',
            invoices: 'Invoice', customers: 'Customer', services: 'Layanan',
            'expense-categories': 'Kategori Biaya', expenses: 'Pengeluaran',
            reports: 'Laporan', fleet: 'Armada', vehicles: 'Kendaraan',
            maintenance: 'Maintenance', incidents: 'Insiden', settings: 'Pengaturan',
            profile: 'Profil', password: 'Password', company: 'Perusahaan',
            users: 'User', 'audit-logs': 'Audit Log', new: 'Baru', edit: 'Edit',
            tires: 'Ban',
        };
        return { label: labels[part] || part, href, isLast: idx === pathParts.length - 1 };
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
                            <div className="sidebar-logo-icon">L</div>
                            <span className="sidebar-logo-text">LOGISTIK</span>
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
                                        if (window.innerWidth <= 768) {
                                            setMobileOpen(!mobileOpen);
                                        } else {
                                            setSidebarCollapsed(!sidebarCollapsed);
                                        }
                                    }}
                                    aria-label="Toggle sidebar"
                                >
                                    {sidebarCollapsed ? <Menu size={20} /> : <ChevronLeft size={20} />}
                                </button>

                                <nav className="breadcrumbs">
                                    {breadcrumbs.map((crumb, idx) => (
                                        <React.Fragment key={crumb.href}>
                                            {idx > 0 && <span className="breadcrumbs-separator">/</span>}
                                            {crumb.isLast ? (
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
