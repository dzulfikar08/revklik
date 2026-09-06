import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  client: {
    /** klikapa production Worker API base (overridable for dev/staging). */
    EXPO_PUBLIC_KLIKAPA_API_URL: z.url().optional(),
  },
  clientPrefix: "EXPO_PUBLIC_",
  emptyStringAsUndefined: true,
  runtimeEnv: {
    EXPO_PUBLIC_KLIKAPA_API_URL: process.env.EXPO_PUBLIC_KLIKAPA_API_URL,
  },
});
