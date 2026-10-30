---
lang: id
title: "Cara Membuat Funnel Konversi yang Benar untuk Bisnis Online Indonesia"
description: "Panduan membangun funnel konversi: tentukan tujuan, petakan langkah, cari titik pengunjung berhenti, dan baca funnel scroll RevKlik berdasarkan data-section."
ogDescription: "Cara menentukan langkah funnel, mencari titik pengunjung berhenti, dan membaca funnel scroll RevKlik."
published: 2026-05-08
updated: 2026-10-30
readMinutes: 7
category: guide
featured: false
related: [analytics-untuk-umkm, atribusi-pendapatan, cloudflare-workers-d1]
draft: false
---

Kebanyakan pemilik bisnis online tahu conversion rate mereka. Tapi sedikit yang tahu **di langkah mana** pengunjung memutuskan pergi. Funnel konversi menjawab pertanyaan itu, dan jawabannya sering tidak seperti dugaan.

Panduan ini membahas cara berpikir tentang funnel: menentukan langkah yang tepat, melihat di mana pengunjung berhenti, dan memperbaiki titik terlemah. Di tengah artikel kami jelaskan apa yang dilakukan panel funnel RevKlik dan apa yang tidak.

## Apa Itu Funnel Konversi?

Funnel konversi adalah gambaran perjalanan pengunjung dari awal sampai tujuan tertentu, seperti mendaftar, berlangganan, atau membeli. Setiap tahap adalah satu langkah dalam perjalanan itu, dan setiap tahap kehilangan sebagian pengunjung.

Contoh rekaan untuk funnel SaaS sederhana (angkanya ilustrasi, bukan data nyata):

| Tahap | Jumlah | Dropout dari tahap sebelumnya |
|---|---|---|
| Mengunjungi landing page | 10.000 | n/a |
| Mengklik tombol daftar | 2.500 | 75% |
| Mengisi form signup | 1.200 | 52% |
| Menyelesaikan onboarding | 600 | 50% |
| Berlangganan berbayar | 120 | 80% |

Dari 10.000 pengunjung, 120 berlangganan, jadi conversion rate keseluruhan 1,2%. Angka itu sendiri tidak memberi tahu apa yang perlu diperbaiki. **Yang membantu adalah melihat bahwa 75% pengunjung tidak mengklik tombol daftar.** Itulah bottleneck terbesar dalam contoh ini.

## Langkah 1: Tentukan Tujuan Funnel Anda

Sebelum membuat funnel, jawab dulu: **aksi apa yang paling berharga bagi bisnis Anda?**

Beberapa contoh:

- **Signup:** pengunjung membuat akun.
- **Aktivasi:** pengguna menyelesaikan setup pertama, misalnya membuat proyek atau menghubungkan data.
- **Konversi berbayar:** pengguna upgrade ke paket berbayar.
- **Pembelian:** pengunjung menyelesaikan checkout untuk produk tertentu.

Setiap tujuan butuh funnel sendiri. Jangan membuat satu funnel untuk semuanya.

## Langkah 2: Petakan Setiap Langkah

Tulis setiap langkah yang dilalui pengunjung dari awal sampai tujuan, dan buat spesifik. "Mengunjungi website" terlalu umum. "Membuka halaman harga dari iklan Google" jauh lebih berguna.

Contoh funnel signup untuk SaaS:

1. Mendarat di homepage (dari Google Ads, UTM: `utm_source=google`)
2. Mengklik "Lihat Harga"
3. Membuka halaman harga
4. Mengklik tombol daftar di salah satu paket
5. Mengisi email dan password
6. Memverifikasi email
7. Menyelesaikan onboarding

Tiap langkah sebaiknya bisa dilacak sebagai kejadian terpisah, entah sebagai pageview, klik, atau event kustom.

## Langkah 3: Ukur Setiap Tahap

Pageview saja tidak cukup. Pageview tidak memberi tahu apakah pengunjung benar-benar berinteraksi dengan halaman atau langsung menutupnya.

Ada tiga cara RevKlik menangkap interaksi:

- **Event kustom:** kirim dari kode Anda dengan satu baris.

  ```js
  klikapa.track('signup_started', { plan: 'starter' });
  ```

- **Konversi dengan nilai:** `klikapa.conversion('checkout', 150000)` mencatat konversi beserta pendapatannya.
- **Penanda tujuan di HTML:** atribut `data-revklik-goal` pada tombol atau tautan mencatat tujuan saat diklik.

Event kustom muncul pada profil dan timeline tiap pengunjung di dashboard, jadi Anda bisa menelusuri langkah mana yang dilalui atau dilewati satu orang.

## Apa yang Dilakukan Panel Funnel RevKlik

Panel **funnel scroll** di dashboard bekerja dari penanda bagian halaman, bukan dari langkah yang Anda susun manual. Tambahkan `data-section` ke bagian halaman Anda:

```html
<section data-section="hero">...</section>
<section data-section="features">...</section>
<section data-section="pricing">...</section>
<section data-section="signup">...</section>
```

Tracker mencatat bagian mana yang dibaca pengunjung. Panel menampilkan berapa pengunjung yang mencapai tiap bagian, persentase yang berhenti di antara dua bagian, dan conversion rate keseluruhan (porsi pengunjung yang mencapai bagian terakhir). Jika situs Anda punya beberapa halaman, tersedia tab per halaman. Funnel dihitung dari event pageview dan `scroll_section`, tersedia mulai paket Starter, dan mengikuti jendela data 7, 30, atau 90 hari. Detailnya ada di [dokumentasi funnel](https://docs.revklik.com/id/dashboard/funnels/).

Batasannya perlu diketahui: panel ini menunjukkan seberapa jauh pengunjung membaca halaman Anda, bukan funnel multi-halaman dengan langkah yang Anda tentukan sendiri. Untuk funnel seperti pada contoh signup di atas, gunakan event kustom dan timeline pengunjung, atau hitung sendiri dari data Anda.

## Langkah 4: Temukan Bottleneck

Bottleneck adalah tahap dengan **dropout tertinggi**, yaitu tempat porsi pengunjung yang melanjutkan paling kecil.

Tidak ada angka dropout yang otomatis berarti "bagus" atau "buruk", karena hasilnya bergantung pada jenis bisnis dan sumber traffic. Bandingkan antartahap dalam funnel Anda sendiri dan bandingkan funnel Anda dari minggu ke minggu.

Jangan mengoptimasi semua tahap sekaligus. Mulai dari bottleneck terbesar. Memperbaiki tahap yang sudah hampir semua pengunjung lewati hasilnya kecil.

## Langkah 5: Optimasi Berdasarkan Data

Setelah menemukan bottleneck, buat hipotesis tentang kenapa pengunjung berhenti, lalu uji perbaikannya satu per satu.

Contoh hipotesis dan perbaikan:

| Bottleneck | Kemungkinan penyebab | Perbaikan yang bisa diuji |
|---|---|---|
| Banyak yang tidak menekan tombol daftar di homepage | Headline kurang relevan | Uji headline yang lebih spesifik |
| Banyak berhenti di form signup | Terlalu banyak kolom | Kurangi kolom, tunda info tambahan |
| Banyak yang tidak menyelesaikan onboarding | Terlalu banyak langkah | Persingkat langkahnya |
| Banyak yang tidak upgrade berbayar | Nilai produk belum terlihat saat trial | Tampilkan fitur lanjutan lebih awal |

## Funnel vs User Journey: Apa Bedanya?

**Funnel** adalah jalur yang Anda harapkan diikuti pengunjung: linear menuju konversi. **User journey** adalah jalur yang sebenarnya, termasuk belokan, halaman yang dikunjungi berulang kali, dan jalan buntu.

Keduanya penting. Funnel memberi tahu di mana masalahnya, journey membantu menebak kenapa, karena Anda bisa melihat apa yang dilakukan pengunjung sebelum dan sesudah titik itu.

Misalnya, jika banyak pengunjung berhenti di halaman harga, lihat journey mereka. Apakah mereka kembali ke homepage? Membuka halaman fitur dulu? Langsung pergi? Konteks ini tidak ada di funnel saja.

## Kesalahan Umum dalam Membangun Funnel

1. **Terlalu banyak langkah.** Funnel dengan 15 tahap sulit dibaca dan ditindaklanjuti. Mulailah dengan sedikit langkah utama.
2. **Tidak melacak event kustom.** Klik tombol dan submit form perlu dilacak terpisah dari pageview.
3. **Mengabaikan sumber traffic.** Pengunjung dari iklan, media sosial, dan email berperilaku berbeda. Segmentasikan funnel berdasarkan sumber.
4. **Mengoptimasi tahap yang salah.** Memperbaiki tahap yang hampir semua pengunjung lewati hasilnya kecil. Fokus pada bottleneck.
5. **Tidak mengukur dari waktu ke waktu.** Pantau funnel mingguan atau bulanan. Perubahan dropout bisa menandakan masalah teknis atau pergeseran pasar.

## Menghubungkan Funnel dengan Pendapatan

Funnel menunjukkan di mana pengunjung berhenti. Untuk mengetahui channel mana yang akhirnya menghasilkan penjualan, hubungkan dengan [atribusi pendapatan](/blog/atribusi-pendapatan). Jika Anda memakai Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, atau Lemon Squeezy, RevKlik bisa mengaitkan pembayaran dengan kunjungan yang menyebabkannya.

Jika Anda baru mulai, [analytics untuk UMKM](/blog/analytics-untuk-umkm) menjelaskan metrik dasar yang perlu dipantau lebih dulu. Bila ingin melihat tampilannya, buka [demo produk](https://app.revklik.com/demo).
