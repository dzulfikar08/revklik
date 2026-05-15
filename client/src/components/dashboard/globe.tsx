// Globe/event log components

import { useMemo } from "react";
import { t } from "@/lib/i18n";
import { nameFromVisitorId, avatarUrl, countryFlag, DeviceIcon, OSIcon, BrowserIcon, sourceLabel } from "./icons";
import { timeAgo } from "./metric-cards";
import { sessionDuration } from "./journey";
import type { VisitorJourney } from "shared";

export function GlobeSummaryPanel({ journeys }: { journeys: VisitorJourney[] }) {
  const stats = useMemo(() => {
    const uniqueVisitors = new Set(journeys.map(j => j.visitor_id)).size;
    const byReferrer = Object.entries(
      journeys.reduce<Record<string, number>>((acc, j) => {
        const key = j.utm_source || j.referrer || "direct";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const byCountry = Object.entries(
      journeys.reduce<Record<string, number>>((acc, j) => {
        const key = j.country || "unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const byDevice = Object.entries(
      journeys.reduce<Record<string, number>>((acc, j) => {
        const key = j.device_type || "unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return { uniqueVisitors, byReferrer, byCountry, byDevice };
  }, [journeys]);

  return (
    <div className="globe-summary-panel">
      <div className="globe-stat-card">
        <span className="globe-stat-label">{t("globe.live_visitors")}</span>
        <span className="globe-stat-value">{stats.uniqueVisitors}</span>
      </div>
      {stats.byReferrer.length > 0 && (
        <div className="globe-stat-group">
          <span className="globe-stat-group-title">Sources</span>
          {stats.byReferrer.map(([src, count]) => (
            <div key={src} className="globe-stat-row"><span>{sourceLabel(src)}</span><span className="globe-stat-num">{count}</span></div>
          ))}
        </div>
      )}
      {stats.byCountry.length > 0 && (
        <div className="globe-stat-group">
          <span className="globe-stat-group-title">Countries</span>
          {stats.byCountry.map(([country, count]) => (
            <div key={country} className="globe-stat-row"><span>{countryFlag(country)} {country}</span><span className="globe-stat-num">{count}</span></div>
          ))}
        </div>
      )}
      {stats.byDevice.length > 0 && (
        <div className="globe-stat-group">
          <span className="globe-stat-group-title">Devices</span>
          {stats.byDevice.map(([device, count]) => (
            <div key={device} className="globe-stat-row"><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><DeviceIcon device={device} />{device}</span><span className="globe-stat-num">{count}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function GlobeEventLog({ journeys }: { journeys: VisitorJourney[] }) {
  const events = useMemo(() =>
    journeys.slice(0, 10).map(j => {
      const displayName = j.visitor_name || nameFromVisitorId(j.visitor_id);
      return {
        id: j.session_id,
        name: displayName,
        avatar: avatarUrl(displayName),
        city: j.city,
        region: j.region,
        country: j.country,
        path: j.steps.length > 0 ? j.steps[j.steps.length - 1]!.path : "/",
        startedAt: j.started_at,
        device: j.device_type,
        os: j.os,
        browser: j.browser,
        revenue: j.total_revenue,
        hasRevenue: j.total_revenue > 0,
        isIdentified: j.is_identified,
      };
    }),
    [journeys],
  );

  return (
    <div className="globe-event-log">
      <div className="globe-event-log-title">Live Activity</div>
      {events.map(e => (
        <div key={e.id} className="globe-event-row">
          <img src={e.avatar} alt="" style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--bg3)", flexShrink: 0 }} />
          <div className="globe-event-info">
            <span className="globe-event-name">{e.name}</span>
            <span className="globe-event-detail">
              {e.country && <>{countryFlag(e.country)} {[e.city, e.region].filter(Boolean).join(", ") || e.country} · </>}
              {e.device && <><DeviceIcon device={e.device} />{e.device} </>}
              {e.os && <><span style={{ color: "var(--text4)" }}>·</span><OSIcon os={e.os} />{e.os} </>}
              {e.browser && <><span style={{ color: "var(--text4)" }}>·</span><BrowserIcon browser={e.browser} />{e.browser} </>}
              <span style={{ color: "var(--text4)" }}>·</span>{e.path}
            </span>
          </div>
          <span className="globe-event-time">{timeAgo(e.startedAt)}</span>
          {e.hasRevenue && <span className="globe-event-revenue">${e.revenue}</span>}
        </div>
      ))}
    </div>
  );
}

export function GlobeMarkerPopup({ city, journeys, onClose }: { city: string; journeys: VisitorJourney[]; onClose: () => void }) {
  return (
    <div className="globe-marker-popup-overlay" onClick={onClose}>
      <div className="globe-marker-popup" onClick={e => e.stopPropagation()}>
        <div className="globe-popup-header">
          <span className="globe-popup-city">{city}</span>
          <span className="globe-popup-count">{journeys.length} visitor{journeys.length !== 1 ? "s" : ""}</span>
          <button className="globe-popup-close" onClick={onClose}>&#10005;</button>
        </div>
        <div className="globe-popup-list">
          {journeys.map(j => {
            const displayName = j.visitor_name || nameFromVisitorId(j.visitor_id);
            return (
            <div key={j.session_id} className="globe-popup-visitor">
              <div className="globe-popup-visitor-header">
                <img src={avatarUrl(displayName)} alt="" style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--bg3)", flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="globe-popup-name">{displayName}</div>
                  <div className="globe-popup-meta" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    {j.device_type && <><DeviceIcon device={j.device_type} />{j.device_type}</>}
                    {j.os && <><span style={{ color: "var(--text4)" }}>·</span><OSIcon os={j.os} />{j.os}</>}
                    {j.browser && <><span style={{ color: "var(--text4)" }}>·</span><BrowserIcon browser={j.browser} />{j.browser}</>}
                  </div>
                </div>
                {j.total_revenue > 0 && <span className="globe-popup-revenue">${j.total_revenue}</span>}
              </div>
              <div className="globe-popup-session">
                <span className="globe-popup-path">{j.steps.length > 0 ? j.steps[j.steps.length - 1].path : "/"}</span>
                <span className="globe-popup-duration">{sessionDuration(j)}</span>
              </div>
              {j.steps.length > 0 && (
                <div className="globe-popup-steps">
                  {j.steps.slice(-6).map((step, i) => (
                    <span key={i} className={`globe-popup-step ${step.event_type}`}>
                      {step.event_type === "pageview" ? step.path : step.name || step.event_type}
                    </span>
                  ))}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
