---
lang: id
title: "Analytics di Cloudflare Workers dan D1: Apa yang Berubah dari Server Terpusat"
description: "Bandingkan analytics di server terpusat dengan analytics di Cloudflare Workers dan D1: cara kerjanya, biayanya, batasannya, dan konsekuensi untuk lokasi data."
ogDescription: "Apa yang berubah saat analytics berjalan di Cloudflare Workers dan D1, termasuk batasan dan lokasi data."
published: 2026-05-03
updated: 2026-10-30
readMinutes: 6
category: tech
featured: false
related: [cloudflare-workers-d1, benchmark-latensi, analytics-tanpa-cookie]
draft: false
---

Banyak tool analytics klasik menjalankan ingestion dan penyimpanan di server terpusat. Data dari pengunjung di Jakarta menempuh jarak jauh ke data center di wilayah lain, diproses, lalu hasilnya dibaca dari dashboard Anda.

Analytics yang berjalan di platform edge seperti Cloudflare Workers mengubah sebagian dari model itu. Artikel ini menjelaskan apa yang sebenarnya berubah di RevKlik, apa yang tidak berubah, dan di mana batasnya.

## Server Terpusat vs Cloudflare Workers

| Aspek | Server terpusat | Cloudflare Workers + D1 |
|---|---|---|
| Menerima request | Server di satu atau beberapa region | Worker di jaringan Cloudflare, dijalankan dekat database lewat smart placement |
| Skala | Anda mengatur kapasitas server | Platform menskalakan Worker otomatis |
| Biaya | Server berjalan walau traffic sepi | Tagihan mengikuti pemakaian (lihat halaman harga Cloudflare) |
| Titik gagal tunggal | Ya, jika hanya satu server | Dikelola platform, tapi database D1 punya satu primary |
| Ukuran script | Tergantung tool | RevKlik: sekitar 4 KB (gzip) |

Kami tidak mencantumkan angka latensi atau biaya per juta event di tabel ini karena kami belum mempublikasikan cara pengukurannya. Untuk melihat cara mengukur sendiri, baca [seberapa berat script analytics](/blog/benchmark-latensi).

## Bagaimana RevKlik Berjalan di Cloudflare?

Ada tiga komponen utama.

### 1. Worker untuk ingestion

Saat pengunjung memuat halaman Anda, tracker mengirim event ke Worker RevKlik lewat `fetch()` dengan `keepalive: true`. Worker memvalidasi event lalu menyimpannya.

Satu catatan penting: konfigurasi kami memakai smart placement, sehingga Worker dijalankan di dekat primary D1 (Asia-Pasifik), bukan selalu di lokasi terdekat pengunjung. Alasannya, setiap query berurutan ke database akan lambat jika Worker berada jauh dari database. Jadi tidak semua request "diproses di server terdekat dengan pengunjung".

### 2. D1 untuk penyimpanan

Cloudflare D1 adalah database SQLite yang dikelola Cloudflare. Untuk analytics, cocoknya jelas: setiap event menjadi baris yang di-INSERT, dan dashboard membaca ringkasan dengan query SQL (pengunjung, sumber traffic, funnel, journey). Batas ukuran dan jumlah operasi D1 mengikuti dokumentasi Cloudflare yang bisa berubah, jadi cek [batasan D1](https://developers.cloudflare.com/d1/platform/limits/) sebelum merencanakan volume besar.

### 3. R2 untuk cadangan

Kami memakai Cloudflare R2 untuk cadangan database. Cadangan dienkripsi (AES-256-GCM) dan 30 cadangan harian terakhir disimpan. R2 tidak kami pakai untuk mengarsipkan event mentah.

## Soal Biaya

Model Workers dan D1 menagih berdasarkan pemakaian, dengan paket gratis dan paket berbayar. Karena tarifnya berubah, kami tidak mencantumkan angka dolar di sini. Lihat [harga Workers](https://developers.cloudflare.com/workers/platform/pricing/) dan [harga D1](https://developers.cloudflare.com/d1/platform/pricing/) untuk angka terkini, lalu hitung sendiri dengan volume event Anda.

Satu hal yang bisa kami katakan dari pengalaman membangun RevKlik: biaya infrastruktur yang mengikuti pemakaian memudahkan produk kecil memulai tanpa menyewa server tetap. Itu bukan jaminan biaya akan rendah di volume Anda.

## Kenapa Pengiriman Event Penting untuk Akurasi?

Pengiriman event memengaruhi dua hal: kecepatan situs dan kelengkapan data.

**Kecepatan situs:** script yang memblokir render atau menahan thread utama memperlambat halaman, terutama di koneksi mobile. Tracker RevKlik dimuat dengan `defer` dan mengirim data di belakang layar.

**Kelengkapan data:** pengunjung yang menutup tab sebelum request selesai bisa membuat event hilang. Opsi `keepalive: true` pada `fetch()` membantu request tetap selesai setelah halaman ditutup, tapi tidak ada tool analytics yang menjamin semua event masuk. Pemblokir iklan, pengunjung yang menolak persetujuan, dan sinyal Do Not Track juga memengaruhi jumlah data.

## Bagaimana dengan Lokasi Data?

Data RevKlik disimpan di infrastruktur Cloudflare (database D1, wilayah utama Asia-Pasifik), sehingga diproses di luar Indonesia. Ini penting untuk pemberitahuan privasi Anda:

- Sebagai pemilik situs, Anda adalah pengendali data dan RevKlik adalah prosesor Anda.
- Menurut UU PDP (UU 27/2022), ID pengunjung yang menetap termasuk data pribadi, jadi cantumkan RevKlik, ID pengunjung first-party, masa retensi, dan lokasi pemrosesan di kebijakan privasi Anda.
- Event mentah dihapus otomatis setelah 30 hari (Micro), 60 hari (Starter), atau 180 hari (Growth). Anda juga bisa menghapus data satu pengunjung, satu situs, atau akun dari Pengaturan.

Edge hosting tidak menggantikan dasar pemrosesan yang sah dan persetujuan pengunjung. Panduan persetujuan ada di [analytics tanpa cookie pihak ketiga](/blog/analytics-tanpa-cookie). Ini bukan nasihat hukum.

## Kapan Pendekatan Ini Kurang Tepat?

Beberapa batasan yang perlu Anda ketahui:

- **Query berat atas puluhan juta baris:** D1 cocok untuk query per situs, tapi analisis yang memindai volume sangat besar lebih pas di data warehouse khusus.
- **Machine learning real-time:** jika setiap event harus diproses model besar, batas CPU dan memori Worker bisa menjadi kendala.
- **Menggabungkan sumber data lain:** menyatukan data analytics dengan CRM atau data warehouse eksternal memerlukan pipeline ETL terpisah.

## RevKlik di Cloudflare

RevKlik dibangun di Cloudflare Workers dan D1, dengan R2 untuk cadangan. Tracker berukuran sekitar 4 KB (gzip), dan penjelasan teknis lebih rinci ada di [membangun SaaS dengan Cloudflare Workers dan D1](/blog/cloudflare-workers-d1).
