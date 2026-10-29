/** Up to two uppercase letters for an avatar, from a name or else an email. */
export const initialsOf = (name: string, email: string): string => {
	const source = name.trim() || email.trim();
	const parts = source.split(/[\s@._-]+/u).filter(Boolean);
	const letters =
		parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : source.slice(0, 2);
	return letters.toUpperCase() || "?";
};
