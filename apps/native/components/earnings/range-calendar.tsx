import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, Text, TouchableOpacity, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button } from "@/components/ui";
import { monthGrid, pickDay, shiftMonth } from "@/lib/earnings-range";
import type { DayRange } from "@/lib/earnings-range";
import { numberLocale, t } from "@/lib/i18n";

const utcDate = (day: string) => new Date(`${day}T00:00:00Z`);

/** "21 Nov 2026" in the device language. */
export const dayLabel = (day: string): string =>
	new Intl.DateTimeFormat(numberLocale, {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
		year: "numeric",
	}).format(utcDate(day));

const monthTitle = (year: number, month: number): string =>
	new Intl.DateTimeFormat(numberLocale, { month: "long", timeZone: "UTC", year: "numeric" }).format(
		new Date(Date.UTC(year, month - 1, 1)),
	);

/** Mon..Sun initials; 2 Nov 2026 is a Monday. */
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
	new Intl.DateTimeFormat(numberLocale, { timeZone: "UTC", weekday: "narrow" }).format(
		new Date(Date.UTC(2026, 10, 2 + i)),
	),
);

/**
 * Month calendar in a modal: tap a start day, then an end day, then Apply.
 * Days after `today` (the device's local day) can't be picked.
 */
export const RangeCalendar = ({
	initial,
	today,
	onApply,
	onClose,
}: {
	initial: DayRange;
	today: string;
	onApply: (range: DayRange) => void;
	onClose: () => void;
}) => {
	const { theme } = useUnistyles();
	const [range, setRange] = useState(initial);
	const [pending, setPending] = useState(false);
	const [[year, month], setMonth] = useState<[number, number]>(() => [
		Number(initial.to.slice(0, 4)),
		Number(initial.to.slice(5, 7)),
	]);
	const atCurrentMonth = `${year}-${String(month).padStart(2, "0")}` >= today.slice(0, 7);

	return (
		<Modal animationType="fade" transparent visible onRequestClose={onClose}>
			<Pressable style={styles.scrim} onPress={onClose}>
				<Pressable style={styles.card} onPress={() => undefined}>
					<View style={styles.header}>
						<TouchableOpacity
							accessibilityLabel={t("earn.prevMonth")}
							hitSlop={10}
							onPress={() => setMonth(shiftMonth(year, month, -1))}
							style={styles.navButton}
						>
							<Ionicons color={theme.colors.foreground} name="chevron-back" size={18} />
						</TouchableOpacity>
						<Text style={styles.title}>{monthTitle(year, month)}</Text>
						<TouchableOpacity
							accessibilityLabel={t("earn.nextMonth")}
							disabled={atCurrentMonth}
							hitSlop={10}
							onPress={() => setMonth(shiftMonth(year, month, 1))}
							style={[styles.navButton, atCurrentMonth && styles.dim]}
						>
							<Ionicons color={theme.colors.foreground} name="chevron-forward" size={18} />
						</TouchableOpacity>
					</View>

					<View style={styles.week}>
						{WEEKDAYS.map((w, i) => (
							<Text key={i} style={[styles.cell, styles.weekday]}>
								{w}
							</Text>
						))}
					</View>
					{monthGrid(year, month).map((week, wi) => (
						<View key={wi} style={styles.week}>
							{week.map((day, di) => {
								if (!day) return <View key={di} style={styles.cell} />;
								const future = day > today;
								const edge = day === range.from || day === range.to;
								const inside = day > range.from && day < range.to;
								return (
									<TouchableOpacity
										key={day}
										accessibilityLabel={dayLabel(day)}
										accessibilityState={{ disabled: future, selected: edge || inside }}
										disabled={future}
										onPress={() => {
											const next = pickDay(range, pending, day);
											setRange(next.range);
											setPending(next.pending);
										}}
										style={[styles.cell, inside && styles.inside]}
									>
										<View style={[styles.dayDot, edge && styles.edge]}>
											<Text
												style={[
													styles.dayText,
													edge && styles.edgeText,
													future && styles.futureText,
													day === today && !edge && styles.todayText,
												]}
											>
												{Number(day.slice(8))}
											</Text>
										</View>
									</TouchableOpacity>
								);
							})}
						</View>
					))}

					<Text style={styles.summary}>
						{pending
							? t("earn.pickEnd")
							: range.from === range.to
								? dayLabel(range.from)
								: `${dayLabel(range.from)} → ${dayLabel(range.to)}`}
					</Text>
					<View style={styles.actions}>
						<Button label={t("common.cancel")} onPress={onClose} variant="ghost" />
						<Button label={t("earn.apply")} onPress={() => onApply(range)} />
					</View>
				</Pressable>
			</Pressable>
		</Modal>
	);
};

const styles = StyleSheet.create((theme) => ({
	actions: {
		flexDirection: "row",
		gap: 8,
		justifyContent: "flex-end",
		marginTop: 10,
	},
	card: {
		backgroundColor: theme.colors.card,
		borderColor: theme.colors.border,
		borderRadius: theme.borderRadius.xl,
		borderWidth: 1,
		maxWidth: 420,
		padding: 14,
		width: "100%",
	},
	cell: {
		alignItems: "center",
		flex: 1,
		height: 42,
		justifyContent: "center",
	},
	dayDot: {
		alignItems: "center",
		borderRadius: 999,
		height: 36,
		justifyContent: "center",
		width: 36,
	},
	dayText: {
		color: theme.colors.foreground,
		fontSize: theme.fontSize.sm,
		fontVariant: ["tabular-nums"],
	},
	dim: {
		opacity: 0.3,
	},
	edge: {
		backgroundColor: theme.colors.chart,
	},
	edgeText: {
		color: theme.colors.primaryForeground,
		fontWeight: "700",
	},
	futureText: {
		color: theme.colors.mutedForeground,
		opacity: 0.4,
	},
	header: {
		alignItems: "center",
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 6,
	},
	inside: {
		backgroundColor: theme.colors.muted,
	},
	navButton: {
		alignItems: "center",
		height: 44,
		justifyContent: "center",
		width: 44,
	},
	scrim: {
		alignItems: "center",
		backgroundColor: "#000000CC",
		flex: 1,
		justifyContent: "center",
		padding: 16,
	},
	summary: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.sm,
		marginTop: 8,
		textAlign: "center",
	},
	title: {
		color: theme.colors.foreground,
		fontSize: theme.fontSize.base,
		fontWeight: "600",
	},
	todayText: {
		color: theme.colors.chart,
		fontWeight: "700",
	},
	week: {
		flexDirection: "row",
	},
	weekday: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
		height: 28,
		lineHeight: 28,
		textAlign: "center",
	},
}));
