import "@/unistyles";
import { QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { Redirect, router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Alert } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useUnistyles } from "react-native-unistyles";

import { initActiveSite } from "@/lib/active-site";
import { initAuth, useAuth } from "@/lib/auth";
import { configureNotifications, isDefaultTap, PushError, registerForPush } from "@/lib/push";
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
			await Promise.all([
				initAuth(),
				initActiveSite(),
				configureNotifications().catch(() => undefined),
			]);
			await SplashScreen.hideAsync();
		};
		boot();
	}, []);

	// Sign-in (or a cold start with a stored session) registers this device for sale alerts.
	// Denied permission / simulators are shown in Settings; anything else is a setup problem.
	useEffect(() => {
		if (status !== "signed-in") {
			return;
		}
		registerForPush().catch((error: unknown) => {
			if (error instanceof PushError && error.status !== "error") {
				return;
			}
			Alert.alert(
				"Push notifications unavailable",
				error instanceof Error ? error.message : "Couldn't register this device for sale alerts.",
			);
		});
	}, [status]);

	// Tapping a sale/refund alert opens Earnings (cold start and warm).
	const lastResponse = Notifications.useLastNotificationResponse();
	useEffect(() => {
		if (status !== "signed-in" || !lastResponse || !isDefaultTap(lastResponse)) {
			return;
		}
		router.push("/earnings");
		Notifications.clearLastNotificationResponse();
	}, [lastResponse, status]);

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
