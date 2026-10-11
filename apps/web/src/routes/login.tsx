import { createFileRoute } from "@tanstack/react-router";

import { AuthForm, validateAuthSearch } from "@/components/auth-form";

export const Route = createFileRoute("/login")({
	validateSearch: validateAuthSearch,
	component: Login,
	head: () => ({ meta: [{ title: "Sign in · RevKlik" }] }),
});

function Login() {
	const search = Route.useSearch();
	return <AuthForm mode="sign-in" search={search} />;
}
