---
lang: id
title: "Tanpa Cookie Pihak Ketiga: Apa yang Sebenarnya Berubah untuk Analitik Anda"
description: "Tanpa cookie pihak ketiga bukan berarti tanpa data pribadi. Penjelasan ID first-party di local storage dan apa yang tetap jadi tanggung jawab Anda."
ogDescription: "Tanpa cookie pihak ketiga bukan berarti tanpa data pribadi. Ini perbedaannya."
published: 2026-05-12
updated: 2026-10-30
readMinutes: 6
category: privacy
featured: false
related: [analytics-patuh-uu-pdp, revklik-vs-google-analytics, atribusi-pendapatan]
draft: false
---

Istilah "analitik tanpa cookie" sering dipakai seolah-olah artinya tidak ada data pengunjung yang disimpan sama sekali. Itu keliru, dan di bawah UU PDP kekeliruan itu bisa merugikan Anda. Artikel ini membedakan tiga hal yang kerap tercampur: cookie pihak ketiga, cookie first-party, dan penyimpanan lokal di browser. Lalu kami jelaskan apa yang RevKlik lakukan dan apa yang tidak.

## Cookie pihak ketiga, cookie first-party, dan local storage

- **Cookie pihak ketiga** dipasang oleh domain lain, misalnya jaringan iklan, dan dibaca di banyak situs. Inilah yang memungkinkan pelacakan lintas situs dan profil iklan. Safari dan Firefox memblokirnya secara bawaan.
- **Cookie first-party** dipasang oleh domain situs Anda sendiri, misalnya cookie sesi login. Hanya situs itu yang membacanya.
- **Local storage** adalah ruang penyimpanan di browser untuk satu domain. Bukan cookie, tetapi fungsinya untuk analitik mirip: menyimpan sebuah ID di perangkat pengunjung.

Kebanyakan perdebatan soal "kematian cookie" menyangkut jenis pertama. Dua jenis lainnya tidak otomatis bebas masalah privasi.

## Apa yang RevKlik lakukan

RevKlik tidak memakai cookie pihak ketiga, tidak melacak lintas situs, dan tidak membuat profil iklan. Tetapi RevKlik memberi setiap browser sebuah ID acak yang disimpan di local storage pada domain Anda sendiri (first-party, bukan cookie). ID itu bukan nama atau email, dan tidak pernah dibagikan antar situs.

ID ini punya satu tujuan: menghitung pengunjung yang kembali dan mengaitkan sebuah penjualan dengan kunjungan yang menyebabkannya, bahkan beberapa hari kemudian. Tanpa ID yang menetap, atribusi pendapatan tidak mungkin dilakukan.

Kalau pengunjung menghapus penyimpanan browser, server kami tetap bisa mengenalinya lewat hash berkunci (HMAC-SHA256 dengan salt rahasia yang berbeda untuk setiap situs) dari alamat IP, browser, bahasa, dan ukuran layar. Alamat IP mentah tidak disimpan, dan hash tidak bisa dicocokkan antar situs.

## Apakah ini data pribadi?

Ya, perlakukan sebagai data pribadi. ID yang menetap dapat menandai pengunjung yang kembali, sehingga termasuk data pribadi menurut UU PDP (UU 27/2022) dan GDPR. RevKlik menjaga datanya seminimal mungkin, tetapi tidak membuatnya hilang. Konsekuensinya:

- Anda adalah pengendali data untuk data pengunjung Anda. RevKlik adalah prosesor Anda.
- Anda perlu dasar pemrosesan yang sah (persetujuan adalah yang paling aman) dan pemberitahuan privasi yang menyebut alat yang Anda pakai.
- Menyimpan ID di perangkat pengunjung, dengan cookie maupun local storage, termasuk hal yang perlu Anda perhitungkan dalam kebijakan privasi.

Pembahasan lengkapnya ada di [panduan praktis UU PDP untuk analitik](/blog/analytics-patuh-uu-pdp). Tulisan ini bukan nasihat hukum.

## Apa yang berubah, apa yang tidak

Yang berubah ketika Anda memakai analitik tanpa cookie pihak ketiga:

- Data pengunjung Anda tidak ikut menjadi bahan profil iklan di situs lain.
- Tidak ada data yang bergantung pada cookie milik jaringan iklan, jadi tidak terpengaruh ketika browser memblokirnya.
- Anda tetap bisa menghitung pengunjung yang kembali di browser yang sama, dan menautkan penjualan ke sumbernya.

Yang tidak berubah:

- Anda tetap memproses data pribadi dan tetap perlu dasar hukum serta pemberitahuan privasi.
- Satu orang di dua perangkat tetap terlihat sebagai dua pengunjung. Anda bisa menautkannya hanya jika Anda mengirim identitas lewat `identify()`, dan itu mengharuskan persetujuan lebih dulu.
- Pengunjung yang menolak persetujuan, atau memakai Global Privacy Control, tidak boleh dilacak. RevKlik menghormati GPC dan Do Not Track secara bawaan.

## Kapan Anda perlu meminta persetujuan

Kalau pengunjung Anda mencakup penduduk Indonesia, UE, atau Inggris, minta persetujuan sebelum tracker berjalan. Tambahkan `data-consent="required"` pada tag script, lalu panggil `klikapa.consent(true)` saat pengunjung setuju. Sebelum itu tidak ada yang disimpan dan tidak ada yang dikirim. Jika pengunjung menolak, panggil `klikapa.consent(false)`.

```html
<script defer data-site-id="your-site-id" data-consent="required"
  src="https://app.revklik.com/klikapa.js"></script>
```

## Ringkasannya

"Tanpa cookie pihak ketiga" adalah klaim yang bisa dipertanggungjawabkan. "Tanpa data pribadi" bukan. Pilih alat analitik dengan melihat apa yang benar-benar disimpan di perangkat pengunjung dan di server, lalu tulis itu di kebijakan privasi Anda.
