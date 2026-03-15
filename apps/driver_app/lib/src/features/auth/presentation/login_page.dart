import 'package:flutter/material.dart';

import '../../../app.dart';
import '../data/driver_auth_service.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.onLogin});

  final ValueChanged<DriverAppSession> onLogin;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final DriverAuthService _authService = DriverAuthService();
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _submitting = false;
  bool _obscurePassword = true;
  String? _errorMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _errorMessage = null;
    });
    try {
      final session = await _authService.login(
        email: _emailController.text.trim(),
        password: _passwordController.text,
      );
      if (!mounted) return;
      widget.onLogin(session);
    } on DriverAuthException catch (err) {
      if (!mounted) return;
      setState(() => _errorMessage = err.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _errorMessage = 'Tidak bisa terhubung ke server login');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ── Logo ──
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: scheme.primary,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: const Icon(
                      Icons.local_shipping_rounded,
                      color: Colors.white,
                      size: 28,
                    ),
                  ),

                  const SizedBox(height: 28),

                  // ── Heading ──
                  Text(
                    'Selamat datang',
                    style: TextStyle(
                      color: scheme.onSurface,
                      fontSize: 28,
                      fontWeight: FontWeight.w800,
                      height: 1.1,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Masuk untuk melihat perjalanan aktif\ndan mengirim lokasi berkala.',
                    style: TextStyle(
                      color: scheme.onSurface.withOpacity(0.5),
                      fontSize: 14,
                      height: 1.6,
                    ),
                  ),

                  const SizedBox(height: 36),

                  // ── Form ──
                  Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _FieldLabel(label: 'Email'),
                        const SizedBox(height: 8),
                        TextFormField(
                          controller: _emailController,
                          keyboardType: TextInputType.emailAddress,
                          decoration: InputDecoration(
                            hintText: 'driver@perusahaan.com',
                            prefixIcon: Icon(
                              Icons.alternate_email_rounded,
                              size: 18,
                              color: scheme.onSurface.withOpacity(0.35),
                            ),
                          ),
                          validator: (value) {
                            final text = value?.trim() ?? '';
                            if (text.isEmpty || !text.contains('@')) {
                              return 'Masukkan email yang valid';
                            }
                            return null;
                          },
                        ),

                        const SizedBox(height: 16),

                        _FieldLabel(label: 'Password'),
                        const SizedBox(height: 8),
                        TextFormField(
                          controller: _passwordController,
                          obscureText: _obscurePassword,
                          decoration: InputDecoration(
                            hintText: '••••••••',
                            prefixIcon: Icon(
                              Icons.lock_outline_rounded,
                              size: 18,
                              color: scheme.onSurface.withOpacity(0.35),
                            ),
                            suffixIcon: GestureDetector(
                              onTap: () => setState(
                                () => _obscurePassword = !_obscurePassword,
                              ),
                              child: Icon(
                                _obscurePassword
                                    ? Icons.visibility_off_outlined
                                    : Icons.visibility_outlined,
                                size: 18,
                                color: scheme.onSurface.withOpacity(0.35),
                              ),
                            ),
                          ),
                          validator: (value) {
                            if ((value ?? '').length < 6) {
                              return 'Password minimal 6 karakter';
                            }
                            return null;
                          },
                        ),

                        if (_errorMessage != null) ...[
                          const SizedBox(height: 14),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 12,
                            ),
                            decoration: BoxDecoration(
                              color: scheme.errorContainer,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  Icons.error_outline_rounded,
                                  color: scheme.error,
                                  size: 16,
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    _errorMessage!,
                                    style: TextStyle(
                                      color: scheme.error,
                                      fontSize: 13,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],

                        const SizedBox(height: 24),

                        SizedBox(
                          width: double.infinity,
                          child: FilledButton(
                            onPressed: _submitting ? null : _submit,
                            style: FilledButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 16),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14),
                              ),
                            ),
                            child: _submitting
                                ? SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: scheme.onPrimary,
                                    ),
                                  )
                                : const Text(
                                    'Masuk',
                                    style: TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 24),

                  // ── Info banner ──
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFECF6F4),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFCBE4DF)),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.info_outline_rounded,
                          color: scheme.primary,
                          size: 16,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'Login memanggil /api/auth/login dengan scope DRIVER. Pastikan API_BASE_URL mengarah ke host Next.js untuk device fisik.',
                            style: TextStyle(
                              color: scheme.primary.withOpacity(0.8),
                              fontSize: 12,
                              height: 1.5,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label,
      style: TextStyle(
        color: Theme.of(context).colorScheme.onSurface.withOpacity(0.6),
        fontSize: 13,
        fontWeight: FontWeight.w600,
      ),
    );
  }
}
