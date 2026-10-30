---
lang: id
title: "Cara Tracking Revenue dari Shopee, Tokopedia, dan Website Sendiri"
description: "Panduan tracking revenue lintas channel: Shopee, Tokopedia, dan website sendiri. Cara mengatribusikan penjualan marketplace dan menggabungkannya di satu dashboard."
published: 2026-05-16
updated: 2026-10-30
readMinutes: 8
category: revenue
featured: false
related: [atribusi-pendapatan, funnel-konversi, analytics-tanpa-cookie]
draft: true
---

Penjual Indonesia rata-rata beroperasi di **3-5 channel sekaligus**: Shopee, Tokopedia, mungkin TikTok Shop, Instagram DM, dan website sendiri. Setiap channel punya dashboard analytics masing-masing. Pertanyaannya: bisakah Anda menjawab, dalam 30 detik, channel mana yang paling menguntungkan bulan ini?

Jika jawabannya "tidak yakin", Anda tidak sendiri. Hampir semua penjual Indonesia kesulitan menggabungkan data revenue dari berbagai marketplace. Mereka tahu total omzet, tapi tidak tahu *profit per channel* setelah dikurangi biaya iklan, komisi marketplace, dan ongkos kirim.

Artikel ini membahas cara membangun sistem [atribusi revenue](/blog/atribusi-pendapatan) lintas channel yang terpusat, dari Shopee, Tokopedia, hingga website sendiri, menggunakan analytics modern.

## Kenapa Multi-Channel Itu Sulit?

Setiap marketplace adalah ekosistem tertutup. Shopee punya Shopee Ads dashboard. Tokopedia punya Tokopedia Ads dashboard. Website sendiri mungkin pakai Google Analytics. Masing-masing memberikan data yang berbeda, dengan metrik yang berbeda, dalam format yang berbeda.

Masalah utamanya:

- **Data terfragmentasi**: Revenue Shopee di dashboard Shopee, revenue Tokopedia di dashboard Tokopedia. Tidak ada tampilan terpadu.
- **Metrik tidak konsisten**: Shopee menghitung "order" berbeda dengan Tokopedia. Yang satu menghitung GMV (Gross Merchandise Value), yang lain net revenue setelah potongan.
- **Tidak ada user journey lintas channel**: Pelanggan bisa melihat produk di Tokopedia, tapi beli di Shopee karena ada voucher. Tidak ada marketplace yang melacak ini.
- **Biaya tersembunyi**: Komisi marketplace (1-8%), biaya iklan internal, ongkos kirim yang disubsidi, semuanya menggerus margin, tapi tidak selalu terlihat di dashboard revenue.

> Jika Anda tidak bisa mengukur profit per channel secara akurat, Anda mungkin sedang membuang uang di channel yang terlihat ramai tapi sebenarnya rugi.

## Masalah Analytics Built-In Marketplace

Shopee dan Tokopedia menyediakan dashboard analytics masing-masing. Tapi ada batasan serius yang sering diabaikan penjual:

### Shopee Analytics

Dashboard Shopee menunjukkan data yang hanya terjadi *di dalam Shopee*. Anda bisa melihat total penjualan, produk terlaris, dan performa iklan. Tapi:

- Tidak ada pelacakan pelanggan yang datang dari media sosial ke Shopee
- Tidak ada perbandingan langsung dengan channel lain
- Data export terbatas, tidak bisa diintegrasikan langsung ke BI tool
- Attribution window pendek, hanya mengaitkan order dengan iklan dalam 7 hari terakhir

### Tokopedia Analytics

Tokopedia memberikan insight serupa untuk ekosistem mereka. Batasannya mirip:

- Analisis terbatas pada pengunjung yang sudah bertransaksi di Tokopedia
- Tidak ada tracking dari awareness (konten TikTok/IG) hingga pembelian
- Metrik traffic dan conversion tidak bisa dibandingkan langsung dengan Shopee

Intinya: analytics marketplace berguna untuk optimasi *di dalam platform tersebut*. Tapi untuk keputusan strategis, channel mana yang harus mendapat budget lebih, Anda perlu data yang tergabung dari semua sumber.

## Cara Tracking Revenue Website Sendiri

Sebelum membahas marketplace, mari mulai dari channel yang paling bisa dikontrol: website sendiri. Tracking revenue di website Anda lebih mudah karena Anda memiliki akses penuh ke data.

Langkah-langkah dasar:

### 1. Pasang Analytics Script

Tambahkan script analytics ke setiap halaman website. Dengan RevKlik, ini satu baris:

`<script defer data-site-id="..." src="https://app.revklik.com/klikapa.js"></script>`

Script ini sekitar 4 KB (gzip) dan dimuat tanpa memblokir halaman. Setiap pageview, klik, dan navigasi tercatat otomatis.

### 2. Track Conversion Event

Setiap kali terjadi pembayaran, kirim event `purchase` ke analytics. Ini bisa dilakukan melalui:

- **Payment webhook**: Payment processor (Xendit, Midtrans, Polar) mengirim notifikasi otomatis ke RevKlik saat pembayaran berhasil
- **Custom event**: Panggil API RevKlik dari halaman "Terima Kasih" setelah checkout

Data yang perlu dikirim: jumlah pembayaran, produk, dan identifikasi pengunjung (email atau visitor ID).

### 3. Hubungkan dengan UTM

Setiap link marketing yang mengarah ke website Anda harus punya parameter UTM. Saat pengunjung mendarat, UTM disimpan di session. Saat mereka membayar, revenue otomatis dikaitkan dengan sumber traffic.

Pelajari lebih detail tentang cara menghubungkan UTM dengan revenue di panduan [atribusi revenue](/blog/atribusi-pendapatan) kami.

## Integrasi dengan Marketplace via Webhook

Bagian inilah yang paling sering ditanyakan: **bagaimana cara menghubungkan data penjualan dari Shopee dan Tokopedia ke analytics website?**

Jawabannya: **webhook API**.

### Cara Kerja Webhook Marketplace

Shopee dan Tokopedia keduanya menyediakan API yang mengirim notifikasi otomatis setiap kali ada event penting, termasuk pesanan baru, pesanan selesai, dan pembayaran diterima.

Alurnya:

1. Pelanggan melakukan pembayaran di Shopee/Tokopedia
2. Marketplace mengirim HTTP POST ke webhook URL Anda (contoh: `https://app.revklik.com/api/webhook/shopee`)
3. RevKlik menerima data: order ID, jumlah, produk, status
4. Revenue dicatat di dashboard, ditandai sebagai channel "Shopee" atau "Tokopedia"
5. Data tergabung dengan revenue dari website dan channel lainnya

**Tip Penting**

Gunakan event "pesanan selesai" (order completed), bukan "pesanan dibuat" (order placed). Banyak pesanan di marketplace yang dibatalkan atau dikembalikan. Tracking revenue pada saat order selesai memberikan angka yang lebih akurat.

### Shopee Open Platform API

Shopee menyediakan Open Platform API yang bisa diakses oleh developer. Endpoint utama untuk tracking revenue:

- `order/list`, Daftar pesanan dengan filter tanggal dan status
- `order/detail`, Detail pesanan termasuk item, jumlah, dan pembayaran
- `payment/list`, Data pembayaran yang sudah settled

Untuk setup webhook, daftarkan aplikasi di Shopee Open Platform, dapatkan API key, dan konfigurasi endpoint di dashboard RevKlik.

### Tokopedia API

Tokopedia (sekarang bagian dari GoTo) menyediakan API serupa melalui Tokopedia Developer Platform:

- `order/single`, Notifikasi per pesanan baru
- `order/batch`, Ambil batch pesanan berdasarkan rentang waktu
- `finance/account`, Data settlement dan saldo

Sama seperti Shopee, daftarkan aplikasi, dapatkan credentials, dan hubungkan ke RevKlik webhook.

## Tabel Perbandingan Tracking per Channel

| Aspek | Website Sendiri | Shopee | Tokopedia |
|---|---|---|---|
| Kontrol Data | Penuh | Terbatas (API) | Terbatas (API) |
| Tracking UTM | Ya, lengkap | Tidak tersedia | Tidak tersedia |
| User Journey | Full funnel | Hanya di-platform | Hanya di-platform |
| Revenue Tracking | Real-time via webhook | Setelah settled (1-3 hari) | Setelah settled (1-3 hari) |
| Biaya Transaksi | 0% (pembayaran langsung) | 2-8% komisi | 1-5% komisi |
| Custom Event | Ya, tak terbatas | Tidak | Tidak |
| A/B Testing | Ya | Tidak | Tidak |
| Kepemilikan Pelanggan | 100% milik Anda | Milik marketplace | Milik marketplace |

## Panduan Setup Step-by-Step

Berikut langkah-langkah praktis untuk membangun sistem tracking revenue lintas channel:

### Langkah 1: Hubungkan Website ke RevKlik

Tambahkan script RevKlik ke website Anda. Prosesnya kurang dari 2 menit. Setelah terpasang, semua traffic dan conversion tercatat otomatis.

### Langkah 2: Konfigurasi Payment Webhook

Hubungkan payment processor website Anda (Xendit, Midtrans, atau Polar) ke RevKlik. Setiap pembayaran yang berhasil langsung tercatat sebagai revenue event.

### Langkah 3: Hubungkan Shopee via API

1. Daftar di **Shopee Open Platform** (open.shopee.com)
2. Buat aplikasi dan dapatkan Partner Key + Shop ID
3. Di dashboard RevKlik, buka Integrations dan pilih "Shopee"
4. Masukkan credentials dan aktifkan webhook untuk event `order_completed`
5. Verifikasi dengan melakukan test order

### Langkah 4: Hubungkan Tokopedia via API

1. Daftar di **Tokopedia Developer** (developer.tokopedia.com)
2. Buat aplikasi dan dapatkan Client ID + Client Secret
3. Di dashboard RevKlik, buka Integrations dan pilih "Tokopedia"
4. Masukkan credentials dan aktifkan webhook
5. Verifikasi koneksi dengan test order

### Langkah 5: Lihat Dashboard Terpadu

Setelah semua channel terhubung, dashboard RevKlik menampilkan revenue dari semua sumber dalam satu tampilan. Anda bisa:

- Membandingkan revenue per channel (Shopee vs Tokopedia vs Website)
- Melihat [funnel konversi](/blog/funnel-konversi) untuk setiap channel
- Mengidentifikasi channel mana yang paling menguntungkan setelah dikurangi biaya
- Melacak tren revenue mingguan atau bulanan per channel

**Perhitungan Profit, Bukan Revenue**

Jangan hanya melihat GMV (Gross Merchandise Value). Revenue Shopee Rp 10 juta bukan berarti profit Rp 10 juta. Kurangi dengan komisi marketplace, biaya iklan internal, dan ongkos kirim. Di dashboard RevKlik, Anda bisa menambahkan **cost per channel** sehingga yang terlihat adalah profit bersih, bukan omzet kotor.

## Strategi Mengoptimalkan Multi-Channel

Dengan data revenue terpusat, Anda bisa membuat keputusan strategis:

### Allocated Budget Berdasarkan Profit

Jangan membagi budget iklan rata ke semua channel. Gunakan data atribusi untuk mengalokasikan lebih banyak ke channel dengan profit per visitor tertinggi. Contoh: jika website sendiri menghasilkan Rp 50.000 profit per visitor sementara Shopee hanya Rp 15.000, invest lebih banyak di SEO dan konten untuk website.

### Gunakan Marketplace sebagai Acquisition Channel

Marketplace sangat baik untuk menemukan pelanggan baru. Tapi marginnya tipis. Strategi yang cerdas: gunakan marketplace untuk akuisisi, lalu arahkan pelanggan loyal ke website sendiri untuk repeat purchase dengan margin lebih tinggi.

### Track Cross-Channel Behavior

Pelanggan sering melihat produk di satu channel dan beli di channel lain. Ini disebut **cross-channel attribution**. Contoh: seseorang melihat review produk di TikTok, cek harga di Shopee, tapi akhirnya beli langsung di website karena lebih murah. Tanpa sistem terpusat, Anda tidak akan pernah tahu bahwa konten TikTok itulah yang memulai journey tersebut.

## FAQ

### Bagaimana cara tracking revenue dari Shopee dan Tokopedia sekaligus?

Gunakan webhook API dari Shopee dan Tokopedia yang mengirim notifikasi otomatis setiap kali ada pesanan selesai. Hubungkan webhook ini ke platform analytics seperti RevKlik, yang akan mencatat revenue per channel secara otomatis. Data dari semua marketplace dan website sendiri bisa digabungkan dalam satu dashboard terpusat.

### Apakah analytics built-in Shopee dan Tokopedia cukup?

Tidak cukup untuk keputusan strategis lintas channel. Analytics built-in marketplace hanya menunjukkan data di dalam platform masing-masing. Anda tidak bisa membandingkan performa Shopee vs Tokopedia vs website dalam satu tampilan, tidak ada atribusi lintas channel, dan tidak ada pelacakan user journey lengkap dari awal hingga pembelian.

### Apakah perlu persetujuan pengunjung untuk tracking revenue marketplace?

Tracking lewat webhook API marketplace berjalan dari server ke server dan tidak memakai cookie browser. Untuk tracker di website Anda, RevKlik memakai ID pengunjung acak first-party di penyimpanan lokal browser dan tanpa cookie pihak ketiga. ID yang menetap termasuk data pribadi menurut UU PDP, dan Anda adalah pengendali datanya. Sebutkan RevKlik dalam kebijakan privasi Anda dan minta persetujuan sebelum tracker berjalan (`data-consent="required"`) jika pengunjung Anda mencakup penduduk Indonesia, UE, atau Inggris.

### Berapa biaya tracking revenue lintas channel dengan RevKlik?

RevKlik mulai dari **Rp 16.000/bulan** untuk 10.000 event. Sudah termasuk tracking website, integrasi webhook marketplace, atribusi revenue, dan dashboard terpusat. Jauh lebih terjangkau dibanding enterprise analytics tools yang ratusan dolar per bulan.
