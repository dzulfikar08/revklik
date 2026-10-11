import { setLocale, useLocale, useT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";

const OPTIONS: { value: Locale; label: string; name: string }[] = [
	{ value: "id", label: "ID", name: "Bahasa Indonesia" },
	{ value: "en", label: "EN", name: "English" },
];

/** Two-button ID/EN switch; the choice persists in localStorage. */
export const LocaleToggle = ({ className }: { className?: string }) => {
	const locale = useLocale();
	const t = useT();
	return (
		<div
			role="group"
			aria-label={t("locale.label")}
			className={`bg-muted/70 inline-flex rounded-full p-0.5 ${className ?? ""}`}
		>
			{OPTIONS.map((o) => (
				<button
					key={o.value}
					type="button"
					lang={o.value}
					aria-label={o.name}
					aria-pressed={locale === o.value}
					onClick={() => setLocale(o.value)}
					className={`focus-visible:outline-ring min-h-7 rounded-full px-2.5 font-mono text-[11px] font-medium outline-offset-2 focus-visible:outline-2 ${
						locale === o.value
							? "bg-card text-foreground ring-foreground/10 ring-1"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
};
