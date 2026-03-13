# Security Audit Report

Tanggal audit: 2026-03-13

## Executive Summary

Core workflow saat ini tidak menunjukkan blocker authz atau data-integrity yang kritis setelah hardening di sweep ini. Jalur mutasi utama sudah punya:

- session validation terhadap user live
- same-origin guard untuk route POST
- baseline security headers
- sanitasi HTML untuk print path
- guard concurrency pada pembayaran utama

Brutal truth-nya: model data tetap bergantung pada **app-layer authorization**, bukan RLS database native. Karena backend memakai token Sanity server-side, kesalahan route auth di masa depan akan berdampak luas. Jadi risiko terbesar yang masih tersisa sekarang bukan bug kasat mata harian, tapi kombinasi **supply-chain** dan **arsitektur akses data**.

## Open Findings

### 1. High: `xlsx` dependency masih punya advisory tanpa patch tersedia di registry saat ini

Lokasi:

- [package.json](/c:/LOGISTIK/app/package.json)
- [export.ts](/c:/LOGISTIK/app/src/lib/export.ts)

Temuan:

- `npm audit` masih melaporkan advisory `xlsx` severity `high`
- versi yang tersedia di registry saat ini berhenti di `0.18.5`
- advisory yang dilaporkan meminta versi di atas garis yang belum tersedia dari registry saat audit ini dijalankan

Catatan penting:

- penggunaan `xlsx` di codebase ini hanya untuk **menulis/export workbook**
- saya tidak menemukan jalur parse workbook dari user seperti `XLSX.read(...)` atau `XLSX.readFile(...)`

Impact:

- risiko saat ini lebih rendah dibanding aplikasi yang menerima upload Excel dari user
- tetap ada supply-chain exposure yang sebaiknya tidak dibiarkan permanen

Rekomendasi:

- migrasikan export Excel ke library yang lebih aktif dan tidak kena advisory, misalnya `exceljs`
- atau ganti begitu versi patched benar-benar tersedia di registry produksi

### 2. Medium: Tidak ada native RLS, semua kontrol akses ada di layer aplikasi

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

### 3. Low: Proxy page guard masih berbasis JWT claim, bukan live user lookup

Lokasi:

- [proxy.ts](/c:/LOGISTIK/app/src/proxy.ts)
- [auth.ts](/c:/LOGISTIK/app/src/lib/auth.ts)

Temuan:

- `getSession()` sekarang sudah revalidate user aktif dari Sanity
- tetapi `proxy.ts` masih membaca token JWT langsung untuk route-shell redirect

Impact:

- user yang baru saja dinonaktifkan bisa sempat melihat shell halaman sampai cookie habis atau request API berikutnya gagal
- data sensitif tetap lebih aman karena API/session sudah live-validated

Rekomendasi:

- kalau ingin menutup gap ini total, redesign page guard agar memakai lightweight revocation/session-version strategy

## Remediated In This Audit

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

## Verification

Berhasil:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run audit:finance` -> `Total temuan: 0`

Catatan:

- `npm audit` masih menandai `xlsx` sebagai temuan supply-chain terbuka
- background HTTP smoke server lokal dibatasi policy tool pada sesi ini, jadi verifikasi response untuk patch security ini saya dasarkan pada code-path audit + gate teknis yang lolos

