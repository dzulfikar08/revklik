import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout route for /settings/* — children (index, api-tokens, api-playground)
// render through this Outlet. Page content lives in settings.index.tsx.
export const Route = createFileRoute("/settings")({
	component: SettingsLayout,
});

function SettingsLayout() {
	return <Outlet />;
}
