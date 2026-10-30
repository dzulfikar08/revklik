---
lang: id
title: "Analitik dan UU PDP: Panduan Praktis untuk Pemilik Situs"
description: "Panduan praktis UU PDP untuk analitik web: pengendali dan prosesor, persetujuan, retensi, penghapusan data, dan lokasi data. Bukan janji kepatuhan otomatis."
ogDescription: "Pengendali dan prosesor, persetujuan, retensi, penghapusan, dan lokasi data untuk analitik situs Anda."
published: 2026-05-16
updated: 2026-10-30
readMinutes: 8
category: privacy
featured: false
related: [analytics-tanpa-cookie, revklik-vs-google-analytics, funnel-konversi]
draft: false
---

UU Nomor 27 Tahun 2022 tentang Perlindungan Data Pribadi (UU PDP) berlaku untuk pemilik situs yang memproses data pengunjung, termasuk lewat alat analitik. Tidak ada alat yang membuat Anda otomatis patuh. Kepatuhan adalah hasil dari keputusan Anda: dasar pemrosesan, pemberitahuan privasi, masa simpan, dan cara menangani permintaan hapus. Alat analitik hanya bisa memudahkan atau mempersulit keputusan itu.

Artikel ini bukan nasihat hukum. Untuk situasi yang rumit, tanyakan ke konsultan hukum.

## Siapa yang bertanggung jawab: pengendali dan prosesor

UU PDP membedakan dua peran:

- **Pengendali data** menentukan tujuan dan cara pemrosesan. Untuk data pengunjung situs Anda, itu Anda.
- **Prosesor data** memproses data atas nama pengendali. Untuk analitik yang Anda pasang, itu penyedia analitik. Untuk RevKlik, peran RevKlik adalah prosesor Anda.

Artinya kewajiban menyusun dasar hukum dan memberi tahu pengunjung ada pada Anda, bukan pada penyedia alat.

## Apakah data analitik termasuk data pribadi?

Sering kali ya. ID pengunjung yang menetap dapat menandai pengunjung yang kembali, sehingga termasuk data pribadi menurut UU PDP. Hal yang sama berlaku untuk alamat IP dan pengenal perangkat. Ini berlaku juga untuk ID yang disimpan di local storage, bukan hanya cookie.

Sebagai contoh, RevKlik memberi setiap browser sebuah ID acak di local storage pada domain Anda sendiri, dan tidak membagikannya antar situs. Server kami menyimpan alamat IP hanya dalam bentuk hash berkunci dengan salt rahasia per situs. Meski begitu, ID tersebut tetap data pribadi. RevKlik menjaga datanya seminimal mungkin, tetapi tidak membuatnya hilang.

Karena itu, jangan menulis di kebijakan privasi bahwa analitik Anda "tidak mengumpulkan data pribadi". Tulis apa yang sebenarnya disimpan.

## Persetujuan

UU PDP menuntut dasar pemrosesan yang sah. Persetujuan adalah dasar yang paling aman, dan paling mudah dibuktikan.

Rekomendasi kami:

1. Sebutkan RevKlik, ID pengunjung first-party, dan masa retensi (di bawah) dalam kebijakan privasi Anda.
2. Jika pengunjung Anda mencakup penduduk Indonesia, UE, atau Inggris, minta persetujuan sebelum tracker berjalan.
3. Selalu minta persetujuan sebelum memanggil `identify()` (nama, email, telepon), dan sebelum mengaktifkan heatmap atau rekaman sesi.

Di RevKlik, tambahkan `data-consent="required"` pada tag script, lalu panggil `klikapa.consent(true)` saat pengunjung setuju. Sebelum itu tidak ada yang disimpan dan tidak ada yang dikirim. Jika pengunjung menolak, panggil `klikapa.consent(false)`.

```html
<script defer data-site-id="your-site-id" data-consent="required"
  src="https://app.revklik.com/klikapa.js"></script>
```

```js
// Dipanggil dari tombol di banner persetujuan Anda
document.querySelector('#terima').addEventListener('click', () => klikapa.consent(true));
document.querySelector('#tolak').addEventListener('click', () => klikapa.consent(false));
```

Heatmap dan rekaman sesi nonaktif sampai Anda mengatur `window.klikapa_consent`. Tracker juga menghormati Global Privacy Control (Sec-GPC) dan Do Not Track secara bawaan.

Banner persetujuan yang asal jadi (misalnya otomatis menyetujui setelah beberapa detik) tidak membantu Anda. Jika Anda memasang banner, pastikan pilihan "tolak" benar-benar menghentikan pelacakan.

## Retensi: berapa lama data disimpan

UU PDP mengharapkan data tidak disimpan lebih lama dari yang perlu. Di RevKlik, kami menyimpan pageview, event kustom, sesi, dan profil pengunjung untuk situs Anda, ditambah negara, wilayah, dan kota dari Cloudflare, serta perangkat, browser, dan OS. Nama, email, dan nomor telepon hanya disimpan jika Anda mengirimnya lewat `identify()`.

Event mentah dihapus otomatis setelah:

| Paket | Retensi event mentah |
| --- | --- |
| Micro | 30 hari |
| Starter | 60 hari |
| Growth | 180 hari |

Angka ini dua kali jendela laporan paket, dengan minimum 30 hari. Catatan pembayaran dan pendapatan tetap disimpan sebagai catatan pembukuan sampai Anda menghapus situs atau akun. Tuliskan keduanya di kebijakan privasi Anda.

## Penghapusan data dan cadangan

Pengunjung berhak meminta data mereka dihapus. Dari menu Pengaturan, Anda bisa menghapus data satu pengunjung, satu situs, atau seluruh akun. Data aktif langsung dihapus. Catatan pembayaran milik pengunjung yang dihapus tetap disimpan tetapi dianonimkan.

Cadangan database dienkripsi (AES-256-GCM) dan 30 cadangan harian terakhir disimpan, sehingga data yang dihapus hilang dari cadangan dalam 30 hari. Jika pengunjung bertanya, itu jawaban jujurnya.

## Lokasi data

Data disimpan di infrastruktur Cloudflare (database D1, wilayah utama Asia-Pasifik), sehingga diproses di luar Indonesia. Cantumkan hal ini dalam pemberitahuan privasi Anda. Alat analitik lain juga punya lokasi penyimpanan sendiri, jadi tanyakan hal yang sama kepada penyedia mana pun yang Anda pilih.

## Sanksi

UU PDP memuat sanksi administratif dan ketentuan pidana. Sanksi administratif dapat berupa denda hingga 2% dari pendapatan tahunan (Pasal 57), selain peringatan tertulis dan penghentian pemrosesan. Baca teks undang-undangnya langsung untuk detail terbaru.

## Daftar periksa untuk situs Anda

1. Catat semua alat pelacak di situs (analitik, piksel iklan, rekaman sesi). Buka kode sumber atau pakai ekstensi pendeteksi tracker.
2. Tentukan dasar pemrosesan untuk masing-masing. Untuk pengunjung dari Indonesia, UE, atau Inggris, siapkan persetujuan.
3. Perbarui kebijakan privasi: nama alat, jenis data, ID di perangkat pengunjung, masa simpan, lokasi data, dan cara meminta penghapusan.
4. Pasang `data-consent="required"` dan sambungkan ke banner Anda.
5. Jangan memanggil `identify()` sebelum ada persetujuan.
6. Siapkan prosedur internal untuk permintaan hapus data pengunjung.

Untuk perbandingan alat dari sisi fitur dan privasi, lihat [RevKlik vs Google Analytics](/blog/revklik-vs-google-analytics). Untuk penjelasan ID first-party dan cookie pihak ketiga, baca [apa yang sebenarnya berubah tanpa cookie pihak ketiga](/blog/analytics-tanpa-cookie).
