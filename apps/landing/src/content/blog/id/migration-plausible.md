---
lang: id
title: "Migrasi dari Plausible ke RevKlik: 3 Langkah"
description: "Pindah dari Plausible ke RevKlik dalam 3 langkah: ganti script, buat ulang goal, hubungkan gateway pembayaran untuk atribusi pendapatan. Tanpa impor data lama."
ogDescription: "Pindah dari Plausible ke RevKlik: ganti script, buat ulang goal, hubungkan gateway pembayaran."
published: 2026-05-14
updated: 2026-10-30
readMinutes: 6
category: compare
featured: false
related: [migration-datafast, atribusi-pendapatan, analytics-tanpa-cookie]
draft: false
---

Plausible adalah alat analitik yang ringan dan sederhana. Plausible sendiri menyatakan tidak memakai cookie, dan kode sumbernya terbuka sehingga bisa dijalankan di server sendiri. Namun ketika bisnis berkembang, Anda mungkin butuh lebih dari pageview dan bounce rate: **berapa pendapatan yang dihasilkan tiap halaman dan tiap channel**, bagaimana pengunjung bergerak melalui funnel, dan di mana mereka berhenti.

RevKlik dibuat untuk pertanyaan itu. Tulisan ini menjelaskan cara memasangnya menggantikan Plausible. Fitur dan harga Plausible berubah dari waktu ke waktu, jadi cek dokumentasi dan halaman harga Plausible sendiri untuk perbandingan terbaru.

## 3 Langkah Migrasi

### Langkah 1: Simpan arsip data Plausible (opsional)

RevKlik tidak mengimpor data dari Plausible. Satu-satunya impor yang ada saat ini adalah dari OneDollarStats. Data lama Anda tetap berada di Plausible selama akun Anda aktif. Jika ingin menyimpan arsip, gunakan fitur ekspor data di Plausible, lalu simpan filenya sendiri. File itu tidak bisa dimuat ke RevKlik.

### Langkah 2: Ganti script Plausible

Buka kode HTML situs Anda dan cari tag script Plausible:

Sebelum (Plausible):

```html
<script defer data-domain="domainanda.com"
  src="https://plausible.io/js/script.js"></script>
```

Sesudah (RevKlik):

```html
<script defer data-site-id="YOUR-SITE-ID"
  src="https://app.revklik.com/klikapa.js"></script>
```

Hapus satu baris, tambahkan satu baris, lalu deploy. RevKlik mulai mencatat begitu ada kunjungan. Goal Plausible tidak ikut pindah. Buat ulang goal klik dengan atribut `data-revklik-goal` pada elemen yang relevan, misalnya `<button data-revklik-goal="signup">`.

### Langkah 3: Hubungkan gateway pembayaran

Di dashboard RevKlik, buka halaman **Integrations** dan hubungkan gateway yang Anda pakai: Xendit, DOKU, Mayar, Paywuz, atau Polar. Ikuti petunjuk di halaman itu (misalnya mendaftarkan endpoint webhook di dashboard gateway). Setelah terhubung, pembayaran dikaitkan dengan kunjungan yang menyebabkannya dan muncul sebagai pendapatan per sumber traffic. Atribusi pendapatan dan funnel tersedia mulai paket Starter.

## Apa yang Ditawarkan RevKlik

| | Micro | Starter | Growth |
|---|---|---|---|
| Harga per bulan | Rp 16.000 ($1) | Rp 64.000 ($4) | Rp 192.000 ($12) |
| Event per bulan | 10.000 | 100.000 | 500.000 |
| Situs | 1 | 3 | 10 |
| Jendela data dashboard | 7 hari | 30 hari | 90 hari |
| Retensi event mentah | 30 hari | 60 hari | 180 hari |
| Atribusi pendapatan dan funnel | Tidak | Ya | Ya |

Pembayaran dengan QRIS (IDR) atau kartu (USD). Growth bisa dicoba 7 hari tanpa kartu. RevKlik adalah layanan terkelola di Cloudflare (data di wilayah Asia-Pasifik), bukan perangkat lunak yang bisa Anda pasang sendiri. Ukuran script RevKlik sekitar 4 KB (gzip).

## Menjalankan Keduanya Bersamaan

Jika ingin membandingkan angka selama masa transisi, pasang script RevKlik di samping script Plausible:

```html
<!-- Plausible (sementara) -->
<script defer data-domain="domainanda.com"
  src="https://plausible.io/js/script.js"></script>

<!-- RevKlik -->
<script defer data-site-id="YOUR-SITE-ID"
  src="https://app.revklik.com/klikapa.js"></script>
```

Setelah angka RevKlik terasa masuk akal (beberapa hari), hapus script Plausible.

## Privasi

RevKlik tidak memakai cookie pihak ketiga, tidak melacak lintas situs, dan tidak membuat profil iklan. Tracker memberi tiap browser sebuah ID acak yang disimpan di penyimpanan lokal pada domain Anda (first-party, bukan cookie). ID yang menetap dapat menandai pengunjung yang kembali, sehingga termasuk data pribadi menurut UU PDP (UU 27/2022) dan GDPR. Anda sebagai pemilik situs adalah pengendali datanya, dan RevKlik adalah prosesor Anda. Sebutkan RevKlik dan masa retensi dalam kebijakan privasi, dan jika pengunjung Anda mencakup penduduk Indonesia, UE, atau Inggris, minta persetujuan sebelum tracker berjalan dengan `data-consent="required"` dan `klikapa.consent(true)`. Tracker menghormati Global Privacy Control dan Do Not Track. Baca [analitik tanpa cookie pihak ketiga](/blog/analytics-tanpa-cookie) untuk rinciannya.

## FAQ

### Apakah data historis saya hilang?

Tidak, data lama tetap di Plausible. RevKlik tidak mengimpornya, dan mulai mengumpulkan data baru sejak script terpasang.

### Berapa lama migrasinya?

Mengganti script hanya beberapa menit. Menghubungkan gateway dan membuat ulang goal bergantung pada setup Anda.

### Apakah RevKlik bisa dijalankan di server sendiri seperti Plausible?

Tidak. RevKlik adalah layanan terkelola, jadi Anda tidak perlu mengurus server, tetapi juga tidak bisa menjalankannya sendiri.
