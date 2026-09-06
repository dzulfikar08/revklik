import "@/unistyles";
import { QueryClientProvider } from "@tanstack/react-query";
import { Redirect, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useUnistyles } from "react-native-unistyles";

import { initActiveSite } from "@/lib/active-site";
import { initAuth, useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/query-client";

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

const RootLayout = () => {
  const { theme } = useUnistyles();
  const { status } = useAuth();

  useEffect(() => {
    const boot = async () => {
      await Promise.all([initAuth(), initActiveSite()]);
      await SplashScreen.hideAsync();
    };
    boot();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* oxlint-disable-next-line react/style-prop-object -- expo-status-bar takes a string style */}
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: {
              backgroundColor: theme.colors.background,
            },
            headerTintColor: theme.colors.foreground,
            headerTitleStyle: {
              color: theme.colors.foreground,
            },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack>
        {status === "signed-out" ? <Redirect href="/sign-in" /> : null}
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
};

export default RootLayout;
