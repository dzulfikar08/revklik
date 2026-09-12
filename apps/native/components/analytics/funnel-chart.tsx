import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { fmt } from "@/lib/analytics-data";
import type { LegacyFunnelStep } from "@/lib/klikapa/api";

/** Steel-blue ramp endpoints from the web FunnelChart, lerped in sRGB. */
const RAMP_START: [number, number, number] = [0x3d, 0x77, 0xb6];
const RAMP_END: [number, number, number] = [0x93, 0xb4, 0xda];

const hx = (v: number): string => v.toString(16).padStart(2, "0").toUpperCase();

const bandColor = (i: number, n: number): string => {
	const t = n <= 1 ? 0 : i / (n - 1);
	const [r, g, b] = RAMP_START.map((s, k) => Math.round(s + (RAMP_END[k] - s) * t));
	return `#${hx(r)}${hx(g)}${hx(b)}`;
};

/**
 * Landing-page scroll funnel — plain-View port of the web FunnelChart:
 * plateaued stage bars narrowing by visitors, dropoff pills on the necks,
 * conversion rate in the corner.
 */
export const FunnelChart = ({ steps, rate }: { steps: LegacyFunnelStep[]; rate?: number }) => {
	const { theme } = useUnistyles();

	const max = steps[0]?.visitors ?? 1;
	const bands = useMemo(
		() => steps.map((s, i) => ({ ...s, color: bandColor(i, steps.length), i })),
		[steps],
	);

	return (
		<View>
			{rate === undefined ? null : <Text style={styles.rate}>{rate}% conversion rate</Text>}
			{bands.map((b) => {
				const widthPct = Math.max(4, (b.visitors / max) * 100);
				return (
					<View key={b.section} style={styles.stageWrap}>
						<View style={[styles.stage, { backgroundColor: b.color, width: `${widthPct}%` }]}>
							<Text style={styles.stageVisitors}>{fmt(b.visitors)} visitors</Text>
							<Text style={styles.stagePct}>{b.percentage}%</Text>
						</View>
						{b.i < steps.length - 1 && (steps[b.i + 1]?.dropoff ?? 0) >= 1 ? (
							<View
								style={[
									styles.dropoff,
									{
										backgroundColor: theme.colors.card,
										borderColor: theme.colors.border,
									},
								]}
							>
								<Text style={styles.dropoffText}>−{steps[b.i + 1]?.dropoff ?? 0}%</Text>
							</View>
						) : null}
					</View>
				);
			})}
			<Text style={styles.hint}>data-section scroll funnel</Text>
		</View>
	);
};

/** Page picker for multi-page funnels, shown above the chart. */
export const FunnelPageTabs = ({
	pages,
	active,
	onPick,
}: {
	pages: { path: string }[];
	active: string;
	onPick: (path: string) => void;
}) => (
	<View style={styles.pageTabs}>
		{pages.map((p) => (
			<Text
				key={p.path}
				numberOfLines={1}
				onPress={() => onPick(p.path)}
				style={[styles.pageTab, p.path === active && styles.pageTabActive]}
			>
				{p.path}
			</Text>
		))}
	</View>
);

const styles = StyleSheet.create((theme) => ({
	dropoff: {
		borderRadius: 999,
		borderWidth: 1,
		paddingHorizontal: 6,
		paddingVertical: 1,
		position: "absolute",
		right: 8,
		top: 6,
	},
	dropoffText: {
		color: theme.colors.foreground,
		fontFamily: "monospace",
		fontSize: 10,
	},
	hint: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
		marginTop: 6,
	},
	pageTab: {
		backgroundColor: theme.colors.muted,
		borderRadius: 999,
		color: theme.colors.mutedForeground,
		fontFamily: "monospace",
		fontSize: 11,
		maxWidth: 180,
		paddingHorizontal: 8,
		paddingVertical: 3,
	},
	pageTabActive: {
		backgroundColor: theme.colors.popover,
		color: theme.colors.foreground,
	},
	pageTabs: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 6,
		marginBottom: 10,
	},
	rate: {
		color: theme.colors.foreground,
		fontSize: 13,
		fontWeight: "600",
		marginBottom: 8,
		textAlign: "right",
	},
	stage: {
		alignItems: "flex-start",
		borderRadius: theme.borderRadius.sm,
		flexDirection: "row",
		gap: 8,
		justifyContent: "space-between",
		paddingHorizontal: 8,
		paddingVertical: 9,
	},
	stagePct: {
		color: "#FFFFFFCC",
		fontFamily: "monospace",
		fontSize: 10,
	},
	stageVisitors: {
		color: "#FFFFFF",
		fontSize: 11,
		fontWeight: "600",
	},
	stageWrap: {
		alignItems: "flex-start",
		marginBottom: 4,
		position: "relative",
		width: "100%",
	},
}));
