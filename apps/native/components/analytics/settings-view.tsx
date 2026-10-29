import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, ScrollView, Switch, Text, TouchableOpacity, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { AccountsSection } from "@/components/analytics/accounts-section";
import { Panel, PanelBody } from "@/components/analytics/ui";
import { NotificationsSection, PlanSection } from "@/components/push-settings";
import { Button, Input, Row } from "@/components/ui";
import { useActiveSite } from "@/lib/active-site";
import { authSignOut, useAuth } from "@/lib/auth";
import {
	createEmailReport,
	deleteEmailReport,
	fetchEmailReports,
	updateEmailReport,
} from "@/lib/klikapa/analytics-settings";
import { fetchSites, API_URL, LegacyApiError } from "@/lib/klikapa/api";
import type { SiteWithStats } from "@/lib/klikapa/api";
import {
	fetchTeam,
	inviteTeamMember,
	removeTeamMember,
	updateTeamMemberRole,
} from "@/lib/klikapa/team";
import type { LegacyTeamMember, TeamRole } from "@/lib/klikapa/team";

const FREQUENCIES = ["daily", "weekly", "monthly"] as const;

const ROLES: readonly { value: TeamRole; label: string }[] = [
	{ label: "Admin", value: "admin" },
	{ label: "Editor", value: "editor" },
	{ label: "Viewer", value: "viewer" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const errMsg = (e: unknown, fallback: string): string =>
	e instanceof LegacyApiError ? e.message : fallback;

const sentLabel = (iso: string | null): string =>
	iso ? new Date(iso).toDateString().slice(4) : "never";

/* ------------------------------ email reports ------------------------------ */

const EmailReportsSection = ({ siteId }: { siteId: string }) => {
	const qc = useQueryClient();
	const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]>("weekly");

	const reportsQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchEmailReports(siteId),
		queryKey: ["legacy", "email-reports", siteId],
	});
	const invalidate = { queryKey: ["legacy", "email-reports", siteId] };
	const reports = reportsQ.data ?? [];

	const createMut = useMutation({
		mutationFn: () => createEmailReport(siteId, frequency),
		onError: (e: unknown) => Alert.alert(errMsg(e, "Failed to create report")),
		onSuccess: () => qc.invalidateQueries(invalidate),
	});
	const toggleMut = useMutation({
		mutationFn: ({ enabled, id }: { enabled: boolean; id: string }) =>
			updateEmailReport(id, { enabled }),
		onError: (e: unknown) => Alert.alert(errMsg(e, "Failed to update report")),
		onSuccess: () => qc.invalidateQueries(invalidate),
	});
	const deleteMut = useMutation({
		mutationFn: (id: string) => deleteEmailReport(id),
		onError: (e: unknown) => Alert.alert(errMsg(e, "Failed to delete report")),
		onSuccess: () => qc.invalidateQueries(invalidate),
	});

	return (
		<Panel hint="recurring summary to your account email" title="Email reports">
			{siteId ? (
				<>
					<View style={styles.freqRow}>
						{FREQUENCIES.map((f) => (
							<TouchableOpacity key={f} onPress={() => setFrequency(f)}>
								<Text style={[styles.freqChip, frequency === f && styles.freqChipActive]}>{f}</Text>
							</TouchableOpacity>
						))}
						<View style={styles.freqAdd}>
							<Button
								busy={createMut.isPending}
								icon="add"
								label="Schedule"
								onPress={() => createMut.mutate()}
								size="sm"
								variant="outline"
							/>
						</View>
					</View>
					<PanelBody
						emptyText="No reports scheduled yet."
						hasData={reports.length > 0}
						loading={reportsQ.isLoading}
					>
						{reports.map((r) => (
							<View key={r.id} style={styles.reportRow}>
								<View style={styles.reportMain}>
									<Text style={styles.reportFreq}>{r.frequency}</Text>
									<Text style={styles.reportSent}>last sent {sentLabel(r.last_sent)}</Text>
								</View>
								<Switch
									onValueChange={(enabled) => toggleMut.mutate({ enabled, id: r.id })}
									value={r.enabled === 1}
								/>
								<TouchableOpacity onPress={() => deleteMut.mutate(r.id)}>
									<Text style={styles.reportDelete}>✕</Text>
								</TouchableOpacity>
							</View>
						))}
					</PanelBody>
				</>
			) : (
				<Text style={styles.sectionEmpty}>Connect a site to schedule reports.</Text>
			)}
		</Panel>
	);
};

/* ---------------------------------- team ----------------------------------- */

const MemberRow = ({
	member,
	onRole,
	onRemove,
	busy,
}: {
	member: LegacyTeamMember;
	onRole: (id: string, role: TeamRole) => void;
	onRemove: (id: string) => void;
	busy: boolean;
}) => {
	const { theme } = useUnistyles();
	const roleIdx = ROLES.findIndex((r) => r.value === member.role);
	return (
		<View style={styles.memberRow}>
			<View style={styles.memberMain}>
				<Text numberOfLines={1} style={styles.memberName}>
					{member.name ?? member.email ?? member.user_id}
				</Text>
				{member.name && member.email ? (
					<Text numberOfLines={1} style={styles.memberEmail}>
						{member.email}
					</Text>
				) : null}
			</View>
			<View
				style={[
					styles.memberStatus,
					{
						backgroundColor: member.accepted_at
							? `${theme.colors.up}1A`
							: `${theme.colors.chart}1A`,
					},
				]}
			>
				<Text
					style={[
						styles.memberStatusText,
						{
							color: member.accepted_at ? theme.colors.up : theme.colors.chart,
						},
					]}
				>
					{member.accepted_at ? "Active" : "Invited"}
				</Text>
			</View>
			<TouchableOpacity
				disabled={busy}
				onPress={() => onRole(member.id, ROLES[(roleIdx + 1) % ROLES.length]?.value ?? "viewer")}
			>
				<Text style={styles.memberRole}>{ROLES[roleIdx]?.label ?? member.role} ⇄</Text>
			</TouchableOpacity>
			<TouchableOpacity disabled={busy} onPress={() => onRemove(member.id)}>
				<Text style={styles.reportDelete}>✕</Text>
			</TouchableOpacity>
		</View>
	);
};

const TeamSection = ({ siteId }: { siteId: string }) => {
	const { theme } = useUnistyles();
	const qc = useQueryClient();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<TeamRole>("viewer");

	const teamQ = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchTeam(siteId),
		queryKey: ["legacy", "team", siteId],
	});
	const invalidate = { queryKey: ["legacy", "team", siteId] };
	const emailOk = EMAIL_RE.test(email.trim());

	const inviteMut = useMutation({
		mutationFn: () => inviteTeamMember(siteId, email.trim(), role),
		onError: (e: unknown) => Alert.alert(errMsg(e, "Couldn't send the invite")),
		onSuccess: () => {
			setEmail("");
			qc.invalidateQueries(invalidate);
		},
	});
	const roleMut = useMutation({
		mutationFn: ({ id, next }: { id: string; next: TeamRole }) => updateTeamMemberRole(id, next),
		onError: (e: unknown) => Alert.alert(errMsg(e, "Couldn't change the role")),
		onSuccess: () => qc.invalidateQueries(invalidate),
	});
	const removeMut = useMutation({
		mutationFn: (id: string) => removeTeamMember(id),
		onError: (e: unknown) => Alert.alert(errMsg(e, "Couldn't remove the member")),
		onSuccess: () => qc.invalidateQueries(invalidate),
	});

	const team = teamQ.data;

	return (
		<Panel hint="per-site access" title="Team">
			{siteId ? (
				<>
					{team?.owner ? (
						<View style={styles.memberRow}>
							<View style={styles.memberMain}>
								<Text numberOfLines={1} style={styles.memberName}>
									{team.owner.name}
								</Text>
								<Text numberOfLines={1} style={styles.memberEmail}>
									{team.owner.email}
								</Text>
							</View>
							<View style={[styles.memberStatus, { backgroundColor: `${theme.colors.up}1A` }]}>
								<Text style={[styles.memberStatusText, { color: theme.colors.up }]}>Owner</Text>
							</View>
						</View>
					) : null}
					<PanelBody
						emptyText="No invited members yet."
						hasData={(team?.members ?? []).length > 0}
						loading={teamQ.isLoading}
					>
						{(team?.members ?? []).map((m) => (
							<MemberRow
								key={m.id}
								busy={roleMut.isPending || removeMut.isPending}
								member={m}
								onRemove={(id) => removeMut.mutate(id)}
								onRole={(id, next) => roleMut.mutate({ id, next })}
							/>
						))}
					</PanelBody>
					<View style={styles.inviteRow}>
						<View style={styles.inviteEmail}>
							<Input
								autoCapitalize="none"
								keyboardType="email-address"
								onChangeText={setEmail}
								placeholder="teammate@example.com"
								value={email}
							/>
						</View>
						<TouchableOpacity
							onPress={() =>
								setRole(
									ROLES[(ROLES.findIndex((r) => r.value === role) + 1) % ROLES.length]?.value ??
										"viewer",
								)
							}
						>
							<Text style={styles.memberRole}>{role} ⇄</Text>
						</TouchableOpacity>
						<Button
							disabled={!emailOk}
							icon="person-add-outline"
							label="Invite"
							onPress={() => inviteMut.mutate()}
							size="sm"
						/>
					</View>
				</>
			) : (
				<Text style={styles.sectionEmpty}>Connect a site to manage its team.</Text>
			)}
		</Panel>
	);
};

/* -------------------------------- settings --------------------------------- */

export const SettingsView = () => {
	const { theme } = useUnistyles();
	const activeSite = useActiveSite();
	const { user } = useAuth();
	const sitesQ = useQuery({
		queryFn: (): Promise<SiteWithStats[]> => fetchSites("30d"),
		queryKey: ["legacy", "sites", "settings"],
	});
	const siteDomain = sitesQ.data?.find((s) => s.id === activeSite)?.domain ?? activeSite ?? "—";

	return (
		<ScrollView
			contentContainerStyle={styles.page}
			style={{ backgroundColor: theme.colors.background }}
		>
			<Text style={styles.pageTitle}>Settings</Text>
			<Text style={styles.pageSub}>
				Connected to your revklik account — live data from klikapa-db
			</Text>

			<Panel title="Account">
				<Row label="Name" value={user?.name ?? "—"} />
				<Row label="Email" value={user?.email ?? "—"} />
				<Row label="Role" value={user?.role ?? "—"} />
			</Panel>

			<AccountsSection />

			<NotificationsSection />
			<PlanSection />

			<Panel title="Data source">
				<Row label="API" value={API_URL} />
				<Row label="Active site" value={siteDomain} />
				<Row label="Mode" value="live" />
			</Panel>

			<EmailReportsSection siteId={activeSite ?? ""} />
			<TeamSection siteId={activeSite ?? ""} />

			<Panel title="Session">
				<Button
					icon="log-out-outline"
					label="Sign out"
					onPress={() => authSignOut()}
					variant="outline"
				/>
			</Panel>
		</ScrollView>
	);
};

const styles = StyleSheet.create((theme, rt) => ({
	freqAdd: {
		marginLeft: "auto",
	},
	freqChip: {
		backgroundColor: theme.colors.muted,
		borderColor: theme.colors.border,
		borderRadius: 999,
		borderWidth: 1,
		color: theme.colors.mutedForeground,
		fontSize: 12,
		paddingHorizontal: 10,
		paddingVertical: 4,
	},
	freqChipActive: {
		backgroundColor: theme.colors.popover,
		color: theme.colors.foreground,
		fontWeight: "600",
	},
	freqRow: {
		alignItems: "center",
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 6,
	},
	inviteEmail: {
		flex: 1,
	},
	inviteRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: 8,
		marginTop: 8,
	},
	memberEmail: {
		color: theme.colors.mutedForeground,
		fontFamily: "monospace",
		fontSize: 11,
	},
	memberMain: {
		flexShrink: 1,
	},
	memberName: {
		color: theme.colors.foreground,
		fontSize: 12,
		fontWeight: "500",
	},
	memberRole: {
		color: theme.colors.mutedForeground,
		fontFamily: "monospace",
		fontSize: 11,
	},
	memberRow: {
		alignItems: "center",
		backgroundColor: theme.colors.muted,
		borderRadius: theme.borderRadius.md,
		flexDirection: "row",
		gap: 8,
		marginBottom: 4,
		paddingHorizontal: 10,
		paddingVertical: 8,
	},
	memberStatus: {
		borderRadius: 999,
		paddingHorizontal: 8,
		paddingVertical: 2,
	},
	memberStatusText: {
		fontSize: 11,
		fontWeight: "500",
	},
	page: {
		gap: 10,
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
	reportDelete: {
		color: theme.colors.mutedForeground,
		fontSize: 14,
		paddingHorizontal: 4,
	},
	reportFreq: {
		color: theme.colors.foreground,
		fontSize: 13,
		fontWeight: "500",
	},
	reportMain: {
		flex: 1,
	},
	reportRow: {
		alignItems: "center",
		borderColor: theme.colors.border,
		borderTopWidth: 1,
		flexDirection: "row",
		gap: 10,
		paddingVertical: 8,
	},
	reportSent: {
		color: theme.colors.mutedForeground,
		fontSize: 11,
	},
	sectionEmpty: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
		paddingVertical: 12,
		textAlign: "center",
	},
}));
