# 🚛 LOGISTIK — Admin Panel

Sistem manajemen logistik berbasis web. Dibangun dengan **Next.js 14**, **Sanity CMS**, dan di-deploy ke **Vercel**.

---

## 📋 Daftar Modul

| Modul | URL | Deskripsi |
|---|---|---|
| Dashboard | `/dashboard` | Ringkasan statistik bisnis |
| Order / Resi | `/orders` | Manajemen order pengiriman |
| Surat Jalan | `/delivery-orders` | Tracking pengiriman per DO |
| Customer | `/customers` | Data pelanggan |
| Layanan | `/services` | Jenis layanan/komoditas |
| **Nota Ongkos Angkut** | `/invoices` | Tagihan ongkos ke customer |
| **Borongan Supir** | `/borongan` | Slip upah supir |
| Bon Supir | `/driver-vouchers` | Uang jalan / bon supir |
| Pengeluaran | `/expenses` | Pencatatan biaya operasional |
| Kategori Biaya | `/expense-categories` | Kategori pengeluaran |
| Rekening Bank | `/bank-accounts` | Manajemen rekening |
| Laporan | `/reports` | Laba rugi & arus kas |
| Fleet | `/fleet/*` | Kendaraan, supir, maintenance, ban, insiden |
| Pengaturan | `/settings/*` | Profil, perusahaan, user, audit log |

---

## 🔄 Alur Kerja (Workflow)

### 1. Order → Surat Jalan → Selesai

```
📦 Buat Order (Resi)
   └─ Isi customer, penerima, barang, berat
   └─ Nomor Resi auto: R-202603-0001

📋 Buat Surat Jalan (DO) dari Order
   └─ Pilih kendaraan & supir
   └─ Nomor DO auto: DO-202603-0001
   └─ Status awal: CREATED

🚛 Set Tarip Borongan (SEBELUM BERANGKAT)
   └─ Di halaman detail DO → card "Tarip Borongan Supir"
   └─ Input Rp/kg → Simpan
   └─ Tarip ini akan otomatis terisi saat buat Slip Borongan

🚚 Update Status DO
   └─ CREATED → ON_DELIVERY → DELIVERED
   └─ Saat DELIVERED: upload POD (Proof of Delivery)
   └─ ✅ Saat SEMUA DO dari order DELIVERED → Order otomatis → COMPLETE

🖨️ Cetak Surat Jalan (PDF)
```

---

### 2. Nota Ongkos Angkut (Tagihan ke Customer)

```
💼 Buat Nota (/invoices/new)
   └─ Pilih customer dari dropdown
   └─ Sistem filter DO milik customer tsb (berdasarkan orderRef → customerRef)
   └─ Tambah baris dari Surat Jalan, atau tambah manual
   └─ Kolom: NO.TRUCK | TANGGAL | NO.SJ | DARI | TUJUAN | BARANG | COLLIE | BERAT KG | TARIP | UANG RP
   └─ UANG RP = BERAT KG × TARIP (auto-hitung)
   └─ Nomor Nota auto: NOTA-202603-0001
   └─ Status: UNPAID

💰 Terima Pembayaran
   └─ Di halaman detail Nota → "Tambah Pembayaran"
   └─ Masukkan jumlah, tanggal, rekening bank
   └─ Status otomatis update:
      UNPAID → PARTIAL (bayar sebagian)
      PARTIAL → PAID (lunas)
   └─ Pembayaran tercatat sebagai income
   └─ Saldo rekening bank bertambah (CREDIT)

🖨️ Cetak Nota
   └─ Format sesuai standar perusahaan
   └─ Kolom perincian perjalanan lengkap
```

---

### 3. Borongan Supir (Upah Supir)

```
📝 Buat Slip Borongan (/borongan/new)
   └─ Pilih supir
   └─ Sistem tampilkan DO yang sudah diselesaikan supir tersebut
   └─ Tarip otomatis terisi dari DO (yang sudah diset sebelum berangkat)
   └─ UANG RP = BERAT KG × TARIP (auto-hitung)
   └─ Nomor Slip auto: BRG-202603-0001
   └─ Status: UNPAID

💵 Bayar Upah Supir
   └─ Di halaman detail Slip → "Bayar Borongan Supir"
   └─ Modal: pilih rekening bank, metode, tanggal, catatan
   └─ Saat konfirmasi:
      ✅ Status Slip → PAID
      ✅ Pengeluaran tercatat di modul Expenses
      ✅ Saldo rekening bank berkurang (DEBIT)

🖨️ Cetak Slip Borongan
   └─ Format sama dengan Nota Ongkos
```

---

### 4. Bon Supir (Uang Jalan)

```
💴 Buat Bon (/driver-vouchers/new)
   └─ Supir minta uang jalan sebelum berangkat
   └─ Catat jumlah cash yang diberikan

🧾 Supir Lapor Pengeluaran
   └─ Di detail bon → tambah item pengeluaran (BBM, tol, dll)
   └─ Status: DRAFT → ISSUED → SETTLED

✅ Settle Bon
   └─ Selisih cash vs pengeluaran dihitung otomatis
   └─ Jika ada sisa, supir kembalikan
```

---

### 5. Laporan Keuangan

```
📊 Laba Rugi (/reports → tab Laba Rugi)
   └─ Pendapatan: dari semua pembayaran masuk (payment)
   └─ Pengeluaran: dari semua expense (termasuk upah borongan)
   └─ Laba Bersih = Pendapatan - Pengeluaran
   └─ Outstanding: gabungan Invoice lama + Nota Ongkos baru

💳 Arus Kas (/reports → tab Arus Kas)
   └─ Per rekening bank: masuk & keluar
   └─ Semua transaksi kronologis
```

---

### 6. Fleet Management

```
🚗 Kendaraan (/fleet/vehicles)
   └─ Data unit, plat, STNK, KIR, asuransi

👤 Supir (/fleet/drivers)
   └─ Data supir, lisensi, KTP

🔧 Maintenance (/fleet/maintenance)
   └─ Jadwal servis berkala

🛞 Ban (/fleet/tires)
   └─ Tracking kondisi ban per unit

🚨 Insiden (/fleet/incidents)
   └─ Laporan kecelakaan/insiden
   └─ Status: OPEN → IN_REVIEW → RESOLVED
```

---

## 🔢 Format Nomor Otomatis

| Dokumen | Format | Contoh |
|---|---|---|
| Order / Resi | `R-20YYMM-XXXX` | `R-202603-0001` |
| Surat Jalan (DO) | `DO-20YYMM-XXXX` | `DO-202603-0012` |
| Nota Ongkos | `NOTA-20YYMM-XXXX` | `NOTA-202603-0003` |
| Slip Borongan | `BRG-20YYMM-XXXX` | `BRG-202603-0005` |
| Insiden | `INC-20YYMM-XXXX` | `INC-202603-0001` |

---

## 🔐 Role & Akses

| Fitur | OWNER | ADMIN | OPERATOR |
|---|---|---|---|
| Semua modul | ✅ | ✅ | ⚡ Terbatas |
| Nota Ongkos Angkut | ✅ | ✅ | ❌ |
| Borongan Supir | ✅ | ✅ | ❌ |
| Laporan | ✅ | ✅ | ❌ |
| Audit Log | ✅ | ❌ | ❌ |
| User Management | ✅ | ❌ | ❌ |
| Rekening Bank | ✅ | ✅ | ❌ |

---

## 🧩 Hubungan Antar Modul

```
Customer ──────────────────────────────────────────────┐
   │                                                    │
   ↓                                                    ↓
Order ──► Delivery Order (DO) ──► Nota Ongkos Angkut
               │                       │
               │                       └──► Payment ──► Bank Account
               │
               ↓
          Driver/Vehicle
               │
               ├──► Tarip Borongan (diset sebelum berangkat di DO)
               │
               └──► Slip Borongan ──► Expense ──► Bank Account (DEBIT)
                         │
                         └──► Bon Supir (uang jalan)
```

---

## ⚙️ Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: Sanity CMS
- **Auth**: Custom session-based auth
- **Deploy**: Vercel
- **PDF**: Client-side print window

## 🛠️ Development

```bash
# Install
npm install

# Dev server
npm run dev

# Build
npm run build

# Deploy
npx vercel --prod
```

## 🌍 Environment Variables

```
NEXT_PUBLIC_SANITY_PROJECT_ID=xxx
NEXT_PUBLIC_SANITY_DATASET=production
SANITY_API_VERSION=2024-01-01
SANITY_API_TOKEN=xxx
NEXTAUTH_SECRET=xxx
```
