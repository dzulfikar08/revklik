---
title: "Pasang RevKlik dalam tiga langkah"
description: "Daftar, tambah situs, tempel snippet. Panduan singkat dari nol sampai data kunjungan dan revenue mengalir ke dashboard Anda."
pubDate: 2026-09-15
tag: "Panduan"
---

Tidak perlu konfigurasi panjang untuk mulai mengukur situs Anda. Tiga
langkah, dan statistik mengalir sejak kunjungan pertama.

## 1. Buat akun

Daftar di [app.revklik.com](https://app.revklik.com) dengan email dan
password, atau lanjut dengan Google. Setiap akun baru langsung dapat
**gratis 7 hari, tanpa kartu kredit**. Setelah trial, Anda tetap bisa
melanjutkan di paket Micro yang gratis.

## 2. Tambahkan situs Anda

Dari dashboard, buka pemilih situs di header lalu pilih **Manage sites**.
Isi dua hal:

- **Name**: nama apa pun yang membuat Anda mengenali situs itu.
- **Domain**: misalnya `tokoanda.com`. Domain otomatis diubah ke huruf
  kecil, dan satu domain hanya bisa dipakai sekali.

Klik **Add site** dan situs Anda muncul di daftar dengan hitungan
pengunjung dan pageview per baris.

## 3. Tempel snippet

Klik **Snippet** di baris situs Anda. Akan muncul modal berisi skrip yang
dibuat khusus untuk domain tersebut, dengan bentuk seperti ini:

```html
<script defer data-site-id="ID-SITUS-ANDA" src="https://app.revklik.com/klikapa.js"></script>
```

Tempel ke bagian `<head>` di semua halaman yang ingin diukur, lewat
template, layout, atau tag manager Anda. Snippet unik per situs, jadi
selalu salin dari modal, bukan dari situs lain.

## Verifikasi cepat

Buka situs Anda di tab lain, klik-klik sebentar. Dalam hitungan detik,
jumlah pengunjung online muncul di header dashboard dan baris baru masuk ke
panel Live.

## Jangan lupa: kecualikan perangkat Anda sendiri

Di **Manage sites**, buka detail situs Anda:

- **Exclude this device** menghentikan tracking dari browser yang Anda
  pakai kerja, supaya kunjungan sendiri tidak mencemari data.
- **Purge my past visits** menghapus event, sesi, dan profil pengunjung
  yang sudah terekam dari perangkat Anda.

## Langkah selanjutnya

Setelah data mengalir, dua hal yang paling sering dilakukan pengguna baru:

- Hubungkan **payment provider** (Midtrans, Xendit, Stripe, Lemon Squeezy)
  atau **marketplace** (Shopee, Tokopedia) lewat menu Integrations, supaya
  panel revenue terisi.
- Tandai bagian penting halaman dengan atribut `data-section` untuk melihat
  funnel scroll otomatis: di bagian mana calon pembeli berhenti membaca.

Pertanyaan lain? Jawaban lengkapnya ada di
[dokumentasi](https://docs.revklik.com), termasuk [FAQ](https://docs.revklik.com/faq).
