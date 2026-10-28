// Landing copy in two locales. `ID` is the source of truth: `Copy` is derived
// from it, so `EN` fails to type-check if it misses or adds a key.
// Every claim here existed on the previous page (pricing, script size, trial,
// gateways). Wording is tightened, facts are unchanged.
export type Locale = 'id' | 'en';

export const ID = {
	lang: 'id',
	locale_label: 'Bahasa',
	locale_id_name: 'Bahasa Indonesia',
	locale_en_name: 'English',
	home_label: 'RevKlik, beranda',
	meta_title: 'RevKlik: Analytics yang Menunjukkan Channel Penghasil Uang',
	meta_description:
		'Analytics website yang mencocokkan pembayaran Midtrans, Xendit, DOKU, dan Mayar dengan sumber traffic-nya. Tanpa cookie, satu baris script. Trial 7 hari tanpa kartu kredit, lalu mulai Rp 16.000/bulan via QRIS.',
	meta_keywords:
		'analytics indonesia, analytics website, statistik pengunjung website, analytics tanpa cookie, analytics murah, alternatif google analytics, tracking pengunjung website, web analytics indonesia, analytics UMKM, analytic sederhana',
	og_title: 'RevKlik: Tahu Channel Mana yang Menghasilkan Uang',
	og_description: 'Atribusi pendapatan untuk website Indonesia. Trial 7 hari tanpa kartu kredit, lalu mulai Rp 16.000/bulan via QRIS.',
	og_locale: 'id_ID',
	ld_description: 'Analytics website dengan atribusi pendapatan: real-time, tanpa cookie, terhubung ke Midtrans, Xendit, DOKU, dan Mayar.',
	ld_org_description: 'Layanan analytics website simpel dari Joyo Digitama.',
	ld_offers: [
		'Hingga 10.000 event per bulan, 1 situs',
		'Hingga 100.000 event per bulan, 3 situs',
		'Hingga 500.000 event per bulan, 10 situs',
	],
	ld_features: ['Atribusi Pendapatan', 'Dashboard Real-Time', 'Sumber Traffic & UTM', 'Heatmap', 'Rekaman Sesi', 'Server MCP', 'Tanpa Cookie', 'Pembayaran QRIS'],

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
	hero_title: ['Tahu channel mana yang ', 'menghasilkan uang.'] as [string, string],
	hero_sub:
		'RevKlik mencocokkan setiap pembayaran dari Midtrans, Xendit, DOKU, atau Mayar dengan pengunjung dan sumber traffic yang membawanya. Iklan, postingan, atau link WhatsApp mana yang berujung transaksi, Anda lihat di satu dashboard.',
	hero_cta1: 'Coba gratis 7 hari',
	hero_cta2: 'Lihat harga',
	hero_note: 'Tanpa kartu kredit. Bayar via QRIS setelah trial.',

	live_note: 'Toko fiktif dengan data contoh. Tampilannya sama dengan dashboard Anda setelah script terpasang.',
	live_caption: 'Toko Kopi Senja (tokokopisenja.id)',
	live_badge: 'Data contoh',
	live_open: 'Buka dashboard penuh',
	live_loading: 'Memuat dashboard...',
	live_iframe_title: 'Dashboard contoh Toko Kopi Senja, toko fiktif dengan data contoh',

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
			desc: 'Tidak memakai cookie dan tidak menyimpan data pribadi, jadi tidak perlu banner persetujuan.',
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
	f_nempel: 'Nempel: direktori cafe & fasilitas',
};

export type Copy = typeof ID;

export const EN: Copy = {
	lang: 'en',
	locale_label: 'Language',
	locale_id_name: 'Bahasa Indonesia',
	locale_en_name: 'English',
	home_label: 'RevKlik, home',
	meta_title: 'RevKlik: Web Analytics That Shows Which Channels Make Money',
	meta_description:
		'Web analytics that matches Midtrans, Xendit, DOKU, and Mayar payments to the traffic source behind them. No cookies, one line of script. 7-day trial with no credit card, then from Rp 16,000/month via QRIS.',
	meta_keywords:
		'revenue attribution, web analytics indonesia, cookie-free analytics, affordable analytics, google analytics alternative, website visitor tracking, simple analytics, midtrans analytics, xendit analytics',
	og_title: 'RevKlik: Know Which Channel Makes You Money',
	og_description: 'Revenue attribution for Indonesian websites. 7-day trial with no credit card, then from Rp 16,000/month via QRIS.',
	og_locale: 'en_US',
	ld_description: 'Web analytics with revenue attribution: real-time, cookie-free, connected to Midtrans, Xendit, DOKU, and Mayar.',
	ld_org_description: 'A simple web analytics service from Joyo Digitama.',
	ld_offers: [
		'Up to 10,000 events per month, 1 site',
		'Up to 100,000 events per month, 3 sites',
		'Up to 500,000 events per month, 10 sites',
	],
	ld_features: ['Revenue Attribution', 'Real-Time Dashboard', 'Traffic Sources & UTM', 'Heatmaps', 'Session Recordings', 'MCP Server', 'Cookie-Free', 'QRIS Payments'],

	skip: 'Skip to content',
	nav_label: 'Main navigation',
	nav_features: 'Features',
	nav_how: 'Setup',
	nav_pricing: 'Pricing',
	nav_faq: 'FAQ',
	nav_blog: 'Blog',
	nav_login: 'Log in',
	nav_cta: 'Try for free',
	nav_menu: 'Menu',

	hero_title: ['Know which channel ', 'makes you money.'],
	hero_sub:
		'RevKlik matches every payment from Midtrans, Xendit, DOKU, or Mayar to the visitor and traffic source that brought it in. See which ad, post, or WhatsApp link ended in a sale, all in one dashboard.',
	hero_cta1: 'Try free for 7 days',
	hero_cta2: 'See pricing',
	hero_note: 'No credit card. Pay via QRIS after the trial.',

	live_note: 'A fictional shop with sample data. It looks the same as your dashboard once the script is installed.',
	live_caption: 'Toko Kopi Senja (tokokopisenja.id)',
	live_badge: 'Sample data',
	live_open: 'Open full dashboard',
	live_loading: 'Loading dashboard...',
	live_iframe_title: 'Sample dashboard for Toko Kopi Senja, a fictional shop with sample data',

	feat_title: 'From first click to sale.',
	feat_desc: "Traffic alone doesn't pay the bills. RevKlik shows which visitors end up buying, and where they came from.",
	feat_lead: {
		title: 'Revenue Attribution',
		desc: 'Connect your payment gateway. Every payment is recorded with the buyer\'s traffic source, UTM campaign, and landing page.',
		gateways_label: 'Connects to',
		gateways: ['Midtrans', 'Xendit', 'DOKU', 'Mayar', 'Stripe', 'Lemon Squeezy'],
	},
	feat_rows: [
		{
			title: 'Traffic Sources',
			desc: 'Referrers, UTM tags, and campaigns, including WhatsApp clicks that usually show up as "direct". Compare channels by rupiah earned, not just visit counts.',
		},
		{
			title: 'Heatmaps & Session Recordings',
			desc: 'See where visitors click, how far they scroll, and replay their sessions. No need to install Hotjar or Clarity separately.',
		},
		{
			title: 'Real-Time & Visitor Journeys',
			desc: 'Who is online right now, the pages they open in order, plus their country, city, and device.',
		},
		{
			title: 'Ask Your Data With AI',
			desc: 'Connect the RevKlik MCP server to Claude, Cursor, or another AI agent. Ask "which channel drove sales this week?" and the answer comes from your own data.',
		},
		{
			title: 'No Cookies',
			desc: 'RevKlik sets no cookies and stores no personal data, so you need no consent banner.',
		},
	],

	how_title: 'Set up in three steps.',
	how_desc: 'No SDK, no configuration, no tag manager.',
	steps: [
		{
			title: 'Sign up & add your site',
			desc: 'Create an account, enter your website domain, and you get a Site ID right away.',
			meta: '2 minutes',
		},
		{
			title: 'Paste one line of script',
			desc: 'Copy this script and paste it before </head> on your site. It loads with defer, so it never blocks the page.',
			meta: '~4KB gzip',
		},
		{
			title: 'See your data',
			desc: 'Pageviews, traffic sources, and devices appear in your dashboard in real time.',
			meta: 'Real-time',
		},
	],
	code_label: 'Paste before </head>',
	code_copy: 'Copy',
	code_copied: 'Copied',
	code_failed: 'Copy failed, copy it manually',
	code_docs: 'Full documentation',

	price_title: 'Try first, pay if it fits.',
	price_desc:
		'Every new account gets a 7-day trial with all Growth features and no credit card. After that, pick a plan, pay monthly via QRIS, and cancel any time.',
	price_per: '/month',
	price_highlight: 'First plan with revenue attribution',
	price_note: 'Events = pageviews + events + conversions. Need more than 500,000 events/month? Email us:',
	p0_desc: 'For blogs and personal sites',
	p0_f: ['10,000 events per month', '1 site', 'Real-time dashboard, 7 days of data', 'Traffic sources & UTM', 'API & MCP server'],
	p1_desc: 'For growing businesses',
	p1_f: ['100,000 events per month', '3 sites', 'Revenue attribution & funnels', '30 days of data', 'Everything in Micro'],
	p2_desc: 'For high-traffic sites',
	p2_f: ['500,000 events per month', '10 sites', 'Heatmaps, session recordings & AI insights', '90 days of data, team members, priority support'],
	plan_cta: 'Start free trial',

	faq_title: 'Frequently asked questions.',
	faq: [
		{
			q: 'What counts as an "event"?',
			a: 'Every pageview, custom event, and conversion counts as one event. One visitor who opens 3 pages = 3 events.',
		},
		{
			q: 'Do I need a cookie banner?',
			a: 'No. RevKlik sets no cookies and stores no personal data, so your site needs no consent banner.',
		},
		{
			q: 'How do I pay?',
			a: 'Scan the QRIS code on the payment page. Once the payment is confirmed, your plan activates automatically.',
		},
		{
			q: 'Can I cancel any time?',
			a: 'Yes. There is no contract and there are no hidden fees. Just don\'t renew for the next month.',
		},
		{
			q: 'Is there a free plan?',
			a: 'There is no permanent free plan. Every new account gets a 7-day trial with all Growth features and no credit card. After that, the cheapest plan is Rp 16,000 per month.',
		},
		{
			q: 'What happens after the trial ends?',
			a: 'We keep recording your site data for 14 days. Once you pick a plan and pay, your dashboard opens again.',
		},
	],
	faq_aside: 'Still have a question?',
	faq_aside_cta: 'Open the Support page',

	cta_title: 'Install today. See which channels pay by tomorrow morning.',
	cta_desc: 'Sign up, paste one line of script, connect your payment gateway. 7-day trial, no credit card.',
	cta_btn: 'Try free for 7 days',

	footer_copy: '© 2026 Joyo Digitama',
	f_privacy: 'Privacy',
	f_terms: 'Terms',
	f_support: 'Support',
	f_docs: 'Docs',
	f_network: 'Product network',
	f_nempel: 'Nempel: cafe & amenities directory',
};

export function getCopy(locale: Locale): Copy {
	return locale === 'en' ? EN : ID;
}
