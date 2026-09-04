/**
 * Offline tests for the analytics-page data mapping helpers
 * (stepToEvent, profileToVisitor, aggregateGeo — exported for testability).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/utils/orpc", () => ({
  client: { legacy: { mintToken: vi.fn() } },
}));

import type {
  GeoRow,
  JourneyStep,
  VisitorJourney,
  VisitorProfile,
} from "@/lib/legacy/api";

import { aggregateGeo, profileToVisitor, stepToEvent } from "./analytics-page";

const STEP_BASE: JourneyStep = {
  event_type: "custom",
  name: null,
  path: "/",
  props: null,
  revenue: null,
  timestamp: "2026-01-01T00:00:00Z",
};

const step = (over: Partial<JourneyStep> = {}): JourneyStep =>
  Object.assign({}, STEP_BASE, over);

const JOURNEY_BASE: VisitorJourney = {
  browser: null,
  city: null,
  country: null,
  device_type: null,
  is_identified: false,
  os: null,
  referrer: null,
  region: null,
  session_id: "s1",
  started_at: "2026-01-01T00:00:00Z",
  steps: [],
  total_revenue: 0,
  utm_source: null,
  visitor_email: null,
  visitor_id: "v1",
  visitor_name: null,
};

const journey = (over: Partial<VisitorJourney> = {}): VisitorJourney =>
  Object.assign({}, JOURNEY_BASE, over);

const PROFILE_BASE: VisitorProfile = {
  avatar: null,
  browser: "Firefox",
  city: "Jakarta",
  country: "ID",
  device_type: "desktop",
  email: null,
  first_seen: "2025-12-01T00:00:00Z",
  id: "r1",
  last_seen: "2026-01-01T00:00:00Z",
  name: null,
  notes: null,
  os: "Linux",
  phone: null,
  region: null,
  tags: null,
  total_pageviews: 0,
  total_revenue: 0,
  total_sessions: 0,
  visitor_id: "v1",
};

const profile = (over: Partial<VisitorProfile> = {}): VisitorProfile =>
  Object.assign({}, PROFILE_BASE, over);

describe("stepToEvent", () => {
  it("maps pageviews to view events", () => {
    expect(stepToEvent(step({ event_type: "pageview", path: "/pricing" }))).toEqual({
      kind: "view",
      page: "/pricing",
      time: "2026-01-01T00:00:00Z",
    });
  });

  it("maps conversions with parsed props and rounded revenue", () => {
    expect(
      stepToEvent(
        step({
          event_type: "conversion",
          name: "purchase",
          props: '{"plan":"pro"}',
          revenue: 12.4,
        })
      )
    ).toEqual({
      event: "purchase",
      kind: "conversion",
      props: [["plan", "pro"]],
      revenue: "$12",
      time: "2026-01-01T00:00:00Z",
    });
  });

  it("drops heartbeats", () => {
    expect(stepToEvent(step({ name: "heartbeat" }))).toBeNull();
  });

  it("maps scroll milestones from props depth", () => {
    expect(
      stepToEvent(step({ name: "scroll", props: '{"depth":"55"}' }))
    ).toMatchObject({ kind: "scroll", milestone: 55 });
    expect(stepToEvent(step({ name: "scroll" }))).toMatchObject({
      kind: "scroll",
      milestone: null,
    });
  });

  it("prefers click text over target over path", () => {
    expect(
      stepToEvent(step({ name: "click", props: '{"target":"#buy"}', path: "/p" }))
    ).toMatchObject({ click: "#buy", kind: "click" });
    expect(
      stepToEvent(step({ name: "click", props: '{"text":"Buy now"}' }))
    ).toMatchObject({ click: "Buy now" });
  });

  it("maps scroll sections and generic events", () => {
    expect(
      stepToEvent(step({ name: "scroll_section", props: '{"section_id":"hero"}' }))
    ).toMatchObject({ kind: "section", section: "hero" });
    expect(stepToEvent(step({ name: "weird" }))).toEqual({
      event: "weird",
      kind: "event",
      props: undefined,
      time: "2026-01-01T00:00:00Z",
    });
    expect(stepToEvent(step({}))).toMatchObject({ event: "custom" });
  });
});

describe("profileToVisitor", () => {
  const now = new Date();
  const v = profileToVisitor(
    profile({ tags: '["beta","vip"]', notes: "hi", total_revenue: 500_000 }),
    [
      journey({
        session_id: "s2",
        started_at: "2026-01-02T00:00:00Z",
        steps: [
          step({ event_type: "pageview", path: "/b", timestamp: "2026-01-02T01:00:00Z" }),
          step({ event_type: "pageview", path: "/a", timestamp: "2026-01-02T00:30:00Z" }),
        ],
        utm_source: "google",
      }),
      // Another visitor's journey must be ignored entirely.
      journey({
        session_id: "s3",
        steps: [step({ event_type: "pageview", path: "/other" })],
        visitor_id: "v2",
      }),
    ]
  );

  it("keeps only this visitor's journeys and sorts events by time", () => {
    expect(v.events.map((e) => e.page)).toEqual(["/a", "/b"]);
  });

  it("maps identity fields", () => {
    expect(v).toMatchObject({
      browser: "Firefox",
      city: "Jakarta",
      country: "ID",
      customer: true,
      device: "desktop",
      flag: "\u{1F1EE}\u{1F1E9}",
      id: "r1",
      note: "hi",
      os: "Linux",
      spent: "$500,000",
      source: "google",
      tags: ["beta", "vip"],
      visitorId: "v1",
    });
  });

  it("falls back to the referrer host, then direct", () => {
    const viaReferrer = profileToVisitor(profile(), [
      journey({ referrer: "https://www.example.com/page", utm_source: null }),
    ]);
    expect(viaReferrer.source).toBe("example.com");

    const direct = profileToVisitor(profile(), [
      journey({ referrer: null, started_at: now.toISOString(), utm_source: null }),
    ]);
    expect(direct.source).toBe("direct");
  });

  it("builds a 7-day activity window with today marked", () => {
    const marked = profileToVisitor(profile(), [
      journey({ started_at: now.toISOString() }),
    ]);
    expect(marked.activity).toHaveLength(7);
    expect(marked.activity[5]).toBe(0);
    expect(marked.activity[6]).toBe(1);
  });

  it("tolerates malformed tag payloads", () => {
    expect(profileToVisitor(profile({ tags: "a, b ,,c" }), []).tags).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(profileToVisitor(profile({ tags: "{not json" }), []).tags).toEqual([
      "{not json",
    ]);
    expect(profileToVisitor(profile({ tags: null }), []).tags).toEqual([]);
  });
});

describe("aggregateGeo", () => {
  const rows: GeoRow[] = [
    { city: "Jakarta", country: "ID", region: null, visitors: 2 },
    { city: "Jakarta", country: "ID", region: null, visitors: 1 },
    { city: "Austin", country: "US", region: null, visitors: 2 },
    { city: null, country: null, region: null, visitors: 9 },
  ];

  it("sums by key, skips null keys, and sorts descending", () => {
    expect(aggregateGeo(rows, (r) => r.country)).toEqual([
      { flag: "\u{1F1EE}\u{1F1E9}", label: "ID", value: 3 },
      { flag: "\u{1F1FA}\u{1F1F8}", label: "US", value: 2 },
    ]);
  });

  it("omits the flag for non-country keys", () => {
    expect(aggregateGeo(rows, (r) => r.city)).toEqual([
      { flag: undefined, label: "Jakarta", value: 3 },
      { flag: undefined, label: "Austin", value: 2 },
    ]);
  });
});
