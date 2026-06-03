# Handoff — Aplikasi Driver Mobile (Flutter)

**Tanggal:** 2026-06-02
**Audience:** developer mobile, QA field, asisten AI yang menyentuh driver app tanpa mengubah workflow bisnis.
**Backend canonical:** Next.js di `app/src/` — API `app/src/app/api/driver/*`.
**Indeks API:** [HANDOFF-API.md §7](./HANDOFF-API.md#7-api-di-luar-apidata).
**Aturan bisnis:** [WORKFLOW.md](../WORKFLOW.md), ringkasan §5.16 [HANDOFF.md](./HANDOFF.md).

Portal web `/driver` **sudah dihapus** — supir hanya login lewat app ini.

---

## 1. Lokasi & stack

| Item | Path / nilai |
|------|----------------|
| Proyek Flutter | `app/apps/driver_app/` |
| Nama package | `driver_app` (`pubspec.yaml`) |
| Entry | `lib/main.dart` → `lib/src/app.dart` (`DriverTrackingApp`) |
| README build | `app/apps/driver_app/README.md` (signing Android `key.properties`) |
| Base URL API | `lib/src/shared/config.dart` — `API_BASE_URL` via `--dart-define`, default production Vercel |
| Header klien | Semua request: `x-client-type: driver-app`, `Authorization: Bearer <token>` (kecuali login/refresh) |

**Dependensi utama:** `http`, `geolocator`, `google_maps_flutter`, `shared_preferences`, `pdf` + `printing`.

---

## 2. Dua permukaan (admin vs supir)

| Permukaan | Path | Auth |
|-----------|------|------|
| **Admin panel** | `app/src/app/(admin)/*` | `/api/auth/login` + cookie `SESSION_COOKIE` |
| **App supir** | `apps/driver_app` | `POST /api/driver/mobile/login` + Bearer token |

Akun role `DRIVER` **tidak** bisa masuk panel admin (`/login` menolak dengan pesan pakai aplikasi driver).

---

## 3. Arsitektur kode Flutter

```
lib/
  main.dart
  src/
    app.dart                    # Session restore, routing Login ↔ Home
    shared/config.dart, theme.dart, branding.dart
    features/
      auth/                     # login, session store
      tracking/
        data/                   # delivery_order_service, driver_tracking_service, driver_access_service
        domain/models.dart
        presentation/           # tracking_home_page, delivery_manifest_page, delivery_completion_page
```

---

## 4. Autentikasi & sesi

| Langkah | API | Implementasi |
|---------|-----|----------------|
| Login | `POST /api/driver/mobile/login` | `DriverAuthService.login` |
| Simpan sesi | — | `DriverSessionStore` → SharedPreferences `driver_app.session.v1` |
| Restore | `GET /api/driver/session` | Bearer; gagal → `POST /api/driver/mobile/refresh` |
| Skor warning | `POST /api/driver/scoring/acknowledge` | Blocking notice bisa blok UI |
| Logout | Lokal saja | Clear prefs + stop GPS (opsional server: `POST /api/driver/logout` dengan cookie legacy — app tidak memanggil) |

**Akun supir** dibuat admin: `POST /api/driver/accounts` dari `/fleet/drivers`.

```bash
cd app/apps/driver_app
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

---

## 5. Matriks layar → API

### 5.1 Login — `login_page.dart`

| Aksi | API |
|------|-----|
| Submit | `POST /api/driver/mobile/login` |

### 5.2 Home — `tracking_home_page.dart`

| Data / aksi | API |
|-------------|-----|
| Muat data | `GET /api/driver/delivery-orders` |
| Status trip / batch SJ | `POST .../status`, `.../batch-status` |
| Ajuan selesai + POD + aktual | `POST .../status` (`DELIVERED` = pending admin) |
| Tutup trip (odometer) | `POST .../status` + `closeTripOnly` |
| Buat DO dari rencana | `POST .../create` |
| Muatan / SJ | `POST .../cargo`, `.../shipper-references`, `PATCH/DELETE .../cargo-item` |
| GPS | `POST /api/driver/tracking` (`start` / `resume` / `heartbeat`, interval ~15 menit) |
| Insiden | `GET/POST/PATCH /api/driver/incidents` |
| Voucher trip | Dari GET portal — **read-only** |

### 5.3 Manifest — `delivery_manifest_page.dart`

Form SJ + barang → submit via service di §5.2.

### 5.4 Penyelesaian — `delivery_completion_page.dart`

Wizard POD + drop + aktual → `requestDeliveryCompletion`.

---

## 6. Aturan bisnis (ringkas)

1. Driver **mengajukan** selesai — admin yang final di `TripDetailPage`.
2. Tracking ACTIVE/PAUSED mengunci resource trip.
3. Nota memakai muatan **aktual** setelah admin final.

---

## 7. Development

```bash
cd app/apps/driver_app && flutter pub get && flutter run
cd app && npm run dev   # admin + API driver
```

---

## 8. Checklist perubahan

- [ ] Setelah ubah API, update service Dart + [HANDOFF-API.md](./HANDOFF-API.md).
- [ ] Uji login, tracking, ajuan selesai, insiden di perangkat fisik.
- [ ] Jangan mengasumsikan `DELIVERED` dari mobile = DO final di sistem.

---

*Sinkronkan setelah refactor `app/src/app/api/driver/*`.*
