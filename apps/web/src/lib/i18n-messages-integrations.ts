/** Strings for the integrations view. Merged by i18n-messages-views.ts. Indonesian uses the casual "kamu" register. */

export const integrationsEn = {
	// page
	"integrations.title": "Integrations",
	"integrations.subtitle":
		"Connect payments, apps, search data and imports so everything lands in this site's dashboard.",
	"integrations.tab.payments": "Payments",
	"integrations.tab.apps": "Apps",
	"integrations.tab.search": "Search",
	"integrations.tab.imports": "Imports",
	"integrations.apps.intro": "Downloads and proceeds from your mobile apps, next to your web revenue.",

	// shared card and form text
	"integrations.status.connected": "Connected",
	"integrations.status.disabled": "Disabled",
	"integrations.connect": "Connect",
	"integrations.connectName": "Connect {name}",
	"integrations.connected": "{name} connected",
	"integrations.disconnect": "Disconnect",
	"integrations.disconnectConfirm": "Disconnect {name}?",
	"integrations.disconnected": "{name} disconnected",
	"integrations.configure": "Configure",
	"integrations.configSaved": "Configuration saved",
	"integrations.saveChanges": "Save changes",
	"integrations.saving": "Saving…",
	"integrations.cancel": "Cancel",
	"integrations.name": "Name",
	"integrations.keepCurrent": "leave empty to keep current",
	"integrations.test": "Test",
	"integrations.testing": "Testing…",
	"integrations.testFailed": "Test failed",
	"integrations.testDetail": "{message}: {detail}",
	"integrations.syncNow": "Sync now",
	"integrations.syncing": "Syncing…",
	"integrations.syncFailed": "Sync failed",
	"integrations.enable": "Enable",
	"integrations.disable": "Disable",
	"integrations.lastSync": "Last sync {when}",
	"integrations.reauthorize": "Re-authorize",
	"integrations.authorizeGoogle": "Authorize with Google",

	// event log
	"integrations.events.show": "Events",
	"integrations.events.hide": "Hide events",
	"integrations.events.recent": "Recent events",
	"integrations.events.loading": "Loading events…",
	"integrations.events.empty": "No events yet. Webhooks and connection tests will show up here.",
	"integrations.events.event": "Event",
	"integrations.events.direction": "Direction",
	"integrations.events.status": "Status",
	"integrations.events.time": "Time",

	// payment provider card
	"integrations.webhookUrl": "Webhook URL",
	"integrations.webhookUrlHint": "Paste this URL in your {name} dashboard webhook settings.",
	"integrations.copy": "Copy",
	"integrations.copied": "Copied",

	// provider descriptions
	"integrations.provider.mailchimp.desc": "Sync subscriber data and track email engagement",
	"integrations.provider.convertkit.desc": "Connect your ConvertKit audience data",
	"integrations.provider.kit.desc": "Sync with Kit (formerly ConvertKit) v3 API",
	"integrations.provider.beehiiv.desc": "Track newsletter subscriber activity",
	"integrations.provider.meta_ads.desc": "Import ad performance and conversion data",
	"integrations.provider.google_ads.desc": "Link Google Ads campaign data",
	"integrations.provider.appstoreconnect.desc":
		"Sync App Store downloads, proceeds, and price changes into the same view as web revenue",
	"integrations.provider.midtrans.desc":
		"Indonesian payment gateway: GoPay, QRIS, bank transfer, credit card, ShopeePay",
	"integrations.provider.xendit.desc":
		"Southeast Asian payment gateway: OVO, DANA, ShopeePay, virtual accounts",
	"integrations.provider.stripe.desc": "Global payments: cards, wallets, bank debits, subscriptions",
	"integrations.provider.lemonsqueezy.desc": "Digital products and SaaS billing platform",
	"integrations.provider.paywuz.desc":
		"Indonesian payment gateway: QRIS, virtual accounts, e-wallets",
	"integrations.provider.doku.desc":
		"Indonesian payment gateway: virtual accounts, QRIS, e-wallets, cards",
	"integrations.provider.mayar.desc":
		"Indonesian payment links and invoices: QRIS, e-wallets, bank transfer",

	// field labels and hints that are our own wording (provider terms stay as is)
	"integrations.field.isProduction": "Production Mode",
	"integrations.field.backfillDays": "Backfill Days (optional)",
	"integrations.asc.issuerHint":
		"App Store Connect → Users and Access → Integrations → App Store Connect API. Shown above the keys table.",
	"integrations.asc.keyIdHint":
		"Same page: the 10-character ID next to the key you generate in step 1 below.",
	"integrations.asc.privateKeyHint":
		"The full .p8 contents including the BEGIN/END lines. Downloaded once when the key is created. If lost, revoke the key and create a new one.",
	"integrations.asc.appIdHint":
		"Apps → your app → General → App Information → Apple ID (the 10-digit number).",
	"integrations.asc.vendorHint":
		"Payments and Financial Reports → top-left, under your Legal Entity Name.",
	"integrations.asc.backfillHint":
		"How far back to pull on first sync (max 90). Apple keeps 13 months of reports.",

	// App Store Connect instructions (<b> bold, <a> link, <i> inline code)
	"integrations.asc.before": "Before you start",
	"integrations.asc.beforeBody":
		"The Paid Applications Agreement must be signed (Agreements, Tax, and Banking). Without it Apple has no sales reports to give.",
	"integrations.asc.step1": "Step 1: create an API key",
	"integrations.asc.step1a":
		"Go to <a>appstoreconnect.apple.com → Users and Access → Integrations</a> and note the <b>Issuer ID</b> shown above the keys table.",
	"integrations.asc.step1b":
		"Click <b>+</b> to generate a new key. Name it (e.g. \"RevKlik analytics\") and pick the <b>Admin</b> role. Admin enables engagement metrics (impressions, page views). The roles \"Finance\" or \"Sales and Reports\" also work, but only for downloads and proceeds.",
	"integrations.asc.step1c":
		"<b>Download</b> the .p8 file. Apple lets you download it exactly once. Paste its full contents below, and copy the key's <b>Key ID</b> from the table.",
	"integrations.asc.step2": "Step 2: app and vendor numbers",
	"integrations.asc.step2a":
		"App ID: <b>Apps → your app → General → App Information → Apple ID</b>.",
	"integrations.asc.step2b":
		"Vendor Number: <b>Payments and Financial Reports</b>, top-left corner, under your Legal Entity Name.",
	"integrations.asc.after":
		"After connecting, hit <b>Test</b> to verify the key, then <b>Sync now</b>. Data lands in the Revenue panel under \"App Store\"; price changes show up as flags on the main chart. Reports arrive daily, so new days appear every morning (US Pacific).",
	"integrations.asc.synced": "Synced {days} day(s), {changes} price change(s) flagged",

	// DOKU instructions
	"integrations.doku.step1": "Step 1: copy your credentials",
	"integrations.doku.step1a":
		"Log in to the <a>DOKU Dashboard</a>, then open <b>Settings → Account → API Keys</b>.",
	"integrations.doku.step1b":
		"Copy the <b>Client ID</b> (format <i>BRN-…</i>), the field above. For the Secret Key, click <b>Reveal Key</b> and enter the 6-digit OTP sent to your email. The key is visible for 30 seconds.",
	"integrations.doku.step2": "Step 2: register the notification URL (per payment method)",
	"integrations.doku.step2a":
		"In the dashboard: <b>Settings → Payment Settings</b>, then select the payment method (Virtual Account, Cards, e-Wallet, Convenience Store, PayLater, Direct Debit, Digital Banking, QRIS). Each one is configured separately.",
	"integrations.doku.step2b": "Set the notification URL to <i>{url}</i> and save.",
	"integrations.doku.after":
		"The URL path is part of DOKU's signature, so it must match exactly. Payments arrive in the Revenue panel. Each DOKU virtual account or payment method needs its own notification URL.",

	// marketplaces (hidden for now, see MARKETPLACES_ENABLED)
	"integrations.marketplace.desc": "Indonesian e-commerce marketplace",
	"integrations.marketplace.syncOrders": "Sync orders",
	"integrations.marketplace.synced": "{name} orders synced",
	"integrations.marketplace.viewOrders": "View orders",
	"integrations.marketplace.hideOrders": "Hide orders",
	"integrations.marketplace.loading": "Loading orders…",
	"integrations.marketplace.empty": "No orders found. Click \"Sync orders\" to fetch from {name}.",
	"integrations.marketplace.order": "Order",
	"integrations.marketplace.amount": "Amount",
	"integrations.marketplace.status": "Status",
	"integrations.marketplace.ordered": "Ordered",
	"integrations.marketplace.showing": "Showing 20 of {n} orders.",

	// Google Search Console
	"integrations.gsc.desc":
		"Import search query performance from Google: clicks, impressions, CTR and position.",
	"integrations.gsc.disconnectName": "Google Search Console",
	"integrations.gsc.synced_one": "Search Console synced: {n} day of queries",
	"integrations.gsc.synced": "Search Console synced: {n} days of queries",
	"integrations.gsc.authAdminOnly": "Only the site owner or an admin can connect Google Search Console.",
	"integrations.gsc.authFailed": "Couldn't start the Google sign-in. Try again.",
	"integrations.gsc.loading": "Loading queries…",
	"integrations.gsc.empty": "No search queries yet.",
	"integrations.gsc.emptyConnected": "No search queries yet. Run a sync after authorizing.",
	"integrations.gsc.totals": "Last 30 days: {clicks} clicks · {impressions} impressions",
	"integrations.gsc.query": "Query",
	"integrations.gsc.clicks": "Clicks",
	"integrations.gsc.impressions": "Impr.",
	"integrations.gsc.ctr": "CTR",
	"integrations.gsc.position": "Pos.",
	"integrations.gsc.showing": "Showing {shown} of {n} queries.",
	"integrations.gsc.stale":
		"Last sync was {when}, more than {days} days ago. These numbers may be out of date. Press Sync now to refresh.",

	// imports
	"imports.hint": "visitors · pages · countries · sources",
	"imports.ods.desc":
		"Import historical visitors, pages, countries, and sources from your OneDollarStats account.",
	"imports.ods.howTo":
		"How to get your API key:",
	"imports.ods.howToBody":
		"log in to onedollarstats.com → account settings (top-right) → API Keys → Create API Key.",
	"imports.ods.apiKey": "API Key",
	"imports.ods.apiKeyPlaceholder": "x-api-key value",
	"imports.ods.domain": "Site domain (as registered in OneDollarStats)",
	"imports.ods.submit": "Import from OneDollarStats",
	"imports.ods.importing": "Importing…",
	"imports.ods.imported_one": "Imported {n} event from OneDollarStats",
	"imports.ods.imported": "Imported {n} events from OneDollarStats",
	"imports.ods.nothingNew": "No new data found",
	"imports.ods.failed": "Import failed",
	"imports.ods.created_one": "Created {n} event.",
	"imports.ods.created": "Created {n} events.",
} as const;

export const integrationsId: Record<Exclude<keyof typeof integrationsEn, `${string}_one`>, string> =
	{
		"integrations.title": "Integrasi",
		"integrations.subtitle":
			"Hubungkan pembayaran, aplikasi, data pencarian, dan impor supaya semuanya masuk ke dasbor situs ini.",
		"integrations.tab.payments": "Pembayaran",
		"integrations.tab.apps": "Aplikasi",
		"integrations.tab.search": "Pencarian",
		"integrations.tab.imports": "Impor",
		"integrations.apps.intro":
			"Unduhan dan pendapatan dari aplikasi mobilmu, bersebelahan dengan pendapatan web.",

		"integrations.status.connected": "Terhubung",
		"integrations.status.disabled": "Nonaktif",
		"integrations.connect": "Hubungkan",
		"integrations.connectName": "Hubungkan {name}",
		"integrations.connected": "{name} terhubung",
		"integrations.disconnect": "Putuskan",
		"integrations.disconnectConfirm": "Putuskan {name}?",
		"integrations.disconnected": "{name} diputus",
		"integrations.configure": "Atur",
		"integrations.configSaved": "Pengaturan disimpan",
		"integrations.saveChanges": "Simpan perubahan",
		"integrations.saving": "Menyimpan…",
		"integrations.cancel": "Batal",
		"integrations.name": "Nama",
		"integrations.keepCurrent": "kosongkan untuk memakai yang sekarang",
		"integrations.test": "Tes",
		"integrations.testing": "Mengetes…",
		"integrations.testFailed": "Tes gagal",
		"integrations.testDetail": "{message}: {detail}",
		"integrations.syncNow": "Sinkron sekarang",
		"integrations.syncing": "Menyinkronkan…",
		"integrations.syncFailed": "Sinkronisasi gagal",
		"integrations.enable": "Aktifkan",
		"integrations.disable": "Nonaktifkan",
		"integrations.lastSync": "Sinkron terakhir {when}",
		"integrations.reauthorize": "Otorisasi ulang",
		"integrations.authorizeGoogle": "Otorisasi dengan Google",

		"integrations.events.show": "Event",
		"integrations.events.hide": "Sembunyikan event",
		"integrations.events.recent": "Event terbaru",
		"integrations.events.loading": "Memuat event…",
		"integrations.events.empty": "Belum ada event. Webhook dan tes koneksi akan muncul di sini.",
		"integrations.events.event": "Event",
		"integrations.events.direction": "Arah",
		"integrations.events.status": "Status",
		"integrations.events.time": "Waktu",

		"integrations.webhookUrl": "URL Webhook",
		"integrations.webhookUrlHint": "Tempel URL ini di pengaturan webhook dasbor {name}.",
		"integrations.copy": "Salin",
		"integrations.copied": "Tersalin",

		"integrations.provider.mailchimp.desc": "Sinkronkan data pelanggan dan pantau keterlibatan email",
		"integrations.provider.convertkit.desc": "Hubungkan data audiens ConvertKit kamu",
		"integrations.provider.kit.desc": "Sinkron dengan API Kit v3 (dulu ConvertKit)",
		"integrations.provider.beehiiv.desc": "Pantau aktivitas pelanggan newsletter",
		"integrations.provider.meta_ads.desc": "Impor performa iklan dan data konversi",
		"integrations.provider.google_ads.desc": "Hubungkan data kampanye Google Ads",
		"integrations.provider.appstoreconnect.desc":
			"Sinkronkan unduhan, pendapatan, dan perubahan harga App Store ke tampilan yang sama dengan pendapatan web",
		"integrations.provider.midtrans.desc":
			"Payment gateway Indonesia: GoPay, QRIS, transfer bank, kartu kredit, ShopeePay",
		"integrations.provider.xendit.desc":
			"Payment gateway Asia Tenggara: OVO, DANA, ShopeePay, virtual account",
		"integrations.provider.stripe.desc":
			"Pembayaran global: kartu, dompet digital, debit bank, langganan",
		"integrations.provider.lemonsqueezy.desc": "Platform penagihan untuk produk digital dan SaaS",
		"integrations.provider.paywuz.desc":
			"Payment gateway Indonesia: QRIS, virtual account, e-wallet",
		"integrations.provider.doku.desc":
			"Payment gateway Indonesia: virtual account, QRIS, e-wallet, kartu",
		"integrations.provider.mayar.desc":
			"Link pembayaran dan invoice Indonesia: QRIS, e-wallet, transfer bank",

		"integrations.field.isProduction": "Mode produksi",
		"integrations.field.backfillDays": "Hari backfill (opsional)",
		"integrations.asc.issuerHint":
			"App Store Connect → Users and Access → Integrations → App Store Connect API. Ada di atas tabel key.",
		"integrations.asc.keyIdHint":
			"Halaman yang sama: ID 10 karakter di samping key yang kamu buat di langkah 1 di bawah.",
		"integrations.asc.privateKeyHint":
			"Isi lengkap file .p8 termasuk baris BEGIN/END. File ini hanya bisa diunduh sekali saat key dibuat. Kalau hilang, cabut key lalu buat yang baru.",
		"integrations.asc.appIdHint":
			"Apps → aplikasimu → General → App Information → Apple ID (angka 10 digit).",
		"integrations.asc.vendorHint":
			"Payments and Financial Reports → pojok kiri atas, di bawah Legal Entity Name.",
		"integrations.asc.backfillHint":
			"Seberapa jauh data ditarik saat sinkron pertama (maks. 90). Apple menyimpan laporan 13 bulan.",

		"integrations.asc.before": "Sebelum mulai",
		"integrations.asc.beforeBody":
			"Paid Applications Agreement harus sudah ditandatangani (Agreements, Tax, and Banking). Tanpa itu Apple tidak punya laporan penjualan untuk diberikan.",
		"integrations.asc.step1": "Langkah 1: buat API key",
		"integrations.asc.step1a":
			"Buka <a>appstoreconnect.apple.com → Users and Access → Integrations</a> dan catat <b>Issuer ID</b> yang tampil di atas tabel key.",
		"integrations.asc.step1b":
			"Klik <b>+</b> untuk membuat key baru. Beri nama (misalnya \"RevKlik analytics\") dan pilih role <b>Admin</b>. Role Admin mengaktifkan metrik engagement (impresi, page view). Role \"Finance\" atau \"Sales and Reports\" juga bisa, tapi hanya untuk unduhan dan pendapatan.",
		"integrations.asc.step1c":
			"<b>Unduh</b> file .p8. Apple hanya mengizinkan unduh satu kali. Tempel seluruh isinya di bawah, lalu salin <b>Key ID</b> dari tabel.",
		"integrations.asc.step2": "Langkah 2: nomor app dan vendor",
		"integrations.asc.step2a":
			"App ID: <b>Apps → aplikasimu → General → App Information → Apple ID</b>.",
		"integrations.asc.step2b":
			"Vendor Number: <b>Payments and Financial Reports</b>, pojok kiri atas, di bawah Legal Entity Name.",
		"integrations.asc.after":
			"Setelah terhubung, klik <b>Tes</b> untuk memastikan key-nya valid, lalu <b>Sinkron sekarang</b>. Data masuk ke panel Pendapatan dengan label \"App Store\"; perubahan harga muncul sebagai penanda di grafik utama. Laporan datang harian, jadi hari baru muncul tiap pagi (waktu US Pacific).",
		"integrations.asc.synced": "{days} hari disinkronkan, {changes} perubahan harga ditandai",

		"integrations.doku.step1": "Langkah 1: salin kredensial",
		"integrations.doku.step1a":
			"Masuk ke <a>DOKU Dashboard</a>, lalu buka <b>Settings → Account → API Keys</b>.",
		"integrations.doku.step1b":
			"Salin <b>Client ID</b> (formatnya <i>BRN-…</i>), yaitu kolom di atas. Untuk Secret Key, klik <b>Reveal Key</b> dan masukkan OTP 6 digit yang dikirim ke emailmu. Key hanya terlihat selama 30 detik.",
		"integrations.doku.step2": "Langkah 2: daftarkan URL notifikasi (per metode pembayaran)",
		"integrations.doku.step2a":
			"Di dashboard: <b>Settings → Payment Settings</b>, lalu pilih metode pembayarannya (Virtual Account, Cards, e-Wallet, Convenience Store, PayLater, Direct Debit, Digital Banking, QRIS). Tiap metode diatur sendiri-sendiri.",
		"integrations.doku.step2b": "Isi URL notifikasi dengan <i>{url}</i> lalu simpan.",
		"integrations.doku.after":
			"Path URL ini bagian dari signature DOKU, jadi harus persis sama. Pembayaran masuk ke panel Pendapatan. Tiap virtual account atau metode pembayaran DOKU butuh URL notifikasi sendiri.",

		"integrations.marketplace.desc": "Marketplace e-commerce Indonesia",
		"integrations.marketplace.syncOrders": "Sinkron pesanan",
		"integrations.marketplace.synced": "Pesanan {name} disinkronkan",
		"integrations.marketplace.viewOrders": "Lihat pesanan",
		"integrations.marketplace.hideOrders": "Sembunyikan pesanan",
		"integrations.marketplace.loading": "Memuat pesanan…",
		"integrations.marketplace.empty":
			"Belum ada pesanan. Klik \"Sinkron pesanan\" untuk mengambil dari {name}.",
		"integrations.marketplace.order": "Pesanan",
		"integrations.marketplace.amount": "Jumlah",
		"integrations.marketplace.status": "Status",
		"integrations.marketplace.ordered": "Dipesan",
		"integrations.marketplace.showing": "Menampilkan 20 dari {n} pesanan.",

		"integrations.gsc.desc":
			"Impor performa kueri pencarian dari Google: klik, impresi, CTR, dan posisi.",
		"integrations.gsc.disconnectName": "Google Search Console",
		"integrations.gsc.synced": "Search Console disinkronkan: kueri {n} hari",
		"integrations.gsc.authAdminOnly":
			"Hanya pemilik situs atau admin yang bisa menghubungkan Google Search Console.",
		"integrations.gsc.authFailed": "Login Google tidak bisa dimulai. Coba lagi.",
		"integrations.gsc.loading": "Memuat kueri…",
		"integrations.gsc.empty": "Belum ada kueri pencarian.",
		"integrations.gsc.emptyConnected": "Belum ada kueri pencarian. Jalankan sinkron setelah otorisasi.",
		"integrations.gsc.totals": "30 hari terakhir: {clicks} klik · {impressions} impresi",
		"integrations.gsc.query": "Kueri",
		"integrations.gsc.clicks": "Klik",
		"integrations.gsc.impressions": "Impr.",
		"integrations.gsc.ctr": "CTR",
		"integrations.gsc.position": "Pos.",
		"integrations.gsc.showing": "Menampilkan {shown} dari {n} kueri.",
		"integrations.gsc.stale":
			"Sinkron terakhir {when}, lebih dari {days} hari lalu. Angka di bawah bisa sudah usang. Tekan Sinkron sekarang untuk memperbarui.",

		"imports.hint": "pengunjung · halaman · negara · sumber",
		"imports.ods.desc":
			"Impor data historis pengunjung, halaman, negara, dan sumber dari akun OneDollarStats kamu.",
		"imports.ods.howTo": "Cara mendapatkan API key:",
		"imports.ods.howToBody":
			"masuk ke onedollarstats.com → pengaturan akun (kanan atas) → API Keys → Create API Key.",
		"imports.ods.apiKey": "API Key",
		"imports.ods.apiKeyPlaceholder": "nilai x-api-key",
		"imports.ods.domain": "Domain situs (sesuai yang terdaftar di OneDollarStats)",
		"imports.ods.submit": "Impor dari OneDollarStats",
		"imports.ods.importing": "Mengimpor…",
		"imports.ods.imported": "{n} event diimpor dari OneDollarStats",
		"imports.ods.nothingNew": "Tidak ada data baru",
		"imports.ods.failed": "Impor gagal",
		"imports.ods.created": "{n} event dibuat.",
	};
