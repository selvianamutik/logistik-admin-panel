'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, Smartphone } from 'lucide-react';

export default function DriverLoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [checkingSession, setCheckingSession] = useState(true);

    useEffect(() => {
        let alive = true;

        const checkExistingSession = async () => {
            try {
                const [driverRes, adminRes] = await Promise.all([
                    fetch('/api/driver/session'),
                    fetch('/api/auth/session'),
                ]);
                if (!alive) return;

                const driverPayload = driverRes.ok
                    ? await driverRes.json() as { user?: { role?: string } | null }
                    : { user: null };
                if (driverPayload.user?.role === 'DRIVER') {
                    window.location.replace('/driver');
                    return;
                }

                const adminPayload = adminRes.ok
                    ? await adminRes.json() as { user?: { role?: string } | null }
                    : { user: null };
                if (adminPayload.user) {
                    window.location.replace('/dashboard');
                    return;
                }
            } catch {
                // Ignore background session check failures on the driver login page.
            } finally {
                if (alive) {
                    setCheckingSession(false);
                }
            }
        };

        void checkExistingSession();
        return () => {
            alive = false;
        };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, scope: 'DRIVER' }),
            });

            const raw = await res.text();
            let data: { error?: string; user?: { role?: string } } = {};
            if (raw) {
                try {
                    data = JSON.parse(raw) as { error?: string; user?: { role?: string } };
                } catch {
                    data = {};
                }
            }

            if (!res.ok) {
                setError(data.error || `Login gagal (${res.status})`);
                setLoading(false);
                return;
            }

            if (data.user?.role !== 'DRIVER') {
                setError('Akun ini bukan akun mobile driver');
                setLoading(false);
                return;
            }

            window.location.assign('/driver');
        } catch {
            setError('Tidak dapat terhubung ke server');
            setLoading(false);
        }
    };

    if (checkingSession) {
        return (
            <main className="login-page driver-login-page">
                <div className="login-card">
                    <div className="login-header">
                        <div className="login-logo" style={{ display: 'grid', placeItems: 'center' }}>
                            <Smartphone size={22} />
                        </div>
                        <h1 className="login-title">Aplikasi Driver</h1>
                        <p className="login-subtitle">Memeriksa sesi driver...</p>
                    </div>
                    <div className="login-body" style={{ display: 'flex', justifyContent: 'center' }}>
                        <Loader2 size={20} className="spinner" />
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="login-page driver-login-page">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-logo" style={{ display: 'grid', placeItems: 'center' }}>
                        <Smartphone size={22} />
                    </div>
                    <h1 className="login-title">Aplikasi Driver</h1>
                    <p className="login-subtitle">Masuk dari HP untuk update pengiriman dan kirim lokasi live</p>
                </div>

                <div className="login-body">
                    {error && (
                        <div className="login-error">
                            <AlertCircle size={16} />
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label className="form-label" htmlFor="email">
                                Email Driver
                            </label>
                            <input
                                id="email"
                                type="email"
                                className="form-input"
                                placeholder="Masukkan email akun driver"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoFocus
                                autoComplete="email"
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label" htmlFor="password">
                                Password
                            </label>
                            <div className="password-wrapper">
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    className="form-input"
                                    placeholder="Masukkan password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoComplete="current-password"
                                />
                                <button
                                    type="button"
                                    className="password-toggle"
                                    onClick={() => setShowPassword(!showPassword)}
                                    tabIndex={-1}
                                    aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
                            {loading ? (
                                <>
                                    <Loader2 size={18} className="spinner" />
                                    Masuk...
                                </>
                            ) : (
                                'Masuk ke Aplikasi Driver'
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </main>
    );
}
