// Landing copy in two locales. `ID` is the source of truth: `Copy` is derived
// from it, so `EN` fails to type-check if it misses or adds a key.
// Privacy wording follows the approved text from the privacy workstream
// (local://ws4-privacy-copy.md). Do not add claims such as "no personal data",
// "no consent needed", "anonymous" or "compliant" here.
import catalog from '../../../../packages/shared/marketing/catalog.json';

export type Locale = 'id' | 'en';

// Gateways come from the shared catalog so landing, blog and docs list the same ones.
const GATEWAYS = catalog.gateways.map((g) => g.name);
const GATEWAYS_ID = GATEWAYS.join(', ').replace(/, ([^,]+)$/, ' dan $1');
const GATEWAYS_EN = GATEWAYS.join(', ').replace(/, ([^,]+)$/, ', and $1');

export const ID = {
	lang: 'id',
	locale_label: 'Bahasa',
	locale_id_name: 'Bahasa Indonesia',
	locale_en_name: 'English',
	home_label: 'RevKlik, beranda',
	meta_title: 'RevKlik: Analytics yang Menunjukkan Channel Penghasil Uang',
	meta_description:
		'Analytics website yang mencocokkan pembayaran Xendit, DOKU, Mayar, Paywuz, dan Polar dengan sumber traffic-nya. Atribusi pendapatan mulai Rp 64.000/bulan. Trial 7 hari tanpa kartu kredit.',
	og_title: 'RevKlik: Tahu Channel Mana yang Menghasilkan Uang',
	og_description: 'Setiap pembayaran dicocokkan dengan sumber traffic-nya. Trial 7 hari tanpa kartu kredit, atribusi pendapatan mulai Rp 64.000/bulan.',
	og_locale: 'id_ID',
	ld_description: `Analytics website dengan atribusi pendapatan: real-time, tanpa cookie pihak ketiga, terhubung ke ${GATEWAYS_ID}.`,
	ld_org_description: 'Layanan analytics dan pencatatan pendapatan untuk pemilik bisnis online Indonesia, dari Joyo Digitama.',
	ld_offers: [
		'Hingga 10.000 event per bulan, 1 situs',
		'Hingga 100.000 event per bulan, 3 situs',
		'Hingga 500.000 event per bulan, 10 situs',
	],
	ld_features: ['Atribusi Pendapatan', 'Dashboard Real-Time', 'Sumber Traffic & UTM', 'Heatmap', 'Rekaman Sesi', 'Server MCP', 'Tanpa Cookie Pihak Ketiga', 'Pembayaran QRIS'],

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
		'RevKlik mencocokkan setiap pembayaran dari gateway Anda dengan sumber traffic pembelinya, lalu memperkirakan pendapatan bersih setelah fee. Anda tahu iklan, postingan, atau link WhatsApp mana yang berujung transaksi.',
	hero_cta1: 'Coba gratis 7 hari',
	hero_cta2: 'Lihat demo',
	hero_note: 'Tanpa kartu kredit. Bayar via QRIS atau kartu setelah trial.',
	hero_privacy: 'Tanpa cookie pihak ketiga, tanpa pelacakan lintas situs, tanpa profil iklan.',

	live_note: 'Toko fiktif dengan data contoh. Tampilannya sama dengan dashboard Anda setelah script terpasang.',
	live_caption: 'Toko Kopi Senja (tokokopisenja.id)',
	live_badge: 'Data contoh',
	live_open: 'Buka dashboard penuh',
	live_loading: 'Memuat dashboard...',
	live_iframe_title: 'Dashboard contoh Toko Kopi Senja, toko fiktif dengan data contoh',

	feat_title: 'Setiap pembayaran ditautkan ke sumber traffic pembelinya.',
	feat_desc:
		'Traffic saja tidak membayar tagihan. RevKlik menunjukkan pengunjung mana yang akhirnya membeli, dari mana mereka datang, dan berapa yang masuk setelah fee.',
	feat_lead: {
		title: 'Atribusi Pendapatan',
		desc: 'Hubungkan payment gateway Anda lewat webhook. Setiap pembayaran tercatat bersama sumber traffic, kampanye UTM, dan halaman masuk pembelinya.',
		gateways_label: 'Terhubung ke',
		gateways: GATEWAYS,
	},
	feat_rows: [
		{
			title: 'Sumber Traffic',
			desc: 'Referrer, UTM, dan kampanye, termasuk klik dari WhatsApp yang biasanya tercatat sebagai "direct". Bandingkan channel berdasarkan rupiah, bukan sekadar jumlah kunjungan.',
		},
		{
			title: 'Heatmap & Rekaman Sesi',
			desc: 'Lihat bagian halaman yang diklik, seberapa jauh pengunjung menggulir, dan putar ulang sesi mereka. Heatmap dan rekaman nonaktif sampai Anda mengaktifkannya dengan persetujuan pengunjung.',
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
			title: 'Privasi yang Jujur',
			desc: 'Tanpa cookie pihak ketiga dan tanpa pelacakan lintas situs. Setiap browser mendapat ID acak first-party yang tidak dibagikan antar situs, dan data mentah dihapus otomatis setelah 30 sampai 180 hari. ID yang menetap tetap termasuk data pribadi menurut UU PDP, jadi kami menyediakan panduan persetujuan.',
			href: '/privacy',
			link: 'Baca kebijakan privasi',
		},
	],

	how_title: 'Pasang dalam tiga langkah.',
	how_desc: 'Satu baris script sebelum </head>. Tidak perlu SDK atau tag manager.',
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
			desc: 'Pageview, sumber traffic, dan perangkat muncul di dashboard secara real-time. Pembayaran ikut masuk setelah gateway terhubung.',
			meta: 'Real-time',
		},
	],
	code_label: 'Pasang sebelum </head>',
	code_copy: 'Salin',
	code_copied: 'Tersalin',
	code_failed: 'Gagal menyalin, salin manual',
	code_docs: 'Panduan pemasangan (Next.js, WordPress, Shopify, dan lainnya)',

	book_kicker: 'Segera hadir',
	book_title: 'Pembukuan untuk founder SaaS solo di Indonesia.',
	book_desc:
		'Dashboard sudah mencatat pendapatan kotor dan perkiraan pendapatan bersih setelah fee untuk setiap pembayaran. Berikutnya kami membangun pencatatan yang lebih lengkap untuk founder yang berjualan SaaS sendirian.',
	book_items: [
		'Pembayaran dari gateway dan Polar dalam satu buku, dengan kurs ke Rupiah.',
		'Pemantauan peredaran bruto terhadap batas PPh final UMKM.',
		'Rekap bulanan yang bisa Anda serahkan ke konsultan pajak.',
	],
	book_note: 'Belum tersedia. Ini bukan nasihat pajak, dan perhitungan akan tetap perlu Anda cek bersama konsultan.',
	book_cta: 'Kabari saya saat rilis',
	book_mail_subject: 'Kabari saya: pembukuan RevKlik',

	about_title: 'Dibuat di Indonesia, bisa Anda periksa sendiri.',
	about_desc:
		'RevKlik dibuat oleh Joyo Digitama untuk pemilik bisnis online Indonesia. Halaman ini dilacak oleh RevKlik sendiri, dan kodenya terbuka.',
	about_facts: [
		{
			title: 'Kode sumber terbuka',
			desc: 'Seluruh kode RevKlik berlisensi AGPL-3.0 dan ada di GitHub. Anda bisa membaca cara kerjanya, atau menjalankannya sendiri di akun Cloudflare Anda.',
			href: 'https://github.com/dzulfikar08/revklik',
			link: 'Buka repositori',
		},
		{
			title: 'Data di Cloudflare, bukan di Indonesia',
			desc: 'Data disimpan di infrastruktur Cloudflare (database D1, wilayah utama Asia-Pasifik), jadi diproses di luar Indonesia. Cadangan database dienkripsi.',
			href: '/privacy',
			link: 'Detail penyimpanan data',
		},
		{
			title: 'Tidak memindahkan uang Anda',
			desc: 'Pembayaran masuk lewat webhook yang diverifikasi dengan secret per situs. Untuk Mayar dan Paywuz, RevKlik juga membaca daftar transaksi dengan API key Anda. Kami tidak menarik atau memindahkan dana.',
			href: 'https://docs.revklik.com/id/integrations/',
			link: 'Cara integrasi bekerja',
		},
	],

	price_title: 'Coba dulu, bayar kalau cocok.',
	price_desc:
		'Setiap akun baru mendapat 7 hari trial dengan semua fitur Growth, tanpa kartu kredit. Setelah itu pilih paket, bayar per bulan via QRIS atau kartu (USD), dan berhenti kapan saja.',
	price_per: '/bulan',
	price_highlight: 'Paket pertama dengan atribusi pendapatan',
	price_note: 'Event = pageview + event + konversi. Butuh lebih dari 500.000 event/bulan? Email kami:',
	price_timeline: [
		{ when: 'Hari 1 sampai 7', what: 'Growth penuh, tanpa kartu kredit.' },
		{ when: 'Hari 8', what: 'Pilih paket dan bayar. Data tetap dicatat selama 14 hari.' },
		{ when: 'Hari 22', what: 'Pencatatan berhenti sampai Anda memilih paket.' },
	],
	price_alt_prefix: 'atau',
	price_alt_suffix: 'dengan kartu',
	p0_desc: 'Untuk blog dan situs pribadi',
	p0_f: ['10.000 event per bulan', '1 situs', 'Dashboard real-time, data 7 hari', 'Sumber traffic & UTM', 'API & server MCP'],
	p1_desc: 'Untuk bisnis yang sedang tumbuh',
	p1_f: ['100.000 event per bulan', '3 situs', 'Atribusi pendapatan & funnel', 'Data 30 hari', 'Semua fitur Micro'],
	p2_desc: 'Untuk situs dengan traffic besar',
	p2_f: ['500.000 event per bulan', '10 situs', 'Heatmap, rekaman sesi & wawasan AI', 'Data 90 hari, anggota tim, dukungan prioritas'],
	plan_cta: 'Mulai trial Growth, pilih {plan} nanti',

	faq_title: 'Pertanyaan yang sering muncul.',
	faq: [
		{
			q: 'Apa itu "event"?',
			a: 'Setiap pageview, event kustom, dan konversi dihitung sebagai satu event. Satu pengunjung yang membuka 3 halaman = 3 event.',
		},
		{
			q: 'Apakah saya perlu memasang banner cookie?',
			a: 'RevKlik tidak memakai cookie pihak ketiga dan tidak melacak pengunjung lintas situs. Tetapi ID pengunjung yang menetap termasuk data pribadi menurut UU PDP. Jika pengunjung Anda dari Indonesia, UE, atau Inggris, kami menyarankan meminta persetujuan sebelum tracker berjalan: tambahkan data-consent="required" pada script. Ini bukan nasihat hukum; panduan lengkapnya ada di dokumentasi.',
		},
		{
			q: 'Data pengunjung disimpan di mana dan berapa lama?',
			a: 'Di infrastruktur Cloudflare (database D1, wilayah utama Asia-Pasifik). Event mentah dihapus otomatis setelah 30 hari (Micro), 60 hari (Starter), atau 180 hari (Growth). Anda bisa menghapus satu pengunjung, satu situs, atau seluruh akun dari Pengaturan.',
		},
		{
			q: 'Bagaimana cara pembayarannya?',
			a: 'Pengunjung dari Indonesia membayar dengan QRIS dalam Rupiah. Selain itu, bayar dengan kartu dalam USD (Micro $1, Starter $4, Growth $12 per bulan). Paket aktif otomatis setelah pembayaran terkonfirmasi.',
		},
		{
			q: 'Payment gateway apa saja yang bisa dihubungkan?',
			a: `${GATEWAYS_ID}. Tidak ada gateway lain yang kami klaim saat ini; Shopee dan Tokopedia belum tersedia.`,
		},
		{
			q: 'Bisa berhenti langganan kapan saja?',
			a: 'Bisa. Tidak ada kontrak dan tidak ada biaya tersembunyi. Cukup jangan perpanjang bulan berikutnya.',
		},
		{
			q: 'Apakah ada paket gratis?',
			a: 'Tidak ada paket gratis permanen. Setiap akun baru mendapat trial 7 hari dengan semua fitur Growth, tanpa kartu kredit. Setelah itu paket termurah Rp 16.000 per bulan, dan atribusi pendapatan mulai dari Starter (Rp 64.000).',
		},
		{
			q: 'Apa yang terjadi setelah trial selesai?',
			a: 'Data situs Anda tetap dicatat selama 14 hari. Begitu Anda memilih paket dan membayar, dashboard terbuka lagi.',
		},
	],
	faq_aside: 'Pertanyaan Anda belum terjawab?',
	faq_aside_cta: 'Buka halaman Dukungan',

	cta_title: 'Pasang script, sambungkan gateway, lihat pembayaran per channel.',
	cta_desc: 'Daftar, pasang satu baris script, lalu hubungkan payment gateway Anda. Trial 7 hari, tanpa kartu kredit.',
	cta_btn: 'Coba gratis 7 hari',

	sticky_cta: 'Coba gratis 7 hari',

	footer_copy: '© 2026 Joyo Digitama',
	f_privacy: 'Privasi',
	f_terms: 'Ketentuan',
	f_support: 'Dukungan',
	f_docs: 'Docs',
	f_network: 'Jaringan produk',
	f_nempel: 'Nempel: direktori cafe & fasilitas',

	// Shared by blog, support and legal pages.
	blog_meta_title: 'Blog RevKlik | Analytics dan Atribusi Pendapatan untuk Pembangun Produk',
	blog_meta_description:
		'Panduan analytics, atribusi pendapatan, dan privasi pengunjung untuk founder dan pemilik bisnis online Indonesia.',
	blog_h1: 'Catatan untuk pembangun produk digital',
	blog_sub: 'Analytics, atribusi pendapatan, dan privasi pengunjung. Ditulis untuk founder dan pemilik bisnis online Indonesia.',
	blog_all: 'Semua',
	blog_featured: 'Artikel pilihan',
	blog_list_label: 'Semua artikel',
	blog_filter_label: 'Kategori artikel',
	blog_empty: 'Belum ada artikel di kategori ini.',
	post_read_min: '{n} menit baca',
	post_by: 'Oleh Tim RevKlik',
	post_back: 'Semua artikel',
	post_more: 'Baca juga',
	post_updated: 'Diperbarui {date}',
	post_toc: 'Isi artikel',
	cta_post_title: 'Lihat angkanya di data Anda sendiri',
	cta_post_desc: 'Pasang satu baris script, hubungkan payment gateway, dan lihat channel mana yang membawa uang. Trial 7 hari, tanpa kartu kredit.',
	cta_post_btn: 'Coba gratis 7 hari',
	cta_post_demo: 'Lihat demo dashboard',
	cta_inline: 'Ingin melihat ini di data Anda sendiri?',
	cta_inline_btn: 'Coba gratis',
	legal_updated: 'Terakhir diperbarui',
	notfound_title: 'Halaman tidak ditemukan',
	notfound_desc: 'Alamat ini tidak ada atau sudah dipindahkan. Coba salah satu halaman di bawah.',
	notfound_home: 'Ke beranda',
	notfound_blog: 'Baca blog',
	notfound_docs: 'Buka dokumentasi',
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
		'Web analytics that matches Xendit, DOKU, Mayar, Paywuz, and Polar payments to the traffic source behind them. Revenue attribution from $4/month. 7-day trial, no credit card.',
	og_title: 'RevKlik: Know Which Channel Makes You Money',
	og_description: 'Every payment matched to its traffic source. 7-day trial with no credit card, revenue attribution from $4/month.',
	og_locale: 'en_US',
	ld_description: `Web analytics with revenue attribution: real-time, no third-party cookies, connected to ${GATEWAYS_EN}.`,
	ld_org_description: 'Analytics and revenue tracking for Indonesian online business owners, from Joyo Digitama.',
	ld_offers: [
		'Up to 10,000 events per month, 1 site',
		'Up to 100,000 events per month, 3 sites',
		'Up to 500,000 events per month, 10 sites',
	],
	ld_features: ['Revenue Attribution', 'Real-Time Dashboard', 'Traffic Sources & UTM', 'Heatmaps', 'Session Recordings', 'MCP Server', 'No Third-Party Cookies', 'QRIS Payments'],

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
		'RevKlik matches every payment from your gateway to the traffic source behind it, then estimates net revenue after fees. You see which ad, post, or WhatsApp link ended in a sale.',
	hero_cta1: 'Try free for 7 days',
	hero_cta2: 'See the demo',
	hero_note: 'No credit card. Pay by card or QRIS after the trial.',
	hero_privacy: 'No third-party cookies, no cross-site tracking, no ad profiles.',

	live_note: 'A fictional shop with sample data. It looks the same as your dashboard once the script is installed.',
	live_caption: 'Toko Kopi Senja (tokokopisenja.id)',
	live_badge: 'Sample data',
	live_open: 'Open full dashboard',
	live_loading: 'Loading dashboard...',
	live_iframe_title: 'Sample dashboard for Toko Kopi Senja, a fictional shop with sample data',

	feat_title: "Every payment is tied to the buyer's traffic source.",
	feat_desc: "Traffic alone doesn't pay the bills. RevKlik shows which visitors end up buying, where they came from, and what lands after fees.",
	feat_lead: {
		title: 'Revenue Attribution',
		desc: "Connect your payment gateway through a webhook. Every payment is recorded with the buyer's traffic source, UTM campaign, and landing page.",
		gateways_label: 'Connects to',
		gateways: GATEWAYS,
	},
	feat_rows: [
		{
			title: 'Traffic Sources',
			desc: 'Referrers, UTM tags, and campaigns, including WhatsApp clicks that usually show up as "direct". Compare channels by rupiah earned, not just visit counts.',
		},
		{
			title: 'Heatmaps & Session Recordings',
			desc: 'See where visitors click, how far they scroll, and replay their sessions. Heatmaps and recordings stay off until you turn them on with the visitor\'s consent.',
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
			title: 'Honest Privacy',
			desc: 'No third-party cookies and no cross-site tracking. Each browser gets a random first-party ID that is never shared between sites, and raw events are deleted automatically after 30 to 180 days. A persistent ID is still personal data under Indonesia\'s PDP Law, so we ship consent guidance.',
			href: '/privacy',
			link: 'Read the privacy policy',
		},
	],

	how_title: 'Set up in three steps.',
	how_desc: 'One line of script before </head>. No SDK or tag manager needed.',
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
			desc: 'Pageviews, traffic sources, and devices appear in your dashboard in real time. Payments join once your gateway is connected.',
			meta: 'Real-time',
		},
	],
	code_label: 'Paste before </head>',
	code_copy: 'Copy',
	code_copied: 'Copied',
	code_failed: 'Copy failed, copy it manually',
	code_docs: 'Install guide (Next.js, WordPress, Shopify, and more)',

	book_kicker: 'Coming soon',
	book_title: 'Bookkeeping for Indonesian solo SaaS founders.',
	book_desc:
		'The dashboard already records gross revenue and an estimated net after fees for every payment. Next we are building fuller record keeping for founders who sell SaaS on their own.',
	book_items: [
		'Payments from gateways and Polar in one book, converted to Rupiah.',
		'Gross turnover tracked against the UMKM final income tax threshold.',
		'A monthly summary you can hand to your tax consultant.',
	],
	book_note: 'Not available yet. This is not tax advice, and you will still need to check the numbers with a consultant.',
	book_cta: 'Tell me when it ships',
	book_mail_subject: 'Notify me: RevKlik bookkeeping',

	about_title: 'Built in Indonesia, open for you to inspect.',
	about_desc:
		'RevKlik is made by Joyo Digitama for Indonesian online business owners. This page is tracked by RevKlik itself, and the code is open.',
	about_facts: [
		{
			title: 'Open source',
			desc: 'All of RevKlik is licensed AGPL-3.0 and lives on GitHub. You can read how it works, or run it yourself on your own Cloudflare account.',
			href: 'https://github.com/dzulfikar08/revklik',
			link: 'Open the repository',
		},
		{
			title: 'Data on Cloudflare, not in Indonesia',
			desc: 'Data is stored on Cloudflare infrastructure (D1 database, Asia-Pacific primary region), so it is processed outside Indonesia. Database backups are encrypted.',
			href: '/privacy',
			link: 'Data storage details',
		},
		{
			title: 'Never moves your money',
			desc: 'Payments arrive through webhooks verified with a per-site secret. For Mayar and Paywuz, RevKlik also reads your transaction list with your API key. We never pull or move funds.',
			href: 'https://docs.revklik.com/integrations/',
			link: 'How integrations work',
		},
	],

	price_title: 'Try first, pay if it fits.',
	price_desc:
		'Every new account gets a 7-day trial with all Growth features and no credit card. After that, pick a plan, pay monthly by card (USD) or QRIS, and cancel any time.',
	price_per: '/month',
	price_highlight: 'First plan with revenue attribution',
	price_note: 'Events = pageviews + events + conversions. Need more than 500,000 events/month? Email us:',
	price_timeline: [
		{ when: 'Days 1 to 7', what: 'Full Growth, no credit card.' },
		{ when: 'Day 8', what: 'Pick a plan and pay. Data keeps recording for 14 days.' },
		{ when: 'Day 22', what: 'Recording pauses until you pick a plan.' },
	],
	price_alt_prefix: 'or',
	price_alt_suffix: 'via QRIS',
	p0_desc: 'For blogs and personal sites',
	p0_f: ['10,000 events per month', '1 site', 'Real-time dashboard, 7 days of data', 'Traffic sources & UTM', 'API & MCP server'],
	p1_desc: 'For growing businesses',
	p1_f: ['100,000 events per month', '3 sites', 'Revenue attribution & funnels', '30 days of data', 'Everything in Micro'],
	p2_desc: 'For high-traffic sites',
	p2_f: ['500,000 events per month', '10 sites', 'Heatmaps, session recordings & AI insights', '90 days of data, team members, priority support'],
	plan_cta: 'Start Growth trial, pick {plan} later',

	faq_title: 'Frequently asked questions.',
	faq: [
		{
			q: 'What counts as an "event"?',
			a: 'Every pageview, custom event, and conversion counts as one event. One visitor who opens 3 pages = 3 events.',
		},
		{
			q: 'Do I need a cookie banner?',
			a: 'RevKlik sets no third-party cookies and does not track visitors across sites. But a persistent visitor ID is personal data under Indonesia\'s PDP Law. If your audience includes Indonesian, EU, or UK residents, we recommend asking for consent before the tracker runs: add data-consent="required" to the script. This is not legal advice; the full guidance is in the docs.',
		},
		{
			q: 'Where is visitor data stored, and for how long?',
			a: 'On Cloudflare infrastructure (D1 database, Asia-Pacific primary region). Raw events are deleted automatically after 30 days (Micro), 60 days (Starter), or 180 days (Growth). You can delete one visitor, a whole site, or your account from Settings.',
		},
		{
			q: 'How do I pay?',
			a: 'Visitors from Indonesia pay in Rupiah with QRIS. Everyone else pays by card in USD (Micro $1, Starter $4, Growth $12 per month). Your plan activates automatically once the payment is confirmed.',
		},
		{
			q: 'Which payment gateways can I connect?',
			a: `${GATEWAYS_EN}. We do not claim any others today; Shopee and Tokopedia are not available yet.`,
		},
		{
			q: 'Can I cancel any time?',
			a: 'Yes. There is no contract and there are no hidden fees. Just don\'t renew for the next month.',
		},
		{
			q: 'Is there a free plan?',
			a: 'There is no permanent free plan. Every new account gets a 7-day trial with all Growth features and no credit card. After that, the cheapest plan is $1 per month, and revenue attribution starts at Starter ($4).',
		},
		{
			q: 'What happens after the trial ends?',
			a: 'We keep recording your site data for 14 days. Once you pick a plan and pay, your dashboard opens again.',
		},
	],
	faq_aside: 'Still have a question?',
	faq_aside_cta: 'Open the Support page',

	cta_title: 'Paste the script, connect your gateway, see payments per channel.',
	cta_desc: 'Sign up, paste one line of script, then connect your payment gateway. 7-day trial, no credit card.',
	cta_btn: 'Try free for 7 days',

	sticky_cta: 'Try free for 7 days',

	footer_copy: '© 2026 Joyo Digitama',
	f_privacy: 'Privacy',
	f_terms: 'Terms',
	f_support: 'Support',
	f_docs: 'Docs',
	f_network: 'Product network',
	f_nempel: 'Nempel: cafe & amenities directory',

	blog_meta_title: 'RevKlik Blog | Analytics and Revenue Attribution for Product Builders',
	blog_meta_description:
		'Guides on analytics, revenue attribution, and visitor privacy for founders and online business owners in Indonesia.',
	blog_h1: 'Notes for digital product builders',
	blog_sub: 'Analytics, revenue attribution, and visitor privacy. Written for founders and online business owners in Indonesia.',
	blog_all: 'All',
	blog_featured: 'Featured article',
	blog_list_label: 'All articles',
	blog_filter_label: 'Article categories',
	blog_empty: 'No articles in this category yet.',
	post_read_min: '{n} min read',
	post_by: 'By the RevKlik team',
	post_back: 'All articles',
	post_more: 'Keep reading',
	post_updated: 'Updated {date}',
	post_toc: 'On this page',
	cta_post_title: 'See the numbers on your own data',
	cta_post_desc: 'Paste one line of script, connect your payment gateway, and see which channel brings in the money. 7-day trial, no credit card.',
	cta_post_btn: 'Try free for 7 days',
	cta_post_demo: 'See the demo dashboard',
	cta_inline: 'Want to see this on your own data?',
	cta_inline_btn: 'Try for free',
	legal_updated: 'Last updated',
	notfound_title: 'Page not found',
	notfound_desc: 'This address does not exist or has moved. Try one of the pages below.',
	notfound_home: 'Go home',
	notfound_blog: 'Read the blog',
	notfound_docs: 'Open the docs',
};

export function getCopy(locale: Locale): Copy {
	return locale === 'en' ? EN : ID;
}
