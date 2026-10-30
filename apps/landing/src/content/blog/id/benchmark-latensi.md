---
lang: id
title: "Seberapa Berat Script Analytics? Cara Mengukur Dampaknya ke Kecepatan Situs"
description: "Script analytics ikut menentukan kecepatan situs Anda. Pelajari yang perlu diperiksa dan cara mengukur sendiri ukuran serta dampak script analytics."
ogDescription: "Cara mengukur sendiri dampak script analytics ke kecepatan situs, dengan perintah yang bisa Anda jalankan."
published: 2026-05-14
updated: 2026-10-30
readMinutes: 5
category: tech
featured: false
related: [cloudflare-analytics, analytics-tanpa-cookie, cloudflare-workers-d1]
draft: false
---

Script analytics yang berat atau memblokir render memperlambat website Anda, dan itu bisa memengaruhi bounce rate, SEO, dan konversi. Versi lama artikel ini memuat tombol benchmark dan angka perbandingan RevKlik, GA4, dan Plausible. Kami menghapusnya karena angka perbandingannya tidak bisa Anda ulang dan kami tidak mendokumentasikan cara pengukurannya. Artikel ini menggantinya dengan hal yang bisa Anda periksa sendiri.

## Kenapa Script Analytics Memengaruhi Kecepatan?

Google memakai [Core Web Vitals](https://web.dev/vitals/) sebagai sinyal pengalaman halaman. Script pihak ketiga yang berat paling sering memengaruhi dua metrik:

- **Largest Contentful Paint (LCP):** script yang memblokir render menunda elemen terbesar di layar.
- **Interaction to Next Paint (INP):** JavaScript yang berjalan lama di main thread memperlambat respons terhadap klik dan ketukan.

Karena itu, tiga hal layak diperiksa pada setiap tool analytics: ukuran script, apakah script dimuat tanpa memblokir render, dan bagaimana data dikirim.

## Yang Kami Ketahui tentang Script RevKlik

Dua fakta ini berasal dari kode tracker di repositori kami:

- **Ukuran:** `klikapa.js` berukuran sekitar 4 KB setelah kompresi gzip (sekitar 4,3 KB pada build yang kami periksa).
- **Cara kirim data:** event dikirim lewat `fetch()` dengan opsi `keepalive: true`, sehingga request tetap selesai walau pengunjung berpindah halaman dan tidak menunggu respons server untuk melanjutkan.

Script dipasang dengan atribut `defer`, sehingga tidak menahan parsing HTML:

```html
<script defer data-site-id="your-site-id" src="https://app.revklik.com/klikapa.js"></script>
```

Kami sengaja tidak mencantumkan ukuran atau latensi script GA4 dan Plausible. Ukuran dan perilaku keduanya berubah seiring versi, jadi angka yang kami tulis hari ini bisa salah bulan depan. Ukur sendiri dengan cara di bawah.

## Cara Mengukur Sendiri

### 1. Ukuran script setelah gzip

Jalankan di terminal, ganti URL dengan script yang ingin Anda periksa:

```bash
curl -s https://app.revklik.com/klikapa.js | gzip -c | wc -c
```

Hasilnya jumlah byte setelah gzip. Perintah yang sama berlaku untuk script analytics lain, sehingga Anda membandingkan ukuran dengan metode yang sama.

### 2. Dampak ke waktu muat halaman

Buka situs Anda di Chrome, lalu:

1. Buka DevTools, tab **Network**, centang **Disable cache**, dan pilih throttling jaringan yang mewakili pengunjung Anda.
2. Muat halaman dengan script analytics, lalu muat lagi tanpa script itu.
3. Bandingkan LCP di tab **Performance** atau di Lighthouse. Ulangi beberapa kali dan ambil median, karena satu pengukuran saja gampang menyesatkan.

### 3. Apakah script memblokir render

Di tab **Network**, lihat kolom **Priority** dan waterfall. Script yang dimuat dengan `async` atau `defer` tidak menahan parsing HTML. Script sinkron di `<head>` menahannya. Lighthouse juga menandai sumber daya yang memblokir render.

### 4. Latensi pengiriman data

Request pengiriman event berjalan di belakang layar, jadi waktunya tidak langsung terlihat oleh pengunjung. Anda tetap bisa melihatnya di tab **Network** dengan memfilter nama endpoint tracking, lalu membandingkan kolom **Time**. Hasil bergantung pada lokasi, ISP, dan kondisi jaringan Anda, jadi jangan menyimpulkan dari satu kali coba.

## Soal Latensi di Sisi Server

RevKlik berjalan di Cloudflare Workers dengan database D1. Konfigurasi kami memakai smart placement, yaitu Worker dijalankan di dekat primary D1 di Asia-Pasifik, bukan di lokasi terdekat pengunjung, supaya query ke database tidak menempuh jarak jauh. Artinya "diproses di server terdekat dengan pengunjung" tidak tepat untuk semua request, dan kami tidak mengklaim angka latensi tertentu. Detail arsitekturnya ada di [analytics edge-native](/blog/cloudflare-analytics) dan [membangun SaaS dengan Workers dan D1](/blog/cloudflare-workers-d1).

## Ringkasan

- Periksa ukuran gzip, atribut `defer` atau `async`, dan cara pengiriman data pada setiap tool analytics.
- Ukur dampaknya di situs Anda sendiri, dengan perangkat dan jaringan yang mewakili pengunjung Anda.
- Percayalah pada angka yang bisa Anda ulang, termasuk angka dari kami. Untuk RevKlik, angka yang kami tahu pasti adalah ukuran script sekitar 4 KB (gzip).

Bagian privasi tracker (ID pengunjung first-party, retensi, dan persetujuan) dibahas di [analytics tanpa cookie pihak ketiga](/blog/analytics-tanpa-cookie).
