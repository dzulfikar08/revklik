import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  beforeLoad: async () => {
    // Dynamic import keeps better-auth out of the entry chunk.
    const { authClient } = await import("@/lib/auth-client");
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({
        to: "/login",
      });
    }
    const { data: customerState } = await authClient.customer.state();
    return { session, customerState };
  },
});

function AuthLayout() {
  return <Outlet />;
}
