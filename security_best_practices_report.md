# Security Audit Report

Tanggal audit: 2026-03-13

## Executive Summary

Core workflow saat ini tidak menunjukkan blocker authz atau data-integrity yang kritis setelah hardening di sweep ini. Jalur mutasi utama sudah punya:

- session validation terhadap user live
- same-origin guard untuk route POST
- baseline security headers
- sanitasi HTML untuk print path
- guard concurrency pada pembayaran utama

Brutal truth-nya: model data tetap bergantung pada **app-layer authorization**, bukan RLS database native. Karena backend memakai token Sanity server-side, kesalahan route auth di masa depan akan berdampak luas. Jadi risiko terbesar yang masih tersisa sekarang bukan bug kasat mata harian, tapi **arsitektur akses data** dan disiplin menjaga regression authz.

## Open Findings

### 1. Medium: Tidak ada native RLS, semua kontrol akses ada di layer aplikasi

Lokasi:

- [sanity.ts](/c:/LOGISTIK/app/src/lib/sanity.ts)
- [route.ts](/c:/LOGISTIK/app/src/app/api/data/route.ts)
- [driver accounts route](/c:/LOGISTIK/app/src/app/api/driver/accounts/route.ts)
- [driver tracking route](/c:/LOGISTIK/app/src/app/api/driver/tracking/route.ts)

Temuan:

- backend memakai Sanity server-side client dengan token privileged
- artinya dataset tidak diproteksi oleh RLS per-user seperti pada database relasional
- semua pembatasan akses bergantung pada route guard, role check, dan sanitasi response

Impact:

- bila ada route auth regression di masa depan, scope data yang terekspos bisa besar

Status:

- saat audit ini, route utama sudah dijaga cukup ketat
- ini residual architectural risk, bukan bug terbuka spesifik yang belum ditangani

Rekomendasi:

- pertahankan semua akses data hanya lewat route server yang diaudit
- tambah test authz regression untuk entity sensitif
- jangan pernah expose Sanity token ke client

### 2. Low: Proxy page guard sekarang live-validated best-effort, dengan fallback JWT saat route session gagal

Lokasi:

- [proxy.ts](/c:/LOGISTIK/app/src/proxy.ts)
- [auth.ts](/c:/LOGISTIK/app/src/lib/auth.ts)

Temuan:

- `proxy.ts` sekarang mencoba revalidate sesi hidup lewat `/api/auth/session`
- kalau sesi tidak valid, cookie dibersihkan lalu user diarahkan ulang ke login
- fallback decode JWT masih dipakai hanya saat route session gagal sementara, supaya shell tidak ikut rapuh karena transient failure internal

Impact:

- risiko stale shell session turun jauh dibanding kondisi awal
- residual gap kecil masih ada hanya saat live session check gagal sementara dan fallback JWT harus dipakai

Rekomendasi:

- kalau ingin menutup gap ini total tanpa fallback, redesign page guard agar memakai lightweight revocation/session-version strategy

## Remediated In This Audit

### Fixed: export Excel sudah dimigrasikan dari `xlsx` ke `exceljs`

Perbaikan:

- dependency `xlsx` dihapus dari runtime
- export workbook sekarang memakai `exceljs`
- `npm audit --omit=dev` sekarang bersih

Lokasi:

- [package.json](/c:/LOGISTIK/app/package.json)
- [package-lock.json](/c:/LOGISTIK/app/package-lock.json)
- [export.ts](/c:/LOGISTIK/app/src/lib/export.ts)

### Fixed: password hash bocor ke browser lewat endpoint user

Perbaikan:

- response `users` sekarang disanitasi sebelum dikirim ke client
- create/update user juga tidak lagi mengembalikan `passwordHash`
- route akun mobile driver juga tidak lagi mengembalikan `passwordHash`

Lokasi:

- [data-helpers.ts](/c:/LOGISTIK/app/src/lib/api/data-helpers.ts)
- [route.ts](/c:/LOGISTIK/app/src/app/api/data/route.ts)
- [generic-workflows.ts](/c:/LOGISTIK/app/src/lib/api/generic-workflows.ts)
- [driver accounts route](/c:/LOGISTIK/app/src/app/api/driver/accounts/route.ts)

### Fixed: filter query bisa fallback ke “ambil semua” dan menerima field liar

Perbaikan:

- key filter sekarang divalidasi
- value filter sekarang dibatasi ke scalar / array of scalar
- malformed filter tidak lagi fallback ke `sanityGetAll`, tetapi ditolak `400`

Lokasi:

- [sanity.ts](/c:/LOGISTIK/app/src/lib/sanity.ts)
- [route.ts](/c:/LOGISTIK/app/src/app/api/data/route.ts)

### Fixed: auth brute-force sekarang punya throttle best-effort

Perbaikan:

- login route sekarang menahan percobaan gagal berulang per `email + IP + scope`
- throttle ini best-effort, cocok sebagai lapisan tambahan, bukan pengganti rate limiting edge/provider

Lokasi:

- [rate-limit.ts](/c:/LOGISTIK/app/src/lib/api/rate-limit.ts)
- [login route](/c:/LOGISTIK/app/src/app/api/auth/login/route.ts)

### Fixed: Sanity config tidak lagi diam-diam fallback ke dataset default

Perbaikan:

- project/dataset sekarang fail-fast kalau env wajib tidak tersedia

Lokasi:

- [sanity.ts](/c:/LOGISTIK/app/src/lib/sanity.ts)

### Fixed: admin tidak lagi menerima full company settings owner-only

Perbaikan:

- `entity=company` sekarang disanitasi per role
- admin tetap mendapat field operasional yang memang dipakai UI, seperti branding, due date nota, dan info transfer
- field owner-only seperti counter atau prefix numbering dan aset internal perusahaan tidak lagi dibuka penuh ke admin

Lokasi:

- [data-helpers.ts](/c:/LOGISTIK/app/src/lib/api/data-helpers.ts)
- [route.ts](/c:/LOGISTIK/app/src/app/api/data/route.ts)

Verifikasi runtime:

- login `admin@company.local` ke production lalu `GET /api/data?entity=company` sekarang mengembalikan `numberingSettings` yang sudah dinolkan atau dikosongkan
- login `owner@company.local` tetap mendapat profile penuh untuk halaman pengaturan perusahaan

## Verification

Berhasil:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run audit:finance` -> `Total temuan: 0`

Catatan:

- `npm audit --omit=dev` sekarang `found 0 vulnerabilities`
- background HTTP smoke server lokal dibatasi policy tool pada sesi ini, jadi verifikasi response untuk patch security ini saya dasarkan pada code-path audit + gate teknis yang lolos
