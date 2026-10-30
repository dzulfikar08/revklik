import { Input } from "@revklik/ui/components/input";
import { Label } from "@revklik/ui/components/label";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { authInputClass } from "@/components/auth-shell";
import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";

interface AuthFieldProps {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	type?: "text" | "email" | "password";
	autoComplete?: string;
	placeholder?: string;
	autoFocus?: boolean;
	/** Message key of what is wrong, if anything. Shown inline and read out. */
	error?: MessageKey;
	/** Always-visible helper line under the field (e.g. the password rule). */
	hint?: string;
	/** Sits opposite the label, e.g. the "Forgot password?" link. */
	labelAside?: ReactNode;
}

/**
 * Labelled input with a localized inline error instead of the browser's own
 * validation bubble. The error and hint are tied to the input with
 * aria-describedby; the error line is a polite live region so a fix that
 * clears it is not silent either. Password fields get a 44px show/hide toggle.
 */
export const AuthField = ({
	id,
	label,
	value,
	onChange,
	type = "text",
	autoComplete,
	placeholder,
	autoFocus,
	error,
	hint,
	labelAside,
}: AuthFieldProps) => {
	const t = useT();
	const [revealed, setRevealed] = useState(false);
	const isPassword = type === "password";
	const errorId = `${id}-error`;
	const hintId = `${id}-hint`;
	const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

	return (
		<div>
			<div className="flex items-center justify-between gap-2">
				<Label htmlFor={id}>{label}</Label>
				{labelAside}
			</div>
			<div className="relative mt-1.5">
				<Input
					id={id}
					className={`${authInputClass} ${isPassword ? "pe-11" : ""}`}
					type={isPassword && revealed ? "text" : type}
					autoComplete={autoComplete}
					placeholder={placeholder}
					autoFocus={autoFocus}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					aria-invalid={error ? true : undefined}
					aria-describedby={describedBy || undefined}
					spellCheck={isPassword || type === "email" ? false : undefined}
					autoCapitalize={type === "email" ? "none" : undefined}
				/>
				{isPassword ? (
					<button
						type="button"
						aria-pressed={revealed}
						aria-label={t("auth.showPassword")}
						onClick={() => setRevealed((shown) => !shown)}
						className="text-muted-foreground hover:text-foreground focus-visible:outline-ring absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center rounded-md outline-offset-[-2px] transition-colors duration-150 focus-visible:outline-2"
					>
						{revealed ? (
							<EyeOff className="size-4" aria-hidden />
						) : (
							<Eye className="size-4" aria-hidden />
						)}
					</button>
				) : null}
			</div>
			{hint ? (
				<p id={hintId} className="text-muted-foreground mt-1.5 text-[13px]">
					{hint}
				</p>
			) : null}
			<div aria-live="polite">
				{error ? (
					<p id={errorId} className="text-destructive mt-1.5 text-[13px]">
						{t(error)}
					</p>
				) : null}
			</div>
		</div>
	);
};
