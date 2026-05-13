# UAT End-to-End Sistem Logistik

Tanggal dibuat: 2026-05-13

Dokumen ini adalah paket UAT untuk divisi tester. Scope-nya mengikuti modul yang ada di aplikasi saat ini: admin web, portal/app driver, workflow order sampai finance, armada, inventory, accounting, RBAC, dan regression guard.

## 1. Scope UAT

| Area | Modul / Route | Prioritas | Coverage UAT |
| --- | --- | --- | --- |
| Core | /login, /dashboard, /settings/profile | P0 | Auth, sesi, logout, profile, password, dashboard role. |
| Master Data | /customers, /trip-rates, /services, /expense-categories | P0 | Customer, barang customer, pickup, tujuan, rate, armada, kategori biaya. |
| Order & Trip | /orders, /trips, /delivery-orders, /surat-jalan | P0 | Order/resi, DO, multi-SJ, multi-barang, status, POD, aktual, drop, lock. |
| Driver | /driver, apps/driver_app | P0 | Login driver, list trip, SJ/barang, tracking, completion request, incident. |
| Finance | /invoices, /bank-accounts, /driver-vouchers, /borongan, /expenses | P0 | Nota ongkos, receipt, kas/bank, uang jalan, borongan, expense. |
| Accounting | /accounting/*, /reports | P1 | Laba rugi, arus kas, jurnal, buku besar, akun perkiraan. |
| Inventory | /suppliers, /inventory/* | P1 | Supplier, barang gudang, pembelian, stok, material usage. |
| Fleet | /fleet/* | P0/P1 | Kendaraan, supir, akses mobile, maintenance, ban, insiden, scoring. |
| SDM | /employees, /attendance | P2 | Karyawan, absensi, export/filter. |
| Settings | /settings/* | P0/P1 | User, RBAC, company docs, audit logs. |

## 2. Akun dan Role Demo

| Role | Akun Demo | Fokus UAT | Catatan Akses |
| --- | --- | --- | --- |
| OWNER | owner@company.local / owner12345 | Semua modul, approval, laporan, pengaturan, audit. | Full access. Dipakai untuk sign-off akhir. |
| OPERASIONAL | admin@company.local / admin12345 | Order, trip, surat jalan, customer, uang jalan, pengeluaran operasional. | Tidak semua modul finance/settings boleh diubah. |
| FINANCE | finance@company.local / admin12345 | Invoice/nota, pembayaran, rekening, kas, laporan, jurnal. | Harus dibatasi dari workflow armada tertentu. |
| ARMADA | armada@company.local / admin12345 | Kendaraan, supir, ban, maintenance, insiden. | Tidak boleh membuat tagihan/pembayaran. |
| DRIVER | driver.agus@company.local / driver12345 | Mobile app/portal driver: trip, SJ, barang, tracking, approval request, insiden. | Tidak boleh login ke admin panel. |

## 3. Entry Criteria

- Build yang diuji sudah bisa login dan tidak gagal load route utama.
- Environment UAT tidak memakai data production live.
- Data seed atau data UAT baseline tersedia.
- Tester punya akses ke admin web, portal driver/app mobile, dan akun sesuai role.
- Browser dan device mobile yang digunakan dicatat pada setiap run.

## 4. Exit Criteria

- Semua test case P0 berstatus Pass.
- Bug Critical/High sudah Fixed dan lulus retest.
- Tidak ada mismatch data pada flow Order -> DO/SJ -> Driver -> Approval -> Nota -> Payment -> Laporan.
- Print/export dokumen kritikal tidak error.
- Owner/QA lead memberi sign-off.

## 5. Ringkasan Test Case

- Total case: 121
- P0: 83
- P1: 36
- P2: 2

## 6. Cara Eksekusi Tester

1. Reset atau siapkan data UAT.
2. Jalankan test case dari prioritas P0 dulu.
3. Isi kolom Status: Not Run, Pass, Fail, Blocked, atau N/A.
4. Untuk setiap Fail, isi Actual Result, Evidence Link, dan Bug ID.
5. Setelah bug fixed, lakukan retest pada case yang sama.
6. Setelah semua P0 lulus, lanjutkan P1 dan P2.

## 7. Skenario E2E Utama

| Scenario ID | Nama Skenario | Owner Modul | Tujuan | Alur Ringkas | Expected End State |
| --- | --- | --- | --- | --- | --- |
| E2E-001 | Order to Cash Normal | Operasional + Finance | Validasi alur bisnis utama dari order sampai uang masuk dan laporan. | Customer/master data -> Order -> DO/SJ -> Driver tracking -> Admin delivered dengan aktual/drop -> Nota -> Payment -> Laporan. | Order COMPLETE, DO DELIVERED, Nota PAID/PARTIAL sesuai nominal, bank/kas dan laporan sinkron. |
| E2E-002 | Partial Qty + Hold + DO Lanjutan | Operasional | Pastikan partial qty tidak kehilangan sisa barang. | Order qty besar -> DO sebagian -> sisanya hold -> release hold -> DO berikutnya -> finalisasi. | Progress item benar: delivered/held/pending tidak negatif dan status order benar. |
| E2E-003 | Mobile Driver SJ Correction | Operasional + Driver | Validasi driver bisa tambah/edit/hapus SJ sebelum aktual final tanpa merusak admin. | Assign trip -> driver input SJ -> edit nomor salah -> tambah SJ tambahan -> hapus SJ salah -> tambah/edit barang -> admin review. | Admin melihat data SJ/barang final benar; tidak ada stale SJ/item. |
| E2E-004 | Driver Completion Approval | Driver + Admin | Pastikan final fatal tetap approval admin. | Driver ajukan selesai dengan actual/drop/POD -> admin approve atau reject -> driver koreksi bila reject. | DO hanya DELIVERED setelah approve admin; pending lock aktif selama menunggu. |
| E2E-005 | Incident to Settlement | Driver + Armada + Finance | Validasi insiden lapangan dan biaya. | Driver lapor insiden -> admin armada review -> driver/admin input resolution cost -> finance posting/expense bila disetujui. | Incident resolved/closed dan biaya tercatat tanpa dobel posting. |
| E2E-006 | Uang Jalan Trip Settlement | Operasional + Finance | Validasi kas uang jalan dan settlement trip. | DO aktif -> terbit uang jalan -> top up -> biaya trip -> settle sisa/kekurangan -> laporan kas. | Voucher SETTLED, expense dan bankTransaction benar, tidak bisa dobel borongan. |
| E2E-007 | Borongan Legacy Eligible | Owner | Validasi slip borongan hanya untuk DO eligible. | DO delivered eligible tanpa voucher -> buat borongan -> bayar -> laporan expense. | Borongan PAID, expense tercatat, DO dengan voucher ditolak. |
| E2E-008 | Inventory to Maintenance | Gudang + Armada | Validasi stok sparepart dipakai maintenance. | Supplier -> item gudang -> pembelian/receive -> maintenance pakai material -> stock recap. | Stock masuk/keluar benar dan biaya maintenance tercatat. |
| E2E-009 | RBAC Cross Role | Owner | Pastikan role tidak bocor akses. | Login owner/admin/finance/armada/driver -> buka menu/action kritikal masing-masing. | Setiap role hanya bisa melihat/mutasi sesuai matrix. |
| E2E-010 | Cancellation and Resource Unlock | Operasional + Driver | Validasi cancel trip melepas resource dan tracking. | DO aktif dengan driver/kendaraan/tracking -> cancel oleh admin -> assign driver ke trip baru. | Tracking STOPPED, lock driver/kendaraan lepas, trip baru bisa dibuat. |

## 8. Severity Bug

| Severity | Definisi | Contoh |
| --- | --- | --- |
| Critical | Flow bisnis utama berhenti atau data finansial/operasional rusak. | DO tidak bisa final, payment salah saldo, SJ hilang tidak valid. |
| High | Fungsi penting gagal tetapi ada workaround terbatas. | Driver tidak bisa edit barang sebelum final, nota tidak bisa print. |
| Medium | Bug mengganggu workflow tetapi tidak merusak data utama. | Filter salah, validasi copy kurang jelas. |
| Low | Minor UI/copy/alignment. | Label kurang rapi, spacing kurang konsisten. |

## 9. Modul yang Wajib Diuji Manual End-to-End

Detail test case ada di workbook Excel:

- Auth, session, RBAC
- Dashboard
- Master data customer, barang customer, pickup, tujuan, rate
- Order/resi, partial qty, hold, trip plan
- Trip/DO/SJ, multi-SJ, add/edit/delete SJ, actual final, POD, drop point
- Driver mobile/portal, tracking, completion request, incident
- Approval admin
- Invoice/Nota Ongkos, adjustment, payment, overpayment
- Uang Jalan Trip
- Borongan
- Expenses, rekening, kas
- Accounting reports
- Supplier, inventory, purchase, stock recap, material usage
- Armada, kendaraan, supir, mobile access, maintenance, ban, incident
- SDM, karyawan, absensi
- Settings, users, company docs, audit log
- Non-functional: responsive UI, timezone Asia/Jakarta, print/export, data integrity

## 10. File Pendamping

- Workbook UAT: `artifacts/uat/UAT_LOGISTIK_END_TO_END.xlsx`
- Dokumen ini: `docs/UAT_LOGISTIK_END_TO_END.md`
