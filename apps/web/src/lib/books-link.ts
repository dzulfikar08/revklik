/** Where RevKlik Books lives on the hosted product. */
const HOSTED_BOOKS_URL = "https://books.revklik.com";

/** Path on Books that starts "Masuk dengan RevKlik" (OAuth against this app's /oauth/authorize). */
const BOOKS_SIGN_IN_PATH = "/auth/revklik/start";

/**
 * Link target of the account menu's "RevKlik Books" item. `VITE_BOOKS_URL` points
 * it at another deployment (local dev, a staging Books); without it only the hosted
 * product links to Books, because a self-hosted install has no Books client registered.
 */
export const booksSignInUrl = ({
	override,
	selfHosted,
}: {
	override: unknown;
	selfHosted: boolean;
}): string | null => {
	const configured = typeof override === "string" ? override.trim() : "";
	const base = configured || (selfHosted ? "" : HOSTED_BOOKS_URL);
	return base ? `${base.replace(/\/+$/u, "")}${BOOKS_SIGN_IN_PATH}` : null;
};
