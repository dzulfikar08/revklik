/**
 * Team — Settings section: member list (email / role / status),
 * invite-by-email, role change, remove. No old UI existed; the worker
 * routes are the contract (GET /team, POST /team/invite,
 * PATCH/DELETE /team/:memberId).
 */
import { Button } from "@revklik/ui/components/button";
import { Input } from "@revklik/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@revklik/ui/components/select";
import { ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
	fetchTeam,
	inviteTeamMember,
	removeTeamMember,
	updateTeamMemberRole,
} from "@/lib/legacy/team";
import type { LegacyTeamMember, TeamRole } from "@/lib/legacy/team";
import { LegacyApiError } from "@/lib/legacy/api";
import { useT } from "@/lib/i18n";

import { useSiteAccess } from "./use-site-access";
import type { MessageKey } from "@/lib/i18n";

import { Panel } from "./ui";

const ROLES: readonly { value: TeamRole; labelKey: MessageKey }[] = [
	{ value: "admin", labelKey: "team.role.admin" },
	{ value: "editor", labelKey: "team.role.editor" },
	{ value: "viewer", labelKey: "team.role.viewer" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const errMsg = (e: unknown, fallback: string): string =>
	e instanceof LegacyApiError ? e.message : fallback;

const MemberRow = ({
	member,
	onRole,
	onRemove,
	busy,
	canEdit,
}: {
	member: LegacyTeamMember;
	onRole: (id: string, role: TeamRole) => void;
	onRemove: (id: string) => void;
	busy: boolean;
	/** Only the site owner changes roles or removes people. */
	canEdit: boolean;
}) => {
	const t = useT();
	const who = member.email ?? member.name ?? t("team.memberFallback");
	return (
		<li className="bg-muted/40 hover:bg-muted/60 flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-2">
			<span className="min-w-0 flex-1">
				<span className="block truncate text-xs font-medium">
					{member.name ?? member.email ?? member.user_id}
				</span>
				{member.name && member.email ? (
					<span className="text-muted-foreground block truncate font-mono text-[11px]">
						{member.email}
					</span>
				) : null}
			</span>
			<span
				className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
					member.accepted_at ? "bg-(--up)/10 text-(--up)" : "bg-(--chart)/10 text-(--chart)"
				}`}
			>
				{member.accepted_at ? t("team.status.active") : t("team.status.invited")}
			</span>
			{canEdit ? (
				<Select value={member.role} onValueChange={(v) => onRole(member.id, String(v) as TeamRole)}>
					<SelectTrigger aria-label={t("team.roleFor", { who })} className="h-7 w-24 text-xs">
						<SelectValue>
							{(value: string | null) => {
								const r = ROLES.find((x) => x.value === value);
								return r ? t(r.labelKey) : null;
							}}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{ROLES.map((r) => (
							<SelectItem key={r.value} value={r.value}>
								{t(r.labelKey)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : (
				<span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium">
					{t(ROLES.find((x) => x.value === member.role)?.labelKey ?? "team.role.viewer")}
				</span>
			)}
			{canEdit ? (
				<button
					type="button"
					aria-label={t("team.removeWho", { who })}
					disabled={busy}
					onClick={() => onRemove(member.id)}
					className="text-muted-foreground hover:text-(--down) focus-visible:outline-ring rounded p-1 outline-offset-2 focus-visible:outline-2 disabled:opacity-40"
				>
					<Trash2 className="size-3.5" aria-hidden />
				</button>
			) : null}
		</li>
	);
};

export const TeamSection = ({ siteId }: { siteId: string }) => {
	const qc = useQueryClient();
	const t = useT();
	const canEdit = useSiteAccess(siteId).can.owner;
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<TeamRole>("viewer");

	const roleLabel = (value: string): string => {
		const match = ROLES.find((r) => r.value === value);
		return match ? t(match.labelKey) : value;
	};

	const { data, isLoading } = useQuery({
		enabled: Boolean(siteId),
		queryFn: () => fetchTeam(siteId),
		queryKey: ["legacy", "team", siteId],
		staleTime: 30_000,
	});

	const invalidate = { queryKey: ["legacy", "team", siteId] };
	const emailOk = EMAIL_RE.test(email.trim());

	const inviteMut = useMutation({
		mutationFn: () => inviteTeamMember(siteId, email.trim(), role),
		onSuccess: (res) => {
			qc.invalidateQueries(invalidate);
			toast.success(t("team.inviteSent", { email: res.email, role: roleLabel(res.role) }));
			setEmail("");
		},
		onError: (e) => toast.error(errMsg(e, t("team.inviteFailed"))),
	});

	const roleMut = useMutation({
		mutationFn: ({ id, next }: { id: string; next: TeamRole }) => updateTeamMemberRole(id, next),
		onSuccess: () => {
			qc.invalidateQueries(invalidate);
			toast.success(t("team.roleUpdated"));
		},
		onError: (e) => {
			qc.invalidateQueries(invalidate);
			toast.error(errMsg(e, t("team.roleFailed")));
		},
	});

	const removeMut = useMutation({
		mutationFn: (id: string) => removeTeamMember(id),
		onSuccess: () => {
			qc.invalidateQueries(invalidate);
			toast.success(t("team.removed"));
		},
		onError: (e) => toast.error(errMsg(e, t("team.removeFailed"))),
	});

	const submitInvite = () => {
		if (!emailOk) {
			toast.error(t("team.enterValidEmail"));
			return;
		}
		inviteMut.mutate();
	};

	return (
		<Panel title={t("team.title")} hint={t("team.hint")}>
			{!siteId ? (
				<p className="text-muted-foreground py-4 text-center text-xs">{t("team.connectSite")}</p>
			) : (
				<>
					{canEdit ? (
						<div className="mb-2.5 flex flex-wrap items-center gap-2">
							<span className="text-muted-foreground flex items-center gap-1 text-xs">
								<UserPlus className="size-3.5" aria-hidden />
								{t("team.invite")}
							</span>
							<Input
								type="email"
								value={email}
								placeholder={t("team.emailPlaceholder")}
								aria-label={t("team.inviteeEmail")}
								onChange={(e) => setEmail(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										submitInvite();
									}
								}}
								className={`h-8 w-56 text-xs ${email && !emailOk ? "border-(--down)" : ""}`}
							/>
							<Select value={role} onValueChange={(v) => setRole(String(v) as TeamRole)}>
								<SelectTrigger aria-label={t("team.inviteeRole")} className="h-8 w-28 text-xs">
									<SelectValue>
										{(value: string | null) => {
											const r = ROLES.find((x) => x.value === value);
											return r ? t(r.labelKey) : null;
										}}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{ROLES.map((r) => (
										<SelectItem key={r.value} value={r.value}>
											{t(r.labelKey)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Button
								size="sm"
								className="h-8 text-xs"
								disabled={!emailOk || inviteMut.isPending}
								onClick={submitInvite}
							>
								{t("team.sendInvite")}
							</Button>
							{email && !emailOk ? (
								<span className="text-(--down) text-[11px]">{t("team.invalidEmail")}</span>
							) : null}
						</div>
					) : null}

					{isLoading ? (
						<p className="text-muted-foreground py-3 text-center text-xs">{t("team.loading")}</p>
					) : (
						<ul className="space-y-0.5">
							{data?.owner ? (
								<li className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-lg px-2.5 py-2">
									<span className="min-w-0 flex-1">
										<span className="block truncate text-xs font-medium">
											{data.owner.name || data.owner.email}
										</span>
										<span className="text-muted-foreground block truncate font-mono text-[11px]">
											{data.owner.email}
										</span>
									</span>
									<span className="bg-(--up)/10 text-(--up) inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
										<ShieldCheck className="size-3" aria-hidden />
										{t("team.role.owner")}
									</span>
								</li>
							) : null}
							{(data?.members ?? []).map((m) => (
								<MemberRow
									key={m.id}
									member={m}
									busy={roleMut.isPending || removeMut.isPending}
									canEdit={canEdit}
									onRole={(id, next) => roleMut.mutate({ id, next })}
									onRemove={(id) => removeMut.mutate(id)}
								/>
							))}
							{data && !data.owner && data.members.length === 0 ? (
								<li className="text-muted-foreground py-2 text-center text-xs">
									{t("team.empty")}
								</li>
							) : null}
						</ul>
					)}
					<p className="text-muted-foreground mt-2 text-[11px]">{t("team.note")}</p>
				</>
			)}
		</Panel>
	);
};
