import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old bookmarks hit the domain root — send them straight to the app. */
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/analytics" });
  },
});
