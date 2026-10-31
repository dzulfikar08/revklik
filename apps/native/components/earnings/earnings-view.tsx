import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { RefreshControl, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { CountBarRow, Panel, PanelBody } from "@/components/analytics/ui";
import { DailyChart } from "@/components/earnings/daily-chart";
import { Button } from "@/components/ui";
import { agoLabel, fmt } from "@/lib/analytics-data";
import { t } from "@/lib/i18n";
import {
	EARNINGS_CURRENCIES,
	EARNINGS_PRESETS,
	fetchEarnings,
	formatMoney,
	railLabel,
} from "@/lib/klikapa/earnings";
import { fillDaily, presetRange } from "@/lib/earnings-range";
import type { EarningsPreset } from "@/lib/earnings-range";

const TOP_ROWS = 8;

/* ---------------------------------- chips ---------------------------------- */

const ChipsRow = <K extends string>({
	items,
	value,
	onChange,
}: {
	items: readonly { key: K; label: string }[];
	value: K;
	onChange: (key: K) => void;
}) => (
	<ScrollView
		horizontal
		contentContainerStyle={styles.chipsTrack}
		showsHorizontalScrollIndicator={false}
	>
		{items.map((item) => {
			const active = value === item.key;
			return (
				<TouchableOpacity
					key={item.key}
					onPress={() => onChange(item.key)}
					style={[styles.chip, active && styles.chipActive]}
				>
					<Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{item.label}</Text>
				</TouchableOpacity>
			);
		})}
	</ScrollView>
);

const Tile = ({
	label,
	value,
	sub,
	hero = false,
}: {
	label: string;
	value: string;
	sub?: ReactNode;
	hero?: boolean;
}) => (
	<View style={[styles.tile, hero && styles.tileHero]}>
		<Text style={styles.tileLabel}>{label}</Text>
		<Text style={[styles.tileValue, hero && styles.tileValueHero]}>{value}</Text>
		{sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
	</View>
);

/* ---------------------------------- view ----------------------------------- */

const AUTO_KEY = "auto";

export const EarningsView = () => {
	const { theme } = useUnistyles();
	const [preset, setPreset] = useState<EarningsPreset>("7d");
	const [currencyKey, setCurrencyKey] = useState<string>(AUTO_KEY);
	const currency = currencyKey === AUTO_KEY ? undefined : currencyKey;
	const range = useMemo(() => presetRange(preset), [preset]);

	const q = useQuery({
		queryFn: () => fetchEarnings(range.from, range.to, currency),
		placeholderData: keepPreviousData,
		queryKey: ["earnings", range.from, range.to, currency ?? AUTO_KEY],
	});
	const data = q.data;
	const cur = data?.currency ?? currency ?? "USD";
	const days = useMemo(() => (data ? fillDaily(data.daily, data.from, data.to) : []), [data]);
	const topGross = Math.max(1, ...(data?.by_product.map((p) => p.gross) ?? [0]));
	const railGross = Math.max(1, ...(data?.by_rail.map((r) => r.gross) ?? [0]));
	const empty = data !== undefined && data.totals.sales === 0 && data.totals.refunds === 0;

	return (
		<ScrollView
			contentContainerStyle={styles.page}
			refreshControl={
				<RefreshControl
					colors={[theme.colors.chart]}
					onRefresh={() => q.refetch()}
					refreshing={q.isRefetching}
					tintColor={theme.colors.chart}
				/>
			}
			style={{ backgroundColor: theme.colors.background }}
		>
			<Text style={styles.pageTitle}>{t("earn.title")}</Text>
			<Text style={styles.pageSub}>
				{data ? t("earn.subtitleRange", { from: data.from, to: data.to }) : t("earn.subtitleAll")}
			</Text>

			<ChipsRow items={EARNINGS_PRESETS} onChange={setPreset} value={preset} />
			<ChipsRow
				items={EARNINGS_CURRENCIES.map((c) => ({ key: c.code ?? AUTO_KEY, label: c.label }))}
				onChange={setCurrencyKey}
				value={currencyKey}
			/>

			{q.isError ? (
				<Panel title={t("earn.loadFailed")}>
					<Text style={styles.errorText}>
						{q.error instanceof Error ? q.error.message : "Request failed"}
					</Text>
					<Button label={t("common.tryAgain")} onPress={() => q.refetch()} variant="outline" />
				</Panel>
			) : null}

			{data ? (
				<>
					<View style={styles.tileRow}>
						<Tile hero label={t("earn.net")} sub={cur} value={formatMoney(data.totals.net, cur)} />
						<Tile label={t("earn.gross")} value={formatMoney(data.totals.gross, cur)} />
					</View>
					<View style={styles.tileRow}>
						<Tile label={t("earn.sales")} value={fmt(data.totals.sales)} />
						<Tile
							label={t("earn.refunds")}
							sub={
								data.totals.refunds > 0
									? `−${formatMoney(data.totals.refund_amount, cur)}`
									: undefined
							}
							value={fmt(data.totals.refunds)}
						/>
					</View>

					{empty ? (
						<Panel title={t("earn.noSales")}>
							<Text style={styles.empty}>{t("earn.noSalesBody")}</Text>
						</Panel>
					) : (
						<>
							<Panel title={t("earn.daily")}>
								<DailyChart currency={cur} days={days} />
							</Panel>

							<Panel title={t("earn.byProduct")}>
								<PanelBody
									emptyText={t("earn.noProduct")}
									hasData={data.by_product.length > 0}
									loading={false}
								>
									{data.by_product.slice(0, TOP_ROWS).map((p) => (
										<CountBarRow
											key={`${p.site_id}-${p.product ?? "none"}`}
											label={`${p.product ?? p.site_name} · ${fmt(p.sales)}`}
											share={(p.gross / topGross) * 100}
											value={formatMoney(p.gross, cur)}
										/>
									))}
								</PanelBody>
							</Panel>

							<Panel title={t("earn.byRail")}>
								<PanelBody
									emptyText={t("earn.noRail")}
									hasData={data.by_rail.length > 0}
									loading={false}
								>
									{data.by_rail.map((r) => (
										<CountBarRow
											key={r.rail}
											fill={theme.colors.violet}
											label={`${railLabel(r.rail)} · ${fmt(r.sales)}`}
											share={(r.gross / railGross) * 100}
											value={formatMoney(r.gross, cur)}
										/>
									))}
								</PanelBody>
							</Panel>

							<Panel title={t("earn.recent")}>
								{data.recent.map((r) => {
									const refund = r.revenue < 0;
									return (
										<View key={r.event_id} style={styles.recentRow}>
											<View style={styles.recentMain}>
												<Text numberOfLines={1} style={styles.recentTitle}>
													{r.product ?? r.site_name}
												</Text>
												<Text numberOfLines={1} style={styles.recentSub}>
													{refund ? t("earn.refund") : (r.name ?? t("earn.sale"))} ·{" "}
													{railLabel(r.rail)} · {agoLabel(r.occurred_at)}
												</Text>
											</View>
											<View style={styles.recentAmounts}>
												<Text
													style={[
														styles.recentGross,
														{ color: refund ? theme.colors.down : theme.colors.up },
													]}
												>
													{formatMoney(r.converted_gross, cur)}
												</Text>
												<Text style={styles.recentNet}>
													{t("earn.netShort", { amount: formatMoney(r.converted_net, cur) })}
												</Text>
											</View>
										</View>
									);
								})}
							</Panel>
						</>
					)}
				</>
			) : null}

			{q.isLoading ? <Text style={styles.empty}>Loading earnings…</Text> : null}
		</ScrollView>
	);
};

const styles = StyleSheet.create((theme, rt) => ({
	chip: {
		alignItems: "center",
		backgroundColor: theme.colors.muted,
		borderColor: theme.colors.border,
		borderRadius: 999,
		borderWidth: 1,
		paddingHorizontal: 12,
		paddingVertical: 6,
	},
	chipActive: {
		backgroundColor: theme.colors.popover,
		borderColor: theme.colors.chart,
	},
	chipLabel: {
		color: theme.colors.mutedForeground,
		fontSize: 13,
		fontWeight: "500",
	},
	chipLabelActive: {
		color: theme.colors.foreground,
	},
	chipsTrack: {
		gap: 6,
		paddingVertical: 2,
	},
	empty: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
		paddingVertical: 12,
		textAlign: "center",
	},
	errorText: {
		color: theme.colors.down,
		fontSize: theme.fontSize.xs,
		marginBottom: 10,
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
	},
	pageTitle: {
		color: theme.colors.foreground,
		fontSize: theme.fontSize.xl,
		fontWeight: "700",
	},
	recentAmounts: {
		alignItems: "flex-end",
	},
	recentGross: {
		fontSize: 14,
		fontWeight: "600",
	},
	recentMain: {
		flexShrink: 1,
		gap: 2,
	},
	recentNet: {
		color: theme.colors.mutedForeground,
		fontSize: 11,
	},
	recentRow: {
		alignItems: "center",
		borderColor: theme.colors.border,
		borderTopWidth: 1,
		flexDirection: "row",
		gap: 10,
		justifyContent: "space-between",
		paddingVertical: 9,
	},
	recentSub: {
		color: theme.colors.mutedForeground,
		fontSize: 11,
	},
	recentTitle: {
		color: theme.colors.foreground,
		fontSize: 13,
		fontWeight: "500",
	},
	tile: {
		backgroundColor: theme.colors.card,
		borderColor: theme.colors.border,
		borderRadius: theme.borderRadius.xl,
		borderWidth: 1,
		flex: 1,
		paddingHorizontal: 12,
		paddingVertical: 10,
	},
	tileHero: {
		borderColor: theme.colors.money,
	},
	tileLabel: {
		color: theme.colors.mutedForeground,
		fontSize: 13,
	},
	tileRow: {
		flexDirection: "row",
		gap: 10,
	},
	tileSub: {
		color: theme.colors.mutedForeground,
		fontSize: 11,
		marginTop: 2,
	},
	tileValue: {
		color: theme.colors.foreground,
		fontSize: 19,
		fontWeight: "600",
		marginTop: 2,
	},
	tileValueHero: {
		color: theme.colors.money,
		fontSize: 22,
	},
}));
