import { useEffect, useRef, useMemo } from "react";
import createGlobe, { type COBEOptions } from "cobe";

const CITY_COORDS: Record<string, [number, number]> = {
  "Jakarta": [-6.2, 106.85], "Surabaya": [-7.25, 112.75], "Bandung": [-6.9, 107.6],
  "Denpasar": [-8.65, 115.22], "Yogyakarta": [-7.8, 110.36], "Semarang": [-6.97, 110.42],
  "Medan": [3.59, 98.67], "Makassar": [-5.15, 119.43], "Palembang": [-2.99, 104.76],
  "Tangerang": [-6.17, 106.63], "Depok": [-6.4, 106.82], "Bekasi": [-6.24, 106.99],
  "Bogor": [-6.6, 106.8], "Malang": [-7.98, 112.63], "Solo": [-7.57, 110.82],
  "Kuala Lumpur": [3.14, 101.69], "Singapore": [1.35, 103.82], "Bangkok": [13.75, 100.5],
  "Manila": [14.6, 120.98], "Tokyo": [35.68, 139.69], "Osaka": [34.69, 135.5],
  "Seoul": [37.57, 127.0], "New York": [40.71, -74.01], "San Francisco": [37.77, -122.42],
  "Los Angeles": [34.05, -118.24], "London": [51.51, -0.13], "Paris": [48.86, 2.35],
  "Berlin": [52.52, 13.41], "Munich": [48.14, 11.58], "Amsterdam": [52.37, 4.9],
  "Sydney": [-33.87, 151.21], "Melbourne": [-37.81, 144.96],
  "Sao Paulo": [-23.55, -46.63], "Toronto": [43.65, -79.38], "Dubai": [25.2, 55.27],
  "Istanbul": [41.01, 28.98], "Taipei": [25.03, 121.57], "Hong Kong": [22.32, 114.17],
  "Hanoi": [21.03, 105.85], "Ho Chi Minh City": [10.82, 106.63],
};

const GLOBE_RADIUS = 0.8;
const MARKER_ELEVATION = 0.05;
const MARKER_RADIUS = GLOBE_RADIUS + MARKER_ELEVATION;

function latLngToVec3(lat: number, lng: number): [number, number, number] {
  const latRad = lat * Math.PI / 180;
  const lngRad = lng * Math.PI / 180 - Math.PI;
  const cosLat = Math.cos(latRad);
  return [-cosLat * Math.sin(lngRad), Math.sin(latRad), cosLat * Math.cos(lngRad)];
}

export function projectMarker(
  lat: number, lng: number,
  phi: number, theta: number,
  cw: number, ch: number,
): { screenX: number; screenY: number; visible: boolean } {
  const [ux, uy, uz] = latLngToVec3(lat, lng);
  const x = ux * MARKER_RADIUS;
  const y = uy * MARKER_RADIUS;
  const z = uz * MARKER_RADIUS;

  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);

  const rotX = cosP * x + sinP * z;
  const rotY = sinP * sinT * x + cosT * y - sinT * cosP * z;
  const rotZ = -sinP * cosT * x + sinT * y + cosP * cosT * z;

  const aspect = cw / ch;
  const normX = (rotX / aspect + 1) / 2;
  const normY = (-rotY + 1) / 2;
  const visible = rotZ >= 0 || (rotX * rotX + rotY * rotY >= 0.64);

  return { screenX: normX * cw, screenY: normY * ch, visible };
}

interface GlobeProps {
  className?: string;
  markers?: { lat: number; lng: number; size: number; city?: string }[];
  style?: React.CSSProperties;
  paused?: boolean;
  onMarkerClick?: (marker: { lat: number; lng: number; size: number; city?: string }, index: number) => void;
  fullscreen?: boolean;
}

const DEFAULT_MARKERS = [
  { lat: -6.2, lng: 106.85, size: 0.06 }, { lat: -7.25, lng: 112.75, size: 0.04 },
  { lat: -8.65, lng: 115.22, size: 0.04 }, { lat: -6.9, lng: 107.6, size: 0.03 },
  { lat: 3.14, lng: 101.69, size: 0.04 }, { lat: 13.75, lng: 100.5, size: 0.04 },
  { lat: 35.68, lng: 139.69, size: 0.04 }, { lat: 40.71, lng: -74.01, size: 0.05 },
  { lat: 51.51, lng: -0.13, size: 0.04 }, { lat: -23.55, lng: -46.63, size: 0.04 },
];

export function Globe({ className, markers, style, paused, onMarkerClick, fullscreen }: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerInteracting = useRef<number | null>(null);
  const phiRef = useRef(0);
  const dragPhi = useRef(0);
  const rafRef = useRef(0);

  const activeMarkers = markers ?? DEFAULT_MARKERS;

  const config = useMemo<COBEOptions>(() => ({
    width: 800, height: 800, devicePixelRatio: 2,
    phi: 0, theta: 0.3, dark: 1, diffuse: 0.4,
    mapSamples: 16000, mapBrightness: 6,
    baseColor: [0.06, 0.06, 0.06],
    markerColor: [0.83, 0.53, 0.16],
    glowColor: [0.83, 0.53, 0.16],
    markers: activeMarkers.map(m => ({ location: [m.lat, m.lng], size: m.size })),
  }), [activeMarkers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ro = new ResizeObserver(() => {
      const dpr = 2;
      const w = canvas.offsetWidth * dpr;
      const h = canvas.offsetHeight * dpr;
      canvas.width = w;
      canvas.height = h;
    });
    ro.observe(canvas);

    requestAnimationFrame(() => {
      const globe = createGlobe(canvas, {
        ...config,
        width: canvas.offsetWidth * 2,
        height: fullscreen ? canvas.offsetHeight * 2 : canvas.offsetWidth * 2,
      });

      const animate = () => {
        if (!paused && !pointerInteracting.current) phiRef.current += 0.003;
        globe.update({ phi: phiRef.current + dragPhi.current });
        rafRef.current = requestAnimationFrame(animate);
      };
      rafRef.current = requestAnimationFrame(animate);
      setTimeout(() => (canvas.style.opacity = "1"), 0);

      const prevDestroy = () => {
        cancelAnimationFrame(rafRef.current);
        globe.destroy();
      };

      (canvas as any).__cleanup = () => {
        prevDestroy();
        ro.disconnect();
      };
    });

    return () => {
      const cleanup = (canvas as any).__cleanup;
      if (cleanup) cleanup();
      cancelAnimationFrame(rafRef.current);
    };
  }, [config, paused, fullscreen]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onMarkerClick || !activeMarkers.length) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const clickY = (e.clientY - rect.top) * (canvas.height / rect.height);

    const currentPhi = phiRef.current + dragPhi.current;
    const theta = 0.3;

    let bestIdx = -1;
    let bestDist = 25;

    for (let i = 0; i < activeMarkers.length; i++) {
      const m = activeMarkers[i];
      const proj = projectMarker(m.lat, m.lng, currentPhi, theta, canvas.width, canvas.height);
      if (!proj.visible) continue;
      const dist = Math.hypot(proj.screenX - clickX, proj.screenY - clickY);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      onMarkerClick(activeMarkers[bestIdx], bestIdx);
    }
  };

  const wrapperStyle: React.CSSProperties = fullscreen
    ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
    : { position: "relative", margin: "0 auto", aspectRatio: "1/1", width: "100%", maxWidth: 500, ...style };

  return (
    <div className={className} style={wrapperStyle}>
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onPointerDown={(e) => {
          if (paused) return;
          pointerInteracting.current = e.clientX;
          canvasRef.current!.style.cursor = "grabbing";
        }}
        onPointerUp={() => {
          pointerInteracting.current = null;
          if (canvasRef.current) canvasRef.current.style.cursor = paused ? "default" : "grab";
        }}
        onPointerOut={() => {
          pointerInteracting.current = null;
          if (canvasRef.current) canvasRef.current.style.cursor = paused ? "default" : "grab";
        }}
        onMouseMove={(e) => {
          if (paused || pointerInteracting.current === null) return;
          dragPhi.current += (e.clientX - pointerInteracting.current) / 1400;
          pointerInteracting.current = e.clientX;
        }}
        style={{
          width: "100%", height: "100%", opacity: 0, transition: "opacity 0.5s",
          contain: "layout paint size", cursor: paused ? "default" : "grab",
        }}
      />
    </div>
  );
}

export function geoToMarkers(geo: { city: string | null; visitors: number }[]): { lat: number; lng: number; size: number; city: string }[] {
  return geo
    .filter(g => g.city && CITY_COORDS[g.city])
    .map(g => {
      const [lat, lng] = CITY_COORDS[g.city!]!;
      const size = Math.min(0.15, Math.max(0.02, g.visitors * 0.004));
      return { lat, lng, size, city: g.city! };
    });
}
