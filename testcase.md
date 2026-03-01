# Test Case LOGISTIK (Analisis Seluruh File Project)

## 1. Cakupan Analisis File

Analisis dibuat dari seluruh file aplikasi di `src/`, `scripts/`, dan config utama project (di luar `node_modules` dan `.next`).

### 1.1 Config & Build
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `next.config.ts`
- `eslint.config.mjs`
- `README.md`

### 1.2 Backend Core
- `src/middleware.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/logout/route.ts`
- `src/app/api/auth/session/route.ts`
- `src/app/api/data/route.ts`
- `src/lib/auth.ts`
- `src/lib/sanity.ts`
- `src/lib/rbac.ts`
- `src/lib/types.ts`
- `src/lib/utils.ts`
- `src/lib/export.ts`
- `src/lib/print.ts`
- `src/lib/pdf/invoiceTemplate.ts`
- `src/lib/pdf/doTemplate.ts`
- `src/lib/mockData.ts`

### 1.3 Frontend App
- Root/login/layout:
  - `src/app/layout.tsx`
  - `src/app/page.tsx`
  - `src/app/login/page.tsx`
  - `src/app/(admin)/layout.tsx`
- Admin pages:
  - `dashboard`
  - `orders`, `orders/new`, `orders/[id]`, `orders/[id]/edit`
  - `delivery-orders`, `delivery-orders/[id]`
  - `invoices`, `invoices/[id]`
  - `customers`, `customers/new`, `customers/[id]`
  - `services`
  - `expense-categories`
  - `expenses`, `expenses/new`
  - `fleet/vehicles`, `fleet/vehicles/new`, `fleet/vehicles/[id]`
  - `fleet/maintenance`
  - `fleet/tires`
  - `fleet/incidents`, `fleet/incidents/[id]`
  - `bank-accounts`, `bank-accounts/[id]`
  - `reports`
  - `settings/profile`, `settings/password`, `settings/company`, `settings/users`, `settings/audit-logs`
- Styling:
  - `src/app/globals.css`
  - `src/app/page.module.css`

### 1.4 Scripts
- `scripts/seed-sanity.ts`
- `scripts/test-sanity.ts`

---

## 2. Prasyarat Uji

1. Jalankan seed data Sanity (`npx tsx scripts/seed-sanity.ts`) atau pastikan data user dan master sudah ada.
2. `.env.local` terisi minimal:
   - `NEXT_PUBLIC_SANITY_PROJECT_ID`
   - `NEXT_PUBLIC_SANITY_DATASET`
   - `SANITY_API_VERSION`
   - `SANITY_API_TOKEN`
   - `JWT_SECRET`
3. Jalankan app: `npm run dev`.
4. Akun uji:
   - `owner@company.local` / `TEST1234`
   - `admin@company.local` / `TEST1234`

---

## 3. Daftar Test Case

## 3.1 Environment & Build

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| ENV-001 | Config | Jalankan `npm run dev` | Server berjalan tanpa crash |
| ENV-002 | Config | Jalankan `npm run build` | Build sukses tanpa error TS/Next |
| ENV-003 | `src/lib/sanity.ts` | Kosongkan `NEXT_PUBLIC_SANITY_PROJECT_ID`, restart server, akses login API | API gagal dengan error konfigurasi (terdeteksi jelas) |
| ENV-004 | `scripts/test-sanity.ts` | Jalankan script test Sanity | Project ID valid berhasil, yang salah gagal 401 |
| ENV-005 | `eslint.config.mjs` | Jalankan `npm run lint` | Lint berjalan dan membaca config dengan benar |

## 3.2 Auth & Session

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| AUTH-001 | `/api/auth/login` | Login tanpa email/password | HTTP 400 + pesan validasi |
| AUTH-002 | `/api/auth/login` | Login email salah | HTTP 401 |
| AUTH-003 | `/api/auth/login`, `src/lib/auth.ts` | Login owner dengan `TEST1234` | HTTP 200, cookie session terbentuk |
| AUTH-004 | `/api/auth/login`, `src/lib/auth.ts` | Login admin dengan `TEST1234` | HTTP 200, role `ADMIN` |
| AUTH-005 | `/api/auth/session` | Akses session saat sudah login | HTTP 200 + data user |
| AUTH-006 | `/api/auth/session` | Akses session tanpa cookie | HTTP 401 + `user:null` |
| AUTH-007 | `/api/auth/logout` | Logout lalu cek `/api/auth/session` | Session invalid (401) |
| AUTH-008 | `src/middleware.ts` | Hapus cookie lalu buka route admin | Redirect ke `/login` |
| AUTH-009 | `src/middleware.ts` | Akses `/` saat login | Redirect ke `/dashboard` |
| AUTH-010 | `src/app/login/page.tsx` | Simulasikan server down saat submit login | Tampil pesan `Tidak dapat terhubung ke server` |

## 3.3 Middleware, RBAC, RLC

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| RBAC-001 | `src/middleware.ts` | Login admin lalu akses `/settings/users` | Redirect ke `/dashboard` |
| RBAC-002 | `src/middleware.ts` | Login admin lalu akses `/reports` | Redirect ke `/dashboard` |
| RBAC-003 | `src/lib/rbac.ts`, `/api/data` | Login admin, fetch `expenses` | Data `privacyLevel=ownerOnly` tidak muncul |
| RBAC-004 | `src/lib/rbac.ts`, `/api/data` | Login admin, fetch `vehicles` | Field sensitif (`chassisNumber`, `engineNumber`) tersanitasi |
| RBAC-005 | `src/lib/rbac.ts` | Render sidebar admin vs owner | Menu owner-only tidak muncul untuk admin |
| RBAC-006 | `/api/data?entity=audit-logs` | Login admin lalu akses audit logs API | HTTP 403 |

## 3.4 Generic API Data (`src/app/api/data/route.ts`)

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| API-001 | GET `/api/data` | Tanpa session | HTTP 401 |
| API-002 | POST `/api/data` | Tanpa session | HTTP 401 |
| API-003 | GET `/api/data` | Entity tidak valid | HTTP 400 |
| API-004 | POST `/api/data` | Entity tidak valid | HTTP 400 |
| API-005 | GET `/api/data?id=...` | ID tidak ada | HTTP 404 |
| API-006 | POST update | Update dokumen valid | Data terupdate + audit log tercatat |
| API-007 | POST delete | Delete dokumen valid | `success:true` + audit log |
| API-008 | GET dengan `filter` JSON valid | Data sesuai filter |
| API-009 | GET dengan `filter` JSON rusak | Fallback ke fetch all, tidak crash |
| API-010 | Create `orders` | Buat order baru | Auto `masterResi`, `status=OPEN`, `createdAt`, `createdBy` |
| API-011 | Create `delivery-orders` | Buat DO baru | Auto `doNumber`, `status=CREATED` |
| API-012 | Create `invoices` | Buat invoice baru | Auto `invoiceNumber`, `status=UNPAID` |
| API-013 | Create `incidents` | Buat incident baru | Auto `incidentNumber`, `status=OPEN` |
| API-014 | Create `users` | Buat user baru dengan password | `password` dipindah ke `passwordHash`, `active=true` |
| API-015 | Entity `company` | Simpan profil perusahaan | Upsert singleton berhasil |

## 3.5 Order Flow

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| ORD-001 | `orders/new` | Submit tanpa customer/nama/alamat penerima | Toast error validasi |
| ORD-002 | `orders/new` | Submit order valid + beberapa item | Order & item tersimpan, redirect ke detail |
| ORD-003 | `orders/page` | Search & filter status | List terfilter sesuai input |
| ORD-004 | `orders/page` | Hapus order via modal konfirmasi | Order hilang dari list |
| ORD-005 | `orders/[id]` | Set item `PENDING -> HOLD` | Status item berubah |
| ORD-006 | `orders/[id]` | Set item hingga semua delivered | Status order otomatis jadi `COMPLETE` |
| ORD-007 | `orders/[id]` | Buat DO tanpa pilih item | Toast error |
| ORD-008 | `orders/[id]` | Buat DO dengan item valid | DO + delivery-order-item terbentuk |
| ORD-009 | `orders/[id]` | Buat invoice tanpa item invoice | Toast error |
| ORD-010 | `orders/[id]/edit` | Edit data penerima/order | Data tersimpan + kembali ke detail |

## 3.6 Delivery Order Flow

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| DO-001 | `delivery-orders/page` | Search/filter status | Data terfilter benar |
| DO-002 | `delivery-orders/[id]` | Ubah status `CREATED -> ON_DELIVERY` | Status DO dan tracking log update |
| DO-003 | `delivery-orders/[id]` | Ubah status `ON_DELIVERY -> DELIVERED` | Item order terkait ikut jadi `DELIVERED` |
| DO-004 | `delivery-orders/[id]` | Uji transisi status invalid (langsung dari `CREATED` ke `DELIVERED`) | Opsi tidak tersedia di UI |
| DO-005 | `delivery-orders/[id]` | Simpan POD setelah delivered | Field POD tersimpan dan tampil |
| DO-006 | `src/lib/pdf/doTemplate.ts` | Export PDF DO | File PDF terdownload, data utama tampil |
| DO-007 | `src/lib/print.ts` | Print dari list DO | Print window terbuka dengan branding perusahaan |
| DO-008 | `src/app/api/data/route.ts` | Cek audit log saat create/update DO | Audit log tersimpan |

## 3.7 Invoice & Payment Flow

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| INV-001 | `invoices/page` | Search/filter status | List sesuai filter |
| INV-002 | `invoices/[id]` | Tambah pembayaran nominal <= 0 | Toast error validasi |
| INV-003 | `invoices/[id]` | Tambah pembayaran valid (tanpa rekening) | Payment & income tercatat |
| INV-004 | `invoices/[id]` | Tambah pembayaran valid (dengan rekening) | Payment + income + bank transaction credit + saldo rekening update |
| INV-005 | `src/app/api/data/route.ts` | Bayar invoice sampai lunas | Status invoice jadi `PAID` |
| INV-006 | `src/lib/pdf/invoiceTemplate.ts` | Export PDF invoice | PDF terdownload dan total sesuai item |
| INV-007 | `invoices/[id]` | Tombol `Bayar penuh` | Nominal otomatis = sisa tagihan |
| INV-008 | `invoices/[id]` | Buka invoice ID tidak ada | Muncul state `Invoice tidak ditemukan` |
| INV-009 | `src/app/api/data/route.ts` | Uji konsistensi total bayar per invoice | Total paid tidak double count |
| INV-010 | `src/app/api/data/route.ts` | Tambah payment dengan amount negatif | Ditolak validasi server (tidak boleh tersimpan) |

## 3.8 Expense & Category

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| EXP-001 | `expense-categories/page` | Tambah kategori kosong | Toast error |
| EXP-002 | `expense-categories/page` | Add/edit kategori valid | Data kategori tersimpan |
| EXP-003 | `expenses/page` | Add expense tanpa kategori/amount | Toast error |
| EXP-004 | `expenses/new` | Add expense dengan `bankAccountRef` | Bank transaction `DEBIT` tercatat, saldo berkurang |
| EXP-005 | `expenses/page` | Owner melihat kolom privacy; admin tidak | Role behavior sesuai |
| EXP-006 | `/api/data?entity=expenses` | Admin fetch data | Record `ownerOnly` tidak tampil |

## 3.9 Fleet Module

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| FLEET-001 | `fleet/vehicles/new` | Simpan tanpa plat/model | Toast error |
| FLEET-002 | `fleet/vehicles/new` | Simpan valid | Kendaraan baru tersimpan `status=ACTIVE` |
| FLEET-003 | `fleet/vehicles/[id]` | Owner vs admin lihat detail | Owner lihat nomor rangka/mesin, admin tidak |
| FLEET-004 | `fleet/maintenance/page` | Jadwalkan servis tanpa kendaraan/tipe | Toast error |
| FLEET-005 | `fleet/maintenance/page` | Update status maintenance ke `DONE` | Status + `completedDate` terupdate |
| FLEET-006 | `fleet/tires/page` | Catat event ban tanpa kendaraan | Toast error |
| FLEET-007 | `fleet/tires/page` | Catat event ban valid | Event tersimpan dan muncul di list |
| FLEET-008 | `fleet/incidents/page` | Lapor incident tanpa kendaraan/deskripsi | Toast error |
| FLEET-009 | `fleet/incidents/page` | Lapor incident valid | Incident + incident-action-log awal tersimpan |
| FLEET-010 | `fleet/incidents/[id]` | Update status tanpa catatan | Ditolak (toast error) |
| FLEET-011 | `fleet/incidents/[id]` | Update status + catatan valid | Status incident berubah + action log baru |
| FLEET-012 | `fleet/vehicles/[id]` | Tab data (DO, maintenance, ban, incident, biaya) | Semua tab tampil data terkait vehicleRef yang benar |

## 3.10 Bank Accounts & Transfer

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| BANK-001 | `bank-accounts/page` | Tambah rekening tanpa nama bank/no rekening | Toast error |
| BANK-002 | `bank-accounts/page` | Tambah rekening valid | Rekening aktif tersimpan, current balance = initial balance |
| BANK-003 | `bank-accounts/page` | Edit rekening | Perubahan data rekening tersimpan |
| BANK-004 | `bank-accounts/page` | Hapus rekening | Rekening dinonaktifkan (soft delete) |
| BANK-005 | `bank-accounts/page` | Transfer dengan source=destination | Ditolak dengan toast error |
| BANK-006 | `bank-accounts/page` | Transfer valid antar rekening | Dua transaksi tercatat (OUT/IN) + saldo kedua rekening update |
| BANK-007 | `src/app/api/data/route.ts` | Transfer valid | Tidak membuat dokumen `bankTransaction` ekstra yang tidak valid |
| BANK-008 | `bank-accounts/[id]` | Filter transaksi by bankAccountRef | Hanya transaksi rekening terkait yang tampil |
| BANK-009 | `bank-accounts/[id]` | Export Excel mutasi | File download dan kolom sesuai |
| BANK-010 | `bank-accounts/[id]` | Print mutasi | Print window menampilkan branding + mutasi |

## 3.11 Reports

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| REP-001 | `reports/page` | Akses owner | Halaman laporan tampil |
| REP-002 | `reports/page` + middleware | Akses admin langsung URL `/reports` | Redirect ke `/dashboard` |
| REP-003 | `reports/page` | Ganti mode periode `month/year/all` | Data ringkasan berubah sesuai periode |
| REP-004 | `reports/page` | Tab `Laba Rugi` hitung revenue/expense/net | Nilai konsisten dengan data sumber |
| REP-005 | `reports/page` | Tab `Arus Kas` per bank | Inflow/outflow/transaction count valid |
| REP-006 | `reports/page` | Export excel di tiap tab | File sesuai tab aktif |
| REP-007 | `reports/page` | Print preview lalu print | Dokumen print sesuai tab+periode |

## 3.12 Settings

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| SET-001 | `settings/profile` | Update nama profile | Data user berubah |
| SET-002 | `settings/password` | Password baru < 6 | Ditolak (toast error) |
| SET-003 | `settings/password` | Konfirmasi tidak sama | Ditolak |
| SET-004 | `settings/password` | Ganti password valid | Login dengan password baru berhasil |
| SET-005 | `settings/password` | Isi current password salah | Seharusnya ditolak (uji kontrol keamanan) |
| SET-006 | `settings/users` | Tambah user tanpa password | Ditolak |
| SET-007 | `settings/users` | Toggle active user | Status aktif user berubah |
| SET-008 | `settings/company` | Simpan logo + nomor dokumen + invoice settings | Data singleton company tersimpan konsisten |

## 3.13 Audit Logs

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| AUD-001 | `settings/audit-logs` | Lakukan create/update/delete data, buka audit log | Aktivitas tercatat dengan actor, action, entity |
| AUD-002 | `src/app/api/data/route.ts` | Simulasikan kegagalan audit log write | Operasi utama tetap sukses (tidak rollback) |
| AUD-003 | `settings/audit-logs` | Search audit logs | Filter pencarian berjalan |

## 3.14 Export, Print, PDF Utility

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| UTIL-001 | `src/lib/export.ts` | Export Excel dataset kosong | File tetap terbuat dengan header |
| UTIL-002 | `src/lib/export.ts` | Export CSV dengan koma/quote/newline | Nilai ter-escape benar |
| UTIL-003 | `src/lib/print.ts` | `window.open` diblok browser | Fungsi gagal aman tanpa crash |
| UTIL-004 | `src/lib/print.ts` | `fetchCompanyProfile` gagal | Return `null`, print tetap bisa fallback nama default |
| UTIL-005 | `src/lib/pdf/invoiceTemplate.ts` | Invoice dengan payment parsial | PDF menampilkan total paid + remaining |
| UTIL-006 | `src/lib/pdf/doTemplate.ts` | DO dengan banyak item | Tabel render rapi, file nama benar |

## 3.15 Script & Seed

| ID | Area/File | Langkah Uji | Hasil Diharapkan |
|---|---|---|---|
| SCR-001 | `scripts/seed-sanity.ts` | Jalankan seed pertama | Dokumen dibuat |
| SCR-002 | `scripts/seed-sanity.ts` | Jalankan seed kedua | Dokumen existing di-skip (idempotent) |
| SCR-003 | `scripts/seed-sanity.ts` | Verifikasi log project ID | Nilai log konsisten dengan `createClient` projectId |
| SCR-004 | `scripts/test-sanity.ts` | Validasi projectId typo (`l` vs `1`) | Case valid sukses, typo gagal |

---

## 4. Smoke Test Prioritas Tinggi (Run Cepat)

1. AUTH-003 login owner.
2. API-010 create order.
3. ORD-008 create DO dari order.
4. DO-003 update DO jadi delivered.
5. ORD-006 cek order jadi complete.
6. INV-003 tambah payment invoice.
7. EXP-004 tambah expense dari rekening.
8. BANK-006 transfer antar rekening.
9. RBAC-001 cek admin tidak bisa buka `/settings/users`.
10. REP-004 cek laporan laba rugi sesuai data transaksi.

---

## 5. Catatan Risiko (Dari Analisis Implementasi Saat Ini)

1. Uji `INV-009`: perhitungan `totalPaid` di API payment berpotensi double count payment terbaru.
2. Uji `BANK-007`: alur transfer bank berpotensi membuat 1 dokumen `bank-transactions` ekstra sebelum proses transfer.
3. Uji `SET-005`: perubahan password saat ini tidak memverifikasi `current password` di server.
4. Uji keamanan API: beberapa otorisasi write masih bergantung UI/middleware, perlu validasi role tambahan di endpoint jika API diakses langsung.

