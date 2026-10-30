---
lang: id
title: "Atribusi Revenue: Cara Mengetahui dari Mana Uang Anda Datang"
description: "Banyak founder tidak tahu channel mana yang benar-benar menghasilkan uang. Cara membangun sistem atribusi revenue sederhana dengan UTM dan webhook pembayaran."
ogDescription: "Bangun atribusi revenue sederhana dengan UTM yang konsisten dan webhook pembayaran."
published: 2026-04-28
updated: 2026-10-30
readMinutes: 8
category: revenue
featured: false
related: [atribusi-pendapatan, funnel-konversi, analytics-tanpa-cookie]
draft: false
---

Pertanyaan paling mendasar dalam bisnis: **dari mana uang kita datang?** Jawaban "dari pelanggan" tidak cukup. Yang perlu Anda ketahui adalah channel marketing mana, kampanye apa, dan halaman mana yang menghasilkan revenue sesungguhnya.

Banyak founder SaaS tidak tahu jawaban ini dengan pasti. Mereka mungkin tahu conversion rate keseluruhan, tapi tidak bisa mengatakan "30% revenue bulan ini berasal dari iklan Google untuk kata kunci X." Tanpa atribusi revenue, Anda bisa membuang uang ke channel yang tidak bekerja dan kurang berinvestasi di channel yang sebenarnya menghasilkan.

## Apa Itu Atribusi Revenue?

Atribusi revenue adalah proses menghubungkan setiap rupiah (atau dolar) revenue dengan sumber asalnya: iklan tertentu, kampanye email, post media sosial, atau halaman organik. Ia menjawab: "Jika saya berhenti mengeluarkan uang di channel X, berapa revenue yang hilang?"

Tanpa atribusi, keputusan budget berdasarkan perkiraan. Dengan atribusi, keputusan berdasarkan data. Untuk pembahasan yang lebih konseptual, baca juga [atribusi pendapatan: channel mana yang benar-benar membawa uang](/blog/atribusi-pendapatan).

## Model Atribusi: Mana yang Tepat?

Ada beberapa model atribusi yang bisa digunakan. Yang paling umum:

| Model | Cara kerja | Kapan digunakan |
| --- | --- | --- |
| First-touch | Semua kredit ke interaksi pertama | Mengukur kesadaran brand (awareness) |
| Last-touch | Semua kredit ke interaksi terakhir | Mengukur konversi langsung |
| Linear | Kredit dibagi rata ke semua touchpoint | Gambaran umum, sederhana |
| Time-decay | Semakin dekat dengan konversi, kredit makin besar | Siklus penjualan panjang |

Untuk sebagian besar SaaS, **last-touch dengan konteks UTM** adalah titik awal yang paling praktis. Ia memberi tahu Anda halaman atau kampanye apa yang langsung mengarah ke pembayaran. Setelah ini bekerja, Anda bisa menambah first-touch dan time-decay untuk gambaran yang lebih lengkap.

## Cara Membangun Sistem Atribusi Sederhana

Anda tidak perlu tool mahal untuk mulai. Yang Anda butuhkan:

### 1. Tracking UTM yang Konsisten

Setiap link yang mengarah ke situs Anda harus memiliki parameter UTM. Minimal: `utm_source`, `utm_medium`, `utm_campaign`.

Contoh:

- Iklan Google: `?utm_source=google&utm_medium=cpc&utm_campaign=analytics-saas`
- Twitter: `?utm_source=twitter&utm_medium=social&utm_campaign=launch-announcement`
- Email newsletter: `?utm_source=newsletter&utm_medium=email&utm_campaign=weekly-digest`

Simpan parameter UTM ini segera saat pengunjung mendarat. Jangan hanya melacaknya di pageview pertama: simpan supaya ketika mereka convert 3 hari kemudian, UTM masih tercatat.

### 2. Hubungkan dengan Payment Webhook

Ini langkah yang paling sering terlewat. Anda tidak bisa mengatribusikan revenue hanya dari analytics halaman. Anda perlu tahu **kapan dan berapa** pembayaran terjadi.

Cara termudah: hubungkan webhook dari payment gateway Anda ke sistem analytics. RevKlik mendukung Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, dan Lemon Squeezy. Setiap kali pembayaran berhasil, webhook mengirim jumlah dan produknya ke analytics.

Kalau penjualan Anda tidak lewat salah satu gateway itu, kirim sendiri sebagai konversi kustom: `klikapa.track` dari browser, atau event dari server Anda lewat API event, dengan nilai transaksi.

Di sisi analytics, pembayaran itu dikaitkan dengan kunjungan yang menyebabkannya. Sekarang setiap rupiah bisa ditelusuri kembali ke UTM sumbernya.

### 3. Buat Laporan Sederhana

Dengan data UTM dan pembayaran yang terhubung, Anda bisa membuat laporan seperti ini. Angkanya rekaan, hanya untuk ilustrasi:

| Sumber | Visitors | Revenue | Conv. rate | Rev/visitor |
| --- | --- | --- | --- | --- |
| Google Ads | 3.200 | $1.840 | 2,1% | $0,58 |
| Twitter organik | 5.100 | $890 | 0,8% | $0,17 |
| Email newsletter | 1.400 | $2.200 | 5,2% | $1,57 |
| Direct/none | 2.800 | $1.100 | 1,5% | $0,39 |

Dari contoh ini terlihat: newsletter menghasilkan revenue per visitor tertinggi. Jika Anda hanya melihat volume traffic, Anda mungkin mengira Twitter lebih penting. Atribusi revenue bisa menunjukkan sebaliknya.

## Masalah Umum dengan Atribusi

### Dark Social

Tidak semua traffic bisa dilacak dengan UTM. Jika seseorang membagikan link Anda di grup WhatsApp atau DM Slack tanpa UTM, muncul sebagai "direct" di analytics. Untuk SaaS B2B, porsinya bisa signifikan.

Solusi parsial: gunakan URL yang unik per channel (bukan hanya UTM) dan lacak parameter yang lebih spesifik. Terima juga bahwa tidak semua atribusi akan sempurna, dan atribusi yang kurang sempurna tetap lebih berguna daripada tidak ada atribusi.

### Siklus Multi-Touch

Pengunjung bisa melihat iklan Google, membaca blog post, menerima email, baru subscribe 2 minggu kemudian. Model last-touch hanya mencatat "email" sebagai sumber. Model first-touch hanya mencatat "Google Ads."

Solusi: mulai dengan last-touch, lalu tambahkan user journey tracking untuk melihat semua touchpoint sebelum konversi. RevKlik menyambung kunjungan dari browser yang sama, jadi Anda bisa melihat tidak hanya titik awal dan akhir, tapi langkah di antaranya.

### Cross-Device

Pengunjung menemukan Anda di HP saat commute, tapi subscribe dari laptop di rumah. ID acak RevKlik tersimpan per browser, jadi dua perangkat ini terlihat sebagai dua pengunjung berbeda.

Solusi: jika pengguna login di situs Anda, Anda bisa mengirim identitasnya lewat `identify()` agar perangkat yang memakai akun yang sama tersambung. Karena itu data pribadi (nama, email, telepon), panggil `identify()` hanya setelah pengunjung memberi persetujuan.

## Atribusi Revenue di RevKlik

Yang RevKlik tangani dari proses di atas:

- UTM ditangkap saat pengunjung mendarat dan disimpan bersama perjalanannya.
- Webhook dari gateway yang didukung mengaitkan pembayaran dengan kunjungan yang menyebabkannya.
- User journey lengkap menunjukkan setiap langkah dari kunjungan pertama hingga pembayaran.
- Laporan revenue bisa dikelompokkan per source, medium, atau campaign.

Untuk menyambung kunjungan antar hari, RevKlik memakai ID acak first-party di local storage. RevKlik tidak memakai cookie pihak ketiga dan tidak melacak lintas situs, tetapi ID yang menetap itu termasuk data pribadi menurut UU PDP. Anda adalah pengendali datanya. Baca [analitik dan UU PDP](/blog/analytics-patuh-uu-pdp) sebelum memasang.

Atribusi revenue tersedia mulai paket Starter.

## Mulai dari yang Sederhana

Jangan mencoba membangun sistem atribusi yang sempurna di hari pertama. Mulai dari:

1. Pasang UTM di setiap link marketing Anda.
2. Hubungkan payment webhook ke analytics.
3. Lihat laporan last-touch attribution setiap minggu.
4. Setelah 1 sampai 2 bulan, tambahkan analisis multi-touch.

UTM yang konsisten dan webhook yang terhubung sudah memberi insight yang jauh lebih baik daripada tidak ada atribusi sama sekali. Setelah itu, [funnel konversi](/blog/funnel-konversi) membantu Anda menemukan di langkah mana calon pembeli berhenti.
