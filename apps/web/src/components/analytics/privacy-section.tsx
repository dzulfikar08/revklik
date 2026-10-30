import { Button } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import { Label } from "@revklik/ui/components/label";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Download, Loader2, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { getLegacyUser, LegacyApiError } from "@/lib/legacy/api";
import {
	AccountDeleteTimeoutError,
	deleteAccount,
	deleteVisitorData,
	exportVisitorData,
} from "@/lib/legacy/privacy";
import { deleteLegacySite, SiteDeleteTimeoutError } from "@/lib/legacy/sites";

import { Panel } from "./ui";

/** Server error codes from the delete-account route, mapped to our own copy. */
const ACCOUNT_ERRORS: Record<string, MessageKey> = {
	billing_cancel_failed: "settings.privacy.err.billing",
	confirm_email_mismatch: "settings.privacy.err.email",
	current_password_invalid: "settings.privacy.err.password",
	recent_login_required: "settings.privacy.err.recent",
	too_many_attempts: "settings.privacy.err.throttled",
};

const downloadJson = (name: string, data: unknown): void => {
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
	);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
};

const FIELD_LABEL = "text-muted-foreground text-xs font-medium";

/* ------------------------------- visitor data ------------------------------ */

const VisitorDataForm = ({ siteId }: { siteId: string }) => {
	const t = useT();
	const idInput = useId();
	const [visitorId, setVisitorId] = useState("");
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState<"delete" | "export" | null>(null);
	const id = visitorId.trim();

	const run = async (kind: "delete" | "export"): Promise<void> => {
		setBusy(kind);
		try {
			if (kind === "export") {
				downloadJson(`visitor-${id}.json`, await exportVisitorData(siteId, id));
				toast.success(t("settings.privacy.exported"));
			} else {
				const counts = await deleteVisitorData(siteId, id);
				toast.success(
					t("settings.privacy.deleted", { events: counts.events, sessions: counts.sessions }),
				);
				setVisitorId("");
				setConfirming(false);
			}
		} catch (err) {
			toast.error(
				err instanceof LegacyApiError && err.status === 404
					? t("settings.privacy.visitorNotFound")
					: err instanceof Error
						? err.message
						: t("settings.privacy.err.generic"),
			);
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="grid gap-2">
			<h3 className="text-[13px] font-semibold">{t("settings.privacy.visitorTitle")}</h3>
			<p className="text-muted-foreground max-w-prose text-xs leading-relaxed">
				{t("settings.privacy.visitorBody")}
			</p>
			<div className="grid max-w-md gap-1.5">
				<Label htmlFor={idInput} className={FIELD_LABEL}>
					{t("settings.privacy.visitorId")}
				</Label>
				<Input
					id={idInput}
					value={visitorId}
					onChange={(e) => {
						setVisitorId(e.target.value);
						setConfirming(false);
					}}
					className="h-9 font-mono text-xs"
					autoComplete="off"
					spellCheck={false}
				/>
			</div>
			{confirming ? (
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-muted-foreground max-w-prose text-xs">
						{t("settings.privacy.visitorConfirm")}
					</span>
					<Button
						variant="destructive"
						size="sm"
						disabled={busy !== null}
						onClick={() => void run("delete")}
					>
						{busy === "delete" ? (
							<Loader2 className="size-3.5 animate-spin" aria-hidden />
						) : (
							<Trash2 className="size-3.5" aria-hidden />
						)}
						{t("settings.privacy.visitorDelete")}
					</Button>
					<Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
						{t("settings.cancel")}
					</Button>
				</div>
			) : (
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={!id || busy !== null}
						onClick={() => void run("export")}
					>
						{busy === "export" ? (
							<Loader2 className="size-3.5 animate-spin" aria-hidden />
						) : (
							<Download className="size-3.5" aria-hidden />
						)}
						{t("settings.privacy.visitorExport")}
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="text-(--down)"
						disabled={!id || busy !== null}
						onClick={() => setConfirming(true)}
					>
						<Trash2 className="size-3.5" aria-hidden />
						{t("settings.privacy.visitorDelete")}
					</Button>
				</div>
			)}
		</div>
	);
};

/* -------------------------------- delete site ------------------------------ */

const DeleteSiteForm = ({ domain, siteId }: { domain: string; siteId: string }) => {
	const t = useT();
	const qc = useQueryClient();
	const navigate = useNavigate();
	const confirmInput = useId();
	const [open, setOpen] = useState(false);
	const [typed, setTyped] = useState("");
	const [busy, setBusy] = useState(false);

	const remove = async (): Promise<void> => {
		setBusy(true);
		try {
			await deleteLegacySite(siteId);
			await qc.invalidateQueries({ queryKey: ["legacy", "sites"] });
			toast.success(t("settings.privacy.siteDeleted", { domain }));
			void navigate({ to: "/analytics" });
		} catch (err) {
			toast.error(
				err instanceof SiteDeleteTimeoutError
					? t("sites.deleteTimeout")
					: err instanceof Error
						? err.message
						: t("settings.privacy.err.generic"),
			);
			setBusy(false);
		}
	};

	return (
		<div className="grid gap-2">
			<h3 className="text-[13px] font-semibold">{t("settings.privacy.siteTitle")}</h3>
			<p className="text-muted-foreground max-w-prose text-xs leading-relaxed">
				{t("settings.privacy.siteBody", { domain })}
			</p>
			{open ? (
				<div className="grid max-w-md gap-2">
					<Label htmlFor={confirmInput} className={FIELD_LABEL}>
						{t("settings.privacy.siteConfirmLabel", { domain })}
					</Label>
					<Input
						id={confirmInput}
						value={typed}
						onChange={(e) => setTyped(e.target.value)}
						className="h-9 font-mono text-xs"
						autoComplete="off"
						spellCheck={false}
					/>
					<div className="flex gap-2">
						<Button
							variant="destructive"
							size="sm"
							disabled={busy || typed.trim() !== domain}
							onClick={() => void remove()}
						>
							{busy ? (
								<Loader2 className="size-3.5 animate-spin" aria-hidden />
							) : (
								<Trash2 className="size-3.5" aria-hidden />
							)}
							{busy ? t("settings.privacy.deleting") : t("settings.privacy.siteDelete")}
						</Button>
						<Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
							{t("settings.cancel")}
						</Button>
					</div>
				</div>
			) : (
				<div>
					<Button
						variant="outline"
						size="sm"
						className="text-(--down)"
						onClick={() => setOpen(true)}
					>
						<Trash2 className="size-3.5" aria-hidden />
						{t("settings.privacy.siteDelete")}
					</Button>
				</div>
			)}
		</div>
	);
};

/* ------------------------------ delete account ----------------------------- */

const DeleteAccountForm = ({ onDeleted }: { onDeleted: () => void }) => {
	const t = useT();
	const emailInput = useId();
	const passwordInput = useId();
	const user = getLegacyUser();
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const remove = async (): Promise<void> => {
		setBusy(true);
		setError("");
		try {
			await deleteAccount({ confirmEmail: email.trim(), currentPassword: password || undefined });
			onDeleted();
		} catch (err) {
			const key = err instanceof LegacyApiError && err.code ? ACCOUNT_ERRORS[err.code] : undefined;
			setError(
				err instanceof AccountDeleteTimeoutError
					? t("settings.privacy.err.timeout")
					: key
						? t(key)
						: err instanceof Error
							? err.message
							: t("settings.privacy.err.generic"),
			);
			setBusy(false);
		}
	};

	return (
		<div className="grid gap-2">
			<h3 className="text-[13px] font-semibold">{t("settings.privacy.accountTitle")}</h3>
			<p className="text-muted-foreground max-w-prose text-xs leading-relaxed">
				{t("settings.privacy.accountBody")}
			</p>
			{open ? (
				<div className="grid max-w-md gap-2">
					<div className="grid gap-1.5">
						<Label htmlFor={emailInput} className={FIELD_LABEL}>
							{t("settings.privacy.accountEmailLabel", { email: user?.email ?? "" })}
						</Label>
						<Input
							id={emailInput}
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							className="h-9 text-xs"
							autoComplete="off"
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor={passwordInput} className={FIELD_LABEL}>
							{t("settings.privacy.accountPassword")}
						</Label>
						<Input
							id={passwordInput}
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="h-9 text-xs"
							autoComplete="current-password"
						/>
						<p className="text-muted-foreground text-xs">
							{t("settings.privacy.accountPasswordHint")}
						</p>
					</div>
					{error ? (
						<p
							className="text-(--down) bg-(--down)/10 rounded-lg px-2.5 py-1.5 text-xs"
							role="alert"
						>
							{error}
						</p>
					) : null}
					<div className="flex gap-2">
						<Button
							variant="destructive"
							size="sm"
							disabled={busy || email.trim().length === 0}
							onClick={() => void remove()}
						>
							{busy ? (
								<Loader2 className="size-3.5 animate-spin" aria-hidden />
							) : (
								<Trash2 className="size-3.5" aria-hidden />
							)}
							{busy ? t("settings.privacy.deleting") : t("settings.privacy.accountDelete")}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={busy}
							onClick={() => {
								setOpen(false);
								setError("");
							}}
						>
							{t("settings.cancel")}
						</Button>
					</div>
				</div>
			) : (
				<div>
					<Button
						variant="outline"
						size="sm"
						className="text-(--down)"
						onClick={() => setOpen(true)}
					>
						<Trash2 className="size-3.5" aria-hidden />
						{t("settings.privacy.accountDelete")}
					</Button>
				</div>
			)}
		</div>
	);
};

/* ---------------------------------- section -------------------------------- */

export const PrivacySection = ({
	domain,
	onAccountDeleted,
	siteId,
}: {
	domain?: string;
	onAccountDeleted: () => void;
	siteId: string;
}) => {
	const t = useT();
	return (
		<Panel title={t("settings.privacy.title")} hint={t("settings.privacy.hint")}>
			<div className="grid gap-5 pt-1">
				<VisitorDataForm siteId={siteId} />
				{domain ? (
					<div className="border-(--border) border-t pt-4">
						<DeleteSiteForm domain={domain} siteId={siteId} />
					</div>
				) : null}
				<div className="border-(--border) border-t pt-4">
					<DeleteAccountForm onDeleted={onAccountDeleted} />
				</div>
			</div>
		</Panel>
	);
};
