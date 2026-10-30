import { Button } from "@revklik/ui/components/button";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { LegacyApiError } from "@/lib/legacy/api";

import { SkeletonRows } from "./ui";

const SERVER_ERROR = 500;
const TOO_MANY = 429;

/** Plain-language cause for a failed load; never the raw fetch message. */
export const loadErrorKey = (error: unknown): MessageKey => {
	if (error instanceof LegacyApiError) {
		if (error.status === TOO_MANY) {
			return "state.errorBusy";
		}
		if (error.status >= SERVER_ERROR) {
			return "state.errorServer";
		}
		return "state.errorGeneric";
	}
	if (error instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine)) {
		return "state.errorOffline";
	}
	return "state.errorGeneric";
};

export const ErrorBlock = ({
	error,
	onRetry,
	retrying = false,
	className = "",
}: {
	error: unknown;
	onRetry: () => void;
	retrying?: boolean;
	className?: string;
}) => {
	const t = useT();
	return (
		<div
			role="alert"
			className={`flex flex-col items-center justify-center gap-3 px-4 py-6 text-center ${className}`}
		>
			<span className="bg-(--down)/10 flex size-9 items-center justify-center rounded-xl text-(--down)">
				<AlertTriangle className="size-4" aria-hidden />
			</span>
			<div className="space-y-0.5">
				<p className="text-sm font-medium">{t("state.errorTitle")}</p>
				<p className="text-muted-foreground max-w-xs text-[13px]">{t(loadErrorKey(error))}</p>
			</div>
			<Button
				variant="outline"
				className="pointer-coarse:h-11 h-9 px-4 text-[13px]"
				disabled={retrying}
				onClick={onRetry}
			>
				{retrying ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
				{t("state.retry")}
			</Button>
		</div>
	);
};

export const EmptyBlock = ({
	children,
	action,
	className = "",
}: {
	children: ReactNode;
	action?: { label: string; onClick: () => void };
	className?: string;
}) => (
	<div
		className={`flex flex-col items-center justify-center gap-3 px-4 py-6 text-center ${className}`}
	>
		<p className="text-muted-foreground max-w-xs text-[13px]">{children}</p>
		{action ? (
			<Button
				variant="outline"
				className="pointer-coarse:h-11 h-9 px-4 text-[13px]"
				onClick={action.onClick}
			>
				{action.label}
			</Button>
		) : null}
	</div>
);

/**
 * One body for every data panel: skeleton while loading, an error with Retry
 * when the request failed (never "no traffic"), a cause plus one action when
 * there is nothing to show, else the content. `boxClass` pins the box so the
 * panel does not jump between states.
 */
export const PanelState = ({
	loading,
	error,
	onRetry,
	retrying,
	hasData,
	emptyText,
	emptyAction,
	skeleton,
	boxClass = "",
	children,
}: {
	loading: boolean;
	error?: unknown;
	onRetry?: () => void;
	retrying?: boolean;
	hasData: boolean;
	emptyText: ReactNode;
	emptyAction?: { label: string; onClick: () => void };
	skeleton?: ReactNode;
	boxClass?: string;
	children: ReactNode;
}) => {
	let body: ReactNode = children;
	if (loading) {
		body = skeleton ?? <SkeletonRows />;
	} else if (error && onRetry && !hasData) {
		body = <ErrorBlock error={error} onRetry={onRetry} retrying={retrying} />;
	} else if (!hasData) {
		body = <EmptyBlock action={emptyAction}>{emptyText}</EmptyBlock>;
	}
	return <div className={boxClass}>{body}</div>;
};
