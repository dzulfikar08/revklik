import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import {
	ActivityIndicator,
	Alert,
	Modal,
	ScrollView,
	Text,
	TouchableOpacity,
	View,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PanelBody, PanelMsg } from "@/components/analytics/ui";
import { Button, Input } from "@/components/ui";
import { selectActiveSite, useActiveSite } from "@/lib/active-site";
import { fmt, money } from "@/lib/analytics-data";
import { fetchSites, LegacyApiError } from "@/lib/klikapa/api";
import type { SiteWithStats } from "@/lib/klikapa/api";
import {
	addExclusion,
	createLegacySite,
	deleteLegacySite,
	fetchExclusions,
	fetchMyFingerprint,
	fetchSiteSnippet,
	purgeMyVisits,
	removeExclusion,
} from "@/lib/klikapa/sites";

const errMsg = (e: unknown, fallback: string): string =>
	e instanceof LegacyApiError ? e.message : fallback;

const fpLabel = (fp: string): string =>
	fp.length > 36 ? `${fp.slice(0, 24)}…${fp.slice(-8)}` : fp;

const noticeFor = (setNotice: (v: string | null) => void) => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return (message: string) => {
		setNotice(message);
		clearTimeout(timer);
		timer = setTimeout(() => setNotice(null), 2600);
	};
};

/* ------------------------------ snippet modal ------------------------------ */

const SnippetModal = ({ site, onClose }: { site: SiteWithStats; onClose: () => void }) => {
	const { theme } = useUnistyles();
	const [copied, setCopied] = useState(false);
	const snippetQ = useQuery({
		queryFn: () => fetchSiteSnippet(site.id),
		queryKey: ["legacy", "snippet", site.id],
	});
	const snippet = snippetQ.data?.snippet ?? "";
	let snippetText = snippet;
	if (snippetQ.isLoading) {
		snippetText = "Loading…";
	}
	if (snippetQ.isError) {
		snippetText = "Couldn't load the snippet.";
	}
	const copy = async () => {
		await Clipboard.setStringAsync(snippet);
		setCopied(true);
		setTimeout(() => setCopied(false), 1600);
	};

	return (
		<Modal animationType="fade" transparent visible onRequestClose={onClose}>
			<View style={styles.modalScrim}>
				<View style={[styles.modalCard, { backgroundColor: theme.colors.card }]}>
					<Text style={styles.modalTitle}>
						Tracking snippet · <Text style={styles.mono}>{site.domain}</Text>
					</Text>
					<Text style={styles.modalSub}>
						Paste this into your site&apos;s HTML. Stats start flowing on the first visit.
					</Text>
					<ScrollView style={[styles.snippetBox, { backgroundColor: theme.colors.background }]}>
						<Text style={styles.snippetText}>{snippetText}</Text>
					</ScrollView>
					<View style={styles.modalActions}>
						<Button label="Close" onPress={onClose} variant="ghost" />
						<Button
							busy={!snippet}
							icon={copied ? "checkmark" : "copy-outline"}
							label={copied ? "Copied" : "Copy snippet"}
							onPress={() => copy()}
						/>
					</View>
				</View>
			</View>
		</Modal>
	);
};

/* ---------------------------- exclusions section --------------------------- */

const ExclusionsSection = ({
	siteId,
	notify,
}: {
	siteId: string;
	notify: (message: string) => void;
}) => {
	const { theme } = useUnistyles();
	const [confirmPurge, setConfirmPurge] = useState(false);

	const exclusionsQ = useQuery({
		queryFn: () => fetchExclusions(siteId),
		queryKey: ["legacy", "exclusions", siteId],
	});
	const fingerprintQ = useQuery({
		queryFn: () => fetchMyFingerprint(siteId),
		queryKey: ["legacy", "my-fingerprint", siteId],
	});

	const invalidate = { queryKey: ["legacy", "exclusions", siteId] };
	const qc = useQueryClient();

	const addMut = useMutation({
		mutationFn: () => addExclusion(siteId),
		onError: (e: unknown) => Alert.alert(errMsg(e, "Couldn't exclude device")),
		onSuccess: (list) => {
			qc.setQueryData(invalidate.queryKey, list);
			notify("This device is excluded from tracking");
		},
	});
	const removeMut = useMutation({
		mutationFn: (fp: string) => removeExclusion(siteId, fp),
		onError: (e: unknown) => Alert.alert(errMsg(e, "Couldn't remove exclusion")),
		onSuccess: (list) => qc.setQueryData(invalidate.queryKey, list),
	});
	const purgeMut = useMutation({
		mutationFn: () => purgeMyVisits(siteId),
		onError: (e: unknown) => Alert.alert(errMsg(e, "Couldn't purge visits")),
		onSuccess: (r) => {
			setConfirmPurge(false);
			notify(`Purged ${r.events} events, ${r.sessions} sessions, ${r.profiles} profiles`);
		},
	});

	const exclusions = exclusionsQ.data ?? [];

	return (
		<View style={[styles.exclusions, { borderColor: theme.colors.border }]}>
			<Text style={styles.exclusionsHint}>
				Exclude this device from tracking. It is matched by a one-way hash of IP, user-agent and
				language, keyed per site. Run once on every device you develop from.
			</Text>
			<View style={styles.exclusionsActions}>
				<Button
					busy={addMut.isPending}
					icon="eye-off-outline"
					label="Exclude this device"
					onPress={() => addMut.mutate()}
					size="sm"
					variant="outline"
				/>
				{confirmPurge ? (
					<>
						<Button
							busy={purgeMut.isPending}
							label="Delete past visits"
							onPress={() => purgeMut.mutate()}
							size="sm"
							variant="destructive"
						/>
						<Button
							label="Cancel"
							onPress={() => setConfirmPurge(false)}
							size="sm"
							variant="ghost"
						/>
					</>
				) : (
					<Button
						label="Purge my past visits"
						onPress={() => setConfirmPurge(true)}
						size="sm"
						variant="ghost"
					/>
				)}
			</View>
			{fingerprintQ.data?.fingerprint ? (
				<Text style={styles.fingerprint}>
					this device: {fpLabel(fingerprintQ.data.fingerprint)}
				</Text>
			) : null}
			{exclusions.length > 0 ? (
				<View style={styles.exclusionList}>
					<Text style={styles.exclusionHead}>EXCLUDED FINGERPRINTS ({exclusions.length})</Text>
					{exclusions.map((fp) => (
						<View key={fp} style={styles.exclusionRow}>
							<Text numberOfLines={1} style={styles.fingerprint}>
								{fpLabel(fp)}
							</Text>
							<TouchableOpacity disabled={removeMut.isPending} onPress={() => removeMut.mutate(fp)}>
								<Text style={styles.exclusionRemove}>✕</Text>
							</TouchableOpacity>
						</View>
					))}
				</View>
			) : null}
		</View>
	);
};

/* --------------------------------- site row -------------------------------- */

/* Small themed icon helper so action glyphs pick up the muted color. */

const Ionicon = ({ name }: { name: keyof typeof Ionicons.glyphMap }) => {
	const { theme } = useUnistyles();
	return <Ionicons color={theme.colors.mutedForeground} name={name} size={14} />;
};

const SiteRow = ({
	site,
	active,
	onPick,
	onSnippet,
	notify,
}: {
	site: SiteWithStats;
	active: boolean;
	onPick: () => void;
	onSnippet: () => void;
	notify: (message: string) => void;
}) => {
	const { theme } = useUnistyles();
	const qc = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	const [showExclusions, setShowExclusions] = useState(false);

	const deleteMut = useMutation({
		mutationFn: () => deleteLegacySite(site.id),
		onError: (e: unknown) => Alert.alert(errMsg(e, "Couldn't delete site")),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["legacy", "sites"] });
			notify(`Deleted ${site.domain}`);
		},
	});

	return (
		<TouchableOpacity
			onPress={onPick}
			style={[
				styles.siteCard,
				{ backgroundColor: theme.colors.background },
				active && { borderColor: theme.colors.chart },
			]}
		>
			<View style={styles.siteMain}>
				<View style={styles.siteTitleRow}>
					{active ? (
						<View style={[styles.activeDot, { backgroundColor: theme.colors.chart }]} />
					) : null}
					<Text numberOfLines={1} style={styles.siteDomain}>
						{site.domain}
					</Text>
				</View>
				<Text numberOfLines={1} style={styles.siteMeta}>
					{site.name}
					{site.visitors || site.pageviews
						? ` · ${fmt(site.visitors)} visitors · ${fmt(site.pageviews)} views${
								site.revenue ? ` · ${money(site.revenue, site.currency)}` : ""
							}`
						: ""}
				</Text>
			</View>
			<View style={styles.siteActions}>
				{confirming ? (
					<>
						<Text style={styles.confirmText}>Delete site + all data?</Text>
						<Button
							busy={deleteMut.isPending}
							label="Delete"
							onPress={() => deleteMut.mutate()}
							size="sm"
							variant="destructive"
						/>
						<Button label="Cancel" onPress={() => setConfirming(false)} size="sm" variant="ghost" />
					</>
				) : (
					<>
						<TouchableOpacity onPress={onSnippet} style={styles.siteAction}>
							<Ionicon name="code-slash-outline" />
							<Text style={styles.siteActionText}>SNIPPET</Text>
						</TouchableOpacity>
						<TouchableOpacity
							onPress={() => setShowExclusions(!showExclusions)}
							style={styles.siteAction}
						>
							<Ionicon name="eye-off-outline" />
							<Text style={styles.siteActionText}>EXCLUSIONS</Text>
						</TouchableOpacity>
						<TouchableOpacity onPress={() => setConfirming(true)} style={styles.siteAction}>
							<Ionicon name="trash-outline" />
						</TouchableOpacity>
					</>
				)}
			</View>
			{showExclusions ? <ExclusionsSection notify={notify} siteId={site.id} /> : null}
		</TouchableOpacity>
	);
};

/* -------------------------------- sites view ------------------------------- */

export const SitesView = () => {
	const { theme } = useUnistyles();
	const qc = useQueryClient();
	const activeSite = useActiveSite();
	const [snippetFor, setSnippetFor] = useState<SiteWithStats | null>(null);
	const [name, setName] = useState("");
	const [domain, setDomain] = useState("");
	const [notice, setNotice] = useState<string | null>(null);
	const notify = noticeFor(setNotice);

	const sitesQ = useQuery({
		queryFn: () => fetchSites("30d"),
		queryKey: ["legacy", "sites", "manage"],
	});
	const sites = sitesQ.data ?? [];

	const addMut = useMutation({
		mutationFn: () => createLegacySite(name.trim(), domain.trim().toLowerCase()),
		onError: (e: unknown) => Alert.alert(errMsg(e, "Couldn't add site")),
		onSuccess: (site) => {
			qc.invalidateQueries({ queryKey: ["legacy", "sites"] });
			setName("");
			notify(`Site added — ${site.domain} is ready for its snippet`);
		},
	});

	const submitAdd = () => {
		if (!name.trim() || !domain.trim()) {
			Alert.alert("Name and domain are both required.");
			return;
		}
		if (sites.some((s) => s.domain === domain.trim().toLowerCase())) {
			Alert.alert("That domain is already added.");
			return;
		}
		addMut.mutate();
	};

	const pick = (site: SiteWithStats) => {
		selectActiveSite(site.id);
		notify(`Viewing ${site.domain} — open Dashboard for stats`);
	};

	return (
		<ScrollView
			contentContainerStyle={styles.page}
			style={{ backgroundColor: theme.colors.background }}
		>
			{notice ? (
				<View style={[styles.notice, { backgroundColor: `${theme.colors.up}1A` }]}>
					<Text style={[styles.noticeText, { color: theme.colors.up }]}>{notice}</Text>
				</View>
			) : null}

			<Text style={styles.pageTitle}>Sites</Text>
			<Text style={styles.pageSub}>
				Tap a card to make it the active site for Dashboard and Visitors.
			</Text>

			<View style={styles.addPanel}>
				<Text style={styles.panelTitle}>Add a site</Text>
				<Input
					autoCapitalize="none"
					label="Name"
					onChangeText={setName}
					placeholder="Name — e.g. My blog"
					value={name}
				/>
				<Input
					autoCapitalize="none"
					keyboardType="url"
					label="Domain"
					onChangeText={setDomain}
					placeholder="example.com"
					value={domain}
				/>
				<View style={styles.addRow}>
					<Button
						busy={addMut.isPending}
						icon="add"
						label="Add site"
						onPress={submitAdd}
						size="sm"
					/>
				</View>
			</View>

			<PanelBody
				emptyText="No sites yet — add your first one above."
				hasData={sites.length > 0}
				loading={sitesQ.isLoading}
			>
				{sitesQ.isError ? (
					<PanelMsg>{errMsg(sitesQ.error, "Couldn't load sites.")}</PanelMsg>
				) : (
					<View style={styles.siteList}>
						{sites.map((s) => (
							<SiteRow
								key={s.id}
								active={s.id === activeSite}
								notify={notify}
								onPick={() => pick(s)}
								onSnippet={() => setSnippetFor(s)}
								site={s}
							/>
						))}
					</View>
				)}
			</PanelBody>

			{sitesQ.isLoading && sites.length === 0 ? (
				<ActivityIndicator color={theme.colors.chart} style={styles.spinner} />
			) : null}

			{snippetFor ? <SnippetModal onClose={() => setSnippetFor(null)} site={snippetFor} /> : null}
		</ScrollView>
	);
};

const styles = StyleSheet.create((theme, rt) => ({
	activeDot: {
		borderRadius: 999,
		height: 8,
		width: 8,
	},
	addPanel: {
		backgroundColor: theme.colors.card,
		borderColor: theme.colors.border,
		borderRadius: theme.borderRadius.xl,
		borderWidth: 1,
		gap: 10,
		padding: 12,
	},
	addRow: {
		alignItems: "flex-end",
	},
	confirmText: {
		color: theme.colors.mutedForeground,
		fontSize: 11,
	},
	exclusionHead: {
		color: theme.colors.mutedForeground,
		fontSize: 9,
		letterSpacing: 1,
	},
	exclusionList: {
		marginTop: 6,
	},
	exclusionRemove: {
		color: theme.colors.mutedForeground,
		fontSize: 13,
		paddingHorizontal: 6,
	},
	exclusionRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: 8,
		justifyContent: "space-between",
		paddingVertical: 3,
	},
	exclusions: {
		borderRadius: theme.borderRadius.md,
		borderStyle: "dashed",
		borderWidth: 1,
		marginTop: 8,
		padding: 10,
	},
	exclusionsActions: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
		marginTop: 8,
	},
	exclusionsHint: {
		color: theme.colors.mutedForeground,
		fontSize: 11,
		lineHeight: 16,
	},
	fingerprint: {
		color: theme.colors.mutedForeground,
		fontFamily: "monospace",
		fontSize: 10,
		marginTop: 6,
	},
	modalActions: {
		flexDirection: "row",
		gap: 8,
		justifyContent: "flex-end",
		marginTop: 10,
	},
	modalCard: {
		borderColor: theme.colors.border,
		borderRadius: theme.borderRadius.xl,
		borderWidth: 1,
		maxWidth: 560,
		padding: 14,
		width: "100%",
	},
	modalScrim: {
		alignItems: "center",
		backgroundColor: "#000000CC",
		flex: 1,
		justifyContent: "center",
		padding: 16,
	},
	modalSub: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
		marginBottom: 10,
		marginTop: 2,
	},
	modalTitle: {
		color: theme.colors.foreground,
		fontSize: theme.fontSize.sm,
		fontWeight: "600",
	},
	mono: {
		fontFamily: "monospace",
	},
	notice: {
		borderRadius: theme.borderRadius.md,
		paddingHorizontal: 12,
		paddingVertical: 8,
	},
	noticeText: {
		fontSize: theme.fontSize.xs,
		fontWeight: "500",
	},
	page: {
		gap: 12,
		padding: 12,
		paddingBottom: 32,
		paddingTop: 12 + rt.insets.top,
	},
	pageSub: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
		marginTop: -8,
	},
	pageTitle: {
		color: theme.colors.foreground,
		fontSize: theme.fontSize.lg,
		fontWeight: "600",
	},
	panelTitle: {
		color: theme.colors.foreground,
		fontSize: theme.fontSize.sm,
		fontWeight: "600",
	},
	siteAction: {
		alignItems: "center",
		flexDirection: "row",
		gap: 4,
	},
	siteActionText: {
		color: theme.colors.mutedForeground,
		fontFamily: "monospace",
		fontSize: 10,
	},
	siteActions: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 10,
		marginTop: 8,
	},
	siteCard: {
		borderRadius: theme.borderRadius.lg,
		borderWidth: 1,
		padding: 10,
	},
	siteDomain: {
		color: theme.colors.foreground,
		flexShrink: 1,
		fontSize: 13,
		fontWeight: "500",
	},
	siteList: {
		gap: 8,
	},
	siteMain: {
		gap: 2,
	},
	siteMeta: {
		color: theme.colors.mutedForeground,
		fontSize: 11,
	},
	siteTitleRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: 6,
	},
	snippetBox: {
		borderColor: theme.colors.border,
		borderRadius: theme.borderRadius.md,
		borderWidth: 1,
		maxHeight: 220,
		padding: 10,
	},
	snippetText: {
		color: theme.colors.foreground,
		fontFamily: "monospace",
		fontSize: 11,
		lineHeight: 17,
	},
	spinner: {
		marginTop: 8,
	},
}));
