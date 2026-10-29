import { initialsOf } from "@/lib/initials";

/** Initials in a circle; accounts carry no uploaded photo in the dashboard. */
export const AccountAvatar = ({
	name,
	email,
	className = "size-8",
}: {
	name: string;
	email: string;
	className?: string;
}) => (
	<span
		aria-hidden
		className={`bg-muted text-foreground ring-foreground/10 inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-1 ${className}`}
	>
		{initialsOf(name, email)}
	</span>
);
