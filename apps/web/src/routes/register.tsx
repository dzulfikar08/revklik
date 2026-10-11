import { createFileRoute } from "@tanstack/react-router";

import { AuthForm, validateAuthSearch } from "@/components/auth-form";

/** Sign-up entry point for the pricing page (?plan=) and affiliate links (?ref=). */
export const Route = createFileRoute("/register")({
	validateSearch: validateAuthSearch,
	component: Register,
	head: () => ({ meta: [{ title: "Create account · RevKlik" }] }),
});

function Register() {
	const search = Route.useSearch();
	return <AuthForm mode="sign-up" search={search} />;
}
