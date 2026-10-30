import { createFileRoute } from "@tanstack/react-router";

import { AuthForm } from "@/components/auth-form";
import { redirectIfSignedIn } from "@/lib/auth-guard";
import { authDocumentTitle } from "@/lib/auth-page";
import { validateAuthSearch } from "@/lib/auth-search";
import { getLocale } from "@/lib/i18n";

export const Route = createFileRoute("/login")({
	validateSearch: validateAuthSearch,
	beforeLoad: ({ search }) => redirectIfSignedIn(search),
	component: Login,
	head: () => ({ meta: [{ title: authDocumentTitle(getLocale(), "signIn") }] }),
});

function Login() {
	const search = Route.useSearch();
	return <AuthForm mode="sign-in" search={search} />;
}
