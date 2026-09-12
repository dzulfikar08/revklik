import { Redirect } from "expo-router";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { AuthScreen } from "@/components/auth-screen";
import { useAuth } from "@/lib/auth";

const SignInRoute = () => {
	const { theme } = useUnistyles();
	const { status } = useAuth();

	if (status === "signed-in") {
		return <Redirect href="/(tabs)" />;
	}

	return (
		<View style={[styles.root, { backgroundColor: theme.colors.background }]}>
			<AuthScreen />
		</View>
	);
};

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
});

export default SignInRoute;
