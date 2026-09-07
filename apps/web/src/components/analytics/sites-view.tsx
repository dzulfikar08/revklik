import { Button } from "@revklik-new/ui/components/button";
import { Input } from "@revklik-new/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Code2,
  Copy,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { fetchSites } from "@/lib/legacy/api";
import type { SiteWithStats } from "@/lib/legacy/api";
import {
  addExclusion,
  createLegacySite,
  deleteLegacySite,
  fetchExclusions,
  fetchMyFingerprint,
  fetchSiteSnippet,
  purgeMyVisits,
  removeExclusion,
} from "@/lib/legacy/sites";

import { fmt, money } from "./data";
import { Panel } from "./ui";

const fpLabel = (fp: string): string =>
  fp.length > 36 ? `${fp.slice(0, 24)}…${fp.slice(-8)}` : fp;

/* ------------------------------ snippet modal ------------------------------ */

const SnippetModal = ({
  site,
  onClose,
}: {
  site: SiteWithStats;
  onClose: () => void;
}) => {
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const snippetQ = useQuery({
    queryKey: ["legacy", "snippet", site.id],
    queryFn: () => fetchSiteSnippet(site.id),
    retry: false,
  });

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const snippet = snippetQ.data?.snippet ?? "";
  const agentPrompt = `Install RevKlik analytics on this website.

Site ID: ${site.id}

Fetch and follow the full setup guide, then implement it:
https://revklik.com/docs.txt`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy the snippet");
    }
  };

  const copyAgentPrompt = async () => {
    try {
      await navigator.clipboard.writeText(agentPrompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy the prompt");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="animate-in fade-in absolute inset-0 bg-black/55 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Tracking snippet for ${site.domain}`}
        tabIndex={-1}
        autoFocus
        className="bg-card ring-foreground/10 animate-in fade-in zoom-in-95 relative w-full max-w-xl rounded-2xl p-4 ring-1 duration-150 outline-none"
      >
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              Tracking snippet{" "}
              <span className="text-muted-foreground">· {site.domain}</span>
            </h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Paste this into your site&apos;s HTML. Stats start flowing on the
              first visit.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="hover:bg-muted focus-visible:outline-ring ms-auto rounded-md p-1.5 outline-offset-2 focus-visible:outline-2"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <pre className="bg-background ring-foreground/10 max-h-48 overflow-auto rounded-xl p-3 font-mono text-[11px] leading-relaxed ring-1">
          {snippetQ.isLoading
            ? "Loading…"
            : snippetQ.isError
              ? "Couldn't load the snippet."
              : snippet}
        </pre>

        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            disabled={!snippet || snippetQ.isLoading}
            onClick={copy}
          >
            {copied ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <Copy className="size-3.5" aria-hidden />
            )}
            {copied ? "Copied" : "Copy snippet"}
          </Button>
        </div>

        <div className="border-foreground/10 mt-4 border-t pt-4">
          <h3 className="text-xs font-semibold tracking-wider uppercase">
            Set up with an AI agent
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Paste this prompt into Claude Code, Cursor, or any other agent — it
            installs the tracker correctly for you.
          </p>
          <pre className="bg-background ring-foreground/10 mt-2 max-h-40 overflow-auto rounded-xl p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words ring-1">
            {agentPrompt}
          </pre>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-[11px]">
              Full docs:{" "}
              <a
                href="https://revklik.com/docs.txt"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground underline-offset-2 hover:underline"
              >
                docs.txt
              </a>{" "}
              ·{" "}
              <a
                href="https://revklik.com/docs.html"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground underline-offset-2 hover:underline"
              >
                docs.html
              </a>
            </p>
            <Button size="sm" variant="outline" onClick={copyAgentPrompt}>
              {promptCopied ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <Copy className="size-3.5" aria-hidden />
              )}
              {promptCopied ? "Copied" : "Copy agent prompt"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------------------------- exclusions section --------------------------- */

const ExclusionsSection = ({ siteId }: { siteId: string }) => {
  const qc = useQueryClient();
  const [confirmPurge, setConfirmPurge] = useState(false);

  const exclusionsQ = useQuery({
    queryKey: ["legacy", "exclusions", siteId],
    queryFn: () => fetchExclusions(siteId),
    retry: false,
  });
  const fingerprintQ = useQuery({
    queryKey: ["legacy", "my-fingerprint", siteId],
    queryFn: () => fetchMyFingerprint(siteId),
    retry: false,
  });

  const setList = (list: string[]) =>
    qc.setQueryData(["legacy", "exclusions", siteId], list);

  const addMut = useMutation({
    mutationFn: () => addExclusion(siteId),
    onSuccess: (list) => {
      setList(list);
      toast.success("This device is now excluded — future visits won't be tracked.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeMut = useMutation({
    mutationFn: (fp: string) => removeExclusion(siteId, fp),
    onSuccess: setList,
    onError: (e: Error) => toast.error(e.message),
  });
  const purgeMut = useMutation({
    mutationFn: () => purgeMyVisits(siteId),
    onSuccess: (r) => {
      setConfirmPurge(false);
      toast.success(
        `Purged ${r.events} events, ${r.sessions} sessions, ${r.profiles} visitor profiles.`
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exclusions = exclusionsQ.data ?? [];

  return (
    <div className="border-border/60 mt-1.5 rounded-xl border border-dashed p-2.5">
      <p className="text-muted-foreground text-[11px] leading-relaxed">
        Exclude your own browser/device from tracking (fingerprint = IP +
        user-agent + language). Run once on every device you develop from.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={addMut.isPending}
          onClick={() => addMut.mutate()}
        >
          {addMut.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <EyeOff className="size-3.5" aria-hidden />
          )}
          Exclude this device
        </Button>
        {confirmPurge ? (
          <span className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="destructive"
              disabled={purgeMut.isPending}
              onClick={() => purgeMut.mutate()}
            >
              {purgeMut.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : null}
              Delete past visits
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmPurge(false)}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setConfirmPurge(true)}
          >
            Purge my past visits
          </Button>
        )}
      </div>
      {fingerprintQ.data?.fingerprint ? (
        <p className="text-muted-foreground mt-2 truncate font-mono text-[10px]">
          this device: {fpLabel(fingerprintQ.data.fingerprint)}
        </p>
      ) : null}
      {exclusions.length > 0 ? (
        <div className="mt-2">
          <p className="text-muted-foreground text-[10px] tracking-wider uppercase">
            Excluded fingerprints ({exclusions.length})
          </p>
          <ul className="mt-1 grid gap-1">
            {exclusions.map((fp) => (
              <li
                key={fp}
                className="hover:bg-muted/60 flex items-center gap-2 rounded-lg px-1.5 py-1"
              >
                <code className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[10px]">
                  {fpLabel(fp)}
                </code>
                <button
                  type="button"
                  aria-label={`Remove exclusion ${fpLabel(fp)}`}
                  disabled={removeMut.isPending}
                  onClick={() => removeMut.mutate(fp)}
                  className="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1 outline-offset-2 focus-visible:outline-2"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

/* --------------------------------- site row -------------------------------- */

const SiteRow = ({
  site,
  onSnippet,
  onDeleted,
}: {
  site: SiteWithStats;
  onSnippet: (site: SiteWithStats) => void;
  onDeleted: (domain: string) => void;
}) => {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [showExclusions, setShowExclusions] = useState(false);

  const deleteMut = useMutation({
    mutationFn: () => deleteLegacySite(site.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["legacy", "sites"] });
      onDeleted(site.domain);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <li className="bg-background ring-foreground/10 rounded-xl p-2.5 ring-1">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{site.domain}</p>
          <p className="text-muted-foreground truncate text-[11px]">
            {site.name}
            {site.visitors || site.pageviews ? (
              <span className="ml-1.5 font-mono tabular-nums">
                · {fmt(site.visitors)} visitors · {fmt(site.pageviews)} views
                {site.revenue ? ` · ${money(site.revenue)}` : ""}
              </span>
            ) : null}
          </p>
        </div>
        {confirming ? (
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-[11px]">
              Delete site + all its data?
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => deleteMut.mutate()}
            >
              {deleteMut.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="size-3.5" aria-hidden />
              )}
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onSnippet(site)}
              className="hover:bg-muted text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10px] tracking-wider uppercase outline-offset-2 focus-visible:outline-2"
            >
              <Code2 className="size-3.5" aria-hidden />
              Snippet
            </button>
            <button
              type="button"
              aria-expanded={showExclusions}
              onClick={() => setShowExclusions(!showExclusions)}
              className={`hover:bg-muted inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10px] tracking-wider uppercase outline-offset-2 focus-visible:outline-2 ${
                showExclusions
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <EyeOff className="size-3.5" aria-hidden />
              Exclusions
            </button>
            <button
              type="button"
              aria-label={`Delete ${site.domain}`}
              onClick={() => setConfirming(true)}
              className="hover:bg-muted text-muted-foreground hover:text-(--down) rounded-md p-1.5 outline-offset-2 focus-visible:outline-2"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </span>
        )}
      </div>
      {showExclusions ? <ExclusionsSection siteId={site.id} /> : null}
    </li>
  );
};

/* -------------------------------- sites view ------------------------------- */

export const SitesView = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const qc = useQueryClient();
  const [snippetFor, setSnippetFor] = useState<SiteWithStats | null>(null);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");

  const sitesQ = useQuery({
    queryKey: ["legacy", "sites", "manage"],
    queryFn: () => fetchSites("30d"),
    enabled: open,
    retry: false,
    staleTime: 30_000,
  });
  const sites = sitesQ.data ?? [];

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !snippetFor) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, snippetFor]);

  const addMut = useMutation({
    mutationFn: () =>
      createLegacySite(name.trim(), domain.trim().toLowerCase()),
    onSuccess: (site) => {
      qc.invalidateQueries({ queryKey: ["legacy", "sites"] });
      setName("");
      setDomain("");
      toast.success(`Site added — ${site.domain} is ready for its snippet.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitAdd = () => {
    if (!name.trim() || !domain.trim()) {
      toast.error("Name and domain are both required.");
      return;
    }
    if (sites.some((s) => s.domain === domain.trim().toLowerCase())) {
      toast.error("That domain is already added.");
      return;
    }
    addMut.mutate();
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40">
      <dialog
        open
        aria-label="Manage sites"
        className="fixed inset-0 z-40 m-0 h-svh max-h-none w-full max-w-none overflow-visible border-0 bg-transparent p-0"
      >
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="animate-in fade-in absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Manage sites"
          tabIndex={-1}
          autoFocus
          className="bg-card ring-foreground/10 animate-in slide-in-from-right-8 absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col rounded-l-2xl ring-1 duration-200 outline-none"
        >
          <div className="border-border/60 flex items-center gap-2 border-b p-3">
            <p className="text-sm font-semibold">
              Sites{" "}
              <span className="text-muted-foreground font-mono text-xs">
                {sites.length}
              </span>
            </p>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="hover:bg-muted focus-visible:outline-ring ms-auto rounded-md p-1.5 outline-offset-2 focus-visible:outline-2"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
            <Panel title="Add a site">
              <form
                className="grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitAdd();
                }}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name — e.g. My blog"
                    aria-label="Site name"
                  />
                  <Input
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="example.com"
                    aria-label="Site domain"
                    inputMode="url"
                  />
                </div>
                <div className="flex items-center justify-end">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={addMut.isPending}
                  >
                    {addMut.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="size-3.5" aria-hidden />
                    )}
                    Add site
                  </Button>
                </div>
              </form>
            </Panel>

            {sitesQ.isLoading ? (
              <p className="text-muted-foreground py-6 text-center text-xs">
                Loading sites…
              </p>
            ) : sitesQ.isError ? (
              <p
                className="rounded-xl bg-(--down)/10 px-3 py-2 text-xs text-(--down)"
                role="alert"
              >
                {sitesQ.error instanceof Error
                  ? sitesQ.error.message
                  : "Couldn't load sites."}
              </p>
            ) : sites.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-xs">
                No sites yet — add your first one above.
              </p>
            ) : (
              <ul className="grid gap-2">
                {sites.map((s) => (
                  <SiteRow
                    key={s.id}
                    site={s}
                    onSnippet={setSnippetFor}
                    onDeleted={(d) => toast.success(`Deleted ${d}`)}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>
      </dialog>
      {snippetFor ? (
        <SnippetModal site={snippetFor} onClose={() => setSnippetFor(null)} />
      ) : null}
    </div>
  );
};
