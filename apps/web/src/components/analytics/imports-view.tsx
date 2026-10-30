import { Button } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import { Label } from "@revklik/ui/components/label";
import { DollarSign } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { importOneDollarStats } from "@/lib/legacy/integrations";
import type { OdsImportResult } from "@/lib/legacy/integrations";

import { Panel } from "./ui";

const ResultNote = ({ children }: { children: ReactNode }) => (
	<p className="bg-(--up)/10 text-(--up) mt-2 rounded-lg px-3 py-2 text-xs">{children}</p>
);

const ErrorNote = ({ children }: { children: ReactNode }) => (
	<p className="bg-(--down)/10 text-(--down) mt-2 rounded-lg px-3 py-2 text-xs">{children}</p>
);

const OneDollarStatsPanel = ({ siteId }: { siteId: string }) => {
	const t = useT();
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
				data.imported > 0 ? t("imports.toastDone", { n: data.imported }) : t("imports.toastNone"),
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("imports.failed"));
		} finally {
			setImporting(false);
		}
	};

	return (
		<Panel title="OneDollarStats" hint={t("imports.hint")}>
			<div className="flex items-start gap-2.5">
				<span className="bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
					<DollarSign className="size-4" aria-hidden />
				</span>
				<p className="text-muted-foreground text-xs leading-relaxed">{t("imports.intro")}</p>
			</div>

			<div className="text-muted-foreground bg-muted/60 mt-2 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed">
				<span className="text-foreground font-semibold">{t("imports.keyHelpLabel")}</span>{" "}
				{t("imports.keyHelp")}
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
						{t("imports.apiKey")}
					</Label>
					<Input
						id="ods-api-key"
						type="password"
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						placeholder={t("imports.apiKeyPlaceholder")}
						className="h-8 font-mono text-xs"
					/>
				</div>
				<div className="grid gap-1">
					<Label htmlFor="ods-domain" className="text-[10px]">
						{t("imports.domain")}
					</Label>
					<Input
						id="ods-domain"
						value={odsDomain}
						onChange={(e) => setOdsDomain(e.target.value)}
						placeholder={t("imports.domainPlaceholder")}
						className="h-8 font-mono text-xs"
					/>
				</div>
				<div>
					<Button type="submit" size="sm" disabled={importing || !siteId || !apiKey || !odsDomain}>
						{importing ? t("imports.importing") : t("imports.submit")}
					</Button>
				</div>
			</form>

			{result ? (
				<ResultNote>
					{t("imports.created", { n: result.imported })} {result.note}
				</ResultNote>
			) : null}
			{error ? <ErrorNote>{error}</ErrorNote> : null}
		</Panel>
	);
};

export const ImportsView = ({ siteId }: { siteId: string }) => (
	<div className="grid items-start gap-2.5 md:grid-cols-2">
		<OneDollarStatsPanel siteId={siteId} />
	</div>
);
