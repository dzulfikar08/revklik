import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { z } from "zod";

import { Button, Input } from "@/components/ui";
import { authCompleteGoogle, authRegister, authSignIn, useAuth } from "@/lib/auth";
import { GOOGLE_AUTH_URL, LegacyApiError } from "@/lib/klikapa/api";

type Mode = "sign-in" | "sign-up";

const signInSchema = z.object({
	email: z.email("Enter a valid email address"),
	password: z.string().min(8, "Use at least 8 characters"),
});

const signUpSchema = signInSchema.extend({
	name: z.string().trim().min(1, "Name is required"),
});

/**
 * Google OAuth capture. The in-app auth session resolves when the browser
 * lands on a URL for this app; a `#token=…` fragment is parsed exactly like
 * the web root route. Today the klikapa worker redirects to the *web app*
 * instead of the app scheme, so openAuthSessionAsync never resolves with a
 * usable URL — the button surfaces that as a friendly hint until the server
 * gains a client-supplied post-auth redirect (see GOOGLE_AUTH_URL in
 * lib/klikapa/api.ts for the exact server need).
 */
const continueWithGoogle = async (): Promise<void> => {
	const callbackUrl = Linking.createURL("auth");
	const result = await WebBrowser.openAuthSessionAsync(GOOGLE_AUTH_URL, callbackUrl);
	if (result.type !== "success" || !result.url) {
		throw new Error("cancelled");
	}
	const hashIndex = result.url.indexOf("#token=");
	if (hashIndex === -1) {
		throw new Error("no-token");
	}
	const token = decodeURIComponent(
		result.url.slice(hashIndex + "#token=".length).split("&")[0] ?? "",
	);
	if (!token) {
		throw new Error("no-token");
	}
	await authCompleteGoogle(token);
};

const GoogleHint = ({ message }: { message: string }) => (
	<Text style={styles.googleHint}>{message}</Text>
);

export const AuthScreen = () => {
	const { status } = useAuth();
	const [mode, setMode] = useState<Mode>("sign-in");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [googleHint, setGoogleHint] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const submit = async () => {
		if (pending) {
			return;
		}
		setFormError(null);
		const schema = mode === "sign-in" ? signInSchema : signUpSchema;
		const parsed = schema.safeParse({
			email: email.trim(),
			name: name.trim(),
			password,
		});
		if (!parsed.success) {
			setFormError(parsed.error.issues[0]?.message ?? "Check the form and try again");
			return;
		}
		setPending(true);
		try {
			await (mode === "sign-in"
				? authSignIn(parsed.data.email, parsed.data.password)
				: authRegister(
						(parsed.data as { name?: string }).name ?? "",
						parsed.data.email,
						parsed.data.password,
					));
		} catch (error) {
			setFormError(
				error instanceof LegacyApiError ? error.message : "Couldn't sign you in — please try again",
			);
		}
		setPending(false);
	};

	const onGoogle = async () => {
		setGoogleHint(null);
		setFormError(null);
		setPending(true);
		try {
			await continueWithGoogle();
		} catch (error) {
			setGoogleHint(
				error instanceof Error && error.message === "cancelled"
					? null
					: "Google sign-in needs the server to redirect back to the app — use email and password for now.",
			);
		}
		setPending(false);
	};

	if (status === "loading") {
		return null;
	}

	return (
		<KeyboardAvoidingView behavior="height" style={styles.flex}>
			<ScrollView contentContainerStyle={styles.scroll}>
				<View style={styles.card}>
					<View style={styles.logo}>
						<Ionicons color="#F7A062" name="pulse" size={30} />
					</View>
					<Text style={styles.title}>
						{mode === "sign-in" ? "Welcome back" : "Create your account"}
					</Text>
					<Text style={styles.subtitle}>
						{mode === "sign-in"
							? "Sign in to your revklik analytics"
							: "Start your free 7-day trial — no card required"}
					</Text>

					<View style={styles.form}>
						{mode === "sign-up" ? (
							<Input
								autoCapitalize="words"
								onChangeText={setName}
								placeholder="Ada Lovelace"
								label="Name"
								value={name}
							/>
						) : null}
						<Input
							autoCapitalize="none"
							autoComplete="email"
							keyboardType="email-address"
							label="Email"
							onChangeText={setEmail}
							placeholder="you@example.com"
							value={email}
						/>
						<Input
							autoCapitalize="none"
							label="Password"
							onChangeText={setPassword}
							onSubmitEditing={() => submit()}
							placeholder="••••••••"
							secureTextEntry
							value={password}
						/>
						{formError ? <Text style={styles.error}>{formError}</Text> : null}
						<Button
							busy={pending}
							label={mode === "sign-in" ? "Sign In" : "Create Account"}
							onPress={() => submit()}
						/>
					</View>

					<View style={styles.divider}>
						<View style={styles.dividerLine} />
						<Text style={styles.dividerText}>or</Text>
						<View style={styles.dividerLine} />
					</View>

					<Button
						icon="logo-google"
						label="Continue with Google"
						onPress={() => onGoogle()}
						variant="outline"
					/>
					{googleHint ? <GoogleHint message={googleHint} /> : null}

					<Text style={styles.switchText}>
						{mode === "sign-in" ? "No account? " : "Already have an account? "}
						<Text
							onPress={() => {
								setMode(mode === "sign-in" ? "sign-up" : "sign-in");
								setFormError(null);
								setGoogleHint(null);
							}}
							style={styles.switchLink}
						>
							{mode === "sign-in" ? "Create one" : "Sign in"}
						</Text>
					</Text>
				</View>
			</ScrollView>
		</KeyboardAvoidingView>
	);
};

const styles = StyleSheet.create((theme) => ({
	card: {
		alignSelf: "center",
		backgroundColor: theme.colors.card,
		borderColor: theme.colors.border,
		borderRadius: theme.borderRadius.xl,
		borderWidth: 1,
		maxWidth: 400,
		padding: 20,
		width: "100%",
	},
	divider: {
		alignItems: "center",
		flexDirection: "row",
		gap: 10,
		marginVertical: 14,
	},
	dividerLine: {
		backgroundColor: theme.colors.border,
		flex: 1,
		height: 1,
	},
	dividerText: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
	},
	error: {
		color: theme.colors.down,
		fontSize: theme.fontSize.xs,
	},
	flex: {
		backgroundColor: theme.colors.background,
		flex: 1,
	},
	form: {
		gap: 10,
		marginTop: 16,
	},
	googleHint: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
		marginTop: 6,
		textAlign: "center",
	},
	logo: {
		alignItems: "center",
		alignSelf: "center",
		backgroundColor: `${theme.colors.chart}22`,
		borderColor: `${theme.colors.chart}55`,
		borderRadius: theme.borderRadius.lg,
		borderWidth: 1,
		height: 52,
		justifyContent: "center",
		marginBottom: 10,
		width: 52,
	},
	scroll: {
		flexGrow: 1,
		justifyContent: "center",
		padding: 16,
	},
	subtitle: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
		marginTop: 4,
		textAlign: "center",
	},
	switchLink: {
		color: theme.colors.foreground,
		fontWeight: "600",
	},
	switchText: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.sm,
		marginTop: 14,
		textAlign: "center",
	},
	title: {
		color: theme.colors.foreground,
		fontSize: 19,
		fontWeight: "600",
		textAlign: "center",
	},
}));
