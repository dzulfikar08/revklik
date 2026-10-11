import { Lock, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared bits for the Growth-gated panels (heatmap, recordings, AI insights,
 * predictions). A 403 from the API maps to GrowthPlanLockedError upstream;
 * these helpers render the locked presentation for it.
 */

/* Blurred stand-in for the feature area behind the upgrade overlay. */
const LockedPreview = () => (
	<div
		aria-hidden
		className="pointer-events-none flex select-none flex-col gap-2 p-3 opacity-50 blur-[5px]"
	>
		<div className="bg-muted h-20 rounded-lg" />
		<div className="flex gap-2">
			<div className="bg-muted h-9 flex-1 rounded-lg" />
			<div className="bg-muted h-9 flex-1 rounded-lg" />
			<div className="bg-muted h-9 flex-1 rounded-lg" />
		</div>
		<div className="bg-muted h-9 w-4/5 rounded-lg" />
		<div className="bg-muted h-9 w-3/5 rounded-lg" />
		<div className="bg-muted h-9 w-2/3 rounded-lg" />
	</div>
);

export const GrowthLocked = ({
	feature,
	onUpgrade,
	plan = "Growth",
}: {
	blurb?: string;
	feature: string;
	onUpgrade: () => void;
	/** Plan that unlocks the feature (Funnels unlock on Starter). */
	plan?: string;
}) => (
	<div className="relative min-h-52 overflow-hidden rounded-xl" role="status">
		<LockedPreview />
		<div className="bg-background/60 absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-4 text-center">
			<span className="bg-muted text-muted-foreground flex h-8 w-8 items-center justify-center rounded-lg">
				<Lock className="h-4 w-4" />
			</span>
			<p className="text-sm font-semibold">
				{feature} is a {plan} feature
			</p>
			<button
				type="button"
				onClick={onUpgrade}
				className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-ring mt-1 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2"
			>
				<Sparkles className="h-3.5 w-3.5" aria-hidden />
				Upgrade to {plan}
			</button>
		</div>
	</div>
);

export const GrowthMsg = ({ children }: { children: ReactNode }) => (
	<p className="text-muted-foreground py-6 text-center text-xs">{children}</p>
);

export const GrowthSkeleton = ({ rows = 3 }: { rows?: number }) => (
	<div className="flex flex-col gap-2" aria-hidden>
		{Array.from({ length: rows }, (_, i) => (
			<div
				key={i}
				className="bg-muted h-12 animate-pulse rounded-lg"
				style={{ opacity: 1 - i * 0.2 }}
			/>
		))}
	</div>
);
