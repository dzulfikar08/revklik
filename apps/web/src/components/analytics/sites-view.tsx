import { Button } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Code2, EyeOff, Loader2, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { normalizeDomain } from "@/lib/domain";
import { useT } from "@/lib/i18n";
import { fetchSites, isPlanRequired } from "@/lib/legacy/api";
import type { SiteWithStats } from "@/lib/legacy/api";
import {
	addExclusion,
	createLegacySite,
	deleteLegacySite,
	fetchExclusions,
	fetchMyFingerprint,
	purgeMyVisits,
	SiteDeleteTimeoutError,
	removeExclusion,
} from "@/lib/legacy/sites";
import { useModalDialog } from "@/lib/use-modal-dialog";

import { fmt, money } from "./data";
import { siteHasEvents, SnippetModal } from "./snippet-modal";
import type { SnippetSite } from "./snippet-modal";
import { Panel } from "./ui";

const fpLabel = (fp: string): string =>
	fp.length > 36 ? `${fp.slice(0, 24)}…${fp.slice(-8)}` : fp;

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

	const setList = (list: string[]) => qc.setQueryData(["legacy", "exclusions", siteId], list);

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
				`Purged ${r.events} events, ${r.sessions} sessions, ${r.profiles} visitor profiles.`,
			);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const exclusions = exclusionsQ.data ?? [];

	return (
		<div className="border-border/60 mt-1.5 rounded-xl border border-dashed p-2.5">
			<p className="text-muted-foreground text-[11px] leading-relaxed">
				Exclude your own browser/device from tracking (fingerprint = IP + user-agent + language).
				Run once on every device you develop from.
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
						<Button size="sm" variant="ghost" onClick={() => setConfirmPurge(false)}>
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
	const t = useT();
	const qc = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	const [showExclusions, setShowExclusions] = useState(false);

	// The row stays (with a "Deleting site data…" state) until the worker
	// confirms the purge with a final 200; only then does the list refetch.
	const deleteMut = useMutation({
		mutationFn: () => deleteLegacySite(site.id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["legacy", "sites"] });
			onDeleted(site.domain);
		},
		onError: (e: Error) =>
			toast.error(e instanceof SiteDeleteTimeoutError ? t("sites.deleteTimeout") : e.message),
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
								{site.revenue ? ` · ${money(site.revenue, site.currency)}` : ""}
							</span>
						) : null}
					</p>
				</div>
				{deleteMut.isPending ? (
					<span
						role="status"
						aria-live="polite"
						className="text-muted-foreground flex items-center gap-1.5 text-[11px]"
					>
						<Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
						{t("sites.deleting")}
					</span>
				) : confirming ? (
					<span className="flex items-center gap-1.5">
						<span className="text-muted-foreground text-[11px]">Delete site + all its data?</span>
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
						<Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
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
								showExclusions ? "text-foreground" : "text-muted-foreground hover:text-foreground"
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

const SitesPanel = ({ onClose }: { onClose: () => void }) => {
	const t = useT();
	const qc = useQueryClient();
	const [snippetFor, setSnippetFor] = useState<SnippetSite | null>(null);
	const [name, setName] = useState("");
	const [domain, setDomain] = useState("");
	const dialog = useModalDialog<HTMLElement>(onClose);

	const sitesQ = useQuery({
		queryKey: ["legacy", "sites", "manage"],
		queryFn: () => fetchSites("30d"),
		retry: false,
		staleTime: 30_000,
	});
	const sites = sitesQ.data ?? [];

	const addMut = useMutation({
		mutationFn: (host: string) => createLegacySite(name.trim(), host),
		onSuccess: (site) => {
			qc.invalidateQueries({ queryKey: ["legacy", "sites"] });
			setName("");
			setDomain("");
			toast.success(t("sites.added", { domain: site.domain }));
			// Straight to install: the snippet is the only next step.
			setSnippetFor({ domain: site.domain, hasEvents: false, id: site.id });
		},
		onError: (e: Error) => {
			// Site limit / plan errors get the global toast with an Upgrade action.
			if (!isPlanRequired(e)) {
				toast.error(e.message);
			}
		},
	});

	const submitAdd = () => {
		if (!name.trim() || !domain.trim()) {
			toast.error(t("sites.required"));
			return;
		}
		const host = normalizeDomain(domain);
		if (!host) {
			toast.error(t("sites.invalidDomain"));
			return;
		}
		// Show the cleaned value so the user sees what gets saved.
		setDomain(host);
		if (sites.some((s) => s.domain === host)) {
			toast.error(t("sites.duplicate"));
			return;
		}
		addMut.mutate(host);
	};

	return (
		<div className="fixed inset-0 z-40">
			<button
				type="button"
				tabIndex={-1}
				aria-hidden
				onClick={onClose}
				className="animate-in fade-in absolute inset-0 bg-black/55 backdrop-blur-[2px]"
			/>
			<aside
				ref={dialog.ref}
				onKeyDown={dialog.onKeyDown}
				role="dialog"
				aria-modal="true"
				aria-labelledby="sites-panel-title"
				tabIndex={-1}
				className="bg-card ring-foreground/10 animate-in slide-in-from-right-8 absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col rounded-l-2xl ring-1 duration-200 outline-none"
			>
				<div className="border-border/60 flex items-center gap-2 border-b p-3">
					<h2 id="sites-panel-title" className="text-sm font-semibold">
						{t("sites.title")}{" "}
						<span className="text-muted-foreground font-mono text-xs">{sites.length}</span>
					</h2>
					<button
						type="button"
						aria-label={t("sites.close")}
						onClick={onClose}
						className="hover:bg-muted focus-visible:outline-ring ms-auto -m-1 rounded-md p-2.5 outline-offset-2 focus-visible:outline-2"
					>
						<X className="size-4" aria-hidden />
					</button>
				</div>

				<div className="flex-1 space-y-2.5 overflow-y-auto p-3">
					<Panel title={t("sites.addTitle")}>
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
									placeholder={t("sites.namePlaceholder")}
									aria-label={t("sites.nameLabel")}
									data-autofocus
									className="h-10"
								/>
								<Input
									value={domain}
									onChange={(e) => setDomain(e.target.value)}
									onBlur={() => {
										const host = normalizeDomain(domain);
										if (host) setDomain(host);
									}}
									placeholder="example.com"
									aria-label={t("sites.domainLabel")}
									inputMode="url"
									autoCapitalize="none"
									autoCorrect="off"
									spellCheck={false}
									className="h-10"
								/>
							</div>
							<div className="flex items-center justify-end">
								<Button type="submit" className="h-10" disabled={addMut.isPending}>
									{addMut.isPending ? (
										<Loader2 className="size-3.5 animate-spin" aria-hidden />
									) : (
										<Plus className="size-3.5" aria-hidden />
									)}
									{t("sites.addBtn")}
								</Button>
							</div>
						</form>
					</Panel>

					{sitesQ.isLoading ? (
						<p className="text-muted-foreground py-6 text-center text-xs">{t("sites.loading")}</p>
					) : sitesQ.isError ? (
						<p className="rounded-xl bg-(--down)/10 px-3 py-2 text-xs text-(--down)" role="alert">
							{t("sites.loadError")}
						</p>
					) : sites.length === 0 ? (
						<p className="text-muted-foreground py-6 text-center text-xs">{t("sites.empty")}</p>
					) : (
						<ul className="grid gap-2">
							{sites.map((s) => (
								<SiteRow
									key={s.id}
									site={s}
									onSnippet={(site) =>
										setSnippetFor({
											domain: site.domain,
											hasEvents: siteHasEvents(site),
											id: site.id,
										})
									}
									onDeleted={(d) => toast.success(`Deleted ${d}`)}
								/>
							))}
						</ul>
					)}
				</div>
			</aside>
			{snippetFor ? <SnippetModal site={snippetFor} onClose={() => setSnippetFor(null)} /> : null}
		</div>
	);
};

/** Slide-over for adding sites, copying snippets and managing exclusions. */
export const SitesView = ({ open, onClose }: { open: boolean; onClose: () => void }) =>
	open ? <SitesPanel onClose={onClose} /> : null;
