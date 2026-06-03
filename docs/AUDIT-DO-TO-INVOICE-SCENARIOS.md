# Audit skenario UAT — DO → Invoice

**Tanggal:** 2026-06-02
**Tipe:** laporan read-only (bukan perbaikan kode)
**Lanjutan dari:** audit mismatch DO→invoice di percakapan sebelumnya
**Kode acuan:** `order-workflows.ts`, `finance-workflows.ts`, `invoice-create-page-support.ts`, `delivery-order-completion.ts`, `TripDetailPage`, `orders/[id]`, `invoices/new`

---

## Cara baca checklist

| Simbol | Arti |
|--------|------|
| **PASS** | Perilaku konsisten dengan aturan bisnis yang diharapkan |
| **FAIL** | Mismatch data/UI/API atau rawan salah operasi |
| **WARN** | Bisa jalan, tapi membingungkan atau bergantung disiplin user |

**Layar:** Trip = `/trips/[id]` (`TripDetailPage`), Order = `/orders/[id]`, InvNew = `/invoices/new`, InvDet = `/invoices/[id]`, Mobile = Flutter driver app.

---

## Aturan “siap ditagih” (tiga definisi di kode)

| Lapisan | Syarat |
|---------|--------|
| **Order → tombol Buat Invoice** | Minimal 1 DO: `status === 'DELIVERED'` **dan** `hasDeliveryOrderBillableCargo` |
| **InvNew → dropdown DO** | `DELIVERED` **atau** (bukan `CANCELLED` **dan** ada drop billable di `actualDropPoints`) |
| **API `freight-notas` create** | Bukan `CANCELLED`; jika belum `DELIVERED` maka **wajib** ada `actualDropPoints` + muatan billable per baris; jika `DELIVERED` tanpa drop, masih boleh pakai rencana/item |

Ini menjadi akar banyak **FAIL** di skenario partial.

---

## S1 — Multi-SJ: selesaikan SJ-A dulu, SJ-B masih jalan

**Setup:** 1 DO, 2 referensi SJ (A & B), muatan terpisah per SJ.

| Langkah | Trip | Order | InvNew | API |
|---------|------|-------|--------|-----|
| Driver ajuan selesai **hanya SJ-A** (POD + drop billable A) | Banner pending + target SJ terlihat | — | — | `pendingDriverRequests[]` |
| Admin **Review & Approve** batch SJ-A | Modal prefill dari pending; merge drop: **preserve** drop SJ-B + tambah drop A | — | — | `set-surat-jalan-status-batch` + `approveDriverRequest` |
| Status trip/DO setelah approve | SJ-A `DELIVERED`, SJ-B masih progres → agregat DO sering **`PARTIAL_HOLD`** atau **`ON_DELIVERY`** (bukan full `DELIVERED`) | Baris DO: “Masuk invoice” untuk A; tombol invoice **WARN disabled** jika DO belum `DELIVERED` | DO **bisa muncul** di dropdown jika drop A billable | **PASS** create baris SJ-A; **WARN** tanpa cek pending |
| Finance buat nota pilih SJ-A saja | — | — | Modal grup SJ: hanya baris A | **PASS** dedupe per item/SJ |

**Kesimpulan S1:** Backend **mendukung** penagihan per SJ (incremental drops). UX Order **terlalu ketat** (butuh full `DELIVERED`). InvNew **lebih longgar** — finance bisa tagih sebelum ops menandai trip “selesai”.

---

## S2 — Hold / transit: sebagian muatan tidak masuk invoice

**Setup:** Finalisasi dengan drop `DROP` (billable) + `HOLD` atau `TRANSIT` (non-billable).

| Langkah | Trip | InvNew | API |
|---------|------|--------|-----|
| Admin final dengan mixed drop | Label per titik: “Masuk Invoice” vs “Hold / Tidak Masuk Invoice” | — | Hanya `DROP`/`EXTRA_DROP` masuk ringkasan billable |
| Generate baris nota | Outcome card: “Terkirim Sebagian” jika ada billable + hold | Baris hanya dari billable; SJ tanpa billable **di-skip** | **PASS** tolak baris tanpa drop billable |
| User coba tagih full rencana | — | **WARN** jika `DELIVERED` tanpa `actualDropPoints`: baris dari **rencana item**, bukan drop | **FAIL** vs narasi “pakai aktual” |

**Kesimpulan S2:** Hold **benar** tidak ikut tagihan. Risiko: admin set `DELIVERED` + POD tanpa mengisi drop → invoice dari **rencana**.

---

## S3 — Partial hold lanjutan (SJ PARTIAL_HOLD → finalize sisa)

**Setup:** SJ pernah `PARTIAL_HOLD` (hold continuable), lalu admin finalize sisa ke `DELIVERED`.

| Langkah | Trip | InvNew |
|---------|------|--------|
| Batch finalize continuation | Logic `isHoldContinuationFinalize`, split/merge drop hold | — |
| Status SJ setelah finalize | `getSuratJalanStatusAfterFinalize`: masih hold → **`PARTIAL_HOLD`**, else **`DELIVERED`** | — |
| Tagihan setelah SJ-1 partial, sebelum SJ-2 | DO mungkin **`PARTIAL_HOLD`** | **PASS** baris SJ yang sudah punya drop billable; SJ belum final **tidak** generate baris |

**Kesimpulan S3:** Alur **partial-by-SJ** di backend kuat; UI Order/label “DO selesai” tidak mencerminkan partial.

---

## S4 — Multi-customer invoice per SJ (`billingCustomerRef`)

**Setup:** Dua SJ sama DO, `billingCustomerRef` berbeda di drop/referensi.

| Langkah | InvNew | API |
|---------|--------|-----|
| Pilih DO tanpa pilih customer header | Toast: “SJ dengan customer invoice berbeda…” | — |
| Pilih customer dulu, tambah DO | Hanya baris customer tersebut | **PASS** validasi baris ≠ customer header |
| Split 2 invoice | User buat invoice #1 customer A, lalu #2 customer B | Coverage key per SJ/item → **PASS** tidak double bill |

**Kesimpulan S4:** **PASS** dengan syarat user paham urutan (customer dulu). **WARN:** tidak ada penjelasan di Trip/Order.

---

## S5 — Split invoice: SJ sama, tagih dua kali (partial qty)

**Setup:** Satu SJ punya 2 barang / 2 drop billable; invoice #1 hanya ambil sebagian baris.

| Langkah | InvNew | API |
|---------|--------|-----|
| Invoice #1 pilih grup SJ + subset baris | `usedNotaDoItemRefs` / coverage `doRef::item::…` | **PASS** |
| Invoice #2 sisa baris | Baris sisa masih tersedia di modal pilih SJ | **PASS** “sudah masuk invoice lain” |
| Invoice #2 tanpa pilih customer | **WARN** sama seperti S4 | — |

**Kesimpulan S5:** **PASS** — desain coverage per item/drop mendukung split nota.

---

## S6 — Driver ajuan vs admin manual (dua jalur final)

| Jalur | Trip | Mobile | Hasil data |
|-------|------|--------|------------|
| Driver ajuan `DELIVERED` | Approve → merge `pendingDriverActualDropPoints` ke `actualDropPoints` | Tidak set status final | **PASS** |
| Admin manual `DELIVERED` trip | Modal POD + drop wajib; blok jika masih ada **pending driver** | — | **PASS** |
| Admin manual saat pending ada | Error 409: review dulu | — | **PASS** |
| Finance create nota saat pending | Tidak diblok | — | **FAIL** — bisa tagih drop lama sebelum approve request baru |

**Kesimpulan S6:** Gate pending **ada** di status manual, **tidak** di invoice.

---

## S7 — Status DO vs status SJ (tampilan)

| Kondisi | Trip list SJ | Badge DO di Order |
|---------|--------------|-------------------|
| SJ-A DELIVERED, SJ-B ON_DELIVERY | Filter status per SJ **PASS** | DO badge dari status agregat — bisa **`ON_DELIVERY`** padahal A sudah bisa ditagih **WARN** |
| Semua SJ DELIVERED | **PASS** | DO `DELIVERED` → tombol invoice aktif **PASS** |

---

## S8 — Tanpa `actualDropPoints` tapi status DELIVERED

**Setup:** Admin (atau jalur lama) set DO `DELIVERED` + POD tanpa mengisi titik drop.

| Lapisan | Hasil |
|---------|--------|
| Trip | Mungkin tidak ada breakdown “Masuk invoice” |
| Order | `billableDeliveredDoCount` bisa **> 0** jika helper billable dari field lain — **WARN** |
| InvNew | DO bisa masuk list; baris dari **planned/actual item**, collie/berat rencana |
| API create | **PASS** (tidak 409) |

**Kesimpulan S8:** **FAIL operasional** — tagihan tidak berbasis realisasi drop.

---

## S9 — Duplikasi SJ di nota & revisi

| Aksi | Hasil |
|------|--------|
| Tambah SJ sama dua kali di invoice berbeda | API: “sudah masuk invoice lain” **PASS** |
| Revisi invoice (`?edit=`) | Baris terpakai exclude nota sendiri **PASS** |
| Edit manual baris kosong `doRef` | “Tambah baris” manual — **WARN** tidak terhubung DO |

---

## S10 — Navigasi & CTA (UX putus)

| Dari | Ke InvNew | Nota terkait di Trip |
|------|-----------|---------------------|
| Order “Buat Invoice” | `/invoices/new` tanpa `doRef` / `orderRef` | — |
| Trip detail | **Tidak ada** tombol/link invoice | **Tidak ada** daftar `freightNota` / nomor nota |
| InvDet | Link DO? | Perlu cek item — baris punya `doNumber` |

**Kesimpulan S10:** **FAIL UX** — finance harus cari DO ulang di dropdown global.

---

## Matriks ringkas skenario → rekomendasi verifikasi manual

| ID | Skenario | Verifikasi di browser (disarankan) |
|----|----------|-------------------------------------|
| S1 | 2 SJ, tagih A saja | Approve A → cek dropdown InvNew vs tombol Order |
| S2 | Hold + drop | Final mixed → pastikan hanya DROP di nota |
| S3 | PARTIAL_HOLD lanjut | Dua kali finalize → nota bertahap |
| S4 | 2 customer SJ | Dua invoice terpisah |
| S5 | Split baris | Dua nota, coverage item |
| S6 | Pending + invoice | Ajuan driver + coba create nota sebelum approve |
| S8 | DELIVERED tanpa drop | Cek apakah nota pakai rencana |
| S10 | Deep link | Dari order ke nota — apakah DO terpilih otomatis |

---

## Prioritas perbaikan (untuk fase implementasi berikutnya)

1. **P0** — Satukan “siap ditagih”: `DELIVERED` atau `PARTIAL_HOLD` dengan ≥1 SJ punya drop billable **dan** tidak ada pending kritis; sama di Order, InvNew, API.
2. **P0** — API tolak (atau flag keras) create nota jika `DELIVERED` tanpa `actualDropPoints` billable.
3. **P1** — `invoices/new?doRef=` / `?orderRef=` + tampilan nota di Trip.
4. **P1** — Copy InvNew: ganti “DO yang selesai” → “DO / SJ dengan realisasi drop siap ditagih”.
5. **P2** — Badge Order: “Sebagian siap ditagih (n SJ)” vs hanya status DO agregat.

---

## Yang sudah kuat (jangan rusak saat refactor)

- Finalisasi per SJ (batch) dengan **merge incremental** `actualDropPoints`.
- Pemisahan billable vs hold/return di UI Trip dan di `buildNotaRowsFromDeliveryOrder`.
- Coverage anti-duplikat SJ/item/drop di nota.
- Driver hanya **mengajukan** selesai; approve admin dengan POD.
- Validasi multi-customer di InvNew + API.

---

*Dokumen ini hanya laporan audit. Perilaku diverifikasi dari kode; jalankan skenario S1–S8 di staging untuk bukti runtime.*
