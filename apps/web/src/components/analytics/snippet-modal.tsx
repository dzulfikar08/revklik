import { Button } from "@revklik/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleCheck, Copy, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useT } from "@/lib/i18n";
import { connectSSE, fetchDashboard } from "@/lib/legacy/api";
import type { SiteWithStats } from "@/lib/legacy/api";
import { fetchSiteSnippet } from "@/lib/legacy/sites";
import { useModalDialog } from "@/lib/use-modal-dialog";

/** What the modal needs from a site; a freshly created one has no stats yet. */
export interface SnippetSite {
	id: string;
	domain: string;
	/** Known to have received events already (skips the waiting indicator). */
	hasEvents?: boolean;
}

/**
 * Has this site ever received an event? Uses `has_events` when the API
 * sends it; otherwise any traffic in the loaded range counts.
 */
export const siteHasEvents = (site: SiteWithStats): boolean =>
	site.has_events ?? (site.pageviews > 0 || site.visitors > 0 || site.sparkline.some((v) => v > 0));

const POLL_MS = 5000;

/**
 * Flips to true when the site's first event arrives: the live SSE feed
 * reports a visitor, or the 24h overview (polled every 5s as a fallback for
 * blocked streams) shows a pageview.
 */
const useFirstEvent = (siteId: string, known: boolean): boolean => {
	const [streamed, setStreamed] = useState(false);
	const received = known || streamed;

	const overviewQ = useQuery({
		enabled: !received,
		meta: { silent: true },
		queryFn: () => fetchDashboard(siteId, "24h", ""),
		queryKey: ["legacy", "first-event", siteId],
		refetchInterval: received ? false : POLL_MS,
		retry: false,
	});
	const polled = (overviewQ.data?.stats.pageviews ?? 0) > 0;

	useEffect(() => {
		if (received) {
			return;
		}
		return connectSSE(siteId, ({ type }) => {
			if (type === "visitor") {
				setStreamed(true);
			}
		});
	}, [siteId, received]);

	return received || polled;
};

const InstallStatus = ({ site }: { site: SnippetSite }) => {
	const t = useT();
	const received = useFirstEvent(site.id, site.hasEvents === true);
	return (
		<div
			role="status"
			aria-live="polite"
			className={`mt-3 flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-xs ring-1 ${
				received
					? "bg-(--up)/10 text-(--up) ring-(--up)/20"
					: "bg-muted/60 text-muted-foreground ring-foreground/10"
			}`}
		>
			{received ? (
				<CircleCheck className="mt-px size-4 shrink-0" aria-hidden />
			) : (
				<Loader2
					className="mt-px size-4 shrink-0 animate-spin motion-reduce:animate-none"
					aria-hidden
				/>
			)}
			<div>
				<p className="text-foreground font-medium">
					{received ? t("snippet.received") : t("snippet.waiting")}
				</p>
				{received ? null : <p className="mt-0.5">{t("snippet.waitingHint")}</p>}
			</div>
		</div>
	);
};

export const SnippetModal = ({ site, onClose }: { site: SnippetSite; onClose: () => void }) => {
	const t = useT();
	const [copied, setCopied] = useState(false);
	const [promptCopied, setPromptCopied] = useState(false);
	const dialog = useModalDialog<HTMLDivElement>(onClose);
	const snippetQ = useQuery({
		queryKey: ["legacy", "snippet", site.id],
		queryFn: () => fetchSiteSnippet(site.id),
		retry: false,
	});

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
			toast.error(t("snippet.copyFailed"));
		}
	};

	const copyAgentPrompt = async () => {
		try {
			await navigator.clipboard.writeText(agentPrompt);
			setPromptCopied(true);
			setTimeout(() => setPromptCopied(false), 1600);
		} catch {
			toast.error(t("snippet.copyFailed"));
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
			<button
				type="button"
				tabIndex={-1}
				aria-hidden
				onClick={onClose}
				className="animate-in fade-in absolute inset-0 bg-black/55 backdrop-blur-[2px]"
			/>
			<div
				ref={dialog.ref}
				onKeyDown={dialog.onKeyDown}
				role="dialog"
				aria-modal="true"
				aria-labelledby="snippet-title"
				aria-describedby="snippet-desc"
				tabIndex={-1}
				className="bg-card ring-foreground/10 animate-in fade-in zoom-in-95 relative max-h-[calc(100svh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl p-4 ring-1 duration-150 outline-none"
			>
				<div className="mb-3 flex items-start gap-2">
					<div className="min-w-0">
						<h2 id="snippet-title" className="truncate text-sm font-semibold">
							{t("snippet.title")} <span className="text-muted-foreground">· {site.domain}</span>
						</h2>
						<p id="snippet-desc" className="text-muted-foreground mt-0.5 text-xs">
							{t("snippet.desc")}
						</p>
					</div>
					<button
						type="button"
						aria-label={t("sites.close")}
						onClick={onClose}
						className="hover:bg-muted focus-visible:outline-ring ms-auto -m-1.5 rounded-md p-2.5 outline-offset-2 focus-visible:outline-2"
					>
						<X className="size-4" aria-hidden />
					</button>
				</div>

				<pre className="bg-background ring-foreground/10 max-h-48 overflow-auto rounded-xl p-3 font-mono text-[11px] leading-relaxed ring-1">
					{snippetQ.isLoading
						? t("snippet.loading")
						: snippetQ.isError
							? t("snippet.error")
							: snippet}
				</pre>

				<div className="mt-3 flex justify-end">
					<Button
						size="sm"
						className="h-9"
						data-autofocus
						disabled={!snippet || snippetQ.isLoading}
						onClick={copy}
					>
						{copied ? (
							<Check className="size-3.5" aria-hidden />
						) : (
							<Copy className="size-3.5" aria-hidden />
						)}
						{copied ? t("snippet.copied") : t("snippet.copy")}
					</Button>
				</div>

				<InstallStatus site={site} />

				<div className="border-foreground/10 mt-4 border-t pt-4">
					<h3 className="text-xs font-semibold">{t("snippet.agentTitle")}</h3>
					<p className="text-muted-foreground mt-1 text-xs">{t("snippet.agentDesc")}</p>
					<pre className="bg-background ring-foreground/10 mt-2 max-h-40 overflow-auto rounded-xl p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words ring-1">
						{agentPrompt}
					</pre>
					<div className="mt-3 flex flex-wrap items-center justify-between gap-2">
						<p className="text-muted-foreground text-[11px]">
							{t("snippet.docs")}{" "}
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
								href="https://docs.revklik.com"
								target="_blank"
								rel="noopener noreferrer"
								className="hover:text-foreground underline-offset-2 hover:underline"
							>
								docs.revklik.com
							</a>
						</p>
						<Button size="sm" variant="outline" className="h-9" onClick={copyAgentPrompt}>
							{promptCopied ? (
								<Check className="size-3.5" aria-hidden />
							) : (
								<Copy className="size-3.5" aria-hidden />
							)}
							{promptCopied ? t("snippet.copied") : t("snippet.copyPrompt")}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
};
