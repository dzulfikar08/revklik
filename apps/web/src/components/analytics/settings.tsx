import { Button } from "@revklik/ui/components/button";
import { Check, Copy, LogOut } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useT } from "@/lib/i18n";
import { rememberedOtherUserIds } from "@/lib/legacy/accounts";
import { getLegacyUser, LEGACY_API_BASE, legacySignOut } from "@/lib/legacy/api";

import { EmailReportsSection } from "./email-reports";
import { LinkedAccountsSection } from "./linked-accounts";
import { PrivacySection } from "./privacy-section";
import { TeamSection } from "./team";
import { Panel } from "./ui";

const Row = ({ children, label }: { children: React.ReactNode; label: string }) => (
	<div className="flex items-center justify-between gap-3">
		<dt className="text-muted-foreground text-xs">{label}</dt>
		<dd className="flex min-w-0 items-center gap-1.5 text-[13px]">{children}</dd>
	</div>
);

const CopyValue = ({ value }: { value: string }) => {
	const t = useT();
	const [copied, setCopied] = useState(false);
	return (
		<>
			<span className="truncate font-mono text-xs">{value}</span>
			<button
				type="button"
				aria-label={t("settings.copy")}
				className="text-muted-foreground hover:text-foreground focus-visible:outline-ring flex size-6 shrink-0 items-center justify-center rounded-md outline-offset-2 focus-visible:outline-2 pointer-coarse:size-9"
				onClick={async () => {
					try {
						await navigator.clipboard.writeText(value);
						setCopied(true);
						setTimeout(() => setCopied(false), 1600);
					} catch {
						toast.error(t("share.copyFailed"));
					}
				}}
			>
				{copied ? (
					<Check className="size-3.5" aria-hidden />
				) : (
					<Copy className="size-3.5" aria-hidden />
				)}
			</button>
		</>
	);
};

export const SettingsView = ({
	site,
	siteId,
	onSignOut,
}: {
	site?: string;
	siteId: string;
	onSignOut: () => void;
}) => {
	const handleSignOut = async (): Promise<void> => {
		await legacySignOut({ keepOthers });
		onSignOut();
	};
	const user = getLegacyUser();
	const [keepOthers, setKeepOthers] = useState(false);
	const t = useT();
	const keepId = useId();

	return (
		<main className="mx-auto max-w-7xl px-3 pt-3 pb-6 md:px-4">
			<div className="mb-2.5">
				<h1 className="text-lg font-semibold tracking-tight">{t("settings.title")}</h1>
				<p className="text-muted-foreground text-xs">{t("settings.subtitle")}</p>
			</div>
			<div className="grid gap-2.5 md:grid-cols-2">
				<Panel title={t("settings.account")}>
					<dl className="grid gap-2">
						<Row label={t("settings.name")}>
							<span className="truncate font-medium">{user?.name ?? "-"}</span>
						</Row>
						<Row label={t("settings.email")}>
							<span className="truncate text-xs">{user?.email ?? "-"}</span>
						</Row>
						{user?.role === "super_admin" ? (
							<Row label={t("settings.accountType")}>
								<span className="bg-muted/70 ring-foreground/10 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1">
									{t("settings.platformAdmin")}
								</span>
							</Row>
						) : null}
					</dl>
				</Panel>

				<Panel title={t("settings.site")}>
					<dl className="grid gap-2">
						<Row label={t("settings.domain")}>
							<span className="truncate font-medium">{site ?? "-"}</span>
						</Row>
						<Row label={t("settings.siteId")}>
							<CopyValue value={siteId} />
						</Row>
					</dl>
					<details className="mt-3">
						<summary className="text-muted-foreground hover:text-foreground focus-visible:outline-ring cursor-pointer text-xs outline-offset-2 focus-visible:outline-2">
							{t("settings.developer")}
						</summary>
						<dl className="mt-2 grid gap-2">
							<Row label={t("settings.apiUrl")}>
								<CopyValue value={LEGACY_API_BASE} />
							</Row>
						</dl>
					</details>
				</Panel>

				<div className="md:col-span-2">
					<EmailReportsSection siteId={siteId} />
				</div>

				<div className="md:col-span-2">
					<TeamSection siteId={siteId} />
				</div>

				<div className="md:col-span-2">
					<LinkedAccountsSection />
				</div>

				<div className="md:col-span-2">
					<PrivacySection domain={site} siteId={siteId} onAccountDeleted={onSignOut} />
				</div>

				<div className="md:col-span-2">
					<Panel title={t("settings.session")}>
						{rememberedOtherUserIds().length > 0 ? (
							<label
								htmlFor={keepId}
								className="text-muted-foreground mb-2 flex items-start gap-2 text-xs"
							>
								<input
									id={keepId}
									type="checkbox"
									checked={keepOthers}
									onChange={(e) => setKeepOthers(e.target.checked)}
									className="mt-0.5 size-4 pointer-coarse:size-5"
								/>
								{t("accounts.keepOthers")}
							</label>
						) : null}
						<Button variant="outline" size="sm" onClick={() => void handleSignOut()}>
							<LogOut className="size-3.5" aria-hidden />
							{t("settings.signOut")}
						</Button>
					</Panel>
				</div>
			</div>
		</main>
	);
};
