---
lang: id
title: Kebijakan Privasi
description: Data apa yang RevKlik simpan tentang akun Anda dan pengunjung situs Anda, berapa lama, di mana, dan cara menghapusnya.
updated: 2026-10-30
---

RevKlik adalah layanan analytics dan pencatatan pendapatan dari Joyo Digitama. Halaman ini menjelaskan data yang kami proses, untuk apa, berapa lama, dan hak Anda. Kami menulisnya apa adanya: RevKlik menjaga privasi, tetapi tidak menghilangkan data pribadi.

Ringkasnya: tanpa cookie pihak ketiga, tanpa pelacakan lintas situs, tanpa profil iklan, dan kami tidak menjual data.

## Dua peran kami

- **Data pengunjung situs Anda.** Anda adalah pengendali data dan RevKlik adalah prosesor yang bekerja atas instruksi Anda.
- **Data akun RevKlik Anda** (nama, email, tagihan). Di sini Joyo Digitama bertindak sebagai pengendali data.

## Data yang kami simpan

Untuk setiap situs yang Anda pasangi script, kami menyimpan pageview, event kustom, sesi, dan profil pengunjung, ditambah negara, wilayah, dan kota dari Cloudflare, serta perangkat, browser, dan OS. Nama, email, dan nomor telepon pengunjung hanya disimpan jika Anda sendiri mengirimnya lewat `identify()`.

Untuk akun Anda, kami menyimpan nama, alamat email, kata sandi yang di-hash (atau tautan akun Google jika Anda masuk dengan Google), dan riwayat langganan. Dashboard memakai cookie sesi first-party agar Anda tetap masuk.

Jika Anda menghubungkan payment gateway, kami menyimpan catatan pembayaran yang diperlukan untuk atribusi pendapatan: ID transaksi, jumlah, mata uang, waktu, dan fee. Kami tidak menyimpan nomor kartu atau data pembayaran sensitif milik pembeli Anda.

## ID pengunjung

RevKlik memberi setiap browser sebuah ID acak yang disimpan di penyimpanan lokal browser pada domain Anda sendiri (first-party, bukan cookie). ID ini membantu menghitung pengunjung yang kembali dan mengaitkan penjualan dengan kunjungan yang menyebabkannya, bahkan beberapa hari kemudian. ID bersifat acak dan tidak pernah dibagikan antar situs.

Jika pengunjung menghapus penyimpanan browser, server kami tetap bisa mengenalinya lewat hash berkunci (HMAC-SHA256 dengan salt rahasia yang berbeda untuk setiap situs) dari alamat IP, browser, bahasa, dan ukuran layar. Alamat IP mentah tidak disimpan, dan hash tidak bisa dicocokkan antar situs.

ID yang menetap dapat menandai pengunjung yang kembali, sehingga termasuk data pribadi menurut UU PDP (UU 27/2022) dan GDPR. RevKlik menjaga data itu seminimal mungkin; RevKlik tidak membuatnya hilang.

## Cookie dan pelacakan

RevKlik tidak memakai cookie pihak ketiga dan tidak melacak pengunjung lintas situs. Kami tidak membangun profil iklan dan tidak membagikan data untuk pemasaran. Script menghormati sinyal Global Privacy Control (Sec-GPC) dan Do Not Track secara bawaan.

## Berapa lama data disimpan

Event mentah dihapus otomatis setelah 30 hari (Micro), 60 hari (Starter), atau 180 hari (Growth): dua kali jendela laporan paket, minimal 30 hari. Catatan pembayaran dan pendapatan tetap disimpan sebagai catatan pembukuan sampai Anda menghapus situs atau akun.

## Penghapusan dan cadangan

Anda bisa menghapus data satu pengunjung, satu situs, atau seluruh akun dari Pengaturan. Data aktif langsung dihapus; catatan pembayaran milik pengunjung yang dihapus tetap disimpan tetapi dianonimkan.

Cadangan database dienkripsi (AES-256-GCM) dan 30 cadangan harian terakhir disimpan, sehingga data yang dihapus hilang dari cadangan dalam 30 hari.

## Di mana data disimpan

Data disimpan di infrastruktur Cloudflare (database D1, wilayah utama Asia-Pasifik), sehingga diproses di luar Indonesia. Jika Anda pengendali data bagi pengunjung Indonesia, cantumkan hal ini dalam pemberitahuan privasi Anda.

## Pihak ketiga yang kami gunakan

- **Cloudflare**: hosting, database, penyimpanan cadangan, pengiriman email, dan inferensi untuk wawasan AI.
- **Pakasir** dan **Polar**: memproses pembayaran langganan RevKlik Anda (QRIS dan kartu). Mereka menerima data tagihan yang diperlukan untuk transaksi itu.
- **Google**: hanya jika Anda masuk dengan Google atau menghubungkan Search Console.
- **Payment gateway Anda** (Midtrans, Xendit, DOKU, Mayar, Paywuz, Polar, Stripe, Lemon Squeezy): hanya jika Anda menghubungkannya. Kami menerima notifikasi pembayaran, dan untuk Mayar dan Paywuz juga membaca daftar transaksi dengan API key Anda.

Kami tidak memiliki perjanjian pemrosesan data (DPA) standar saat ini. Jika Anda membutuhkannya, tulis ke support@revklik.com.

## Panduan untuk pemilik situs (bukan nasihat hukum)

Menurut UU PDP, Anda memerlukan dasar pemrosesan yang sah (persetujuan adalah yang paling aman) dan pemberitahuan privasi yang menyebut alat yang Anda pakai. Rekomendasi kami:

- Sebutkan RevKlik, ID pengunjung first-party, dan masa retensi di atas dalam kebijakan privasi Anda.
- Jika pengunjung Anda mencakup penduduk Indonesia, UE, atau Inggris, minta persetujuan sebelum tracker berjalan. Tambahkan `data-consent="required"` pada tag script dan panggil `klikapa.consent(true)` saat pengunjung setuju (sebelum itu tidak ada yang disimpan dan tidak ada yang dikirim). Jika menolak, panggil `klikapa.consent(false)`.
- Selalu minta persetujuan sebelum memanggil `identify()` (nama, email, telepon) dan sebelum mengaktifkan heatmap atau rekaman sesi; keduanya nonaktif sampai Anda mengatur `window.klikapa_consent`.

Panduan teknisnya ada di [dokumentasi privasi](https://docs.revklik.com/id/privacy/).

## Hak Anda

Anda dapat meminta akses, ekspor (CSV dari dashboard), koreksi, penghapusan, atau keberatan atas pemrosesan data Anda. Penghapusan data pengunjung, situs, dan akun tersedia langsung di Pengaturan. Untuk permintaan lain, tulis ke support@revklik.com dengan subjek "Permintaan privasi". Kami berusaha menjawab dalam 14 hari kerja.

## Perubahan kebijakan

Jika kami mengubah kebijakan ini secara material, kami memperbarui tanggal di atas dan memberi tahu pemilik akun lewat email.

## Kontak

Joyo Digitama, support@revklik.com.
