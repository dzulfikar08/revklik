import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { fmt } from "@/lib/analytics-data";

/* --------------------------------- panel ----------------------------------- */

export const Panel = ({
  title,
  tabs,
  hint,
  children,
}: {
  title?: string;
  tabs?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) => (
  <View style={styles.panel}>
    <View style={styles.panelHead}>
      {tabs ?? (title ? <Text style={styles.panelTitle}>{title}</Text> : null)}
      {hint ? <View style={styles.panelHint}>{hint}</View> : null}
    </View>
    {children}
  </View>
);

/* -------------------------------- panel tabs ------------------------------- */

interface TabKey {
  readonly key: string;
  readonly label: string;
}

export const PanelTabs = ({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly TabKey[];
  value: string;
  onChange: (key: string) => void;
}) => (
  <View style={styles.tabsTrack}>
    {tabs.map((t) => {
      const active = value === t.key;
      return (
        <TouchableOpacity
          key={t.key}
          onPress={() => onChange(t.key)}
          style={[styles.tab, active && styles.tabActive]}
        >
          <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
            {t.label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

/* -------------------------------- stat tile -------------------------------- */

export const StatTile = ({
  label,
  value,
  delta,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  tone: "good" | "bad";
}) => {
  const { theme } = useUnistyles();
  const color = tone === "good" ? theme.colors.up : theme.colors.down;
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <View style={styles.tileRow}>
        <Text style={styles.tileValue}>{value}</Text>
        <View style={[styles.delta, { backgroundColor: `${color}1A` }]}>
          <Ionicons
            color={color}
            name={tone === "good" ? "arrow-up" : "arrow-down"}
            size={10}
          />
          <Text style={[styles.deltaText, { color }]}>{delta}</Text>
        </View>
      </View>
    </View>
  );
};

/* -------------------------------- bar rows --------------------------------- */
export const CountBarRow = ({
  glyph,
  label,
  value,
  share,
  fill,
}: {
  glyph?: ReactNode;
  label: string;
  value: string;
  share: number;
  fill?: string;
}) => {
  const { theme } = useUnistyles();
  const color = fill ?? theme.colors.chart;
  return (
    <View style={styles.barRow}>
      <View
        style={[
          styles.barFill,
          {
            backgroundColor: `${color}66`,
            width: `${Math.min(100, Math.max(2, share))}%`,
          },
        ]}
      />
      <View style={styles.barLabelWrap}>
        {glyph}
        <Text numberOfLines={1} style={styles.barLabel}>
          {label}
        </Text>
      </View>
      <Text style={styles.barValue}>{value}</Text>
    </View>
  );
};

/* -------------------------------- sort hint -------------------------------- */

export const SortHint = ({
  label,
  dir,
  onToggle,
}: {
  label: string;
  dir?: "desc" | "asc";
  onToggle: () => void;
}) => {
  const { theme } = useUnistyles();
  return (
    <TouchableOpacity onPress={onToggle} style={styles.sortHint}>
      <Text style={styles.sortHintLabel}>{label}</Text>
      <Ionicons
        color={theme.colors.mutedForeground}
        name="swap-vertical"
        size={12}
        style={dir === "asc" ? styles.sortHintFlipped : undefined}
      />
    </TouchableOpacity>
  );
};

/* ------------------------------ panel messages ----------------------------- */

export const PanelMsg = ({ children }: { children: ReactNode }) => (
  <Text style={styles.panelMsg}>{children}</Text>
);

export const PanelBody = ({
  loading,
  hasData,
  emptyText,
  children,
}: {
  loading: boolean;
  hasData: boolean;
  emptyText: string;
  children: ReactNode;
}) => {
  if (loading) {
    return <PanelMsg>Loading…</PanelMsg>;
  }
  if (!hasData) {
    return <PanelMsg>{emptyText}</PanelMsg>;
  }
  return children;
};

/** Compact max-value label, reused above the traffic chart. */
export const MaxLabel = ({ max }: { max: number }) => (
  <Text style={styles.maxLabel}>{fmt(max)}</Text>
);

const styles = StyleSheet.create((theme) => ({
  barFill: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
  },
  barLabel: {
    color: theme.colors.foreground,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "500",
  },
  barLabelWrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
  },
  barRow: {
    backgroundColor: theme.colors.muted,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    marginBottom: 4,
    overflow: "hidden",
  },
  barValue: {
    color: theme.colors.mutedForeground,
    fontFamily: "monospace",
    fontSize: theme.fontSize.xs,
    position: "absolute",
    right: 10,
  },
  delta: {
    alignItems: "center",
    borderRadius: 999,
    flexDirection: "row",
    gap: 2,
    marginBottom: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  deltaText: {
    fontSize: 11,
    fontWeight: "600",
  },
  maxLabel: {
    color: theme.colors.mutedForeground,
    fontFamily: "monospace",
    fontSize: 11,
  },
  panel: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    padding: 12,
  },
  panelHead: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    marginBottom: 8,
  },
  panelHint: {
    flexShrink: 1,
  },
  panelMsg: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
    paddingVertical: 20,
    textAlign: "center",
  },
  panelTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  sortHint: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  sortHintFlipped: {
    transform: [{ rotate: "180deg" }],
  },
  sortHintLabel: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
  },
  tab: {
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tabActive: {
    backgroundColor: theme.colors.popover,
    borderColor: theme.colors.border,
    borderWidth: 1,
  },
  tabLabel: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
    fontWeight: "500",
  },
  tabLabelActive: {
    color: theme.colors.foreground,
  },
  tabsTrack: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.borderRadius.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
    padding: 2,
  },
  tile: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    flex: 1,
    minWidth: "46%",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tileLabel: {
    color: theme.colors.mutedForeground,
    fontSize: 13,
  },
  tileRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  tileValue: {
    color: theme.colors.foreground,
    fontSize: 21,
    fontWeight: "600",
  },
}));
