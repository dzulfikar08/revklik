import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { fmt, niceMax } from "@/lib/analytics-data";
import type { Point } from "@/lib/analytics-data";

/**
 * Visitors-per-point bar chart built from plain Views — the native
 * counterpart of the web TrafficChart (SVG area). Same geometry helpers:
 * niceMax() ceiling, 25/50/75% gridlines, first/last tick labels.
 */
export const TrafficChart = ({ points }: { points: Point[] }) => {
	const { theme } = useUnistyles();

	const { max, bars, ticks } = useMemo(() => {
		const peak = Math.max(1, ...points.map((p) => p.current));
		const maxLocal = niceMax(peak * 1.08);
		const barsLocal = points.map((p) => ({
			heightPct: Math.max(2, (p.current / maxLocal) * 100),
			point: p,
		}));
		const n = points.length;
		const tickEvery = Math.max(1, Math.ceil(n / 6));
		const ticksLocal = points
			.map((p, i) => ({ i, label: p.label }))
			.filter(({ i }) => i % tickEvery === 0 || i === n - 1);
		return { bars: barsLocal, max: maxLocal, ticks: ticksLocal };
	}, [points]);

	return (
		<View>
			<Text style={styles.maxLabel}>{fmt(max)}</Text>
			<View style={styles.plot}>
				{[0.25, 0.5, 0.75].map((f) => (
					<View key={f} style={[styles.gridline, { bottom: `${f * 100}%` }]} />
				))}
				<View style={styles.barsTrack}>
					{bars.map(({ heightPct, point }, i) => (
						<View key={`${point.label}-${i}`} style={styles.barSlot}>
							<View
								style={[
									styles.bar,
									{
										backgroundColor: theme.colors.chart,
										height: `${heightPct}%`,
									},
								]}
							/>
						</View>
					))}
				</View>
			</View>
			<View style={styles.ticksRow}>
				{ticks.map(({ i, label }, idx) => (
					<Text key={`${label}-${i}`} style={styles.tick}>
						{idx > 0 && idx < ticks.length - 1 ? " · " : ""}
						{label}
					</Text>
				))}
			</View>
		</View>
	);
};

const styles = StyleSheet.create((theme) => ({
	bar: {
		borderTopLeftRadius: 2,
		borderTopRightRadius: 2,
		opacity: 0.9,
		width: "100%",
	},
	barSlot: {
		alignItems: "flex-end",
		flex: 1,
		height: "100%",
		justifyContent: "flex-end",
	},
	barsTrack: {
		alignItems: "flex-end",
		bottom: 0,
		flexDirection: "row",
		gap: 2,
		left: 0,
		position: "absolute",
		right: 0,
		top: 0,
	},
	gridline: {
		backgroundColor: theme.colors.border,
		height: 1,
		left: 0,
		opacity: 0.5,
		position: "absolute",
		right: 0,
	},
	maxLabel: {
		color: theme.colors.mutedForeground,
		fontFamily: "monospace",
		fontSize: 11,
		marginBottom: 4,
	},
	plot: {
		borderColor: theme.colors.border,
		borderRadius: theme.borderRadius.md,
		borderWidth: 1,
		height: 170,
		overflow: "hidden",
	},
	tick: {
		color: theme.colors.mutedForeground,
		fontFamily: "monospace",
		fontSize: 11,
	},
	ticksRow: {
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "space-between",
		marginTop: 6,
	},
}));
