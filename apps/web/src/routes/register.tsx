import { createFileRoute } from "@tanstack/react-router";

import { AuthForm } from "@/components/auth-form";
import { redirectIfSignedIn } from "@/lib/auth-guard";
import { authDocumentTitle } from "@/lib/auth-page";
import { validateAuthSearch } from "@/lib/auth-search";
import { getLocale } from "@/lib/i18n";

/** Sign-up entry point for the pricing page (?plan=) and affiliate links (?ref=). */
export const Route = createFileRoute("/register")({
	validateSearch: validateAuthSearch,
	beforeLoad: ({ search }) => redirectIfSignedIn(search),
	component: Register,
	head: () => ({ meta: [{ title: authDocumentTitle(getLocale(), "signUp") }] }),
});

function Register() {
	const search = Route.useSearch();
	return <AuthForm mode="sign-up" search={search} />;
}
