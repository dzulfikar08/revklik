// Indonesian-only landing copy; the site targets Indonesia, no i18n layer.
// Every claim here existed on the previous page (pricing, script size, trial,
// gateways). Wording is tightened, facts are unchanged.
export const C = {
	skip: 'Lewati ke konten',
	nav_label: 'Navigasi utama',
	nav_features: 'Fitur',
	nav_how: 'Cara Pasang',
	nav_pricing: 'Harga',
	nav_faq: 'FAQ',
	nav_blog: 'Blog',
	nav_login: 'Masuk',
	nav_cta: 'Coba gratis',
	nav_menu: 'Menu',

	// [plain, highlighted]: the second part is rendered in the money color.
	hero_title: ['Tahu channel mana yang ', 'menghasilkan uang.'] as const,
	hero_sub:
		'RevKlik mencocokkan setiap pembayaran dari Midtrans, Xendit, DOKU, atau Mayar dengan pengunjung dan sumber traffic yang membawanya. Iklan, postingan, atau link WhatsApp mana yang berujung transaksi, Anda lihat di satu dashboard.',
	hero_cta1: 'Coba gratis 7 hari',
	hero_cta2: 'Lihat harga',
	hero_note: 'Tanpa kartu kredit. Bayar via QRIS setelah trial.',
	specs_label: 'Ringkasan teknis',
	specs: [
		{ val: '~4KB', lbl: 'ukuran script (gzip)' },
		{ val: '0', lbl: 'cookie' },
		{ val: '5 menit', lbl: 'waktu setup' },
	],

	live_title: 'Bukan mockup. Ini dashboard PakUstadz.com.',
	live_sub:
		'Dashboard publik PakUstadz.com, salah satu situs yang diukur dengan RevKlik. Kunjungi situsnya, lalu lihat datanya bergerak di sini.',
	live_caption: 'Dashboard PakUstadz.com',
	live_open: 'Buka dashboard penuh',
	live_visit: 'Kunjungi PakUstadz.com',
	live_loading: 'Memuat dashboard...',
	live_iframe_title: 'Dashboard live PakUstadz.com, diukur dengan RevKlik',

	feat_title: 'Dari klik pertama sampai transaksi.',
	feat_desc:
		'Traffic saja tidak membayar tagihan. RevKlik menunjukkan pengunjung mana yang akhirnya membeli, dan dari mana mereka datang.',
	feat_lead: {
		title: 'Atribusi Pendapatan',
		desc: 'Hubungkan payment gateway Anda. Setiap pembayaran tercatat bersama sumber traffic, kampanye UTM, dan halaman masuk pembelinya.',
		gateways_label: 'Terhubung ke',
		gateways: ['Midtrans', 'Xendit', 'DOKU', 'Mayar', 'Stripe', 'Lemon Squeezy'],
	},
	feat_rows: [
		{
			title: 'Sumber Traffic',
			desc: 'Referrer, UTM, dan kampanye, termasuk klik dari WhatsApp yang biasanya tercatat sebagai "direct". Bandingkan channel berdasarkan rupiah, bukan sekadar jumlah kunjungan.',
		},
		{
			title: 'Heatmap & Rekaman Sesi',
			desc: 'Lihat bagian halaman yang diklik, seberapa jauh pengunjung menggulir, dan putar ulang sesi mereka. Tidak perlu pasang Hotjar atau Clarity terpisah.',
		},
		{
			title: 'Real-Time & Perjalanan Pengunjung',
			desc: 'Pengunjung yang sedang online, halaman yang mereka buka berurutan, lalu negara, kota, dan perangkatnya.',
		},
		{
			title: 'Tanya Data Lewat AI',
			desc: 'Hubungkan server MCP RevKlik ke Claude, Cursor, atau agen AI lain. Tanyakan "channel mana yang menghasilkan penjualan minggu ini?" dan jawabannya diambil dari data Anda sendiri.',
		},
		{
			title: 'Tanpa Cookie',
			desc: 'Tidak memakai cookie dan tidak menyimpan data pribadi, jadi tidak perlu banner persetujuan. Sesuai UU PDP.',
		},
	],

	how_title: 'Pasang dalam tiga langkah.',
	how_desc: 'Tanpa SDK, tanpa konfigurasi, tanpa tag manager.',
	steps: [
		{
			title: 'Daftar & tambahkan situs',
			desc: 'Buat akun, masukkan domain website Anda, dan Anda langsung mendapat Site ID.',
			meta: '2 menit',
		},
		{
			title: 'Pasang satu baris script',
			desc: 'Salin script ini, tempel sebelum </head> di situs Anda. Script dimuat dengan defer, jadi tidak memblokir halaman.',
			meta: '~4KB gzip',
		},
		{
			title: 'Lihat datanya',
			desc: 'Pageview, sumber traffic, dan perangkat langsung muncul di dashboard secara real-time.',
			meta: 'Real-time',
		},
	],
	code_label: 'Pasang sebelum </head>',
	code_copy: 'Salin',
	code_copied: 'Tersalin',
	code_failed: 'Gagal menyalin, salin manual',
	code_docs: 'Dokumentasi lengkap',

	price_title: 'Coba dulu, bayar kalau cocok.',
	price_desc:
		'Setiap akun baru mendapat 7 hari trial dengan semua fitur Growth, tanpa kartu kredit. Setelah itu pilih paket, bayar per bulan via QRIS, dan berhenti kapan saja.',
	price_per: '/bulan',
	price_highlight: 'Paket pertama dengan atribusi pendapatan',
	price_note: 'Event = pageview + event + konversi. Butuh lebih dari 500.000 event/bulan? Email kami:',
	p0_desc: 'Untuk blog dan situs pribadi',
	p0_f: ['10.000 event per bulan', '1 situs', 'Dashboard real-time, data 7 hari', 'Sumber traffic & UTM', 'API & server MCP'],
	p1_desc: 'Untuk bisnis yang sedang tumbuh',
	p1_f: ['100.000 event per bulan', '3 situs', 'Atribusi pendapatan & funnel', 'Data 30 hari', 'Semua fitur Micro'],
	p2_desc: 'Untuk situs dengan traffic besar',
	p2_f: ['500.000 event per bulan', '10 situs', 'Heatmap, rekaman sesi & wawasan AI', 'Data 90 hari, anggota tim, dukungan prioritas'],
	plan_cta: 'Mulai trial gratis',

	faq_title: 'Pertanyaan yang sering muncul.',
	faq: [
		{
			q: 'Apa itu "event"?',
			a: 'Setiap pageview, event kustom, dan konversi dihitung sebagai satu event. Satu pengunjung yang membuka 3 halaman = 3 event.',
		},
		{
			q: 'Apakah saya perlu memasang banner cookie?',
			a: 'Tidak. RevKlik tidak memakai cookie dan tidak menyimpan data pribadi, jadi situs Anda tidak perlu banner persetujuan.',
		},
		{
			q: 'Bagaimana cara pembayarannya?',
			a: 'Scan QRIS di halaman pembayaran. Setelah pembayaran terkonfirmasi, paket Anda aktif otomatis.',
		},
		{
			q: 'Bisa berhenti langganan kapan saja?',
			a: 'Bisa. Tidak ada kontrak dan tidak ada biaya tersembunyi. Cukup jangan perpanjang bulan berikutnya.',
		},
		{
			q: 'Apakah ada paket gratis?',
			a: 'Tidak ada paket gratis permanen. Setiap akun baru mendapat trial 7 hari dengan semua fitur Growth, tanpa kartu kredit. Setelah itu paket termurah Rp 16.000 per bulan.',
		},
		{
			q: 'Apa yang terjadi setelah trial selesai?',
			a: 'Data situs Anda tetap dicatat selama 14 hari. Begitu Anda memilih paket dan membayar, dashboard terbuka lagi.',
		},
	],
	faq_aside: 'Pertanyaan Anda belum terjawab?',
	faq_aside_cta: 'Buka halaman Dukungan',

	cta_title: 'Pasang hari ini. Lihat channel yang menghasilkan besok pagi.',
	cta_desc: 'Daftar, pasang satu baris script, hubungkan payment gateway Anda. Trial 7 hari, tanpa kartu kredit.',
	cta_btn: 'Coba gratis 7 hari',

	footer_copy: '© 2026 Joyo Digitama',
	f_privacy: 'Privasi',
	f_terms: 'Ketentuan',
	f_support: 'Dukungan',
	f_docs: 'Docs',
	f_network: 'Jaringan produk',
};
