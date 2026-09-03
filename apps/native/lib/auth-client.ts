import { expoClient } from "@better-auth/expo/client";
import { env } from "@revklik-new/env/native";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

export const authClient = createAuthClient({
  baseURL: env.EXPO_PUBLIC_SERVER_URL,
  plugins: [
    expoClient({
      scheme: Constants.expoConfig?.scheme as string,
      storagePrefix: Constants.expoConfig?.scheme as string,
      storage: SecureStore,
    }),
  ],
});

type PolarLinkResponse = {
  url: string;
  redirect: boolean;
};

type PolarClientResponse<T> = Promise<{
  data: T | null;
  error: { message?: string } | null;
}>;

type PolarNativeClient = typeof authClient & {
  checkout: (data: {
    slug?: string;
    products?: string[] | string;
    redirect?: boolean;
    successUrl?: string;
    returnUrl?: string;
  }) => PolarClientResponse<PolarLinkResponse>;
  customer: {
    portal: (data?: { redirect?: boolean }) => PolarClientResponse<PolarLinkResponse>;
  };
};

export const polarNativeClient = authClient as PolarNativeClient;
