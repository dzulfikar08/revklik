---
lang: id
title: "Migrasi dari DataFast ke RevKlik: Langkah dan Perbandingan"
description: "Panduan pindah dari DataFast ke RevKlik: ganti satu script, buat ulang goal, hubungkan gateway pembayaran. Plus tabel apa yang ditawarkan RevKlik per paket."
ogDescription: "Pindah dari DataFast ke RevKlik: ganti script, buat ulang goal, hubungkan gateway pembayaran."
published: 2026-05-14
updated: 2026-10-30
readMinutes: 6
category: compare
featured: false
related: [migration-plausible, atribusi-pendapatan, analytics-tanpa-cookie]
draft: false
---

DataFast adalah alat analitik web yang ringan dan fokus pada kecepatan. Jika Anda sedang menimbang pindah, pertanyaan yang berguna bukan "mana yang lebih cepat", tetapi **bagaimana pengunjung berinteraksi dengan situs Anda** dan **berapa pendapatan yang dihasilkan tiap channel**.

Tulisan ini menjelaskan cara memasang RevKlik menggantikan DataFast, apa yang ikut pindah dan apa yang tidak, dan apa yang RevKlik tawarkan per paket. Kami tidak membandingkan harga atau fitur DataFast baris demi baris, karena harga dan fiturnya berubah. Cek halaman harga DataFast sendiri sebelum memutuskan.

## Kapan Pindah Masuk Akal

RevKlik cocok jika Anda ingin:

- **Atribusi pendapatan** yang menghubungkan pembayaran dari gateway (Xendit, DOKU, Mayar, Paywuz, Polar) ke sumber traffic dan perjalanan pengunjung.
- **Funnel multi-langkah** dan scroll depth di satu dashboard.
- **Pembayaran langganan lokal**: Rp 16.000, Rp 64.000, atau Rp 192.000 per bulan lewat QRIS (atau kartu dalam USD).

Jika kebutuhan Anda hanya statistik pengunjung sederhana dan DataFast sudah memenuhinya, tidak ada alasan mendesak untuk pindah.

## 3 Langkah Migrasi

### Langkah 1: Dapatkan script RevKlik

Buat akun RevKlik dan tambahkan situs Anda. Dashboard memberi script unik untuk situs itu:

```html
<script defer data-site-id="YOUR-SITE-ID"
  src="https://app.revklik.com/klikapa.js"></script>
```

### Langkah 2: Ganti script DataFast

Buka kode situs Anda, hapus script DataFast, lalu pasang script RevKlik di tempat yang sama.

Sebelum (DataFast):

```html
<script defer data-website-id="YOUR-DATAFAST-ID"
  src="https://datafast.app/insights.js"></script>
```

Sesudah (RevKlik):

```html
<script defer data-site-id="YOUR-SITE-ID"
  src="https://app.revklik.com/klikapa.js"></script>
```

Deploy perubahan. Data baru mulai muncul di dashboard RevKlik begitu ada kunjungan.

### Langkah 3: Buat ulang goal dan hubungkan pembayaran

RevKlik tidak punya impor dari DataFast. Goal tidak ikut pindah, jadi buat ulang di situs Anda. Untuk goal klik, tambahkan atribut `data-revklik-goal` pada elemen yang relevan:

```html
<button data-revklik-goal="signup">Daftar</button>
```

Untuk scroll depth, pakai atribut `data-revklik-scroll`. Untuk atribusi pendapatan, buka menu **Integrations** dan hubungkan gateway yang Anda pakai. Gateway yang didukung: Xendit, DOKU, Mayar, Paywuz, dan Polar. Atribusi pendapatan dan funnel tersedia mulai paket Starter.

## Apa yang Ditawarkan RevKlik per Paket

| | Micro | Starter | Growth |
|---|---|---|---|
| Harga per bulan | Rp 16.000 ($1) | Rp 64.000 ($4) | Rp 192.000 ($12) |
| Event per bulan | 10.000 | 100.000 | 500.000 |
| Situs | 1 | 3 | 10 |
| Jendela data dashboard | 7 hari | 30 hari | 90 hari |
| Retensi event mentah | 30 hari | 60 hari | 180 hari |
| Atribusi pendapatan dan funnel | Tidak | Ya | Ya |

Pembayaran dengan QRIS (IDR) atau kartu (USD). Paket Growth bisa dicoba 7 hari tanpa kartu.

## Privasi

RevKlik tidak memakai cookie pihak ketiga, tidak melacak lintas situs, dan tidak membuat profil iklan. Tracker memberi tiap browser sebuah ID acak yang disimpan di penyimpanan lokal pada domain Anda (first-party, bukan cookie). ID yang menetap dapat menandai pengunjung yang kembali, sehingga termasuk data pribadi menurut UU PDP (UU 27/2022), dan Anda sebagai pemilik situs adalah pengendali datanya. Jika pengunjung Anda mencakup penduduk Indonesia, UE, atau Inggris, tambahkan `data-consent="required"` pada tag script dan panggil `klikapa.consent(true)` saat pengunjung setuju. Detailnya ada di [analitik tanpa cookie pihak ketiga](/blog/analytics-tanpa-cookie).

## FAQ

### Berapa lama migrasinya?

Mengganti script hanya beberapa menit. Membuat ulang goal dan menghubungkan gateway bergantung pada jumlahnya.

### Apakah data lama saya pindah?

Tidak. RevKlik tidak mengimpor data dari DataFast, jadi data lama tetap ada di DataFast dan RevKlik mulai merekam dari saat script terpasang. Satu-satunya impor yang ada saat ini adalah dari OneDollarStats.

### Bisakah menjalankan keduanya bersamaan?

Bisa. Pasang script RevKlik di samping script DataFast selama masa transisi, bandingkan angkanya beberapa hari, lalu hapus script DataFast.

### Bagaimana dengan dukungan teknis?

Dukungan lewat halaman [support](/support).
