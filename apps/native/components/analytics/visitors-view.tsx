import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PanelBody } from "@/components/analytics/ui";
import { Button, Input } from "@/components/ui";
import { useActiveSite } from "@/lib/active-site";
import {
  dayLabel,
  FILTER_DIMS,
  FILTER_OPS,
  fmt,
  timeLabel,
  visitorName,
} from "@/lib/analytics-data";
import type { Visitor, VisitorEvent } from "@/lib/analytics-data";
import { profileToVisitor } from "@/lib/analytics-transform";
import { avatarUrl } from "@/lib/identity";
import {
  fetchDashboard,
  fetchVisitors,
  updateVisitor,
} from "@/lib/klikapa/api";
import type { VisitorProfile } from "@/lib/klikapa/api";
import { fetchVisitorProfile } from "@/lib/klikapa/growth";

/* ------------------------------- list filters ------------------------------ */

const LIST_DIMS = FILTER_DIMS.filter((d) =>
  [
    "path",
    "country",
    "region",
    "city",
    "device_type",
    "browser",
    "os",
    "utm_source",
  ].includes(d.value)
);

const fieldOf = (v: Visitor, dim: string): string => {
  switch (dim) {
    case "country": {
      return v.country ?? "";
    }
    case "region": {
      return v.country ?? "";
    }
    case "city": {
      return v.city ?? "";
    }
    case "device_type": {
      return v.device ?? "";
    }
    case "browser": {
      return v.browser ?? "";
    }
    case "os": {
      return v.os ?? "";
    }
    case "utm_source": {
      return v.source;
    }
    case "path": {
      return v.events.find((e) => e.kind === "view")?.page ?? "";
    }
    default: {
      return "";
    }
  }
};

const matches = (
  v: Visitor,
  dim: string,
  op: string,
  value: string
): boolean => {
  const field = fieldOf(v, dim).toLowerCase();
  const needle = value.toLowerCase();
  const has = field.length > 0;
  if (op === "exists") {
    return has;
  }
  if (op === "not_exists") {
    return !has;
  }
  if (op === "is") {
    return field === needle;
  }
  if (op === "is_not") {
    return field !== needle;
  }
  if (op === "contains") {
    return field.includes(needle);
  }
  if (op === "not_contains") {
    return !field.includes(needle);
  }
  return field.startsWith(needle);
};

const FiltersBar = ({
  dim,
  op,
  value,
  onDim,
  onOp,
  onValue,
}: {
  dim: string;
  op: string;
  value: string;
  onDim: (d: string) => void;
  onOp: (o: string) => void;
  onValue: (v: string) => void;
}) => (
  <View style={styles.filters}>
    <ScrollView
      horizontal
      contentContainerStyle={styles.filterChips}
      showsHorizontalScrollIndicator={false}
    >
      {LIST_DIMS.map((d) => (
        <TouchableOpacity key={d.value} onPress={() => onDim(d.value)}>
          <Text
            style={[
              styles.filterChip,
              dim === d.value && styles.filterChipActive,
            ]}
          >
            {d.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
    <ScrollView
      horizontal
      contentContainerStyle={styles.filterChips}
      showsHorizontalScrollIndicator={false}
    >
      {FILTER_OPS.map((o) => (
        <TouchableOpacity key={o.value} onPress={() => onOp(o.value)}>
          <Text
            style={[
              styles.filterChip,
              op === o.value && styles.filterChipActive,
            ]}
          >
            {o.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
    <TextInput
      autoCapitalize="none"
      onChangeText={onValue}
      placeholder={
        op === "exists" || op === "not_exists"
          ? "(no value needed)"
          : "Filter value…"
      }
      placeholderTextColor="#949AA3"
      style={styles.filterValue}
      value={value}
    />
  </View>
);

/* ------------------------------ journey sheet ------------------------------ */

const eventIcon = (kind: VisitorEvent["kind"]) => {
  if (kind === "view") {
    return "eye-outline" as const;
  }
  if (kind === "scroll") {
    return "arrow-down" as const;
  }
  if (kind === "section") {
    return "book-outline" as const;
  }
  if (kind === "click") {
    return "hand-left-outline" as const;
  }
  if (kind === "conversion") {
    return "flag" as const;
  }
  return "pulse" as const;
};

const VisitorStep = ({ ev }: { ev: VisitorEvent }) => {
  const { theme } = useUnistyles();
  const chipStyle = [styles.stepChip, { backgroundColor: theme.colors.muted }];
  const conversion = ev.kind === "conversion";
  return (
    <View style={styles.stepTextWrap}>
      <Text
        style={[
          styles.stepText,
          conversion && { color: theme.colors.up, fontWeight: "600" },
        ]}
      >
        {ev.kind === "view" ? (
          <>
            Viewed page <Text style={chipStyle}>{ev.page}</Text>
          </>
        ) : null}
        {ev.kind === "scroll" ? (
          <>
            Scrolled to <Text style={chipStyle}>{ev.milestone}%</Text>
          </>
        ) : null}
        {ev.kind === "section" ? (
          <>
            Read section <Text style={chipStyle}>{ev.section}</Text>
          </>
        ) : null}
        {ev.kind === "click" ? (
          <>
            Clicked <Text style={chipStyle}>{ev.click}</Text>
          </>
        ) : null}
        {ev.kind === "conversion" ? (
          <>
            Conversion: <Text style={chipStyle}>{ev.event}</Text>
            {ev.revenue ? <Text style={chipStyle}> {ev.revenue}</Text> : null}
          </>
        ) : null}
        {ev.kind === "event" ? (
          <>
            Triggered event: <Text style={chipStyle}>{ev.event}</Text>
          </>
        ) : null}
      </Text>
      {ev.props?.length ? (
        <View style={styles.propChips}>
          {ev.props.map(([k, v]) => (
            <Text
              key={k}
              style={[
                styles.propChip,
                {
                  backgroundColor: theme.colors.muted,
                  color: theme.colors.mutedForeground,
                },
              ]}
            >
              {k}: {v}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const JourneySheet = ({
  visitor,
  onClose,
  onSave,
}: {
  visitor: Visitor;
  onClose: () => void;
  onSave: (patch: { note: string; tags: string[] }) => Promise<void>;
}) => {
  const { theme } = useUnistyles();
  const [oldestFirst, setOldestFirst] = useState(true);
  const [copied, setCopied] = useState(false);
  const [tags, setTags] = useState<string[]>([...visitor.tags]);
  const [tagDraft, setTagDraft] = useState("");
  const [note, setNote] = useState(visitor.note);
  const [saving, setSaving] = useState(false);
  const displayName = visitorName(visitor);

  const events = useMemo(
    () => (oldestFirst ? visitor.events.toReversed() : visitor.events),
    [visitor.events, oldestFirst]
  );

  const copy = async () => {
    await Clipboard.setStringAsync(
      JSON.stringify({ events, visitor }, null, 2)
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const addTag = () => {
    const t = tagDraft.trim().toLowerCase();
    if (!t) {
      return;
    }
    if (!tags.includes(t)) {
      setTags([...tags, t]);
    }
    setTagDraft("");
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ note, tags });
      Alert.alert("Saved");
    } catch {
      Alert.alert("Couldn't save");
    }
    setSaving(false);
  };

  return (
    <Modal animationType="slide" visible onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: theme.colors.card }]}>
        <View style={[styles.sheetHead, { borderColor: theme.colors.border }]}>
          <Text numberOfLines={1} style={styles.sheetTitle}>
            Journey · {displayName}{" "}
            <Text style={styles.sheetCount}>
              ({fmt(visitor.events.length)} events)
            </Text>
          </Text>
          <View style={styles.sheetHeadActions}>
            <TouchableOpacity
              onPress={() => setOldestFirst(!oldestFirst)}
              style={styles.sheetAction}
            >
              <Text style={styles.sheetActionText}>
                {oldestFirst ? "OLDEST FIRST" : "NEWEST FIRST"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => copy()} style={styles.sheetAction}>
              <Ionicons
                color={theme.colors.mutedForeground}
                name={copied ? "checkmark" : "copy-outline"}
                size={14}
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.sheetAction}>
              <Ionicons
                color={theme.colors.foreground}
                name="close"
                size={17}
              />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.sheetBody}>
          <View
            style={[styles.profileBlock, { borderColor: theme.colors.border }]}
          >
            <Image
              source={{ uri: avatarUrl(displayName) }}
              style={styles.avatarLg}
            />
            <View style={styles.profileMain}>
              <View style={styles.profileNameRow}>
                <Text style={styles.profileName}>{displayName}</Text>
                {visitor.customer ? (
                  <View
                    style={[
                      styles.customerBadge,
                      { backgroundColor: `${theme.colors.chart}1A` },
                    ]}
                  >
                    <Text
                      style={[
                        styles.customerText,
                        { color: theme.colors.chart },
                      ]}
                    >
                      Customer
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.profileEmail}>
                {visitor.email ?? "not identified"}
              </Text>
              <Text style={styles.profileMeta}>
                {visitor.flag} {visitor.country ?? "Unknown"}
                {visitor.city ? `, ${visitor.city}` : ""}
              </Text>
              <Text style={styles.profileMeta}>
                {visitor.device ?? "—"} · {visitor.os ?? "—"} ·{" "}
                {visitor.browser ?? "—"}
              </Text>
            </View>
          </View>

          <View
            style={[styles.tagsBlock, { borderColor: theme.colors.border }]}
          >
            <Text style={styles.blockLabel}>Tags</Text>
            <View style={styles.tagRow}>
              {tags.map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setTags(tags.filter((x) => x !== t))}
                >
                  <View
                    style={[
                      styles.tagChip,
                      { backgroundColor: `${theme.colors.chart}1A` },
                    ]}
                  >
                    <Text
                      style={[
                        styles.tagChipText,
                        { color: theme.colors.chart },
                      ]}
                    >
                      {t} ✕
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
              {tags.length === 0 ? (
                <Text style={styles.noTags}>No tags yet.</Text>
              ) : null}
            </View>
            <View style={styles.tagAddRow}>
              <View style={styles.tagInputWrap}>
                <Input
                  autoCapitalize="none"
                  onChangeText={setTagDraft}
                  onSubmitEditing={addTag}
                  placeholder="Add a tag…"
                  value={tagDraft}
                />
              </View>
              <Button
                icon="add"
                label="Add"
                onPress={addTag}
                size="sm"
                variant="outline"
              />
            </View>
            <Text style={[styles.blockLabel, styles.noteLabel]}>Notes</Text>
            <TextInput
              multiline
              onChangeText={setNote}
              placeholder="Context for the team…"
              placeholderTextColor="#949AA3"
              style={[
                styles.noteInput,
                {
                  backgroundColor: theme.colors.input,
                  borderColor: theme.colors.border,
                  color: theme.colors.foreground,
                },
              ]}
              value={note}
            />
            <View style={styles.saveRow}>
              <Button
                busy={saving}
                label="Save"
                onPress={() => save()}
                size="sm"
                variant="outline"
              />
            </View>
          </View>

          <Text
            style={[styles.dayLabel, { backgroundColor: theme.colors.muted }]}
          >
            {events[0] ? dayLabel(events[0].time) : ""}
          </Text>
          <View style={styles.timeline}>
            {events.map((ev, i) => {
              const conversion = ev.kind === "conversion";
              return (
                <View key={`${ev.time}-${i}`} style={styles.stepRow}>
                  <Ionicons
                    color={
                      conversion
                        ? theme.colors.up
                        : theme.colors.mutedForeground
                    }
                    name={eventIcon(ev.kind)}
                    size={14}
                  />
                  <VisitorStep ev={ev} />
                  <Text style={styles.stepTime}>{timeLabel(ev.time)}</Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.stepsFooter}>
            {fmt(visitor.events.length)} steps · {visitor.source}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
};

/* ------------------------------ visitors view ------------------------------ */

export const VisitorsView = () => {
  const { theme } = useUnistyles();
  const siteId = useActiveSite() ?? "";
  const qc = useQueryClient();
  const [dim, setDim] = useState<string>("country");
  const [op, setOp] = useState<string>("contains");
  const [value, setValue] = useState("");
  const [journeyFor, setJourneyFor] = useState<Visitor | null>(null);

  const visitorsQ = useQuery({
    enabled: Boolean(siteId),
    queryFn: () => fetchVisitors(siteId),
    queryKey: ["legacy", "visitors", siteId],
  });

  // Same payload the dashboard uses — journeys come from there.
  const dashQ = useQuery({
    enabled: Boolean(siteId),
    queryFn: () => fetchDashboard(siteId, "30d", ""),
    queryKey: ["legacy", "dash", siteId, "30d", ""],
  });
  const journeys = useMemo(() => dashQ.data?.journeys ?? [], [dashQ.data]);

  const saveVisitor = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { note: string; tags: string[] };
    }) =>
      updateVisitor(id, {
        notes: patch.note,
        tags: JSON.stringify(patch.tags),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["legacy", "visitors"] });
    },
  });

  const visitors = useMemo(
    () =>
      (visitorsQ.data ?? []).map((p: VisitorProfile) =>
        profileToVisitor(p, journeys)
      ),
    [visitorsQ.data, journeys]
  );
  const filtered = useMemo(() => {
    if (!value.trim() && op !== "exists" && op !== "not_exists") {
      return visitors;
    }
    return visitors.filter((v) => matches(v, dim, op, value));
  }, [visitors, dim, op, value]);

  /**
   * Open the journey sheet with the local row, then hydrate from
   * /analytics/visitors/:id when the dashboard payload had no journeys
   * for this visitor (mirrors the web openVisitorSheet fallback).
   */
  const openJourney = async (v: Visitor) => {
    setJourneyFor(v);
    if (v.events.length > 0 || !siteId) {
      return;
    }
    try {
      const res = await fetchVisitorProfile(v.visitorId, siteId);
      setJourneyFor(profileToVisitor(res.profile, res.journeys));
    } catch {
      // Keep the list row — profile info still renders without events.
    }
  };

  let emptyText = "No visitors match.";
  if (visitorsQ.isError) {
    emptyText = "Couldn't load visitors.";
  }
  if (!visitorsQ.isError && visitors.length === 0) {
    emptyText = "No visitors yet.";
  }

  return (
    <View style={{ backgroundColor: theme.colors.background, flex: 1 }}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.pageTitle}>Visitors</Text>
        <FiltersBar
          dim={dim}
          onDim={setDim}
          onOp={setOp}
          onValue={setValue}
          op={op}
          value={value}
        />
        <PanelBody
          emptyText={emptyText}
          hasData={filtered.length > 0}
          loading={visitorsQ.isLoading}
        >
          <View style={styles.listHead}>
            <Text style={styles.listHeadLabel}>Visitor</Text>
            <Text style={styles.listHeadLabel}>Last seen</Text>
          </View>
          {filtered.map((v) => (
            <TouchableOpacity
              key={v.id}
              onPress={() => openJourney(v)}
              style={[styles.visitorRow, { borderColor: theme.colors.border }]}
            >
              <Image
                source={{ uri: avatarUrl(visitorName(v)) }}
                style={styles.avatar}
              />
              <View style={styles.visitorMain}>
                <View style={styles.visitorNameRow}>
                  <Text numberOfLines={1} style={styles.visitorName}>
                    {visitorName(v)}
                  </Text>
                  <Text style={styles.visitorEvents}>
                    {fmt(v.events.length)} events
                  </Text>
                </View>
                <Text numberOfLines={1} style={styles.visitorMeta}>
                  {v.flag} {v.country ?? "Unknown"} · {v.device ?? "—"} ·{" "}
                  {v.os ?? "—"}
                </Text>
                <View style={styles.visitorFootRow}>
                  <Text numberOfLines={1} style={styles.visitorSource}>
                    {v.source}
                  </Text>
                  <Text style={styles.visitorSpent}>{v.spent ?? ""}</Text>
                  <Text style={styles.visitorSeen}>{v.lastSeen}</Text>
                </View>
                <View style={styles.activityRow}>
                  {v.activity.map((a, i) => (
                    <View
                      key={i}
                      style={[
                        styles.activityDot,
                        {
                          backgroundColor: a
                            ? theme.colors.chart
                            : theme.colors.muted,
                        },
                      ]}
                    />
                  ))}
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </PanelBody>
        {visitorsQ.isLoading ? (
          <ActivityIndicator
            color={theme.colors.chart}
            style={styles.spinner}
          />
        ) : null}
      </ScrollView>

      {journeyFor ? (
        <JourneySheet
          visitor={journeyFor}
          onClose={() => setJourneyFor(null)}
          onSave={async (patch) => {
            await saveVisitor.mutateAsync({ id: journeyFor.id, patch });
          }}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  activityDot: {
    borderRadius: 999,
    height: 5,
    width: 5,
  },
  activityRow: {
    flexDirection: "row",
    gap: 3,
    justifyContent: "flex-end",
  },
  avatar: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    width: 36,
  },
  avatarLg: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 48,
    width: 48,
  },
  blockLabel: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
    letterSpacing: 1,
  },
  customerBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  customerText: {
    fontSize: 10,
    fontWeight: "600",
  },
  dayLabel: {
    borderRadius: theme.borderRadius.md,
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
    fontWeight: "500",
    paddingVertical: 6,
    textAlign: "center",
  },
  filterChip: {
    backgroundColor: theme.colors.muted,
    borderColor: theme.colors.border,
    borderRadius: 999,
    borderWidth: 1,
    color: theme.colors.mutedForeground,
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  filterChipActive: {
    backgroundColor: theme.colors.popover,
    color: theme.colors.foreground,
    fontWeight: "600",
  },
  filterChips: {
    gap: 6,
  },
  filterValue: {
    backgroundColor: theme.colors.input,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filters: {
    gap: 8,
  },
  listHead: {
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 6,
  },
  listHeadLabel: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
  },
  noTags: {
    color: theme.colors.mutedForeground,
    fontSize: 12,
  },
  noteInput: {
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    fontSize: theme.fontSize.xs,
    minHeight: 70,
    padding: 10,
    textAlignVertical: "top",
  },
  noteLabel: {
    marginTop: 4,
  },
  page: {
    gap: 10,
    padding: 12,
    paddingBottom: 32,
  },
  pageTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: "600",
  },
  profileBlock: {
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingBottom: 12,
  },
  profileEmail: {
    color: theme.colors.mutedForeground,
    fontFamily: "monospace",
    fontSize: 12,
  },
  profileMain: {
    flexShrink: 1,
    gap: 3,
  },
  profileMeta: {
    color: theme.colors.mutedForeground,
    fontSize: 12,
  },
  profileName: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: "600",
  },
  profileNameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  propChip: {
    borderRadius: 4,
    fontFamily: "monospace",
    fontSize: 10,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  propChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  saveRow: {
    alignItems: "flex-start",
  },
  sheet: {
    flex: 1,
  },
  sheetAction: {
    padding: 2,
  },
  sheetActionText: {
    color: theme.colors.mutedForeground,
    fontFamily: "monospace",
    fontSize: 10,
  },
  sheetBody: {
    gap: 12,
    padding: 14,
    paddingBottom: 40,
  },
  sheetCount: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
    fontWeight: "400",
  },
  sheetHead: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sheetHeadActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginLeft: "auto",
  },
  sheetTitle: {
    color: theme.colors.foreground,
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  spinner: {
    marginTop: 8,
  },
  stepChip: {
    borderRadius: 4,
    fontFamily: "monospace",
    fontSize: 11,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  stepRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  stepText: {
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 20,
  },
  stepTextWrap: {
    flex: 1,
  },
  stepTime: {
    color: theme.colors.mutedForeground,
    fontFamily: "monospace",
    fontSize: 11,
  },
  stepsFooter: {
    color: theme.colors.mutedForeground,
    fontFamily: "monospace",
    fontSize: 11,
    textAlign: "center",
  },
  tagAddRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  tagChip: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tagChipText: {
    fontSize: 11,
    fontWeight: "500",
  },
  tagInputWrap: {
    flex: 1,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagsBlock: {
    borderBottomWidth: 1,
    gap: 8,
    paddingBottom: 14,
  },
  timeline: {
    gap: 2,
  },
  visitorEvents: {
    backgroundColor: theme.colors.muted,
    borderRadius: 4,
    color: theme.colors.mutedForeground,
    fontFamily: "monospace",
    fontSize: 10,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  visitorFootRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  visitorMain: {
    flex: 1,
    gap: 2,
  },
  visitorMeta: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
  },
  visitorName: {
    color: theme.colors.foreground,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  visitorNameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "space-between",
  },
  visitorRow: {
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
  },
  visitorSeen: {
    color: theme.colors.mutedForeground,
    fontSize: 11,
    marginLeft: "auto",
  },
  visitorSource: {
    color: theme.colors.mutedForeground,
    flexShrink: 1,
    fontSize: 11,
  },
  visitorSpent: {
    color: theme.colors.money,
    fontFamily: "monospace",
    fontSize: 11,
  },
}));
