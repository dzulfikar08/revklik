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

import { Panel } from "./ui";

const ROLES: readonly { value: TeamRole; label: string }[] = [
	{ value: "admin", label: "Admin" },
	{ value: "editor", label: "Editor" },
	{ value: "viewer", label: "Viewer" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const errMsg = (e: unknown, fallback: string): string =>
	e instanceof LegacyApiError ? e.message : fallback;

const roleBadge = "bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium";

const MemberRow = ({
	member,
	onRole,
	onRemove,
	busy,
}: {
	member: LegacyTeamMember;
	onRole: (id: string, role: TeamRole) => void;
	onRemove: (id: string) => void;
	busy: boolean;
}) => (
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
			{member.accepted_at ? "Active" : "Invited"}
		</span>
		<Select value={member.role} onValueChange={(v) => onRole(member.id, String(v) as TeamRole)}>
			<SelectTrigger
				aria-label={`Role for ${member.email ?? member.name ?? "member"}`}
				className="h-7 w-24 text-xs"
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{ROLES.map((r) => (
					<SelectItem key={r.value} value={r.value}>
						{r.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
		<button
			type="button"
			aria-label={`Remove ${member.email ?? member.name ?? "member"}`}
			disabled={busy}
			onClick={() => onRemove(member.id)}
			className="text-muted-foreground hover:text-(--down) focus-visible:outline-ring rounded p-1 outline-offset-2 focus-visible:outline-2 disabled:opacity-40"
		>
			<Trash2 className="size-3.5" aria-hidden />
		</button>
	</li>
);

export const TeamSection = ({ siteId }: { siteId: string }) => {
	const qc = useQueryClient();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<TeamRole>("viewer");

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
			toast.success(`Invite sent to ${res.email} as ${res.role}`);
			setEmail("");
		},
		onError: (e) => toast.error(errMsg(e, "Failed to send invite")),
	});

	const roleMut = useMutation({
		mutationFn: ({ id, next }: { id: string; next: TeamRole }) => updateTeamMemberRole(id, next),
		onSuccess: () => {
			qc.invalidateQueries(invalidate);
			toast.success("Role updated");
		},
		onError: (e) => {
			qc.invalidateQueries(invalidate);
			toast.error(errMsg(e, "Failed to update role"));
		},
	});

	const removeMut = useMutation({
		mutationFn: (id: string) => removeTeamMember(id),
		onSuccess: () => {
			qc.invalidateQueries(invalidate);
			toast.success("Member removed");
		},
		onError: (e) => toast.error(errMsg(e, "Failed to remove member")),
	});

	const submitInvite = () => {
		if (!emailOk) {
			toast.error("Enter a valid email address");
			return;
		}
		inviteMut.mutate();
	};

	return (
		<Panel title="Team" hint="people with access to this site">
			{!siteId ? (
				<p className="text-muted-foreground py-4 text-center text-xs">
					Connect a site to manage its team.
				</p>
			) : (
				<>
					<div className="mb-2.5 flex flex-wrap items-center gap-2">
						<span className="text-muted-foreground flex items-center gap-1 text-xs">
							<UserPlus className="size-3.5" aria-hidden />
							Invite
						</span>
						<Input
							type="email"
							value={email}
							placeholder="teammate@example.com"
							aria-label="Invitee email"
							onChange={(e) => setEmail(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									submitInvite();
								}
							}}
							className={`h-8 w-56 text-xs ${email && !emailOk ? "border-(--down)" : ""}`}
						/>
						<Select value={role} onValueChange={(v) => setRole(String(v) as TeamRole)}>
							<SelectTrigger aria-label="Invitee role" className="h-8 w-28 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ROLES.map((r) => (
									<SelectItem key={r.value} value={r.value}>
										{r.label}
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
							Send invite
						</Button>
						{email && !emailOk ? (
							<span className="text-(--down) text-[11px]">Invalid email</span>
						) : null}
					</div>

					{isLoading ? (
						<p className="text-muted-foreground py-3 text-center text-xs">Loading…</p>
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
										Owner
									</span>
								</li>
							) : null}
							{(data?.members ?? []).map((m) => (
								<MemberRow
									key={m.id}
									member={m}
									busy={roleMut.isPending || removeMut.isPending}
									onRole={(id, next) => roleMut.mutate({ id, next })}
									onRemove={(id) => removeMut.mutate(id)}
								/>
							))}
							{data && !data.owner && data.members.length === 0 ? (
								<li className="text-muted-foreground py-2 text-center text-xs">
									No team members yet.
								</li>
							) : null}
						</ul>
					)}
					<p className="text-muted-foreground mt-2 text-[11px]">
						Invitees need an existing revklik account. Owners can change roles and remove members.
					</p>
				</>
			)}
		</Panel>
	);
};
