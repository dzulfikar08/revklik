/**
 * Behavior panels: heatmap and session recordings. Indonesian is written for
 * Indonesian founders (casual "kamu"), not word for word. `<key>_one` entries
 * are English singulars (used when `n` is 1).
 */

export const behaviorEn = {
	// heatmap
	"heatmap.title": "Heatmap",
	"heatmap.hint": "clicks · scroll depth",
	"heatmap.feature": "Heatmaps",
	"heatmap.clicks": "{c} clicks",
	"heatmap.clicks_one": "{c} click",
	"heatmap.sessions": "{c} sessions",
	"heatmap.sessions_one": "{c} session",
	"heatmap.scrollDepth": "Scroll depth",
	"heatmap.topElements": "Top clicked elements",

	// recordings: panel
	"recordings.title": "Recordings",
	"recordings.hintCount": "{n} sessions",
	"recordings.hintCount_one": "{n} session",
	"recordings.hintNone": "sessions",
	"recordings.feature": "Session recordings",
	"recordings.colDevice": "Device",
	"recordings.colPath": "Path",
	"recordings.colDuration": "Duration",
	"recordings.colEvents": "Events",
	"recordings.colWhen": "When",
	"recordings.viewportUnknown": "unknown viewport",
	"recordings.deviceMobile": "{px}px · mobile",
	"recordings.deviceTablet": "{px}px · tablet",
	"recordings.deviceDesktop": "{px}px · desktop",
	"recordings.locked": "Session recordings are a Growth feature.",

	// recordings: replay
	"recordings.replayLabel": "Session recording replay",
	"recordings.replayTitle": "Session Recording",
	"recordings.close": "Close replay",
	"recordings.play": "Play",
	"recordings.pause": "Pause",
	"recordings.restart": "Back to start",
	"recordings.position": "Playback position",
	"recordings.events": "{n} events",
	"recordings.events_one": "{n} event",
	"recordings.viewport": "Viewport: {w}×{h}",
	"recordings.pressPlay": "Press play to replay events",
	"recordings.evClick": "Click at ({x}, {y}) on <{tag}>",
	"recordings.evScroll": "Scroll to y={y}",
	"recordings.evMutation": "DOM change: {n} mutations",
	"recordings.evMutation_one": "DOM change: {n} mutation",
	"recordings.evResize": "Resize to {w}x{h}",
	"recordings.evUnknown": "Unknown event",
} as const;

type BehaviorKey = keyof typeof behaviorEn;

export const behaviorId: Record<Exclude<BehaviorKey, `${string}_one`>, string> = {
	// heatmap
	"heatmap.title": "Heatmap",
	"heatmap.hint": "klik · kedalaman scroll",
	"heatmap.feature": "Heatmap",
	"heatmap.clicks": "{c} klik",
	"heatmap.sessions": "{c} sesi",
	"heatmap.scrollDepth": "Kedalaman scroll",
	"heatmap.topElements": "Elemen paling sering diklik",

	// recordings: panel
	"recordings.title": "Rekaman",
	"recordings.hintCount": "{n} sesi",
	"recordings.hintNone": "sesi",
	"recordings.feature": "Rekaman sesi",
	"recordings.colDevice": "Perangkat",
	"recordings.colPath": "Halaman",
	"recordings.colDuration": "Durasi",
	"recordings.colEvents": "Aktivitas",
	"recordings.colWhen": "Kapan",
	"recordings.viewportUnknown": "ukuran layar tidak diketahui",
	"recordings.deviceMobile": "{px}px · ponsel",
	"recordings.deviceTablet": "{px}px · tablet",
	"recordings.deviceDesktop": "{px}px · desktop",
	"recordings.locked": "Rekaman sesi adalah fitur paket Growth.",

	// recordings: replay
	"recordings.replayLabel": "Putar ulang rekaman sesi",
	"recordings.replayTitle": "Rekaman Sesi",
	"recordings.close": "Tutup pemutar",
	"recordings.play": "Putar",
	"recordings.pause": "Jeda",
	"recordings.restart": "Kembali ke awal",
	"recordings.position": "Posisi pemutaran",
	"recordings.events": "{n} aktivitas",
	"recordings.viewport": "Ukuran layar: {w}×{h}",
	"recordings.pressPlay": "Tekan putar untuk memutar ulang aktivitas",
	"recordings.evClick": "Klik di ({x}, {y}) pada <{tag}>",
	"recordings.evScroll": "Scroll ke y={y}",
	"recordings.evMutation": "Perubahan DOM: {n} mutasi",
	"recordings.evResize": "Ubah ukuran jadi {w}x{h}",
	"recordings.evUnknown": "Aktivitas tidak dikenal",
};
