import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { niceMax } from "@/lib/analytics-data";
import type { Earnings } from "@/lib/klikapa/earnings";
import { formatMoney } from "@/lib/klikapa/earnings";

const MAX_TICKS = 6;

/** "Oct 28" from a YYYY-MM-DD UTC day. */
const dayTick = (date: string): string =>
	new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	});

/**
 * Daily gross bars with the net share drawn inside each bar. Plain Views,
 * same geometry as the traffic chart (niceMax ceiling, quarter gridlines).
 */
export const DailyChart = ({ currency, days }: { currency: string; days: Earnings["daily"] }) => {
	const { theme } = useUnistyles();

	const { bars, max, ticks } = useMemo(() => {
		const peak = Math.max(0, ...days.map((d) => d.gross));
		const ceiling = peak > 0 ? niceMax(peak * 1.08) : 1;
		const every = Math.max(1, Math.ceil(days.length / MAX_TICKS));
		return {
			bars: days.map((d) => ({
				day: d,
				grossPct: d.gross > 0 ? Math.max(2, (d.gross / ceiling) * 100) : 0,
				netPct: d.gross > 0 ? Math.min(100, Math.max(0, d.net / d.gross) * 100) : 0,
			})),
			max: ceiling,
			ticks: days
				.map((d, i) => ({ i, label: dayTick(d.date) }))
				.filter(({ i }) => i % every === 0 || i === days.length - 1),
		};
	}, [days]);

	return (
		<View>
			<Text style={styles.maxLabel}>{formatMoney(max, currency)}</Text>
			<View style={styles.plot}>
				{[0.25, 0.5, 0.75].map((f) => (
					<View key={f} style={[styles.gridline, { bottom: `${f * 100}%` }]} />
				))}
				<View style={styles.barsTrack}>
					{bars.map(({ day, grossPct, netPct }) => (
						<View key={day.date} style={styles.barSlot}>
							<View
								style={[
									styles.bar,
									{ backgroundColor: `${theme.colors.chart}66`, height: `${grossPct}%` },
								]}
							>
								<View
									style={[
										styles.barNet,
										{ backgroundColor: theme.colors.money, height: `${netPct}%` },
									]}
								/>
							</View>
						</View>
					))}
				</View>
			</View>
			<View style={styles.ticksRow}>
				{ticks.map(({ i, label }) => (
					<Text key={i} style={styles.tick}>
						{label}
					</Text>
				))}
			</View>
			<View style={styles.legend}>
				<View style={[styles.swatch, { backgroundColor: `${theme.colors.chart}66` }]} />
				<Text style={styles.legendText}>Gross</Text>
				<View style={[styles.swatch, { backgroundColor: theme.colors.money }]} />
				<Text style={styles.legendText}>Net</Text>
			</View>
		</View>
	);
};

const styles = StyleSheet.create((theme) => ({
	bar: {
		borderTopLeftRadius: 2,
		borderTopRightRadius: 2,
		justifyContent: "flex-end",
		width: "100%",
	},
	barNet: {
		borderTopLeftRadius: 2,
		borderTopRightRadius: 2,
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
	legend: {
		alignItems: "center",
		flexDirection: "row",
		gap: 6,
		marginTop: 8,
	},
	legendText: {
		color: theme.colors.mutedForeground,
		fontSize: 11,
		marginRight: 8,
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
	swatch: {
		borderRadius: 2,
		height: 8,
		width: 8,
	},
	tick: {
		color: theme.colors.mutedForeground,
		fontFamily: "monospace",
		fontSize: 11,
	},
	ticksRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginTop: 6,
	},
}));
