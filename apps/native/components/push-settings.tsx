import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { Alert, Switch, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Panel } from "@/components/analytics/ui";
import { Button } from "@/components/ui";
import { WEB_URL } from "@/lib/env";
import { LegacyApiError } from "@/lib/klikapa/api";
import { fetchPushPrefs, sendTestPush, updatePushPrefs } from "@/lib/klikapa/push";
import type { PushPrefs } from "@/lib/klikapa/push";
import { registerForPush, usePushState } from "@/lib/push";

const PREFS_KEY = ["push", "prefs"] as const;

const errMsg = (e: unknown, fallback: string): string =>
	e instanceof LegacyApiError || e instanceof Error ? e.message : fallback;

const PrefRow = ({
	label,
	hint,
	value,
	disabled,
	onChange,
}: {
	label: string;
	hint: string;
	value: boolean;
	disabled: boolean;
	onChange: (next: boolean) => void;
}) => {
	const { theme } = useUnistyles();
	return (
		<View style={styles.prefRow}>
			<View style={styles.prefMain}>
				<Text style={styles.prefLabel}>{label}</Text>
				<Text style={styles.prefHint}>{hint}</Text>
			</View>
			<Switch
				disabled={disabled}
				onValueChange={onChange}
				thumbColor={value ? theme.colors.chart : theme.colors.mutedForeground}
				trackColor={{ false: theme.colors.muted, true: `${theme.colors.chart}66` }}
				value={value}
			/>
		</View>
	);
};

const STATUS_TEXT = {
	error: "Setup problem",
	idle: "Not registered",
	"permission-denied": "Notifications are off",
	registered: "This device gets sale alerts",
	registering: "Registering…",
	unsupported: "Not supported here",
} as const;

export const NotificationsSection = () => {
	const qc = useQueryClient();
	const push = usePushState();

	const prefsQ = useQuery({ queryFn: fetchPushPrefs, queryKey: PREFS_KEY });
	const prefsMut = useMutation({
		mutationFn: (patch: Partial<PushPrefs>) => updatePushPrefs(patch),
		onError: (e: unknown) => Alert.alert(errMsg(e, "Couldn't save notification settings")),
		onSuccess: (next) => qc.setQueryData(PREFS_KEY, next),
	});
	const testMut = useMutation({
		mutationFn: sendTestPush,
		onError: (e: unknown) => Alert.alert(errMsg(e, "Couldn't send the test notification")),
		onSuccess: ({ sent }) =>
			Alert.alert(
				sent > 0
					? "Test sent — it should arrive in a moment."
					: "No registered device yet. Enable notifications on this phone first.",
			),
	});
	const registerMut = useMutation({
		mutationFn: registerForPush,
		onError: (e: unknown) => Alert.alert(errMsg(e, "Couldn't register this device")),
	});

	const prefs = prefsQ.data;
	return (
		<Panel title="Notifications">
			<Text style={styles.status}>{STATUS_TEXT[push.status]}</Text>
			{push.message ? <Text style={styles.statusError}>{push.message}</Text> : null}

			<PrefRow
				disabled={!prefs || prefsMut.isPending}
				hint="A push for every paid order, across all your products."
				label="Sales"
				onChange={(sales) => prefsMut.mutate({ sales })}
				value={prefs?.sales ?? true}
			/>
			<PrefRow
				disabled={!prefs || prefsMut.isPending}
				hint="A push when a sale is refunded or revoked."
				label="Refunds"
				onChange={(refunds) => prefsMut.mutate({ refunds })}
				value={prefs?.refunds ?? true}
			/>
			{prefsQ.isError ? (
				<Text style={styles.statusError}>{errMsg(prefsQ.error, "Couldn't load preferences")}</Text>
			) : null}

			<View style={styles.actions}>
				{push.status === "registered" ? null : (
					<Button
						busy={registerMut.isPending}
						icon="notifications-outline"
						label="Enable notifications"
						onPress={() => registerMut.mutate()}
					/>
				)}
				<Button
					busy={testMut.isPending}
					icon="paper-plane-outline"
					label="Send test notification"
					onPress={() => testMut.mutate()}
					variant="outline"
				/>
			</View>
		</Panel>
	);
};

/** Plan purchases happen on the web only (no in-app checkout, so no App Store IAP flow). */
export const PlanSection = () => (
	<Panel title="Plan">
		<Text style={styles.status}>Your RevKlik plan and billing are managed on the web.</Text>
		<Button
			icon="open-outline"
			label="Manage plan on revklik.com"
			onPress={() => Linking.openURL(`${WEB_URL}/analytics/billing`)}
			variant="outline"
		/>
	</Panel>
);

const styles = StyleSheet.create((theme) => ({
	actions: {
		gap: 8,
		marginTop: 10,
	},
	prefHint: {
		color: theme.colors.mutedForeground,
		fontSize: 11,
	},
	prefLabel: {
		color: theme.colors.foreground,
		fontSize: 13,
		fontWeight: "500",
	},
	prefMain: {
		flexShrink: 1,
		gap: 2,
	},
	prefRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: 12,
		justifyContent: "space-between",
		paddingVertical: 8,
	},
	status: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
		marginBottom: 4,
	},
	statusError: {
		color: theme.colors.down,
		fontSize: theme.fontSize.xs,
		marginBottom: 6,
	},
}));
