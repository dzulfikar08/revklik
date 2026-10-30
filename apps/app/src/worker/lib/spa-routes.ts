// Paths the dashboard SPA (apps/web/src/routes) answers. Any other non-/api path
// gets the SPA shell with status 404, so unknown URLs are real 404s instead of
// soft 404s (the shell renders the branded not-found view). spa-routes.test.ts
// reads the route files and fails when a route is missing here.
const SPA_ROUTE =
	/^\/(?:(?:login|register|reset-password|verify-email|success|demo)|analytics(?:\/.*)?|public\/[^/]+)?\/?$/;

export const isSpaRoute = (pathname: string): boolean => SPA_ROUTE.test(pathname);
