---
title: "Atribusi pendapatan: channel mana yang benar-benar membawa uang"
description: "Laporan trafik tidak menjawab channel mana yang menghasilkan uang. Begini cara atribusi pendapatan bekerja, dan bagaimana kami menghitungnya di RevKlik."
pubDate: 2026-09-16
tag: "Analitik"
---

Saat menyusun anggaran bulan depan, dua channel di dashboard Anda terlihat
sama ramai. Padahal hanya satu yang mendatangkan pembeli, dan dashboard yang
hanya menghitung kunjungan tidak bisa menunjukkan yang mana. Di sinilah
atribusi pendapatan masuk: praktik menghubungkan setiap penjualan kembali ke
channel dan titik sentuh yang menghasilkannya, lalu membandingkan channel
dari uang yang dibawakan, bukan dari trafik yang dikirim.

## Apa itu atribusi pendapatan?

Contoh perjalanan yang sering terjadi. Seseorang menemukan artikel blog Anda
dari Google, membacanya, lalu pergi. Dua minggu kemudian ia klik tautan di
newsletter Anda, membuka halaman harga, dan mendaftar. Seminggu berikutnya ia
membayar. Siapa yang menutup penjualan itu: Google, newsletter, atau
keduanya yang bekerja bersama?

Tanpa atribusi, kredit biasanya jatuh ke langkah terakhir, dan anggaran
untuk konten yang memulai semuanya dipangkas lebih dulu. Itu keputusan yang
mahal, dan kejadiannya diam-diam setiap bulan.

## Mengapa laporan trafik biasa tidak menjawabnya

Analitik web standar memang jago menghitung: sesi, pageview, referrer,
perangkat, lokasi. Yang tidak dilakukannya adalah menyambung kunjungan itu
sampai terjadi transaksi. Tiga celah yang paling sering kami lihat:

- **Sesi saling terputus.** Pengunjung yang menemukan Anda lewat artikel lalu
  membeli lewat tautan newsletter tercatat sebagai dua orang yang tidak
  berhubungan. Artikelnya mendapat pageview, newsletter mendapat konversi,
  dan channel yang memulai perjalanan tidak mendapat apa-apa.
- **Bounce rate menghukum orang yang salah.** Pembaca yang menemukan jawaban
  lengkap di satu artikel lalu pergi terhitung sebagai kegagalan, padahal
  artikel itu bisa jadi alasan ia kembali dan membeli di kemudian hari.
- **Direct traffic menyembunyikan cerita.** Konversi berlabel direct biasanya
  berarti orang mengetik URL Anda dari ingatan atau membuka tautan tersimpan,
  setelah menemukan Anda di suatu tempat yang tidak tercatat. Dashboard
  menghargai langkah terakhir dan menyebutnya perjalanan utuh.

## Last-touch atau multi-touch?

Model atribusi pada dasarnya cuma aturan pembagian kredit atas satu
penjualan. Dua keluarga model yang paling umum:

- **Last-touch** memberikan seluruh kredit ke sentuhan terakhir sebelum
  pembelian. Sederhana, mudah diverifikasi, dan cocok dengan cara kebanyakan
  dashboard melaporkan data. Titik butanya: channel yang menutup penjualan
  dihargai berlebihan, sementara channel yang membuka perjalanan diabaikan.
  Branded search dan kunjungan direct terlihat hebat, artikel yang
  memperkenalkan Anda kepada pelanggan tidak mendapat apa-apa.
- **Multi-touch** membagi kredit di sepanjang perjalanan: sentuhan pertama
  untuk menemukan pelanggan, sentuhan di tengah untuk menjaga minat,
  sentuhan terakhir untuk menutup. Gambarnya lebih adil, harganya adalah
  keputusan bobot yang harus konsisten.

Tidak ada model yang "benar". Pilih satu, pegang konsisten, dan bandingkan
channel dengan aturan yang sama. Bersiap sedikit terkejut saat pertama kali
berpindah dari last-touch: channel yang diam-diam memulai sebagian besar
perjalanan hampir selalu layak mendapat anggaran lebih besar.

## Cara kami menghitung atribusi pendapatan di RevKlik

RevKlik adalah analytics revenue-first: user journey, funnel, dan atribusi
pendapatan di satu dashboard. Yang kami butuhkan agar atribusi bisa jalan:

1. **Perjalanan yang tersambung antar kunjungan.** Halaman, kampanye UTM,
   dan referrer tersambung menjadi satu jalur per pengunjung, jadi yang Anda
   analisis adalah perjalanan utuh, bukan sesi lepas.
2. **Revenue dari tiga jalur.** Konversi custom yang bisa membawa nilai,
   misalnya satu baris `klikapa.track('signup')` untuk pendaftaran; webhook
   payment provider (Midtrans, Xendit, Stripe, Lemon Squeezy); dan pesanan
   marketplace (Shopee, Tokopedia) yang masuk lewat integrasinya.
3. **Funnel untuk melihat kebocoran.** Tandai bagian penting halaman dengan
   atribut `data-section`, dan funnel scroll menunjukkan di bagian mana
   calon pembeli berhenti membaca sebelum mereka berhenti membeli.

Semua itu berjalan tanpa cookie dan tanpa menyimpan data pribadi, jadi situs
Anda bebas banner persetujuan dan tetap sesuai UU PDP. Anda melihat pola
pembelian, pengunjung tampil sebagai nama samaran yang bisa dibaca, bukan
identitas mentah.

## Mulai dari yang kecil

Anda tidak butuh tim data warehouse. Tiga langkah untuk pekan ini:

1. Tetapkan dua sampai tiga momen konversi yang penting bagi bisnis Anda:
   pendaftaran, permintaan demo, pembelian. Catat sebagai event.
2. Pasang UTM di setiap kampanye Anda sendiri dan biarkan data referrer
   menutup sisanya. Salah melabeli sumber, semua laporan di hilirnya ikut
   salah.
3. Biasakan mengevaluasi channel dari pendapatan yang dibawakan, sekali
   sebulan, dengan aturan atribusi yang sama setiap kali.

## Pertanyaan yang sering muncul

### Apakah atribusi pendapatan butuh cookie?

Tidak. Event tracking first-party dapat menyatukan pageview dan aksi
seorang pengunjung menjadi satu perjalanan tanpa cookie. RevKlik bekerja
tanpa cookie dan tidak menyimpan data pribadi, sehingga tidak ada banner
persetujuan yang perlu Anda kelola.

### Apakah last-touch attribution salah?

Tidak. Ia secara andal menunjukkan channel mana yang menutup penjualan,
informasi penting saat Anda memperbaiki halaman checkout atau harga. Yang
keliru adalah menjadikannya satu-satunya ukuran, karena channel yang
memulai perjalanan, seperti pencarian organik dan konten, jadi tak
terlihat.

### Fitur atribusi revenue ada di paket yang mana?

Panel revenue dan atribusi tersedia mulai paket Starter, Rp 64.000 per
bulan, dibayar dengan QRIS atau kartu, tanpa kontrak. Paket Micro gratis
bisa Anda pakai dulu untuk mencoba tracking tanpa risiko.

## Coba di situs Anda sendiri

Buka [app.revklik.com](https://app.revklik.com), daftar, tempel satu baris
script sebelum `</head>`, lalu hubungkan payment provider atau marketplace
Anda di menu Integrations. Setelah order pertama masuk, panel atribusi
menunjukkan channel mana yang benar-benar membawa uang. Panduan lengkapnya
ada di [docs.revklik.com](https://docs.revklik.com).
