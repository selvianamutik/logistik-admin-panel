# Gading Mas Surya - Admin Panel

Sistem manajemen logistik berbasis web untuk operasional pengiriman, penagihan, kas/bank, armada, dan tracking driver.

Stack utama:
- Next.js 16
- Sanity CMS
- Vercel
- Flutter untuk app driver mobile

## Modul utama

- `/dashboard` untuk ringkasan owner/admin
- `/orders` untuk order/resi
- `/delivery-orders` untuk surat jalan dan tracking per DO
- `/invoices` untuk nota ongkos angkut
- `/borongan` untuk arsip slip borongan supir
- `/driver-vouchers` untuk uang jalan trip dan settlement per DO
- `/expenses` untuk pengeluaran umum
- `/bank-accounts` untuk rekening bank dan kas tunai
- `/reports` untuk laba rugi dan arus kas
- `/fleet/*` untuk supir, kendaraan, maintenance, ban, dan insiden
- `/settings/*` untuk profil, perusahaan, user, dan audit log

## Workflow inti

1. Order dibuat dari customer/pengirim.
2. Dari order, admin membuat Delivery Order.
3. Driver menjalankan tracking dan hanya boleh mengirim progres perjalanan.
4. Admin menyelesaikan DO dan mengisi POD pada langkah yang sama.
5. DO yang selesai bisa ditagihkan ke customer lewat Nota Ongkos.
6. Nota sekarang mendukung klaim / potongan dan satu penerimaan customer bisa dialokasikan ke beberapa nota sekaligus.
7. Pembayaran nota atau penerimaan customer otomatis mem-posting income dan mutasi rekening/kas.
8. DO yang selesai bisa dipakai untuk slip borongan bila perusahaan memang memakai workflow itu.
9. Workflow utama trip driver memakai Uang Jalan Trip yang tertaut ke 1 DO untuk uang jalan awal, top up, biaya perjalanan aktual, upah trip, dan settlement akhir.

Dokumen alur lengkap ada di:
- [WORKFLOW.md](C:\LOGISTIK\app\WORKFLOW.md)
- [AUDIT.md](C:\LOGISTIK\app\AUDIT.md)
- [security_best_practices_report.md](C:\LOGISTIK\app\security_best_practices_report.md)

## Demo seed

Script seed aktif:
- `npm run seed:sanity`
- `npm run reseed:sanity`

Dataset demo saat ini mencakup kondisi:
- customer, layanan, kategori biaya aktif dan nonaktif
- master barang per customer
- order `OPEN`, `PARTIAL`, `COMPLETE`, `ON_HOLD`, `CANCELLED`
- DO `CREATED`, `HEADING_TO_PICKUP`, `ON_DELIVERY`, `ARRIVED`, `DELIVERED`, `CANCELLED`
- nota `UNPAID`, `PARTIAL`, `PAID`
- penerimaan customer untuk bayar beberapa nota sekaligus
- klaim / potongan nota
- borongan `UNPAID`, `PAID`
- uang jalan trip `ISSUED`, `SETTLED`, termasuk skenario sisa uang kembali dan tambahan bayar ke supir
- maintenance, insiden, tracking log, mutasi rekening, kas tunai, dan laporan

Profil perusahaan demo:
- Nama: `Gading Mas Surya`
- Alamat: `JL. KEMANTREN 08 - KEC. TULANGAN, KAB. SIDOARJO - JATIM - INDONESIA`
- Telepon: `(031) 8853000`
- Email: `gadingmassurya@gmail.com`

Akun demo:
- owner web: `owner@company.local / owner12345`
- admin web: `admin@company.local / admin12345`
- driver mobile:
  - `driver.agus@company.local / driver12345`
  - `driver.budi@company.local / driver12345`
  - `driver.catur@company.local / driver12345`

## Status DO yang aktif

Flow status DO yang benar saat demo:
- `CREATED`
- `HEADING_TO_PICKUP`
- `ON_DELIVERY`
- `ARRIVED`
- `DELIVERED`
- `CANCELLED`

Catatan penting:
- driver tidak boleh set `DELIVERED` atau `CANCELLED`
- `DELIVERED` hanya di-set admin
- POD diisi saat admin menyelesaikan DO

## Driver mobile

App driver resmi ada di:
- [apps/driver_app/README.md](C:\LOGISTIK\app\apps\driver_app\README.md)

Flow mobile:
- login driver
- lihat DO milik sendiri
- mulai / pulihkan tracking
- kirim progres perjalanan
- heartbeat lokasi ke dashboard admin

## Development

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run audit:finance
```

Seed ulang demo:

```bash
npm run reseed:sanity
```

## Build note

Jalur build produksi yang stabil di repo ini:
- `npm run build`

`build:turbopack` hanya untuk eksperimen lokal.

## Environment variables

```bash
NEXT_PUBLIC_SANITY_PROJECT_ID=...
NEXT_PUBLIC_SANITY_DATASET=production
SANITY_API_VERSION=2024-01-01
SANITY_API_TOKEN=...
JWT_SECRET=...
```
