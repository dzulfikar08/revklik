/**
 * TanStack Query client for the klikapa API.
 * A 401 anywhere means the persisted token is dead — flip the auth store to
 * signed-out so the root gate routes to sign-in (mirrors the web guard).
 */
import { QueryCache, QueryClient } from "@tanstack/react-query";

import { authSessionExpired } from "./auth";
import { LegacyApiError } from "./klikapa/api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 60_000 },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof LegacyApiError && error.status === 401) {
        authSessionExpired();
      }
    },
  }),
});
