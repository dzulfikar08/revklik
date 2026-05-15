// Heatmap visualization

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchHeatmap } from "@/lib/api";

export function HeatmapView({ siteId, topPages, range }: { siteId: string; topPages: { path: string }[]; range: string }) {
  const [selectedPath, setSelectedPath] = useState("/");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { data: heatmapData, isLoading } = useQuery({
    queryKey: ["heatmap", siteId, selectedPath, range],
    queryFn: () => fetchHeatmap(siteId, selectedPath, range),
    enabled: !!siteId,
  });

  const paths = useMemo(() => {
    const set = new Set(topPages.map((p) => p.path));
    if (!set.has("/")) set.add("/");
    return [...set];
  }, [topPages]);

  // Render click heatmap on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !heatmapData?.clickGrid) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background grid
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 50; i++) {
      const x = (i / 50) * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      const y = (i / 50) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    const grid = heatmapData.clickGrid;
    let maxVal = 0;
    for (const row of grid) for (const v of row) if (v > maxVal) maxVal = v;
    if (maxVal === 0) return;

    const cellW = W / 50;
    const cellH = H / 50;

    for (let r = 0; r < 50; r++) {
      for (let c = 0; c < 50; c++) {
        const v = grid[r]![c]!;
        if (v === 0) continue;
        const intensity = v / maxVal;
        const cx = c * cellW + cellW / 2;
        const cy = r * cellH + cellH / 2;
        const radius = cellW * 0.8 * (0.3 + intensity * 0.7);

        // Color: blue (low) -> orange (mid) -> red (high)
        let color: string;
        if (intensity < 0.5) {
          const t = intensity * 2;
          const rr = Math.round(60 + t * 152);
          const gg = Math.round(165 - t * 29);
          const bb = Math.round(250 - t * 208);
          color = `rgba(${rr},${gg},${bb},${0.3 + intensity * 0.5})`;
        } else {
          const t = (intensity - 0.5) * 2;
          const rr = Math.round(212 + t * 27);
          const gg = Math.round(136 - t * 68);
          const bb = Math.round(42 + t * 26);
          color = `rgba(${rr},${gg},${bb},${0.4 + intensity * 0.5})`;
        }

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
  }, [heatmapData]);

  const data = heatmapData;
  const maxScrollVisitors = data ? Math.max(...data.scrollDepths.map((s) => s.visitors), 1) : 1;

  return (
    <div className="detail-scroll">
      <div className="heatmap-container">
        {/* Header */}
        <div className="heatmap-header">
          <select
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
            className="heatmap-path-select"
          >
            {paths.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {data && (
            <div className="heatmap-stats">
              <span className="heatmap-stat"><span className="heatmap-stat-value">{data.totalClicks.toLocaleString()}</span> clicks</span>
              <span className="heatmap-stat"><span className="heatmap-stat-value">{data.totalSessions.toLocaleString()}</span> sessions</span>
            </div>
          )}
        </div>

        {isLoading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><div className="spinner" /></div>
        ) : !data || data.totalClicks === 0 ? (
          <div style={{ padding: 48, color: "var(--text3)", fontSize: 13, textAlign: "center" }}>
            No click data for this page yet. Make sure the heatmap script is installed.
          </div>
        ) : (
          <div className="heatmap-body">
            <div className="heatmap-canvas-wrap">
              <canvas
                ref={canvasRef}
                width={600}
                height={800}
                className="heatmap-canvas"
              />
            </div>
            <div className="heatmap-sidebar">
              {/* Scroll depth */}
              <div className="heatmap-sidebar-section">
                <div className="heatmap-sidebar-title">Scroll Depth</div>
                <div className="heatmap-scroll-bars">
                  {data.scrollDepths.map((s) => (
                    <div key={s.depth} className="heatmap-scroll-row">
                      <span className="heatmap-scroll-label">{s.depth}%</span>
                      <div className="heatmap-scroll-track">
                        <div className="heatmap-scroll-bar" style={{ width: `${(s.visitors / maxScrollVisitors) * 100}%` }} />
                      </div>
                      <span className="heatmap-scroll-count">{s.visitors}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Top elements */}
              {data.topElements.length > 0 && (
                <div className="heatmap-sidebar-section">
                  <div className="heatmap-sidebar-title">Top Clicked Elements</div>
                  <div className="heatmap-elements">
                    {data.topElements.slice(0, 10).map((el) => (
                      <div key={el.selector} className="heatmap-element-row">
                        <span className="heatmap-element-label" title={el.selector}>{el.label || el.selector}</span>
                        <span className="heatmap-element-count">{el.clicks}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
