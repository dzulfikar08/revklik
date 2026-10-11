import { createFileRoute } from "@tanstack/react-router";

import { AuthForm } from "@/components/auth-form";
import { redirectIfSignedIn } from "@/lib/auth-guard";
import { validateAuthSearch } from "@/lib/auth-search";

/** Sign-up entry point for the pricing page (?plan=) and affiliate links (?ref=). */
export const Route = createFileRoute("/register")({
	validateSearch: validateAuthSearch,
	beforeLoad: ({ search }) => redirectIfSignedIn(search),
	component: Register,
	head: () => ({ meta: [{ title: "Create account · RevKlik" }] }),
});

function Register() {
	const search = Route.useSearch();
	return <AuthForm mode="sign-up" search={search} />;
}
