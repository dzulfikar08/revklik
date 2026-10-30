---
lang: id
title: Dukungan
description: Jawaban cepat tentang RevKlik dan cara menghubungi tim kami lewat email.
updated: 2026-10-30
---

Cari jawabannya di bawah, atau tulis ke [support@revklik.com](mailto:support@revklik.com). Kami berusaha membalas dalam 2 hari kerja. Sertakan domain situs Anda dan, jika ada, tangkapan layar masalahnya.

## Pertanyaan umum

### Apa itu RevKlik?

Analytics yang mencocokkan pembayaran dari payment gateway Anda dengan sumber traffic pembelinya, sehingga Anda tahu channel mana yang menghasilkan uang. Script tracking-nya sekitar 4 KB (gzip).

### Bagaimana cara memasang script?

Tempel satu baris script sebelum `</head>` di situs Anda. Panduan per platform (Next.js, Astro, WordPress, Shopify, Webflow, Google Tag Manager) ada di [dokumentasi](https://docs.revklik.com/id/getting-started/).

### Data tidak muncul di dashboard. Apa yang harus saya cek?

- Ad blocker atau Content Security Policy yang memblokir `app.revklik.com`.
- Site ID di script berbeda dari situs yang Anda buka di dashboard.
- Domain situs di RevKlik tidak sama dengan domain yang dibuka pengunjung.
- Jika Anda memakai `data-consent="required"`, tidak ada data terkirim sampai `klikapa.consent(true)` dipanggil.

### Apakah saya perlu banner persetujuan?

RevKlik tidak memakai cookie pihak ketiga dan tidak melacak lintas situs, tetapi ID pengunjung yang menetap termasuk data pribadi menurut UU PDP. Jika pengunjung Anda dari Indonesia, UE, atau Inggris, kami menyarankan meminta persetujuan sebelum tracker berjalan. Detailnya ada di [Kebijakan Privasi](/privacy). Ini bukan nasihat hukum.

### Bagaimana atribusi pendapatan bekerja?

Hubungkan payment gateway Anda (Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, atau Lemon Squeezy) lewat webhook. Setiap pembayaran dikaitkan dengan perjalanan pengunjung, jadi Anda melihat sumber, kampanye, dan halaman yang menghasilkan pendapatan. Atribusi pendapatan tersedia mulai paket Starter.

### Apakah ada paket gratis?

Tidak ada paket gratis permanen. Setiap akun baru mendapat trial 7 hari dengan semua fitur Growth, tanpa kartu kredit. Setelah itu paket Micro Rp 16.000 per bulan, Starter Rp 64.000, dan Growth Rp 192.000. Pembayaran lewat QRIS atau kartu (USD).

### Bagaimana menghapus data atau akun saya?

Buka Pengaturan. Anda bisa menghapus data satu pengunjung, satu situs, atau seluruh akun. Detail masa simpan dan cadangan ada di [Kebijakan Privasi](/privacy).

## Hubungi kami

- Email: [support@revklik.com](mailto:support@revklik.com)
- Permintaan privasi: tulis "Permintaan privasi" di subjek email.
- Kode sumber dan laporan bug: [GitHub](https://github.com/dzulfikar08/revklik/issues)
