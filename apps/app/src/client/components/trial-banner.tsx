import { useState } from "react";

export function TrialBanner({ days, onUpgrade }: { days: number; onUpgrade: () => void }) {
	const [dismissed, setDismissed] = useState(() => {
		try {
			return sessionStorage.getItem("kp_trial_dismissed") === "1";
		} catch {
			return false;
		}
	});

	if (dismissed) return null;

	const dismiss = () => {
		setDismissed(true);
		try {
			sessionStorage.setItem("kp_trial_dismissed", "1");
		} catch {
			/* ignore */
		}
	};

	return (
		<div className="trial-banner">
			<div className="trial-banner-icon">
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="#34d399"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="10" />
					<path d="M12 6v6l4 2" />
				</svg>
			</div>
			<div className="trial-banner-text">
				<strong>
					{days} day{days === 1 ? "" : "s"} left
				</strong>{" "}
				on your free trial — upgrade to keep access
			</div>
			<button type="button" className="trial-banner-upgrade" onClick={onUpgrade}>
				Upgrade Now
			</button>
			<button type="button" className="trial-banner-dismiss" onClick={dismiss} aria-label="Dismiss">
				&times;
			</button>
		</div>
	);
}
