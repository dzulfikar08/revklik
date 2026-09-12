import { Button } from "@revklik/ui/components/button";
import { LogOut } from "lucide-react";

import { getLegacyUser, LEGACY_API_BASE, legacySignOut } from "@/lib/legacy/api";

import { EmailReportsSection } from "./email-reports";
import { TeamSection } from "./team";

import { Panel } from "./ui";

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
		await legacySignOut();
		onSignOut();
	};
	const user = getLegacyUser();

	return (
		<main className="mx-auto max-w-7xl px-3 pt-3 pb-6 md:px-4">
			<div className="mb-2.5">
				<h1 className="text-lg font-semibold tracking-tight">Settings</h1>
				<p className="text-muted-foreground text-xs">
					Connected to your revklik account — live data from klikapa-db
				</p>
			</div>
			<div className="grid gap-2.5 md:grid-cols-2">
				<Panel title="Account">
					<dl className="grid gap-2 text-[13px]">
						<div className="flex items-center justify-between gap-3">
							<dt className="text-muted-foreground text-xs">Name</dt>
							<dd className="truncate font-medium">{user?.name ?? "—"}</dd>
						</div>
						<div className="flex items-center justify-between gap-3">
							<dt className="text-muted-foreground text-xs">Email</dt>
							<dd className="truncate font-mono text-xs">{user?.email ?? "—"}</dd>
						</div>
						<div className="flex items-center justify-between gap-3">
							<dt className="text-muted-foreground text-xs">Role</dt>
							<dd className="font-mono text-xs">{user?.role ?? "—"}</dd>
						</div>
					</dl>
				</Panel>

				<Panel title="Data source">
					<dl className="grid gap-2 text-[13px]">
						<div className="flex items-center justify-between gap-3">
							<dt className="text-muted-foreground text-xs">API</dt>
							<dd className="truncate font-mono text-xs">{LEGACY_API_BASE}</dd>
						</div>
						<div className="flex items-center justify-between gap-3">
							<dt className="text-muted-foreground text-xs">Active site</dt>
							<dd className="truncate font-mono text-xs">{site ?? "—"}</dd>
						</div>
						<div className="flex items-center justify-between gap-3">
							<dt className="text-muted-foreground text-xs">Mode</dt>
							<dd className="flex items-center gap-1.5 font-mono text-xs">
								<span className="relative flex size-2">
									<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--up) opacity-50 motion-reduce:animate-none" />
									<span className="relative inline-flex size-2 rounded-full bg-(--up)" />
								</span>
								live
							</dd>
						</div>
					</dl>
				</Panel>

				<div className="md:col-span-2">
					<EmailReportsSection siteId={siteId} />
				</div>

				<div className="md:col-span-2">
					<TeamSection siteId={siteId} />
				</div>

				<div className="md:col-span-2">
					<Panel title="Session">
						<Button variant="outline" size="sm" onClick={() => void handleSignOut()}>
							<LogOut className="size-3.5" aria-hidden />
							Sign out
						</Button>
					</Panel>
				</div>
			</div>
		</main>
	);
};
