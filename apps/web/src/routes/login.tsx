import { createFileRoute } from "@tanstack/react-router";

import { AuthForm } from "@/components/auth-form";
import { redirectIfSignedIn } from "@/lib/auth-guard";
import { validateAuthSearch } from "@/lib/auth-search";

export const Route = createFileRoute("/login")({
	validateSearch: validateAuthSearch,
	beforeLoad: ({ search }) => redirectIfSignedIn(search),
	component: Login,
	head: () => ({ meta: [{ title: "Sign in · RevKlik" }] }),
});

function Login() {
	const search = Route.useSearch();
	return <AuthForm mode="sign-in" search={search} />;
}
