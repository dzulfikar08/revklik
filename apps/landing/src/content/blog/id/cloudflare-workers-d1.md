---
lang: id
title: "Membangun SaaS Analytics dengan Cloudflare Workers + D1"
description: "Catatan teknis membangun SaaS multi-tenant dengan Cloudflare Workers, D1, dan R2: arsitektur RevKlik, contoh skema SQL, pola multi-tenancy, dan batasannya."
ogDescription: "Arsitektur RevKlik di Workers, D1, dan R2, lengkap dengan contoh skema dan query SQL."
published: 2026-04-20
updated: 2026-10-30
readMinutes: 10
category: tech
featured: false
related: [cloudflare-analytics, benchmark-latensi, funnel-konversi]
draft: false
---

RevKlik dibangun di Cloudflare: Workers untuk compute, D1 untuk database, R2 untuk cadangan. Artikel ini menjelaskan bagaimana kami menyusunnya, dengan contoh skema dan query yang bisa Anda pakai sebagai titik awal untuk produk Anda sendiri.

## Kenapa Cloudflare untuk SaaS?

Pilihan umum untuk SaaS adalah AWS, GCP, atau Vercel dengan database terkelola seperti PlanetScale atau Supabase. Semuanya bekerja. Cloudflare menawarkan model yang berbeda, dengan beberapa komponen dalam satu platform:

| Kebutuhan | Komponen Cloudflare |
|---|---|
| Compute | Workers |
| Database relasional | D1 (SQLite) |
| Penyimpanan objek | R2 |
| Aset statis dan CDN | Workers Static Assets |
| Jadwal berkala | Cron Triggers |

Biaya mengikuti pemakaian, dengan paket gratis dan berbayar. Tarif berubah dari waktu ke waktu, jadi kami tidak mencantumkan perbandingan harga di sini. Hitung dengan [harga Workers](https://developers.cloudflare.com/workers/platform/pricing/) dan [harga D1](https://developers.cloudflare.com/d1/platform/pricing/) saat Anda merencanakan, memakai volume Anda sendiri.

## Arsitektur RevKlik

RevKlik punya tiga komponen utama.

### 1. Tracking script (sisi klien)

Script JavaScript tanpa framework yang dipasang di situs pelanggan. Ukurannya sekitar 4 KB (gzip), dan mengirim event lewat `fetch()` dengan `keepalive: true` agar request tetap selesai saat pengunjung berpindah halaman.

Script menangkap:

- Pageview (otomatis)
- Parameter UTM dari URL
- ID sesi (disimpan di `sessionStorage`)
- ID pengunjung acak (disimpan di `localStorage` pada domain situs, first-party, bukan cookie)
- Event kustom (dipanggil manual lewat `klikapa.track()`)

Karena ID pengunjung yang menetap termasuk data pribadi menurut UU PDP (UU 27/2022), pemilik situs perlu mencantumkannya di kebijakan privasi dan meminta persetujuan bila perlu. Detailnya ada di [analytics tanpa cookie pihak ketiga](/blog/analytics-tanpa-cookie).

### 2. Worker (ingestion dan API)

Satu Worker menerima event dari tracker, memvalidasinya, dan menyimpannya ke D1. Worker yang sama melayani API dashboard dan menerima webhook dari gateway pembayaran yang didukung (Xendit, DOKU, Mayar, Paywuz, dan Polar) untuk atribusi pendapatan.

Konfigurasi kami memakai smart placement: Worker dijalankan di dekat primary D1 di Asia-Pasifik. Alasannya, query ke database yang dilakukan berurutan menjadi lambat kalau Worker berada jauh dari database.

### 3. Dashboard

Dashboard adalah aplikasi web satu halaman yang disajikan sebagai static asset dari Worker yang sama, dengan route `/api/*` yang dijalankan Worker. Setiap route API yang membaca data situs lebih dulu memeriksa bahwa situs itu milik pengguna yang sedang login, baru menjalankan query D1.

Cron Triggers menjalankan tugas berkala: cadangan database (terenkripsi, disimpan di R2), sinkronisasi pesanan, dan pengiriman ulang notifikasi.

## Contoh Skema di D1

D1 memakai SQLite, jadi skema relasional biasa berfungsi. Skema di bawah ini adalah contoh yang disederhanakan untuk menjelaskan pola, bukan salinan skema produksi RevKlik:

```sql
-- Tabel utama untuk event
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  visitor_id TEXT,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  path TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  revenue REAL,
  props TEXT, -- JSON string
  referrer TEXT
);

-- Index untuk query yang sering dipakai
CREATE INDEX idx_events_tenant_session
  ON events(tenant_id, session_id, timestamp);

CREATE INDEX idx_events_tenant_type
  ON events(tenant_id, event_type, timestamp);

-- Tabel sessions untuk agregasi
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  visitor_id TEXT,
  started_at INTEGER,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  referrer TEXT,
  event_count INTEGER DEFAULT 1,
  converted INTEGER DEFAULT 0
);
```

Index yang tepat adalah faktor terbesar untuk kecepatan query di D1. Dengan index pada `(tenant_id, session_id, timestamp)`, merekonstruksi satu sesi tidak perlu memindai seluruh tabel. Ukur sendiri dengan `EXPLAIN QUERY PLAN` pada data Anda.

## Multi-Tenancy: Dua Pendekatan

Untuk SaaS multi-tenant ada dua pola umum.

### Pendekatan A: satu database dengan tenant_id

Satu database D1 untuk semua pelanggan. Setiap tabel punya kolom `tenant_id`, dan semua query menyertakan filter `WHERE tenant_id = ?`.

**Kelebihan:** sederhana, satu database yang dikelola, mudah untuk analisis lintas pelanggan oleh pemilik platform.

**Kekurangan:** isolasi data bergantung pada disiplin query. Satu query tanpa filter tenant bisa membocorkan data.

### Pendekatan B: satu database per pelanggan

Setiap pelanggan mendapat database D1 sendiri. Cloudflare memungkinkan membuat dan men-binding database secara programatik.

**Kelebihan:** isolasi data lebih kuat dan performa per pelanggan terpisah.

**Kekurangan:** setup lebih kompleks, dan analisis lintas pelanggan butuh agregasi manual.

RevKlik memakai satu database bersama (Pendekatan A) demi kesederhanaan, dengan pemeriksaan kepemilikan situs di setiap route API.

## Query yang Paling Penting

Semua contoh di bawah memakai skema sederhana di atas.

### User journey

Rekonstruksi jalur pengunjung dari satu sesi:

```sql
SELECT path, event_type, timestamp, props
FROM events
WHERE tenant_id = ? AND session_id = ?
ORDER BY timestamp ASC;
```

Halaman paling sering dikunjungi:

```sql
SELECT path, COUNT(*) AS hits
FROM events
WHERE tenant_id = ?
  AND timestamp > ?
GROUP BY path
ORDER BY hits DESC
LIMIT 20;
```

### Atribusi pendapatan

Total pendapatan per sumber UTM:

```sql
SELECT utm_source, utm_medium,
       SUM(revenue) AS total_revenue,
       COUNT(DISTINCT session_id) AS sessions
FROM events
WHERE tenant_id = ?
  AND revenue IS NOT NULL
  AND timestamp > ?
GROUP BY utm_source, utm_medium
ORDER BY total_revenue DESC;
```

### Funnel dengan langkah yang Anda tentukan

Menghitung berapa sesi yang melewati setiap langkah:

```sql
WITH funnel AS (
  SELECT session_id,
    MAX(CASE WHEN path = '/pricing' THEN 1 ELSE 0 END) AS step1,
    MAX(CASE WHEN event_type = 'signup' THEN 1 ELSE 0 END) AS step2,
    MAX(CASE WHEN event_type = 'purchase' THEN 1 ELSE 0 END) AS step3
  FROM events
  WHERE tenant_id = ? AND timestamp > ?
  GROUP BY session_id
)
SELECT
  SUM(step1) AS saw_pricing,
  SUM(step2) AS signed_up,
  SUM(step3) AS purchased
FROM funnel;
```

Ini contoh pola query untuk SaaS Anda sendiri. Panel funnel di dashboard RevKlik bekerja berbeda: ia membaca seberapa jauh pengunjung menggulir halaman berdasarkan penanda `data-section` (lihat [funnel konversi](/blog/funnel-konversi)).

## Soal Performa

Kami tidak mempublikasikan tabel latensi untuk artikel ini, karena kami belum mendokumentasikan metode pengukurannya. Beberapa praktik yang membantu:

- Gunakan index yang sesuai dengan pola query, lalu cek dengan `EXPLAIN QUERY PLAN`.
- Untuk volume tinggi, hitung ringkasan lebih dulu lewat Cron Triggers dan simpan di tabel terpisah, daripada menghitung ulang setiap dashboard dibuka.
- Ukur query pada data dan lokasi Anda sendiri. D1 punya satu primary, jadi jarak Worker ke primary memengaruhi hasil.

## Rekomendasi untuk Mulai

1. **Gunakan Hono.** Framework ini ringan, ditulis dengan TypeScript, dan berjalan di Workers. RevKlik memakainya.
2. **Mulai dengan satu database bersama.** Satu D1 dengan `tenant_id` cukup untuk awal. Pindah ke database per pelanggan hanya jika kebutuhan isolasi mengharuskannya.
3. **Pakai R2 untuk cadangan.** Cadangan terenkripsi di R2 memberi Anda jalan pulih jika terjadi masalah.
4. **Tambah Cron Triggers untuk agregasi.** Hitung angka yang sering dibuka (pengunjung harian, pendapatan per sumber) secara berkala.
5. **Tangani webhook pembayaran di Worker yang sama.** Satu Worker bisa melayani event tracking dan webhook pembayaran tanpa service terpisah.

## Batasan yang Perlu Diketahui

Batas platform berubah dari waktu ke waktu, jadi rujuk dokumentasi resmi saat merencanakan: [batasan Workers](https://developers.cloudflare.com/workers/platform/limits/) dan [batasan D1](https://developers.cloudflare.com/d1/platform/limits/). Hal-hal yang selalu perlu dicek:

- **Ukuran Worker:** ada batas ukuran per Worker.
- **Waktu CPU per request:** ada batas yang berbeda untuk paket gratis dan berbayar. Query D1 yang berat bisa mendekatinya, jadi pakai agregasi awal.
- **Ukuran database D1:** ada batas per database. Rencanakan penghapusan atau pengarsipan data lama. Di RevKlik, event mentah dihapus otomatis setelah 30, 60, atau 180 hari sesuai paket.
- **Koneksi real-time:** Workers biasa tidak menyimpan state koneksi. Untuk dashboard real-time, gunakan polling atau Durable Objects.

## Kesimpulan

Workers, D1, dan R2 membentuk stack yang sederhana untuk dioperasikan satu tim kecil: satu platform untuk compute, database, penyimpanan, dan jadwal. Pelajaran terbesar kami adalah memahami penempatan (Worker dan primary D1) dan menyiapkan index sejak awal.

Untuk melihat hasilnya sebagai produk, kunjungi [demo RevKlik](https://app.revklik.com/demo). Untuk pembahasan dari sisi analytics, baca [analytics di Cloudflare Workers dan D1](/blog/cloudflare-analytics).
