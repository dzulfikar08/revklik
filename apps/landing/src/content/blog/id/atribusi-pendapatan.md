---
lang: id
title: "Atribusi Pendapatan: Channel Mana yang Benar-benar Membawa Uang"
description: "Laporan trafik tidak menjawab channel mana yang menghasilkan uang. Begini cara atribusi pendapatan bekerja, dan bagaimana kami menghitungnya di RevKlik."
ogDescription: "Bandingkan channel dari uang yang dibawakan, bukan dari trafik yang dikirim."
published: 2026-09-16
updated: 2026-10-30
readMinutes: 7
category: revenue
featured: true
related: [atribusi-revenue, funnel-konversi, revklik-vs-google-analytics]
draft: false
---

Saat menyusun anggaran bulan depan, dua channel di dashboard Anda terlihat sama ramai. Padahal hanya satu yang mendatangkan pembeli, dan dashboard yang hanya menghitung kunjungan tidak bisa menunjukkan yang mana. Di sinilah atribusi pendapatan masuk: praktik menghubungkan setiap penjualan kembali ke channel dan titik sentuh yang menghasilkannya, lalu membandingkan channel dari uang yang dibawakan, bukan dari trafik yang dikirim.

## Apa Itu Atribusi Pendapatan?

Contoh perjalanan yang sering terjadi. Seseorang menemukan artikel blog Anda dari Google, membacanya, lalu pergi. Dua minggu kemudian ia klik tautan di newsletter Anda, membuka halaman harga, dan mendaftar. Seminggu berikutnya ia membayar. Siapa yang menutup penjualan itu: Google, newsletter, atau keduanya yang bekerja bersama?

Tanpa atribusi, kredit biasanya jatuh ke langkah terakhir, dan anggaran untuk konten yang memulai semuanya dipangkas lebih dulu. Itu keputusan yang mahal, dan kejadiannya diam-diam setiap bulan.

## Mengapa Laporan Trafik Biasa Tidak Menjawabnya

Analitik web standar memang jago menghitung: sesi, pageview, referrer, perangkat, lokasi. Yang tidak dilakukannya adalah menyambung kunjungan itu sampai terjadi transaksi. Tiga celah yang paling sering kami lihat:

- **Sesi saling terputus.** Pengunjung yang menemukan Anda lewat artikel lalu membeli lewat tautan newsletter tercatat sebagai dua orang yang tidak berhubungan. Artikelnya mendapat pageview, newsletter mendapat konversi, dan channel yang memulai perjalanan tidak mendapat apa-apa.
- **Bounce rate menghukum orang yang salah.** Pembaca yang menemukan jawaban lengkap di satu artikel lalu pergi terhitung sebagai kegagalan, padahal artikel itu bisa jadi alasan ia kembali dan membeli di kemudian hari.
- **Direct traffic menyembunyikan cerita.** Konversi berlabel direct biasanya berarti orang mengetik URL Anda dari ingatan atau membuka tautan tersimpan, setelah menemukan Anda di suatu tempat yang tidak tercatat. Dashboard menghargai langkah terakhir dan menyebutnya perjalanan utuh.

## Last-Touch atau Multi-Touch?

Model atribusi pada dasarnya cuma aturan pembagian kredit atas satu penjualan. Dua keluarga model yang paling umum:

- **Last-touch** memberikan seluruh kredit ke sentuhan terakhir sebelum pembelian. Sederhana, mudah diverifikasi, dan cocok dengan cara kebanyakan dashboard melaporkan data. Titik butanya: channel yang menutup penjualan dihargai berlebihan, sementara channel yang membuka perjalanan diabaikan. Branded search dan kunjungan direct terlihat hebat, artikel yang memperkenalkan Anda kepada pelanggan tidak mendapat apa-apa.
- **Multi-touch** membagi kredit di sepanjang perjalanan: sentuhan pertama untuk menemukan pelanggan, sentuhan di tengah untuk menjaga minat, sentuhan terakhir untuk menutup. Gambarnya lebih adil, harganya adalah keputusan bobot yang harus konsisten.

Tidak ada model yang benar. Pilih satu, pegang konsisten, dan bandingkan channel dengan aturan yang sama. Bersiap sedikit terkejut saat pertama kali berpindah dari last-touch: channel yang diam-diam memulai sebagian besar perjalanan sering kali layak mendapat anggaran lebih besar.

## Cara Kami Menghitung Atribusi Pendapatan di RevKlik

RevKlik menggabungkan user journey, funnel, dan atribusi pendapatan di satu dashboard. Yang dibutuhkan agar atribusi bisa jalan:

1. **Perjalanan yang tersambung antar kunjungan.** Halaman, kampanye UTM, dan referrer tersambung menjadi satu jalur per browser, jadi yang Anda analisis adalah perjalanan utuh, bukan sesi lepas. Penyambungnya adalah ID acak first-party di local storage browser, yang juga membuat penjualan bisa dikaitkan dengan kunjungan yang menyebabkannya, bahkan beberapa hari kemudian.
2. **Pendapatan dari dua jalur.** Pertama, konversi kustom yang bisa membawa nilai: satu baris `klikapa.track('signup')` dari browser, atau event yang dikirim dari server Anda lewat API event. Kedua, webhook dari payment gateway yang didukung: Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, dan Lemon Squeezy.
3. **Funnel untuk melihat kebocoran.** Tandai bagian penting halaman dengan atribut `data-section`, dan funnel scroll menunjukkan di bagian mana calon pembeli berhenti membaca sebelum mereka berhenti membeli.

Soal privasi: RevKlik tidak memakai cookie pihak ketiga, tidak melacak lintas situs, dan tidak membuat profil iklan. Tetapi ID yang menetap tadi termasuk data pribadi menurut UU PDP, dan Anda sebagai pemilik situs adalah pengendali datanya. Panduannya ada di [analitik dan UU PDP](/blog/analytics-patuh-uu-pdp) dan [apa yang sebenarnya berubah tanpa cookie pihak ketiga](/blog/analytics-tanpa-cookie).

## Mulai dari yang Kecil

Anda tidak butuh tim data warehouse. Tiga langkah untuk pekan ini:

1. Tetapkan dua sampai tiga momen konversi yang penting bagi bisnis Anda: pendaftaran, permintaan demo, pembelian. Catat sebagai event.
2. Pasang UTM di setiap kampanye Anda sendiri dan biarkan data referrer menutup sisanya. Salah melabeli sumber, semua laporan di hilirnya ikut salah.
3. Biasakan mengevaluasi channel dari pendapatan yang dibawakan, sekali sebulan, dengan aturan atribusi yang sama setiap kali.

## Pertanyaan yang Sering Muncul

### Apakah atribusi pendapatan butuh cookie?

Tidak butuh cookie pihak ketiga. RevKlik menyimpan ID acak di local storage pada domain Anda sendiri (first-party, bukan cookie) untuk menyatukan pageview dan aksi seorang pengunjung menjadi satu perjalanan. ID itu tetap data pribadi, jadi minta persetujuan jika pengunjung Anda mencakup penduduk Indonesia, UE, atau Inggris.

### Apakah last-touch attribution salah?

Tidak. Ia secara andal menunjukkan channel mana yang menutup penjualan, informasi penting saat Anda memperbaiki halaman checkout atau harga. Yang keliru adalah menjadikannya satu-satunya ukuran, karena channel yang memulai perjalanan, seperti pencarian organik dan konten, jadi tak terlihat.

### Fitur atribusi revenue ada di paket yang mana?

Panel revenue dan atribusi tersedia mulai paket Starter, Rp 64.000 per bulan, dibayar dengan QRIS (IDR) atau kartu (USD). Akun baru mendapat trial 7 hari Growth tanpa kartu kredit, termasuk panel revenue.
