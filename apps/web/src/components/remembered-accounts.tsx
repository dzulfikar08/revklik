import { useEffect, useState } from "react";

import { AccountAvatar } from "@/components/analytics/account-avatar";
import { useT } from "@/lib/i18n";
import { continueAsRemembered, fetchRememberedAccounts } from "@/lib/legacy/accounts";
import type { LegacyUser } from "@/lib/legacy/api";

/**
 * Sign-in shortcut for accounts the user chose to keep signed in on this
 * device ("Keep my other accounts signed in" at sign-out). Sign-out revokes
 * everything else, so this is empty on a default sign-out and renders nothing.
 */
export const RememberedAccounts = ({ onContinue }: { onContinue: () => void }) => {
	const t = useT();
	const [accounts, setAccounts] = useState<LegacyUser[]>([]);

	useEffect(() => {
		let active = true;
		void fetchRememberedAccounts().then((found) => {
			if (active) {
				setAccounts(found);
			}
		});
		return () => {
			active = false;
		};
	}, []);

	if (accounts.length === 0) {
		return null;
	}

	return (
		<section aria-labelledby="remembered-accounts-title" className="grid gap-2">
			<h2 id="remembered-accounts-title" className="text-muted-foreground text-xs font-medium">
				{t("accounts.continueTitle")}
			</h2>
			<ul className="grid gap-1.5">
				{accounts.map((user) => (
					<li key={user.id}>
						<button
							type="button"
							onClick={() => {
								if (continueAsRemembered(user)) {
									onContinue();
								}
							}}
							className="bg-muted/40 hover:bg-muted/70 focus-visible:outline-ring flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start outline-offset-2 transition-colors focus-visible:outline-2"
						>
							<AccountAvatar name={user.name} email={user.email} />
							<span className="min-w-0 flex-1">
								<span className="block truncate text-[13px] font-medium">
									{t("accounts.continueAs", { name: user.name })}
								</span>
								<span className="text-muted-foreground block truncate font-mono text-[11px]">
									{user.email}
								</span>
							</span>
						</button>
					</li>
				))}
			</ul>
			<div className="flex items-center gap-3" role="separator" aria-label={t("auth.or")}>
				<span className="bg-border h-px flex-1" aria-hidden />
				<span className="text-muted-foreground text-xs" aria-hidden>
					{t("auth.or")}
				</span>
				<span className="bg-border h-px flex-1" aria-hidden />
			</div>
		</section>
	);
};
