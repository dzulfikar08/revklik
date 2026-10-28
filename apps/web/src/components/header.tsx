import { BrandMark } from "@revklik/ui/components/brand-mark";
import { Link } from "@tanstack/react-router";

import UserMenu from "./user-menu";

export default function Header() {
	return (
		<div className="bg-card border-border border-b">
			<div className="flex flex-row items-center justify-between px-3 py-1.5">
				<Link to="/analytics" className="flex items-center gap-2">
					<BrandMark className="h-5 w-auto" />
					<span className="text-foreground text-sm font-semibold tracking-tight">RevKlik</span>
				</Link>
				<UserMenu />
			</div>
		</div>
	);
}
