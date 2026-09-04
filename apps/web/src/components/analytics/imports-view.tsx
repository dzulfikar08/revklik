import { Button } from "@revklik-new/ui/components/button";
import { Input } from "@revklik-new/ui/components/input";
import { Label } from "@revklik-new/ui/components/label";
import { Copy, DollarSign, Snowflake } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  WORKER_ORIGIN,
  importOneDollarStats,
  importPolarOrders,
} from "@/lib/legacy/integrations";
import type { OdsImportResult, PolarImportResult } from "@/lib/legacy/integrations";

import { Panel } from "./ui";

const ResultNote = ({ children }: { children: ReactNode }) => (
  <p className="bg-(--up)/10 text-(--up) mt-2 rounded-lg px-3 py-2 text-xs">{children}</p>
);

const ErrorNote = ({ children }: { children: ReactNode }) => (
  <p className="bg-(--down)/10 text-(--down) mt-2 rounded-lg px-3 py-2 text-xs">{children}</p>
);

const PolarPanel = ({ siteId }: { siteId: string }) => {
  const [polarOrgId, setPolarOrgId] = useState("");
  const [polarToken, setPolarToken] = useState("");
  const [result, setResult] = useState<PolarImportResult | null>(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [copied, setCopied] = useState(false);

  const webhookUrl = `${WORKER_ORIGIN}/api/billing/webhook`;

  const run = async () => {
    setImporting(true);
    setError("");
    setResult(null);
    try {
      const data = await importPolarOrders(siteId, polarToken, polarOrgId);
      setResult(data);
      toast.success(
        data.imported > 0 ? `Imported ${data.imported} Polar orders` : "No new orders found"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Panel
      title="Polar"
      hint="paid orders · customers · countries"
    >
      <div className="flex items-start gap-2.5">
        <span className="bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
          <Snowflake className="size-4" aria-hidden />
        </span>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Import paid orders with customer details and country. New orders sync automatically via
          webhooks and a periodic check.
        </p>
      </div>

      <div className="bg-muted/60 mt-2 rounded-lg px-2.5 py-2">
        <p className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wider uppercase">
          Real-time webhook
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 font-mono text-[10px] break-all">{webhookUrl}</code>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => {
              navigator.clipboard.writeText(webhookUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            <Copy className="size-3" aria-hidden />
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
          Add this URL in polar.sh → Settings → Webhooks, with the{" "}
          <span className="font-mono">orders:read</span> scope selected.
        </p>
      </div>

      <div className="text-muted-foreground mt-2 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed">
        <span className="text-foreground font-semibold">Historical import (one-time):</span> create
        a Polar Organization Access Token at polar.sh → Settings → General → New Token (no
        expiration) with <span className="font-mono">orders:read</span>,{" "}
        <span className="font-mono">subscriptions:read</span>,{" "}
        <span className="font-mono">organizations:read</span>.
      </div>

      <form
        className="border-(--border) mt-2 grid gap-2 border-t pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor="polar-org-id" className="text-[10px]">
            Polar Organization ID
          </Label>
          <Input
            id="polar-org-id"
            value={polarOrgId}
            onChange={(e) => setPolarOrgId(e.target.value)}
            placeholder="e.g. a1b2c3d4-e5f6-…"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="polar-token" className="text-[10px]">
            Polar Access Token
          </Label>
          <Input
            id="polar-token"
            type="password"
            value={polarToken}
            onChange={(e) => setPolarToken(e.target.value)}
            placeholder="polar_oat_…"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div>
          <Button
            type="submit"
            size="sm"
            disabled={importing || !siteId || !polarToken || !polarOrgId}
          >
            {importing ? "Importing…" : "Import historical orders"}
          </Button>
        </div>
      </form>

      {result ? (
        <ResultNote>
          Imported {result.imported} order{result.imported === 1 ? "" : "s"}, skipped{" "}
          {result.skipped} (already imported or unpaid).
          {result.imported > 0 ? (
            <span className="text-muted-foreground mt-1 block">
              New orders will sync automatically via webhooks and periodic checks.
            </span>
          ) : null}
        </ResultNote>
      ) : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </Panel>
  );
};

const OneDollarStatsPanel = ({ siteId }: { siteId: string }) => {
  const [apiKey, setApiKey] = useState("");
  const [odsDomain, setOdsDomain] = useState("");
  const [result, setResult] = useState<OdsImportResult | null>(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);

  const run = async () => {
    setImporting(true);
    setError("");
    setResult(null);
    try {
      const data = await importOneDollarStats(siteId, apiKey, odsDomain);
      setResult(data);
      toast.success(
        data.imported > 0
          ? `Imported ${data.imported} events from OneDollarStats`
          : "No new data found"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Panel title="OneDollarStats" hint="visitors · pages · countries · sources">
      <div className="flex items-start gap-2.5">
        <span className="bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
          <DollarSign className="size-4" aria-hidden />
        </span>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Import historical visitors, pages, countries, and sources from your OneDollarStats
          account.
        </p>
      </div>

      <div className="text-muted-foreground bg-muted/60 mt-2 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed">
        <span className="text-foreground font-semibold">How to get your API key:</span> log in to
        onedollarstats.com → account settings (top-right) → API Keys → Create API Key.
      </div>

      <form
        className="border-(--border) mt-2 grid gap-2 border-t pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor="ods-api-key" className="text-[10px]">
            API Key
          </Label>
          <Input
            id="ods-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="x-api-key value"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ods-domain" className="text-[10px]">
            Site domain (as registered in OneDollarStats)
          </Label>
          <Input
            id="ods-domain"
            value={odsDomain}
            onChange={(e) => setOdsDomain(e.target.value)}
            placeholder="yourdomain.com"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div>
          <Button
            type="submit"
            size="sm"
            disabled={importing || !siteId || !apiKey || !odsDomain}
          >
            {importing ? "Importing…" : "Import from OneDollarStats"}
          </Button>
        </div>
      </form>

      {result ? (
        <ResultNote>
          Created {result.imported} event{result.imported === 1 ? "" : "s"}. {result.note}
        </ResultNote>
      ) : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </Panel>
  );
};

export const ImportsView = ({ siteId }: { siteId: string }) => (
  <div className="grid items-start gap-2.5 md:grid-cols-2">
    <PolarPanel siteId={siteId} />
    <OneDollarStatsPanel siteId={siteId} />
  </div>
);
