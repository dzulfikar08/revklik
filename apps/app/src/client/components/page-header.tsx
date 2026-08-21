import { useRouter } from "@tanstack/react-router";

interface PageHeaderProps {
	title: string;
	subtitle?: string;
	backTo?: string;
	action?: React.ReactNode;
	badge?: string;
}

export function PageHeader({ title, subtitle, backTo, action, badge }: PageHeaderProps) {
	const router = useRouter();

	return (
		<div className="page-header">
			<div className="page-header-inner">
				<div className="page-header-left">
					{backTo && (
						<button
							type="button"
							className="page-header-back"
							onClick={() => (backTo ? router.navigate({ to: backTo }) : router.history.back())}
							aria-label="Go back"
						>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
								<path
									d="M10 3L5 8L10 13"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
						</button>
					)}
					<div className="page-header-brand">
						<img src="/revklik.webp" alt="" className="page-header-logo" />
						<div className="page-header-divider" />
					</div>
					<div className="page-header-text">
						<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
							<h1 className="page-header-title">{title}</h1>
							{badge && <span className="page-header-badge">{badge}</span>}
						</div>
						{subtitle && <p className="page-header-sub">{subtitle}</p>}
					</div>
				</div>
				{action && <div className="page-header-action">{action}</div>}
			</div>
		</div>
	);
}
