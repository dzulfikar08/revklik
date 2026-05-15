import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { AreaChart, Area, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid, ComposedChart } from "recharts";
// Custom funnel chart — pure React SVG, no MUI dependency
import GridLayout, { useContainerWidth } from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import { fetchDashboard, fetchFunnel, fetchGeo, fetchRecordings, fetchRecording, fetchHeatmap, updateVisitor, connectSSE, exportData } from "@/lib/api";
import type { VisitorJourney, FunnelStep, PageFunnel, DeviceEntry, RecordingSummary, RecordingDetail, RevenueBySource, RevenueByCountry, RevenueTimeSeriesPoint, ChannelEntry, EntryPageRevenue, RevenueByPaymentMethod, RevenueByPaymentProvider } from "shared";
import { Globe, geoToMarkers } from "@/components/globe";
import { AiInsightsCard } from "@/components/ai-insights-card";
import { EventCalculator } from "@/components/event-calculator";
import { t } from "@/lib/i18n";
import { Capacitor } from "@capacitor/core";
import { DateTimePicker } from "@/components/time-picker";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

// Deterministic name from visitor ID
const NAMES_FIRST = ["Alex","Jordan","Sam","Taylor","Morgan","Casey","Riley","Quinn","Avery","Blake","Sage","River","Skyler","Dakota","Reese","Finley","Rowan","Hayden","Emery","Drew","Parker","Sawyer","Ellis","Arden","Kai","Lennox","Harley","Marley","Shiloh","Sutton"];
const NAMES_LAST = ["Stone","Rivera","Chen","Kim","Patel","Nguyen","Silva","Lee","Brooks","Reed","Clark","Young","Ross","Ward","Fox","Hart","Lane","Marsh","Peck","Wells","Bell","Cole","Grant","Shaw","Hale"];

function nameFromVisitorId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  const first = NAMES_FIRST[Math.abs(h) % NAMES_FIRST.length]!;
  const last = NAMES_LAST[Math.abs(h >> 8) % NAMES_LAST.length]!;
  return `${first} ${last}`;
}

function avatarUrl(name: string): string {
  return `https://api.dicebear.com/9.x/big-smile/svg?seed=${encodeURIComponent(name)}`;
}

function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}


function DeviceIcon({ device }: { device: string }) {
  const d = device.toLowerCase();
  if (d.includes("mobile") || d.includes("phone"))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>;
  if (d.includes("tablet"))
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>;
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>;
}

function OSIcon({ os }: { os: string }) {
  const o = os.toLowerCase();
  if (o.includes("mac")) return <svg width="14" height="14" viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" fill="currentColor"/></svg>;
  if (o.includes("ios")) return <svg width="14" height="14" viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" fill="currentColor"/></svg>;
  if (o.includes("windows")) return <svg width="14" height="14" viewBox="0 0 24 24"><path d="M3 12V6.75l8-1.25V12H3zm0 .5h8v6.5l-8-1.25V12.5zM11.5 5.38l9.5-1.63V12h-9.5V5.38zm0 7.12h9.5v8.25l-9.5-1.63V12.5z" fill="currentColor"/></svg>;
  if (o.includes("android")) return <svg width="14" height="14" viewBox="0 0 24 24"><path d="M17.6 11.4c0-.8-.5-1.5-1.2-1.8l1.7-3.1c.1-.2 0-.5-.2-.6-.2-.1-.5 0-.6.2l-1.7 3.1c-.7-.3-1.4-.4-2.2-.4s-1.5.2-2.2.4L9.5 6.1c-.1-.2-.4-.3-.6-.2-.2.1-.3.4-.2.6l1.7 3.1c-.7.3-1.2 1-1.2 1.8H3v.6c0 3.5 2.1 6.5 5.2 7.8.3.1.7.2 1 .2h5.6c.3 0 .7-.1 1-.2 3.1-1.3 5.2-4.3 5.2-7.8v-.6h-3.4zM7.5 13.3c-.4 0-.8-.4-.8-.8s.4-.8.8-.8.8.4.8.8-.4.8-.8.8zm9 0c-.4 0-.8-.4-.8-.8s.4-.8.8-.8.8.4.8.8-.4.8-.8.8z" fill="currentColor"/></svg>;
  if (o.includes("linux")) return <svg width="14" height="14" viewBox="0 0 24 24"><path d="M12.5 2c-1.5 0-2.5 1.5-2.5 3.5 0 1 .3 2 .8 2.7-.2.8-.5 1.5-1 2C9.2 11 8.5 12 8.5 13.5c0 1.2.4 2 1 2.7.3.4.5.8.5 1.3 0 1.5-.5 2.5-.5 3.5 0 1 .8 1 1.5 1h3c.7 0 1.5 0 1.5-1 0-1-.5-2-.5-3.5 0-.5.2-.9.5-1.3.6-.7 1-1.5 1-2.7 0-1.5-.7-2.5-1.3-3.3-.5-.5-.8-1.2-1-2 .5-.7.8-1.7.8-2.7 0-2-1-3.5-2.5-3.5z" fill="currentColor"/></svg>;
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>;
}

function BrowserIcon({ browser }: { browser: string }) {
  const b = browser.toLowerCase();
  if (b.includes("chrome")) return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728Z"/></svg>;
  if (b.includes("safari")) return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm-.004.953h.006c.063 0 .113.05.113.113v1.842c0 .063-.05.113-.113.113h-.006a.112.112 0 0 1-.113-.113V1.066c0-.063.05-.113.113-.113zm-.941.041c.056.001.104.046.11.104l.077.918a.112.112 0 0 1-.101.12h-.01a.11.11 0 0 1-.12-.1l-.08-.919a.112.112 0 0 1 .102-.12h.01l.012-.003zm1.892 0H12.965a.113.113 0 0 1 .103.121l-.08.92a.111.111 0 0 1-.12.102h-.009a.111.111 0 0 1-.101-.121l.078-.92a.112.112 0 0 1 .111-.102zm-2.838.123a.11.11 0 0 1 .106.092l.32 1.818c.01.06-.03.119-.09.13l-.01.001a.111.111 0 0 1-.128-.09l-.32-1.818a.111.111 0 0 1 .09-.129l.01-.002a.103.103 0 0 1 .022-.002zm3.784.002h.021l.008.002c.061.01.102.07.092.131l-.32 1.814c-.011.062-.07.101-.132.09h-.005a.113.113 0 0 1-.092-.13l.32-1.815a.111.111 0 0 1 .108-.092zm-4.715.203c.048.002.09.035.103.084l.239.893a.112.112 0 0 1-.079.139l-.005.001a.114.114 0 0 1-.14-.08l-.237-.894a.11.11 0 0 1 .078-.137l.006-.002a.123.123 0 0 1 .035-.004zm5.644 0a.11.11 0 0 1 .033.004l.006.002c.06.016.097.079.08.139l-.24.892a.112.112 0 0 1-.137.08l-.005-.002a.114.114 0 0 1-.08-.138l.24-.893a.112.112 0 0 1 .103-.084zm-6.562.285a.11.11 0 0 1 .107.073L9 3.42a.107.107 0 0 1-.064.139l-.012.005a.11.11 0 0 1-.14-.066L8.15 1.76a.11.11 0 0 1 .065-.14l.014-.005a.106.106 0 0 1 .03-.008zm7.469.002c.014 0 .028.001.042.006l.012.006c.057.02.087.082.067.139l-.633 1.738a.11.11 0 0 1-.14.066l-.013-.003A.11.11 0 0 1 15 3.42l.633-1.738a.108.108 0 0 1 .096-.073zm-8.352.366a.112.112 0 0 1 .105.064l.393.838a.112.112 0 0 1-.055.148l-.008.004a.11.11 0 0 1-.146-.054l-.395-.838a.112.112 0 0 1 .055-.149l.008-.004a.11.11 0 0 1 .043-.01zm9.246 0a.11.11 0 0 1 .043.01l.006.003a.11.11 0 0 1 .053.149l-.391.838a.112.112 0 0 1-.148.054l-.006-.002a.112.112 0 0 1-.055-.148l.393-.84a.112.112 0 0 1 .105-.064zm-10.092.44c.04-.002.08.018.102.056l.922 1.597a.113.113 0 0 1-.041.155l-.006.002a.113.113 0 0 1-.154-.041l-.922-1.598a.113.113 0 0 1 .04-.154l.007-.002a.11.11 0 0 1 .052-.016zm10.94.001c.018 0 .035.004.052.014l.004.002a.114.114 0 0 1 .041.156l-.923 1.596a.114.114 0 0 1-.157.04l-.004-.001a.112.112 0 0 1-.04-.155l.925-1.595a.113.113 0 0 1 .102-.057z"/></svg>;
  if (b.includes("firefox")) return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8.824 7.287c.008 0 .004 0 0 0zm-2.8-1.4c.006 0 .003 0 0 0zm16.754 2.161c-.505-1.215-1.53-2.528-2.333-2.943.654 1.283 1.033 2.57 1.177 3.53l.002.02c-1.314-3.278-3.544-4.6-5.366-7.477-.091-.147-.184-.292-.273-.446a3.545 3.545 0 01-.13-.24 2.118 2.118 0 01-.172-.46.03.03 0 00-.027-.03.038.038 0 00-.021 0l-.006.001a.037.037 0 00-.01.005L15.624 0c-2.585 1.515-3.657 4.168-3.932 5.856a6.197 6.197 0 00-2.305.587.297.297 0 00-.147.37c.057.162.24.24.396.17a5.622 5.622 0 012.008-.523l.067-.005a5.847 5.847 0 011.957.222l.095.03a5.816 5.816 0 01.616.228c.08.036.16.073.238.112l.107.055a5.835 5.835 0 01.368.211 5.953 5.953 0 012.034 2.104c-.62-.437-1.733-.868-2.803-.681 4.183 2.09 3.06 9.292-2.737 9.02a5.164 5.164 0 01-1.513-.292 4.42 4.42 0 01-.538-.232c-1.42-.735-2.593-2.121-2.74-3.806 0 0 .537-2 3.845-2 .357 0 1.38-.998 1.398-1.287-.005-.095-2.029-.9-2.817-1.677-.422-.416-.622-.616-.8-.767a3.47 3.47 0 00-.301-.227 5.388 5.388 0 01-.032-2.842c-1.195.544-2.124 1.403-2.8 2.163h-.006c-.46-.584-.428-2.51-.402-2.913-.006-.025-.343.176-.389.206-.406.29-.787.616-1.136.974-.397.403-.76.839-1.085 1.303a9.816 9.816 0 00-1.562 3.52c-.003.013-.11.487-.19 1.073-.013.09-.026.181-.037.272a7.8 7.8 0 00-.069.667l-.002.034-.023.387-.001.06C.386 18.795 5.593 24 12.016 24c5.752 0 10.527-4.176 11.463-9.661.02-.149.035-.298.052-.448.232-1.994-.025-4.09-.753-5.844z"/></svg>;
  if (b.includes("edge")) return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21.86 17.205c.312 1.704-.756 3.378-2.388 4.04-1.726.72-3.862.576-5.386-.576a3.476 3.476 0 01-.586-.528l-2.456-2.848a6.147 6.147 0 01-1.128-3.336A5.973 5.973 0 0112 8.102a6.267 6.267 0 013.168 1.792c.39.408.72.864.984 1.36a6.097 6.097 0 00-2.064-.384 4.652 4.652 0 00-3.024.984 5.012 5.012 0 00-1.68 2.928c-.24 1.704.648 3.408 2.16 4.272l.288.144c1.44.768 3.168.672 4.656-.048a5.052 5.052 0 002.592-3.072c.144-.624.144-1.272.048-1.896.504.84.84 1.752 1.008 2.712.24 1.128.144 2.304-.288 3.384 1.704-.912 3.024-2.544 3.504-4.44a7.726 7.726 0 00-.336-4.992C22.1 7.57 20.164 5.538 17.74 4.306A12.027 12.027 0 0012.02 3c-2.52 0-4.872.792-6.792 2.16A11.927 11.927 0 00.384 11.59a12.226 12.226 0 00.072 5.544c.84 2.904 3.024 5.28 5.808 6.504a12.19 12.19 0 004.584.912c2.472-.024 4.872-.84 6.768-2.4a9.48 9.48 0 002.664-3.648 7.09 7.09 0 00-.36-5.184"/></svg>;
  if (b.includes("opera")) return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8.051 5.238c-1.328 1.566-2.186 3.883-2.246 6.48v.564c.061 2.598.918 4.912 2.246 6.479 1.721 2.236 4.279 3.654 7.139 3.654 1.756 0 3.4-.537 4.807-1.471C17.879 22.846 15.074 24 12 24c-.192 0-.383-.004-.57-.014C5.064 23.689 0 18.436 0 12 0 5.371 5.373 0 12 0h.045c3.055.012 5.84 1.166 7.953 3.055-1.408-.93-3.051-1.471-4.81-1.471-2.858 0-5.417 1.42-7.14 3.654h.003zM24 12c0 3.556-1.545 6.748-4.002 8.945-3.078 1.5-5.946.451-6.896-.205 3.023-.664 5.307-4.32 5.307-8.74 0-4.422-2.283-8.075-5.307-8.74.949-.654 3.818-1.703 6.896-.205C22.455 5.25 24 8.445 24 12z"/></svg>;
  if (b.includes("brave")) return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.68 0l2.096 2.38s1.84-.512 2.709.358c.868.87 1.584 1.638 1.584 1.638l-.562 1.381.715 2.047s-2.104 7.98-2.35 8.955c-.486 1.919-.818 2.66-2.198 3.633-1.38.972-3.884 2.66-4.293 2.916-.409.256-.92.692-1.38.692-.46 0-.97-.436-1.38-.692a185.796 185.796 0 01-4.293-2.916c-1.38-.973-1.712-1.714-2.197-3.633-.247-.975-2.351-8.955-2.351-8.955l.715-2.047-.562-1.381s.716-.768 1.585-1.638c.868-.87 2.708-.358 2.708-.358L8.321 0h7.36zm-3.679 14.936c-.14 0-1.038.317-1.758.69-.72.373-1.242.637-1.409.742-.167.104-.065.301.087.409.152.107 2.194 1.69 2.393 1.866.198.175.489.464.687.464.198 0 .49-.29.688-.464.198-.175 2.24-1.759 2.392-1.866.152-.108.254-.305.087-.41-.167-.104-.689-.368-1.41-.741-.72-.373-1.617-.69-1.757-.69zm0-11.278s-.409.001-1.022.206-1.278.46-1.584.46c-.307 0-2.581-.434-2.581-.434S4.119 7.152 4.119 7.849c0 .697.339.881.68 1.243l2.02 2.149c.192.203.59.511.356 1.066-.235.555-.58 1.26-.196 1.977.384.716 1.042 1.194 1.464 1.115.421-.08 1.412-.598 1.776-.834.364-.237 1.518-1.19 1.518-1.554 0-.365-1.193-1.02-1.413-1.168-.22-.15-1.226-.725-1.247-.95-.02-.227-.012-.293.284-.851.297-.559.831-1.304.742-1.8-.089-.495-.95-.753-1.565-.986-.615-.232-1.799-.671-1.947-.74-.148-.068-.11-.133.339-.175.448-.043 1.719-.212 2.292-.052.573.16 1.552.403 1.632.532.079.13.149.134.067.579-.081.445-.5 2.581-.541 2.96-.04.38-.12.63.288.724.409.094 1.097.256 1.333.256s.924-.162 1.333-.256c.408-.093.329-.344.288-.723-.04-.38-.46-2.516-.541-2.961-.082-.445-.012-.45.067-.579.08-.129 1.059-.372 1.632-.532.573-.16 1.845.009 2.292.052.449.042.487.107.339.175-.148.069-1.332.508-1.947.74-.615.233-1.476.49-1.565.986-.09.496.445 1.241.742 1.8.297.558.304.624.284.85-.02.226-1.026.802-1.247.95-.22.15-1.413.804-1.413 1.169 0 .364 1.154 1.317 1.518 1.554.364.236 1.355.755 1.776.834.422.079 1.08-.4 1.464-1.115.384-.716.039-1.422-.195-1.977-.235-.555.163-.863.355-1.066l2.02-2.149c.341-.362.68-.546.68-1.243 0-.697-2.695-3.96-2.695-3.96s-2.274.436-2.58.436c-.307 0-.972-.256-1.585-.461-.613-.205-1.022-.206-1.022-.206z"/></svg>;
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/></svg>;
}

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    "google.com": "Google", "l.threads.net": "Threads", "threads.net": "Threads",
    "l.threads.com": "Threads", "threads.com": "Threads",
    "facebook.com": "Facebook", "m.facebook.com": "Facebook", "lm.facebook.com": "Facebook",
    "twitter.com": "X / Twitter", "t.co": "X / Twitter", "x.com": "X / Twitter",
    "linkedin.com": "LinkedIn", "www.linkedin.com": "LinkedIn",
    "instagram.com": "Instagram", "reddit.com": "Reddit", "www.reddit.com": "Reddit",
    "github.com": "GitHub", "youtube.com": "YouTube", "tiktok.com": "TikTok",
  };
  return map[source.toLowerCase()] ?? source;
}

export const Route = createFileRoute("/site/$siteId")({ component: SiteDetailPage });

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

function MetricCard({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      {loading ? (
        <div style={{ width: 50, height: 22, borderRadius: 4, background: "var(--border)", animation: "pulse 1.5s infinite", marginTop: 4 }} />
      ) : (
        <span className="metric-value">{value}</span>
      )}
    </div>
  );
}

function ChartCard({ data, revenueTimeseries, loading }: { data: { date: string; pageviews: number; visitors: number }[]; revenueTimeseries?: RevenueTimeSeriesPoint[]; loading: boolean }) {
  if (loading) {
    return <div className="chart-wrap" style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}><div className="spinner" /></div>;
  }
  if (!data || data.length === 0) {
    return <div className="chart-wrap" style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 13 }}>{t("chart.no_data")}</div>;
  }
  const revenueMap = new Map((revenueTimeseries ?? []).map((r) => [r.date, r]));
  const hasRevenue = revenueMap.size > 0;
  const baseMap = new Map(data.map((row) => {
    const label = row.date.includes("T") ? row.date.substring(row.date.indexOf("T") > 4 ? 5 : 0, 16) : row.date.substring(5);
    return [row.date, { ...row, label, revenue: 0, conversions: 0 }];
  }));
  for (const [key, rev] of revenueMap) {
    const existing = baseMap.get(key);
    if (existing) { existing.revenue = rev.revenue; existing.conversions = rev.conversions; }
    else {
      const label = key.includes("T") ? key.substring(5, 16) : key.substring(5);
      baseMap.set(key, { date: key, label, pageviews: 0, visitors: 0, revenue: rev.revenue, conversions: rev.conversions });
    }
  }
  const chartData = [...baseMap.values()].sort((a, b) => a.date < b.date ? -1 : 1);

  return (
    <div className="chart-wrap">
      <div className="chart-label">{t("chart.pageviews_visitors")}</div>
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
            <defs>
              <linearGradient id="gpv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gvs" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--info)" stopOpacity={0.12} />
                <stop offset="100%" stopColor="var(--info)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text3)", fontFamily: "var(--mono)" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "var(--text3)", fontFamily: "var(--mono)" }} tickLine={false} axisLine={false} width={32} />
            {hasRevenue && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "var(--text3)", fontFamily: "var(--mono)" }} tickLine={false} axisLine={false} width={40} tickFormatter={(v: any) => `$${v}`} />}
            <RechartsTooltip content={({ active, payload, label: lbl }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              const vis = d?.visitors ?? 0;
              const rev = d?.revenue ?? 0;
              const conv = d?.conversions ?? 0;
              const revPerVis = vis > 0 ? (rev / vis) : 0;
              const convRate = vis > 0 ? ((conv / vis) * 100) : 0;
              return (
                <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 8, fontSize: 11, color: "var(--text)", boxShadow: "0 8px 24px rgba(0,0,0,.4)", padding: "8px 12px", minWidth: 140 }}>
                  <div style={{ color: "var(--text3)", marginBottom: 4, fontSize: 11 }}>{lbl}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>Visitors</span><span style={{ fontFamily: "var(--mono)" }}>{vis.toLocaleString()}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>Pageviews</span><span style={{ fontFamily: "var(--mono)" }}>{(d?.pageviews ?? 0).toLocaleString()}</span></div>
                  {hasRevenue && <>
                    <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span style={{ color: "#f59e0b" }}>Revenue</span><span style={{ fontFamily: "var(--mono)", color: "#f59e0b" }}>${rev.toFixed(2)}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>Conversions</span><span style={{ fontFamily: "var(--mono)" }}>{conv}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>Rev/visitor</span><span style={{ fontFamily: "var(--mono)" }}>${revPerVis.toFixed(2)}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span>Conv. rate</span><span style={{ fontFamily: "var(--mono)" }}>{convRate.toFixed(2)}%</span></div>
                  </>}
                </div>
              );
            }} />
            {hasRevenue && <Bar yAxisId="right" dataKey="revenue" fill="#e8793a" fillOpacity={0.85} radius={[4, 4, 0, 0]} barSize={data.length > 48 ? 4 : data.length > 24 ? 8 : 14} />}
            <Area yAxisId="left" type="monotone" dataKey="visitors" stroke="#60a5fa" strokeWidth={2} fill="url(#gvs)" dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DataTable({ title, rows, columns, onRowClick }: {
  title: string;
  rows: Record<string, string | number>[];
  columns: { key: string; label: string; align?: "left" | "right"; mono?: boolean }[];
  onRowClick?: (row: Record<string, string | number>) => void;
}) {
  return (
    <div className="data-table-card" style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="data-table-title">{title}</div>
      {rows.length === 0 ? (
        <div style={{ padding: 16, color: "var(--text3)", fontSize: 12, textAlign: "center" }}>{t("common.no_data")}</div>
      ) : (
        <div className="scroll-x" style={{ flex: 1, overflowY: "auto" }}>
          <table className="data-table">
            <thead><tr>{columns.map((col) => <th key={col.key} style={{ textAlign: col.align || "left" }}>{col.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                >{columns.map((col) => <td key={col.key} style={{ textAlign: col.align || "left", fontFamily: col.mono ? "var(--mono)" : "inherit", fontSize: col.mono ? 12 : 13 }}>{row[col.key] ?? "—"}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function sessionDuration(j: VisitorJourney): string {
  if (j.steps.length < 2) return "0s";
  const start = new Date(j.steps[0].timestamp).getTime();
  const end = new Date(j.steps[j.steps.length - 1].timestamp).getTime();
  const d = end - start;
  if (d < 60000) return `${Math.round(d / 1000)}s`;
  if (d < 3600000) return `${Math.round(d / 60000)}m ${Math.round((d % 60000) / 1000)}s`;
  return `${Math.round(d / 3600000)}h`;
}

function parseProps(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function StepIcon({ type }: { type: string }) {
  if (type === "pageview") return <span style={{ color: "var(--accent)", fontSize: 13 }}>◆</span>;
  if (type === "conversion") return <span style={{ color: "var(--green)", fontSize: 13 }}>★</span>;
  return <span style={{ color: "var(--text3)", fontSize: 13 }}>●</span>;
}

function StepLabel({ step }: { step: VisitorJourney["steps"][number] }) {
  const props = parseProps(step.props);
  if (step.event_type === "pageview") {
    return <span style={{ color: "var(--text)" }}>{step.path}</span>;
  }
  if (step.event_type === "custom" && step.name === "scroll") {
    const depth = props.depth ? `${props.depth}%` : "";
    const section = props.section ? props.section : "";
    return <span style={{ color: "var(--text2)" }}>Scrolled to {depth}{section ? ` — ${section}` : ""}</span>;
  }
  if (step.event_type === "custom" && step.name === "scroll_section") {
    const section = props.section ?? "section";
    const depth = props.depth ? ` (${props.depth}%)` : "";
    return <span style={{ color: "var(--text2)" }}>Read section: {section}{depth}</span>;
  }
  if (step.event_type === "custom" && step.name === "click") {
    const label = props.label ?? "unknown";
    const tag = props.tag ?? "";
    return <span style={{ color: "var(--text)" }}>Clicked <span style={{ color: "var(--accent)", fontWeight: 500 }}>"{label}"</span> <span style={{ color: "var(--text3)", fontSize: 11 }}>&lt;{tag}&gt;</span></span>;
  }
  if (step.event_type === "custom" && step.name === "heartbeat") {
    const secs = props.seconds ? `${props.seconds}s` : "";
    return <span style={{ color: "var(--text3)" }}>Active {secs}</span>;
  }
  if (step.event_type === "conversion") {
    return <span style={{ color: "var(--green)", fontWeight: 600 }}>Conversion: {step.name} {step.revenue ? `$${step.revenue}` : ""}</span>;
  }
  return <span style={{ color: "var(--text2)" }}>{step.name || step.event_type}</span>;
}

function JourneyTimeline({ journey }: { journey: VisitorJourney }) {
  const steps = journey.steps;
  return (
    <div className="journey-timeline">
      {steps.map((step, i) => {
        const prev = i > 0 ? steps[i - 1] : null;
        const gap = prev ? new Date(step.timestamp).getTime() - new Date(prev.timestamp).getTime() : 0;
        const showGap = gap > 5 * 60 * 1000;
        return (
          <div key={i}>
            {showGap && (
              <div className="timeline-gap">
                <span className="timeline-gap-line" />
                <span className="timeline-gap-label">{gap > 3600000 ? `${Math.round(gap / 3600000)}h gap` : `${Math.round(gap / 60000)}m gap`}</span>
                <span className="timeline-gap-line" />
              </div>
            )}
            <div className="timeline-row">
              <div className="timeline-left">
                <StepIcon type={step.event_type} />
                <span className="timeline-time">{formatTime(step.timestamp)}</span>
              </div>
              <div className="timeline-content" title={`${formatTime(step.timestamp)} — ${step.event_type === "pageview" ? step.path : step.name || step.event_type}`}>
                <StepLabel step={step} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function JourneyCard({ journey, selected, onClick }: { journey: VisitorJourney; selected: boolean; onClick: () => void }) {
  const displayName = journey.visitor_name || nameFromVisitorId(journey.visitor_id);
  const hasRevenue = journey.total_revenue > 0;
  const dateStr = new Date(journey.started_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const timeStr = formatTime(journey.started_at);

  return (
    <div className={`journey-card ${selected ? "selected" : ""}`}>
      <div className="journey-main" onClick={onClick}>
        <img src={avatarUrl(displayName)} alt="" style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--bg3)", flexShrink: 0 }} />
        <Tip text={displayName}><span className="journey-name">{displayName}</span></Tip>
        {journey.country && <Tip text={[journey.city, journey.region, journey.country].filter(Boolean).join(", ")}><span className="journey-meta">{countryFlag(journey.country)} {[journey.city, journey.region].filter(Boolean).join(", ")}</span></Tip>}
        {(journey.device_type || journey.os || journey.browser) && (
          <Tip text={[journey.device_type, journey.os, journey.browser].filter(Boolean).join(" · ")}>
            <span className="journey-meta" style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              {journey.device_type ? <><DeviceIcon device={journey.device_type} />{journey.device_type}</> : null}
              {journey.os && <><span style={{ color: "var(--text4)" }}>·</span><OSIcon os={journey.os} />{journey.os}</>}
              {journey.browser && <><span style={{ color: "var(--text4)" }}>·</span><BrowserIcon browser={journey.browser} />{journey.browser}</>}
            </span>
          </Tip>
        )}
        {journey.utm_source && <Tip text={`Source: ${journey.utm_source}`}><span className="journey-meta" style={{ color: "var(--accent)" }}>via {journey.utm_source}</span></Tip>}
        {hasRevenue && <Tip text={`Revenue: $${journey.total_revenue}`}><span className="journey-revenue">${journey.total_revenue}</span></Tip>}
        <Tip text={`${dateStr} ${timeStr}`}><span className="journey-meta">{dateStr} {timeStr}</span></Tip>
      </div>
    </div>
  );
}

function ProfilePanel({ journey, onClose }: { journey: VisitorJourney | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tags, setTags] = useState("");
  const [, setSaved] = useState(false);
  const [panelWidth, setPanelWidth] = useState(340);
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  if (!journey) return null;

  const handleEdit = () => { setName(journey.visitor_name ?? ""); setEmail(journey.visitor_email ?? ""); setTags(""); setEditing(true); setSaved(false); };
  const handleSave = async () => {
    await updateVisitor(journey.visitor_id, { name: name || undefined, email: email || undefined, tags });
    setEditing(false); setSaved(true);
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const displayName = journey.visitor_name || nameFromVisitorId(journey.visitor_id);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = panelWidth;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = dragStartX.current - ev.clientX;
      setPanelWidth(Math.max(280, Math.min(600, dragStartW.current + delta)));
    };
    const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const emailOrId = journey.visitor_email || journey.visitor_id;

  return (
    <div className="profile-panel" style={{ width: panelWidth }}>
      {/* Resize handle */}
      <div className="profile-resize-handle" onMouseDown={onDragStart} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text3)" }}>{t("profile.title")}</span>
        <button onClick={onClose} style={{ fontSize: 14, color: "var(--text3)", cursor: "pointer" }}>✕</button>
      </div>
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags (comma separated)" />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-accent" onClick={handleSave}>Save</button>
            <button className="btn-pill" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src={avatarUrl(displayName)} alt="" style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--bg3)" }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <Tip text={displayName}><p className="profile-ellipsis">{displayName}</p></Tip>
              <Tip text={emailOrId}><p className="profile-ellipsis-sm">{journey.visitor_email || journey.visitor_id.slice(0, 16)}</p></Tip>
            </div>
          </div>
          <button onClick={handleEdit} style={{ fontSize: 12, color: "var(--accent)", textAlign: "left", padding: 0, fontWeight: 600 }}>{t("profile.edit")}</button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13, color: "var(--text2)" }}>
            {[journey.city, journey.region, journey.country].filter(Boolean).length > 0 && (
              <Tip text={[journey.city, journey.region, journey.country].filter(Boolean).join(", ")}><span className="profile-info-cell">{countryFlag(journey.country)} {[journey.city, journey.region].filter(Boolean).join(", ")}</span></Tip>
            )}
            {journey.device_type && <span className="profile-info-cell">{journey.device_type}</span>}
            {journey.browser && <span className="profile-info-cell">{journey.browser}</span>}
            {journey.os && <span className="profile-info-cell">{journey.os}</span>}
            {journey.utm_source && <span className="profile-info-cell">{journey.utm_source}</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, paddingTop: 16, borderTop: "1px solid var(--border)", marginTop: 4 }}>
            <div style={{ textAlign: "center" }}><p style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 600 }}>{journey.steps.length}</p><p style={{ fontSize: 10, color: "var(--text3)" }}>steps</p></div>
            <div style={{ textAlign: "center" }}><p style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 600 }}>${journey.total_revenue}</p><p style={{ fontSize: 10, color: "var(--text3)" }}>revenue</p></div>
            <Tip text={journey.utm_source || "direct"}>
              <div style={{ textAlign: "center" }}>
                <p className="profile-ellipsis" style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 600 }}>{journey.utm_source || "direct"}</p>
                <p style={{ fontSize: 10, color: "var(--text3)" }}>source</p>
              </div>
            </Tip>
          </div>
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text3)" }}>Journey</span>
            <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 8 }}>
              <JourneyTimeline journey={journey} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ siteId }: { siteId: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = `<script defer data-site-id="${siteId}" src="${window.location.origin}/klikapa.js"></script>`;

  return (
    <div className="detail-scroll" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0 }}>
      <Globe />
      <div style={{ textAlign: "center", marginTop: -80, maxWidth: 480 }}>
        <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 28, color: "var(--text)", marginBottom: 8 }}>
          {t("sites.waiting")}
        </div>
        <p style={{ color: "var(--text3)", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
          {t("sites.script_hint")}
        </p>
        <div style={{
          background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10,
          padding: "14px 18px", fontFamily: "var(--mono)", fontSize: 11,
          textAlign: "left", width: "100%", color: "var(--text2)", lineHeight: 1.8, wordBreak: "break-all",
          marginBottom: 16,
        }}>
          &lt;script defer data-site-id="{siteId}"<br />&nbsp;&nbsp;src="{window.location.origin}/klikapa.js"&gt;&lt;/script&gt;
        </div>
        <button className="btn-accent" onClick={() => { navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? t("common.copied") : t("common.copy_script")}
        </button>
      </div>
    </div>
  );
}

function CollapsibleSection({ title, defaultOpen, children }: { title: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 0",
        background: "none", border: "none", cursor: "pointer", color: "var(--text2)", fontSize: 13, fontWeight: 600,
        fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em",
      }}>
        <span style={{ transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0)", display: "inline-block", fontSize: 10 }}>▸</span>
        {title}
      </button>
      {open && children}
    </div>
  );
}

const FUNNEL_COLORS = [
  "#d4882a", "#cd8227", "#c67c25", "#bf7623", "#b87021",
  "#b16a1f", "#aa641d", "#a35e1b", "#9c5819", "#955217",
  "#8e4c15", "#874613", "#804011", "#793a0f", "#72340d",
];

function FunnelChartCustom({ steps, conversionRate, pages }: { steps: FunnelStep[]; conversionRate: number; pages: PageFunnel[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [selectedPage, setSelectedPage] = useState<string>("/");

  // Determine which data to show
  const activeFunnel = pages.find((p) => p.path === selectedPage);
  const fallback = { steps, conversionRate, path: "/", totalVisitors: 0 };
  const active = activeFunnel ?? (pages.length > 0 ? pages[0]! : fallback);
  const activeSteps = active.steps;
  const activeConv = active.conversionRate;
  const activeTitle = active.path;

  if (steps.length === 0 && pages.length === 0) {
    return (
      <div className="funnel-card">
        <div className="funnel-title">LP Scroll Funnel</div>
        <div style={{ padding: "32px 0", color: "var(--text3)", fontSize: 13, textAlign: "center" }}>
          No scroll data yet — add <code style={{ fontFamily: "var(--mono)", fontSize: 11, background: "var(--bg3)", padding: "2px 6px", borderRadius: 4 }}>data-section</code> attributes to your page sections
        </div>
      </div>
    );
  }

  const H = 200;
  const isNarrow = typeof window !== "undefined" && window.innerWidth < 500;
  const stepW = isNarrow ? (activeSteps.length > 6 ? 48 : 60) : (activeSteps.length > 6 ? 80 : 120);
  const gap = 4;
  const maxVal = activeSteps[0]?.visitors || 1;
  const totalW = activeSteps.length * (stepW + gap);
  const cy = H / 2;

  const sections = activeSteps.map((s, i) => {
    const ratio = s.visitors / maxVal;
    const nextRatio = i < activeSteps.length - 1 ? activeSteps[i + 1]!.visitors / maxVal : ratio * 0.6;
    const x = i * (stepW + gap);
    const halfH = (H / 2) * ratio;
    const nextHalfH = (H / 2) * nextRatio;
    const curve = stepW * 0.4;
    const d = [
      `M ${x} ${cy - halfH}`,
      `C ${x + curve} ${cy - halfH}, ${x + stepW - curve} ${cy - nextHalfH}, ${x + stepW} ${cy - nextHalfH}`,
      `L ${x + stepW} ${cy + nextHalfH}`,
      `C ${x + stepW - curve} ${cy + nextHalfH}, ${x + curve} ${cy + halfH}, ${x} ${cy + halfH}`,
      "Z",
    ].join(" ");
    return { d, x, step: s, color: FUNNEL_COLORS[i % FUNNEL_COLORS.length] };
  });

  const hSec = hovered !== null ? sections[hovered] : null;

  return (
    <div className="funnel-card" style={{ padding: "16px 16px 4px", position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <span className="funnel-title">LP Scroll Funnel</span>
          <span className="funnel-subtitle">{activeSteps.length} steps</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 600, color: "var(--green)" }}>{activeConv}%</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Conversion</div>
        </div>
      </div>

      {/* Page selector */}
      {pages.length > 0 && (
        <div className="scroll-x" style={{ marginBottom: 8 }}>
          <div style={{ display: "inline-flex", gap: 2 }}>
            {pages.map((p) => (
              <button key={p.path} onClick={() => setSelectedPage(p.path)} style={{
                fontSize: 10, padding: "3px 8px", borderRadius: 4, border: "none", cursor: "pointer",
                fontFamily: "var(--mono)", whiteSpace: "nowrap",
                background: selectedPage === p.path ? "var(--accent-dim)" : "transparent",
                color: selectedPage === p.path ? "var(--accent)" : "var(--text3)",
              }}>{p.path} ({p.totalVisitors})</button>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text4)", marginBottom: 4 }}>{activeTitle}</div>

      <div className={isNarrow ? "scroll-x" : undefined}>
      <svg viewBox={`0 0 ${totalW} ${H}`} style={{ width: isNarrow ? totalW : "100%", height: "auto", display: "block", minWidth: totalW }}>
        <defs>
          {sections.map((sec, i) => (
            <linearGradient key={i} id={`fg${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={sec.color} stopOpacity={0.85} />
              <stop offset="50%" stopColor={sec.color} stopOpacity={1} />
              <stop offset="100%" stopColor={sec.color} stopOpacity={0.85} />
            </linearGradient>
          ))}
        </defs>
        {sections.map((sec, i) => (
          <g key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: "pointer" }}
          >
            <path d={sec.d} fill={hovered === i ? sec.color : `url(#fg${i})`} stroke={hovered === i ? "#fff" : "none"} strokeWidth={hovered === i ? 1.5 : 0} style={{ transition: "fill 0.15s, stroke 0.15s" }} />
            <text
              x={sec.x + stepW / 2}
              y={cy - 6}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ fill: "#fff", fontFamily: "var(--mono)", fontSize: stepW > 100 ? 10 : 8, fontWeight: 600, pointerEvents: "none" }}
            >
              {sec.step.section}
            </text>
            <text
              x={sec.x + stepW / 2}
              y={cy + 10}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ fill: "rgba(255,255,255,.7)", fontFamily: "var(--mono)", fontSize: stepW > 100 ? 11 : 9, fontWeight: 700, pointerEvents: "none" }}
            >
              {sec.step.visitors.toLocaleString()}
            </text>
          </g>
        ))}
      </svg>
      </div>
      {hSec && (
        <div style={{
          position: "absolute", bottom: 36, left: "50%", transform: "translateX(-50%)",
          background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 8,
          padding: "8px 14px", fontSize: 12, fontFamily: "var(--mono)", color: "var(--text)",
          boxShadow: "0 8px 24px rgba(0,0,0,.5)", pointerEvents: "none", zIndex: 10,
          display: "flex", gap: 16, alignItems: "center", whiteSpace: "nowrap",
        }}>
          <span style={{ color: hSec.color, fontWeight: 700 }}>{hSec.step.section}</span>
          <span>{hSec.step.visitors.toLocaleString()} visitors</span>
          <span style={{ color: "var(--text3)" }}>{hSec.step.percentage}%</span>
          {hSec.step.dropoff > 0 && <span style={{ color: "#f87171" }}>-{hSec.step.dropoff}% dropoff</span>}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", padding: "8px 0 4px", fontSize: 11, color: "var(--text3)" }}>
        {activeSteps.map((s, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }} />
            <span>{s.section}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function GlobeSummaryPanel({ journeys }: { journeys: VisitorJourney[] }) {
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

function GlobeEventLog({ journeys }: { journeys: VisitorJourney[] }) {
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

function GlobeMarkerPopup({ city, journeys, onClose }: { city: string; journeys: VisitorJourney[]; onClose: () => void }) {
  return (
    <div className="globe-marker-popup-overlay" onClick={onClose}>
      <div className="globe-marker-popup" onClick={e => e.stopPropagation()}>
        <div className="globe-popup-header">
          <span className="globe-popup-city">{city}</span>
          <span className="globe-popup-count">{journeys.length} visitor{journeys.length !== 1 ? "s" : ""}</span>
          <button className="globe-popup-close" onClick={onClose}>✕</button>
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

function RecordingsTable({ recordings, onSelect }: { recordings: RecordingSummary[]; onSelect: (r: RecordingDetail) => void }) {
  return (
    <div className="data-table-card" style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className="data-table-title" style={{ marginBottom: 0 }}>Session Recordings</span>
        <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--mono)", marginLeft: "auto" }}>{recordings.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {recordings.length === 0 ? (
          <div style={{ padding: 20, color: "var(--text3)", fontSize: 12, textAlign: "center" }}>No recordings yet. Enable recording in your tracking script.</div>
        ) : (
          <table className="data-table" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th>Path</th>
                <th style={{ textAlign: "right" }}>Duration</th>
                <th style={{ textAlign: "right" }}>Events</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {recordings.map((rec) => (
                <tr key={rec.id} style={{ cursor: "pointer" }} onClick={async () => {
                  const detail = await fetchRecording(rec.id);
                  if (detail) onSelect(detail as RecordingDetail);
                }}>
                  <td style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rec.path}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--mono)", color: "var(--text3)" }}>{formatDuration(rec.duration)}</td>
                  <td style={{ textAlign: "right", fontFamily: "var(--mono)", color: "var(--text3)" }}>{rec.event_count}</td>
                  <td style={{ color: "var(--text3)", fontSize: 10, whiteSpace: "nowrap" }}>{timeAgo(rec.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RecordingPanel({ recording, onClose }: { recording: RecordingDetail; onClose: () => void }) {
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const totalMs = recording.duration || (recording.events.length > 0 ? recording.events[recording.events.length - 1]!.t : 0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setPlayTime((prev) => {
          const next = prev + 50 * speed;
          if (next >= totalMs) { setPlaying(false); return totalMs; }
          return next;
        });
      }, 50);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, speed, totalMs]);

  const reset = () => { setPlaying(false); setPlayTime(0); };

  const visibleEvents = useMemo(() => {
    return recording.events.filter((e) => e.t <= playTime);
  }, [recording.events, playTime]);

  const eventTypeIcon = (type: string) => {
    switch (type) {
      case "interaction": return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>;
      case "scroll": return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" strokeWidth="2"><path d="M12 5v14m-7-7l7 7 7-7"/></svg>;
      case "mutation": return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>;
      case "resize": return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>;
      default: return null;
    }
  };

  const eventLabel = (ev: RecordingDetail["events"][0]) => {
    const d = ev.d as Record<string, unknown>;
    switch (ev.type) {
      case "interaction": return `Click at (${(d as any).x}, ${(d as any).y}) on <${(d as any).tg || "??"}>`;
      case "scroll": return `Scroll to y=${(d as any).y}`;
      case "mutation": return `DOM change: ${((d as any).changes || []).length} mutation(s)`;
      case "resize": return `Resize to ${(d as any).w}x${(d as any).h}`;
      default: return "Unknown event";
    }
  };

  return (
    <div className="recording-panel" style={{ position: "fixed", top: 0, right: 0, height: "100vh", background: "var(--bg1)", borderLeft: "1px solid var(--border)", zIndex: 100, display: "flex", flexDirection: "column", boxShadow: "-8px 0 32px rgba(0,0,0,.4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--sans)" }}>Session Recording</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--mono)" }}>{recording.path}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>

      {/* Player controls */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setPlaying(!playing)} style={{ background: "var(--accent)", color: "#000", border: "none", borderRadius: 6, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
            {playing ? "⏸" : "▶"}
          </button>
          <button onClick={reset} style={{ background: "var(--bg3)", color: "var(--text)", border: "none", borderRadius: 6, width: 32, height: 32, cursor: "pointer", fontSize: 14 }}>⏮</button>
          <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--text3)", minWidth: 90 }}>{formatDuration(playTime)} / {formatDuration(totalMs)}</span>
          <span style={{ flex: 1 }} />
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ fontSize: 10, background: "var(--bg3)", color: "var(--text)", border: "1px solid var(--border2)", borderRadius: 4, padding: "2px 4px" }}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        </div>
        {/* Progress bar */}
        <div style={{ position: "relative", height: 6, background: "var(--bg3)", borderRadius: 3, cursor: "pointer" }} onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          setPlayTime(Math.max(0, Math.min(totalMs, pct * totalMs)));
        }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: totalMs > 0 ? `${(playTime / totalMs) * 100}%` : "0%", background: "var(--accent)", borderRadius: 3, transition: "width 0.05s linear" }} />
          {/* Event markers */}
          {recording.events.filter((_, i) => i % Math.max(1, Math.floor(recording.events.length / 40)) === 0).map((ev, i) => (
            <div key={i} style={{ position: "absolute", left: totalMs > 0 ? `${(ev.t / totalMs) * 100}%` : "0%", top: -1, width: 2, height: 8, background: ev.type === "interaction" ? "var(--accent)" : ev.type === "scroll" ? "#6ee7b7" : ev.type === "mutation" ? "#fbbf24" : "#c084fc", borderRadius: 1, opacity: 0.7 }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 10, color: "var(--text3)" }}>
          <span>{recording.events.length} events</span>
          <span>Viewport: {recording.viewport_width || "?"}px</span>
        </div>
      </div>

      {/* Event timeline */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {visibleEvents.map((ev, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", borderRadius: 4, background: i % 2 === 0 ? "transparent" : "var(--bg2)", fontSize: 11 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text3)", minWidth: 45 }}>{formatDuration(ev.t)}</span>
              {eventTypeIcon(ev.type)}
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{eventLabel(ev)}</span>
            </div>
          ))}
          {visibleEvents.length === 0 && (
            <div style={{ padding: 24, color: "var(--text3)", fontSize: 12, textAlign: "center" }}>Press play to replay events</div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function HeatmapView({ siteId, topPages, range }: { siteId: string; topPages: { path: string }[]; range: string }) {
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

const DEFAULT_LAYOUT = [
  { i: "metrics", x: 0, y: 0, w: 12, h: 3, minW: 6, minH: 2 },
  { i: "top-pages", x: 0, y: 3, w: 3, h: 5, minW: 3, minH: 2 },
  { i: "chart", x: 3, y: 3, w: 6, h: 5, minW: 4, minH: 2 },
  { i: "sources", x: 9, y: 3, w: 3, h: 5, minW: 3, minH: 2 },
  { i: "locations", x: 0, y: 8, w: 3, h: 6, minW: 3, minH: 2 },
  { i: "devices", x: 3, y: 8, w: 3, h: 6, minW: 3, minH: 2 },
  { i: "funnel", x: 6, y: 8, w: 6, h: 6, minW: 4, minH: 2 },
  { i: "recordings", x: 0, y: 14, w: 4, h: 6, minW: 3, minH: 2 },
  { i: "journeys", x: 4, y: 14, w: 8, h: 8, minW: 6, minH: 2 },
  { i: "ai-insights", x: 0, y: 22, w: 12, h: 4, minW: 6, minH: 1 },
  { i: "revenue", x: 0, y: 26, w: 6, h: 5, minW: 4, minH: 2 },
  { i: "event-usage", x: 6, y: 26, w: 6, h: 3, minW: 6, minH: 1 },
  { i: "channels", x: 4, y: 18, w: 6, h: 4, minW: 4, minH: 2 },
  { i: "entry-pages", x: 0, y: 26, w: 6, h: 5, minW: 4, minH: 2 },
] as const satisfies Layout;

type LocationTab = "country" | "region" | "city";
type SortDir = "asc" | "desc";

function LocationTable({ geoData, onFilterCountry }: { geoData: any[]; onFilterCountry: (c: string | null) => void }) {
  const [tab, setTab] = useState<LocationTab>("country");
  const [sortKey, setSortKey] = useState<"name" | "visitors">("visitors");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const aggregated = useMemo(() => {
    const key = tab === "country" ? "country" : tab === "region" ? "region" : "city";
    const map = new Map<string, { name: string; visitors: number; country: string | null }>();
    for (const g of geoData) {
      const val = g[key] ?? "Unknown";
      const existing = map.get(val);
      if (existing) {
        existing.visitors += Number(g.visitors);
      } else {
        map.set(val, { name: val, visitors: Number(g.visitors), country: g.country ?? null });
      }
    }
    let rows = [...map.values()];
    rows.sort((a, b) => {
      if (sortKey === "visitors") return sortDir === "desc" ? b.visitors - a.visitors : a.visitors - b.visitors;
      return sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    });
    return rows;
  }, [geoData, tab, sortKey, sortDir]);

  const toggleSort = (key: "name" | "visitors") => {
    if (sortKey === key) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sortArrow = (key: "name" | "visitors") => sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : "";

  return (
    <div className="data-table-card" style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className="data-table-title" style={{ marginBottom: 0 }}>{t("table.locations")}</span>
        <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
          {(["country", "region", "city"] as LocationTab[]).map((t2) => (
            <button key={t2} onClick={() => setTab(t2)} style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "none", cursor: "pointer",
              fontFamily: "var(--mono)", textTransform: "capitalize",
              background: tab === t2 ? "var(--accent-dim)" : "transparent",
              color: tab === t2 ? "var(--accent)" : "var(--text3)",
            }}>{t2}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <table className="data-table">
          <thead><tr>
            <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleSort("name")}>
              {tab === "country" ? t("table.country") : tab === "region" ? t("table.region") : t("table.city")}{sortArrow("name")}
            </th>
            {tab !== "country" && <th>{t("table.country")}</th>}
            <th style={{ cursor: "pointer", userSelect: "none", textAlign: "right" }} onClick={() => toggleSort("visitors")}>
              {t("table.visitors")}{sortArrow("visitors")}
            </th>
          </tr></thead>
          <tbody>
            {aggregated.map((row, i) => (
              <tr key={i} style={{ cursor: "pointer" }} onClick={() => onFilterCountry(row.country)}>
                <td style={{ fontSize: 13 }}>
                  {tab === "country" ? <>{countryFlag(row.name)} {row.name}</> : row.name}
                </td>
                {tab !== "country" && <td style={{ fontSize: 13 }}>{countryFlag(row.country)} {row.country ?? "—"}</td>}
                <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12 }}>{row.visitors.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type DeviceTab = "device" | "os" | "browser";

function DeviceTable({ devices, os, browsers }: { devices: DeviceEntry[]; os: DeviceEntry[]; browsers: DeviceEntry[] }) {
  const [tab, setTab] = useState<DeviceTab>("device");
  const data = tab === "device" ? devices : tab === "os" ? os : browsers;

  return (
    <div className="data-table-card" style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className="data-table-title" style={{ marginBottom: 0 }}>Devices</span>
        <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
          {([["device", "Device"], ["os", "OS"], ["browser", "Browser"]] as [DeviceTab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "none", cursor: "pointer",
              fontFamily: "var(--mono)",
              background: tab === key ? "var(--accent-dim)" : "transparent",
              color: tab === key ? "var(--accent)" : "var(--text3)",
            }}>{label}</button>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <div style={{ padding: 16, color: "var(--text3)", fontSize: 12, textAlign: "center" }}>No data</div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <table className="data-table">
            <thead><tr>
              <th>{tab === "device" ? "Device" : tab === "os" ? "OS" : "Browser"}</th>
              <th style={{ textAlign: "right" }}>Visitors</th>
              <th style={{ textAlign: "right" }}>Share</th>
            </tr></thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 13 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      {tab === "device" ? <DeviceIcon device={d.device} /> : tab === "os" ? <OSIcon os={d.device} /> : <BrowserIcon browser={d.device} />}
                      {d.device.charAt(0).toUpperCase() + d.device.slice(1)}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12 }}>{d.visitors.toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                      <div style={{ width: 48, height: 4, borderRadius: 2, background: "var(--bg3)" }}>
                        <div style={{ width: `${d.percentage}%`, height: "100%", borderRadius: 2, background: "var(--accent)" }} />
                      </div>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{d.percentage}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type RevenueTab = "source" | "country" | "trend" | "method" | "provider";

function RevenueBreakdownWidget({ bySource, byCountry, trend, byMethod, byProvider }: { bySource: RevenueBySource[]; byCountry: RevenueByCountry[]; trend: RevenueTimeSeriesPoint[]; byMethod: RevenueByPaymentMethod[]; byProvider: RevenueByPaymentProvider[] }) {
  const [tab, setTab] = useState<RevenueTab>("source");

  return (
    <div className="data-table-card" style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className="data-table-title" style={{ marginBottom: 0 }}>Revenue</span>
        <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
          {([["source", "Source"], ["country", "Country"], ["trend", "Trend"], ["method", "Method"], ["provider", "Provider"]] as [RevenueTab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "none", cursor: "pointer",
              fontFamily: "var(--mono)",
              background: tab === key ? "var(--accent-dim)" : "transparent",
              color: tab === key ? "var(--accent)" : "var(--text3)",
            }}>{label}</button>
          ))}
        </div>
      </div>
      {tab === "trend" ? (
        trend.length === 0 ? (
          <div style={{ padding: 16, color: "var(--text3)", fontSize: 12, textAlign: "center" }}>No revenue data</div>
        ) : (
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text3)" }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: "var(--text3)" }} tickFormatter={(v: number) => `$${v}`} />
                <RechartsTooltip contentStyle={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "Revenue"]} />
                <Area type="monotone" dataKey="revenue" stroke="var(--accent)" fill="var(--accent-dim)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )
      ) : tab === "method" ? (
        byMethod.length === 0 ? (
          <div style={{ padding: 16, color: "var(--text3)", fontSize: 12, textAlign: "center" }}>No payment method data</div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <table className="data-table">
              <thead><tr><th>Method</th><th style={{ textAlign: "right" }}>Count</th><th style={{ textAlign: "right" }}>Revenue</th></tr></thead>
              <tbody>
                {byMethod.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12 }}>{r.method}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 11 }}>{r.count}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 11 }}>${r.revenue.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === "provider" ? (
        byProvider.length === 0 ? (
          <div style={{ padding: 16, color: "var(--text3)", fontSize: 12, textAlign: "center" }}>No payment provider data</div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <table className="data-table">
              <thead><tr><th>Provider</th><th style={{ textAlign: "right" }}>Count</th><th style={{ textAlign: "right" }}>Revenue</th></tr></thead>
              <tbody>
                {byProvider.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 12 }}>{r.provider}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 11 }}>{r.count}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 11 }}>${r.revenue.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        (tab === "source" ? bySource : byCountry).length === 0 ? (
          <div style={{ padding: 16, color: "var(--text3)", fontSize: 12, textAlign: "center" }}>No revenue data</div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <table className="data-table">
              <thead><tr>
                <th>{tab === "source" ? "Source" : "Country"}</th>
                <th style={{ textAlign: "right" }}>Revenue</th>
                <th style={{ textAlign: "right" }}>Conv.</th>
              </tr></thead>
              <tbody>
                {(tab === "source" ? bySource : byCountry).map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 13 }}>{(r as any).source || (r as any).country}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12 }}>${r.revenue.toFixed(2)}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 12 }}>{r.conversions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

function ChannelBreakdownWidget({ data }: { data: ChannelEntry[] }) {
  if (data.length === 0) return <div style={{ padding: 16, color: "var(--text3)", fontSize: 12, textAlign: "center" }}>No channel data</div>;
  const maxVisitors = Math.max(...data.map(d => d.visitors)) || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {data.map(d => (
        <div key={d.channel} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ width: 100, color: "var(--text2)", flexShrink: 0 }}>{d.channel}</span>
          <div style={{ flex: 1, background: "var(--bg3)", borderRadius: 4, height: 18, overflow: "hidden" }}>
            <div style={{ width: `${(d.visitors / maxVisitors) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: 4, minWidth: 2 }} />
          </div>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text2)", width: 50, textAlign: "right" }}>{d.visitors}</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text3)", width: 35, textAlign: "right" }}>{d.percentage}%</span>
        </div>
      ))}
    </div>
  );
}

function loadLayout(siteId: string): Layout {
  try {
    const saved = localStorage.getItem(`kp_layout_${siteId}`);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return DEFAULT_LAYOUT;
}

function toMobileLayout(layout: Layout, cols: number): Layout {
  let y = 0;
  return layout.map((item) => {
    const h = item.h;
    const mobileItem = { ...item, x: 0, w: cols, y };
    y += h;
    return mobileItem;
  });
}

function DashboardGrid({ siteId, stats, isLoading, timeseries, topPages, sources, devices, osData, browsersData, geoData, funnelSteps, funnelRate, funnelPages, journeys, allJourneys, hasFilters, selectedJourney, setSelectedJourney, setFilterPage, setFilterCountry, recordings, onSelectRecording, range, revenueBySource, revenueByCountry, revenueTimeseries, channels, entryPagesRevenue, revenueByMethod, revenueByProvider, editing, layout, onLayoutChange }: {
  siteId: string;
  stats: any;
  isLoading: boolean;
  timeseries: any[];
  topPages: any[];
  sources: any[];
  devices: DeviceEntry[];
  osData: DeviceEntry[];
  browsersData: DeviceEntry[];
  geoData: any[];
  funnelSteps: FunnelStep[];
  funnelRate: number;
  funnelPages: PageFunnel[];
  journeys: VisitorJourney[];
  allJourneys: VisitorJourney[];
  hasFilters: boolean;
  selectedJourney: VisitorJourney | null;
  setSelectedJourney: (j: VisitorJourney) => void;
  setFilterPage: (p: string | null) => void;
  setFilterCountry: (c: string | null) => void;
  recordings: RecordingSummary[];
  onSelectRecording: (r: RecordingDetail) => void;
  range: string;
  revenueBySource: RevenueBySource[];
  revenueByCountry: RevenueByCountry[];
  revenueTimeseries: RevenueTimeSeriesPoint[];
  channels: ChannelEntry[];
  entryPagesRevenue: EntryPageRevenue[];
  revenueByMethod: RevenueByPaymentMethod[];
  revenueByProvider: RevenueByPaymentProvider[];
  editing: boolean;
  layout: Layout;
  onLayoutChange: (layout: Layout) => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth();

  const METRIC_KEYS = ["views", "visitors", "revenue", "conv", "rev_visitor", "bounce"] as const;
  const METRIC_LABELS: Record<string, string> = { views: t("metric.views"), visitors: t("metric.visitors"), revenue: t("metric.revenue"), conv: "Conv. rate", rev_visitor: "Rev/visitor", bounce: t("metric.bounce_rate") };
  const [hiddenMetrics, setHiddenMetrics] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem("kp_hidden_metrics"); return s ? new Set(JSON.parse(s)) : new Set(); } catch { return new Set(); }
  });
  const [showMetricsPopover, setShowMetricsPopover] = useState(false);
  const toggleMetric = (key: string) => {
    const next = new Set(hiddenMetrics);
    if (next.has(key)) next.delete(key); else next.add(key);
    setHiddenMetrics(next);
    try { localStorage.setItem("kp_hidden_metrics", JSON.stringify([...next])); } catch { /* ignore */ }
  };
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showMetricsPopover) return;
    const handler = (e: MouseEvent) => { if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setShowMetricsPopover(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMetricsPopover]);

  const isMobile = width < 768;
  const gridCols = width < 520 ? 1 : width < 768 ? 2 : 12;
  const activeLayout = isMobile ? toMobileLayout(layout, gridCols) : layout;

  const widgetStyle = (_id: string) => ({
    background: "var(--bg2)",
    border: editing ? "1px dashed var(--accent)" : "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
    cursor: editing ? "move" : "default",
    transition: "border-color 0.2s",
    display: "flex",
    flexDirection: "column" as const,
  });

  return (
    <div ref={containerRef} style={{ flex: 1, overflowY: "auto", padding: isMobile ? "8px 10px 48px" : "16px 20px 48px" }}>
      {mounted && (
      <GridLayout
        layout={activeLayout}
        width={width}
        gridConfig={{ cols: gridCols, rowHeight: 40, margin: isMobile ? [8, 8] as const : [12, 12] as const, containerPadding: null, maxRows: Infinity }}
        dragConfig={{ enabled: editing && !isMobile }}
        resizeConfig={{ enabled: editing && !isMobile }}
        onLayoutChange={isMobile ? undefined : onLayoutChange}
      >
        <div key="metrics" style={{ ...widgetStyle("metrics"), position: "relative", overflow: "visible" }}>
          <div className="metrics-grid" style={{ margin: 0, padding: "8px 14px" }}>
            {!hiddenMetrics.has("views") && <MetricCard label={t("metric.views")} value={stats?.pageviews?.toLocaleString() ?? "0"} />}
            {!hiddenMetrics.has("visitors") && <MetricCard label={t("metric.visitors")} value={stats?.visitors?.toLocaleString() ?? "0"} />}
            {!hiddenMetrics.has("revenue") && <MetricCard label={t("metric.revenue")} value={`$${(stats?.revenue ?? 0).toFixed(2)}`} />}
            {!hiddenMetrics.has("conv") && <MetricCard label="Conv. rate" value={stats?.visitors ? `${((stats?.conversions ?? 0) / stats.visitors * 100).toFixed(2)}%` : "0%"} />}
            {!hiddenMetrics.has("rev_visitor") && <MetricCard label="Rev/visitor" value={stats?.visitors ? `$${((stats?.revenue ?? 0) / stats.visitors).toFixed(2)}` : "$0"} />}
            {!hiddenMetrics.has("bounce") && <MetricCard label={t("metric.bounce_rate")} value={`${stats?.bounceRate ?? 0}%`} />}
          </div>
          <div ref={popoverRef} style={{ position: "absolute", top: 6, right: 8, zIndex: 20 }}>
            <button onClick={() => setShowMetricsPopover(!showMetricsPopover)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 14, padding: 2, lineHeight: 1 }}>⋮</button>
            {showMetricsPopover && (
              <div style={{ position: "absolute", top: "100%", right: 0, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 0", minWidth: 140, boxShadow: "0 8px 24px rgba(0,0,0,.3)" }}>
                {METRIC_KEYS.map(key => (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", cursor: "pointer", fontSize: 12, color: hiddenMetrics.has(key) ? "var(--text3)" : "var(--text)" }}>
                    <input type="checkbox" checked={!hiddenMetrics.has(key)} onChange={() => toggleMetric(key)} style={{ accentColor: "var(--accent)" }} />
                    {METRIC_LABELS[key]}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div key="top-pages" style={widgetStyle("top-pages")}>
          <DataTable title={t("table.top_pages")} rows={topPages.map((p) => ({ path: p.path, views: p.pageviews.toLocaleString(), visitors: p.visitors.toLocaleString() }))}
            columns={[{ key: "path", label: t("table.page") }, { key: "views", label: t("table.views"), align: "right", mono: true }, { key: "visitors", label: t("table.visitors"), align: "right", mono: true }]}
            onRowClick={(row) => setFilterPage(String(row.path))} />
        </div>

        <div key="chart" style={widgetStyle("chart")}>
          <ChartCard data={timeseries} revenueTimeseries={revenueTimeseries} loading={isLoading} />
        </div>

        <div key="sources" style={widgetStyle("sources")}>
          <DataTable title={t("table.traffic_sources")} rows={sources.map((s) => {
            const label = sourceLabel(s.source);
            return { source: label, _pct: `${s.percentage}%` };
          })}
            columns={[{ key: "source", label: t("table.source") }, { key: "_pct", label: "Share", align: "right", mono: true }]} />
        </div>

        <div key="locations" style={widgetStyle("locations")}>
          <LocationTable geoData={geoData} onFilterCountry={setFilterCountry} />
        </div>

        <div key="devices" style={widgetStyle("devices")}>
          <DeviceTable devices={devices} os={osData} browsers={browsersData} />
        </div>

        <div key="funnel" style={widgetStyle("funnel")}>
          <FunnelChartCustom steps={funnelSteps} conversionRate={funnelRate} pages={funnelPages} />
        </div>

        <div key="recordings" style={widgetStyle("recordings")}>
          <RecordingsTable recordings={recordings} onSelect={onSelectRecording} />
        </div>

        <div key="journeys" style={widgetStyle("journeys")}>
          <div className="journeys-section" style={{ margin: 0 }}>
            <div className="journeys-header">
              <span className="journeys-title">{t("journeys.title")}</span>
              <span className="journeys-count">{journeys.length}{hasFilters ? ` / ${allJourneys.length}` : ""}</span>
            </div>
            {journeys.length === 0 ? (
              <div style={{ padding: 20, color: "var(--text3)", fontSize: 13, textAlign: "center" }}>{t("journeys.no_activity")}</div>
            ) : (
              <div className="journeys-list">
                {journeys.map((j) => (
                  <JourneyCard key={j.session_id} journey={j} selected={selectedJourney?.session_id === j.session_id} onClick={() => setSelectedJourney(j)} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div key="ai-insights" style={widgetStyle("ai-insights")}>
          <CollapsibleSection title="AI Insights" defaultOpen={false}>
            <AiInsightsCard siteId={siteId} range={range} />
          </CollapsibleSection>
        </div>

        <div key="event-usage" style={widgetStyle("event-usage")}>
          <CollapsibleSection title="Event Usage This Month" defaultOpen={false}>
            <EventCalculator currentEvents={(stats?.pageviews ?? 0) + (stats?.conversions ?? 0)} currentPlan="starter" />
          </CollapsibleSection>
        </div>

        <div key="revenue" style={widgetStyle("revenue")}>
          <RevenueBreakdownWidget bySource={revenueBySource} byCountry={revenueByCountry} trend={revenueTimeseries} byMethod={revenueByMethod} byProvider={revenueByProvider} />
        </div>

        <div key="channels" style={widgetStyle("channels")}>
          <div className="data-table-card" style={{ border: "none", background: "transparent", display: "flex", flexDirection: "column", height: "100%" }}>
            <span className="data-table-title">Traffic Channels</span>
            <ChannelBreakdownWidget data={channels} />
          </div>
        </div>

        <div key="entry-pages" style={widgetStyle("entry-pages")}>
          <DataTable
            title="Entry Pages Revenue"
            rows={entryPagesRevenue.map(r => ({
              path: r.path,
              sessions: r.sessions.toLocaleString(),
              conversions: r.conversions.toLocaleString(),
              revenue: `$${r.revenue.toFixed(2)}`,
              rate: r.sessions > 0 ? `${((r.conversions / r.sessions) * 100).toFixed(1)}%` : "0%",
            }))}
            columns={[
              { key: "path", label: "Page" },
              { key: "sessions", label: "Sessions", align: "right", mono: true },
              { key: "conversions", label: "Conv.", align: "right", mono: true },
              { key: "revenue", label: "Revenue", align: "right", mono: true },
              { key: "rate", label: "Rate", align: "right", mono: true },
            ]}
          />
        </div>
      </GridLayout>
      )}
    </div>
  );
}

const RANGE_PRESETS = [{ key: "24h", label: "24h" }, { key: "7d", label: "7d" }, { key: "30d", label: "30d" }, { key: "90d", label: "90d" }];

function SiteDetailPage() {
  const navigate = useNavigate();
  const { siteId } = Route.useParams();
  const queryClient = useQueryClient();
  const [range, setRange] = useState("7d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [selectedJourney, setSelectedJourney] = useState<VisitorJourney | null>(null);
  const [locationView, setLocationView] = useState<"cards" | "globe" | "heatmap">("cards");
  const [selectedGlobeCity, setSelectedGlobeCity] = useState<string | null>(null);
  const [filterPage, setFilterPage] = useState<string | null>(null);
  const [filterCountry, setFilterCountry] = useState<string | null>(null);
  const [selectedRecording, setSelectedRecording] = useState<RecordingDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [layout, setLayout] = useState<Layout>(() => loadLayout(siteId));

  const onLayoutChange = useCallback((newLayout: Layout) => {
    setLayout(newLayout);
    try { localStorage.setItem(`kp_layout_${siteId}`, JSON.stringify(newLayout)); } catch { /* ignore */ }
  }, [siteId]);

  const effectiveRange = showCustom && customStart && customEnd ? `${customStart},${customEnd}` : range;

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", siteId, effectiveRange],
    queryFn: () => fetchDashboard(siteId, showCustom && customStart && customEnd ? undefined : range, showCustom ? customStart : undefined, showCustom ? customEnd : undefined),
    enabled: !!siteId,
  });

  const { data: funnelData } = useQuery({
    queryKey: ["funnel", siteId, effectiveRange],
    queryFn: () => fetchFunnel(siteId, showCustom && customStart && customEnd ? undefined : range),
    enabled: !!siteId,
  });

  const { data: geoData } = useQuery({
    queryKey: ["geo", siteId, effectiveRange],
    queryFn: () => fetchGeo(siteId, showCustom && customStart && customEnd ? undefined : range),
    enabled: !!siteId,
  });

  const { data: recordingsData } = useQuery({
    queryKey: ["recordings", siteId, effectiveRange],
    queryFn: () => fetchRecordings(siteId, showCustom && customStart && customEnd ? undefined : range),
    enabled: !!siteId,
  });

  // SSE for real-time updates — only active on globe tab
  useEffect(() => {
    if (!siteId || locationView !== "globe") return;
    const disconnect = connectSSE(siteId, (ev) => {
      if (ev.type === "visitor" || ev.type === "stats") {
        queryClient.invalidateQueries({ queryKey: ["geo", siteId] });
      }
    });
    return disconnect;
  }, [siteId, queryClient, locationView]);

  // Sync widget data on dashboard update
  useEffect(() => {
    if (!data || !Capacitor.isNativePlatform()) return;
    import("@/plugins/klikapa-widget-bridge").then(({ KlikapaWidgetBridge }) => {
      KlikapaWidgetBridge.saveWidgetData({
        siteName: siteId,
        visitors: data.stats.visitors,
        pageviews: data.stats.pageviews,
        trend: 0,
        sparkline: [],
        updatedAt: new Date().toISOString(),
      });
    }).catch(() => {});
  }, [data]);

  if (!siteId) {
    return <div className="empty-state" style={{ flex: 1 }}><p>{t("sites.select_site")}</p></div>;
  }

  const hasNoData = !isLoading && data && data.stats.pageviews === 0;
  const stats = data?.stats;
  const allJourneys = data?.journeys ?? [];
  const topPages = data?.topPages ?? [];
  const sources = data?.sources ?? [];
  const timeseries = data?.timeseries ?? [];
  const revenueBySource = data?.revenueBySource ?? [];
  const revenueByCountry = data?.revenueByCountry ?? [];
  const revenueTimeseries = data?.revenueTimeseries ?? [];
  const channels = data?.channels ?? [];
  const entryPagesRevenue = data?.entryPagesRevenue ?? [];
  const revenueByMethod = data?.revenueByMethod ?? [];
  const revenueByProvider = data?.revenueByProvider ?? [];

  const journeys = useMemo(() => {
    let filtered = allJourneys;
    if (filterPage) filtered = filtered.filter((j) => j.steps.some((s) => s.path === filterPage));
    if (filterCountry) filtered = filtered.filter((j) => j.country === filterCountry);
    return filtered;
  }, [allJourneys, filterPage, filterCountry]);

  const hasFilters = !!(filterPage || filterCountry);

  const globeMarkers = useMemo(() => geoToMarkers(geoData ?? []), [geoData]);

  if (hasNoData) return <EmptyState siteId={siteId} />;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="range-bar">
        {RANGE_PRESETS.map((r) => (
          <button key={r.key} className={`btn-pill ${!showCustom && range === r.key ? "active" : ""}`}
            onClick={() => { setRange(r.key); setShowCustom(false); }}>{r.label}</button>
        ))}
        <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />
        <button className={`btn-pill ${showCustom ? "active" : ""}`} onClick={() => setShowCustom(!showCustom)}>Custom</button>
        {showCustom && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            <DateTimePicker value={customStart} onChange={setCustomStart} placeholder="Start" />
            <span style={{ fontSize: 12, color: "var(--text3)", margin: "0 2px" }}>→</span>
            <DateTimePicker value={customEnd} onChange={setCustomEnd} placeholder="End" />
            {customStart && customEnd && (
              <button className="btn-accent" style={{ fontSize: 12, padding: "6px 14px" }} onClick={() => {}}>Apply</button>
            )}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {editing && (
          <button className="btn-pill range-overflow-btn" style={{ fontSize: 11, padding: "4px 10px", color: "var(--text3)" }}
            onClick={() => { setLayout([...DEFAULT_LAYOUT]); localStorage.removeItem(`kp_layout_${siteId}`); }}>Reset Layout</button>
        )}
        <button className="btn-pill range-overflow-btn" style={{ fontSize: 11, padding: "4px 10px", color: editing ? "var(--accent)" : "var(--text3)" }}
          onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit Layout"}</button>
        <button className="btn-pill range-overflow-btn" onClick={() => navigate({ to: "/import" })} title="Import data">↑ Import</button>
        <button className="btn-pill range-overflow-btn" onClick={() => exportData(siteId, "events", "csv", range)} title="Export CSV">↓ CSV</button>
        <button className="btn-pill range-overflow-btn" onClick={() => navigate({ to: "/settings" })} title="Settings">⚙ Settings</button>
        <div className="location-tabs">
          <button className={`location-tab ${locationView === "cards" ? "active" : ""}`} onClick={() => { setLocationView("cards"); setSelectedGlobeCity(null); }}>Cards</button>
          <button className={`location-tab ${locationView === "globe" ? "active" : ""}`} onClick={() => { setLocationView("globe"); setSelectedGlobeCity(null); }}>Globe</button>
          <button className={`location-tab ${locationView === "heatmap" ? "active" : ""}`} onClick={() => { setLocationView("heatmap"); setSelectedGlobeCity(null); }}>Heatmap</button>
        </div>
      </div>

      {hasFilters && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg2)", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Filters:</span>
          {filterPage && (
            <button className="btn-pill" style={{ fontSize: 11, padding: "3px 10px", display: "flex", alignItems: "center", gap: 4, background: "var(--accent-dim)", color: "var(--accent)" }}
              onClick={() => setFilterPage(null)}>
              {filterPage} <span style={{ opacity: 0.6 }}>✕</span>
            </button>
          )}
          {filterCountry && (
            <button className="btn-pill" style={{ fontSize: 11, padding: "3px 10px", display: "flex", alignItems: "center", gap: 4, background: "var(--accent-dim)", color: "var(--accent)" }}
              onClick={() => setFilterCountry(null)}>
              {filterCountry} <span style={{ opacity: 0.6 }}>✕</span>
            </button>
          )}
          <button className="btn-pill" style={{ fontSize: 10, padding: "3px 8px", color: "var(--text3)" }}
            onClick={() => { setFilterPage(null); setFilterCountry(null); }}>Clear all</button>
        </div>
      )}

      {isLoading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><div className="spinner" /></div>
      ) : locationView === "globe" ? (
        <div className="detail-scroll">
          <div className="globe-view-layout">
            <div className="globe-view-sidebar">
              <GlobeSummaryPanel journeys={journeys} />
              <GlobeEventLog journeys={journeys} />
            </div>
            <div className="globe-view-main">
              <div className="globe-header">
                <span className="globe-title">{t("table.locations")}</span>
                {geoData && <span className="globe-count">{geoData.reduce((s, g) => s + g.visitors, 0).toLocaleString()} visitors from {geoData.length} locations</span>}
              </div>
              <div className="globe-canvas-wrap">
                <Globe
                  markers={globeMarkers}
                  paused={!!selectedGlobeCity}
                  onMarkerClick={(marker) => setSelectedGlobeCity(marker.city ?? null)}
                />
              </div>
              {selectedGlobeCity && (
                <GlobeMarkerPopup
                  city={selectedGlobeCity}
                  journeys={journeys.filter(j => j.city === selectedGlobeCity)}
                  onClose={() => setSelectedGlobeCity(null)}
                />
              )}
            </div>
          </div>
        </div>
      ) : locationView === "heatmap" ? (
        <HeatmapView siteId={siteId} topPages={topPages} range={effectiveRange} />
      ) : (
        <DashboardGrid siteId={siteId} stats={stats} isLoading={isLoading} timeseries={timeseries}
          topPages={topPages} sources={sources} devices={data?.devices ?? []} osData={data?.os ?? []} browsersData={data?.browsers ?? []} geoData={geoData ?? []}
          funnelSteps={funnelData?.steps ?? []} funnelRate={funnelData?.conversionRate ?? 0} funnelPages={funnelData?.pages ?? []}
          journeys={journeys} allJourneys={allJourneys} hasFilters={hasFilters}
          selectedJourney={selectedJourney} setSelectedJourney={setSelectedJourney}
          setFilterPage={setFilterPage} setFilterCountry={setFilterCountry}
          recordings={recordingsData ?? []} onSelectRecording={setSelectedRecording}
          range={range}
          revenueBySource={revenueBySource} revenueByCountry={revenueByCountry} revenueTimeseries={revenueTimeseries}
          channels={channels} entryPagesRevenue={entryPagesRevenue} revenueByMethod={revenueByMethod} revenueByProvider={revenueByProvider}
          editing={editing} layout={layout} onLayoutChange={onLayoutChange} />
      )}

      {selectedJourney && <ProfilePanel journey={selectedJourney} onClose={() => setSelectedJourney(null)} />}
      {selectedRecording && <RecordingPanel recording={selectedRecording} onClose={() => setSelectedRecording(null)} />}
    </div>
  );
}
