import { createFileRoute, redirect } from "@tanstack/react-router";

/* Post-login landing: the product lives at /analytics. */
export const Route = createFileRoute("/_auth/dashboard")({
  beforeLoad: () => {
    throw redirect({ to: "/analytics" });
  },
});
