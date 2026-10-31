import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Panel } from "@/components/analytics/ui";
import { Button, Input } from "@/components/ui";
import { authAccountDeleted, useAuth } from "@/lib/auth";
import { BOOKS_URL } from "@/lib/env";
import { t } from "@/lib/i18n";
import { LegacyApiError } from "@/lib/klikapa/api";
import { deleteAccount } from "@/lib/klikapa/privacy";
import { unregisterFromPush } from "@/lib/push";

/** Opens RevKlik Books' "Masuk dengan RevKlik" sign-in, same target as the web account menu. */
export const BooksLink = () => {
	const url = BOOKS_URL;
	if (!url) {
		return null;
	}
	return (
		<Panel title={t("account.books")}>
			<Text style={styles.hint}>{t("account.booksHint")}</Text>
			<Button
				icon="open-outline"
				label={t("account.books")}
				onPress={() => {
					WebBrowser.openBrowserAsync(url).catch(() => undefined);
				}}
				variant="outline"
			/>
		</Panel>
	);
};

/**
 * Account deletion, required in-app by the App Store: confirm with the account
 * email (plus the password when the account has one), then DELETE /auth/account.
 */
export const DeleteAccountSection = () => {
	const { user } = useAuth();
	const qc = useQueryClient();
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);

	const mut = useMutation({
		mutationFn: async () => {
			// Needs the live session, so it runs before the account (and token) disappear.
			await unregisterFromPush();
			await deleteAccount({ confirmEmail: email.trim(), currentPassword: password });
		},
		onError: (e: unknown) =>
			setError(e instanceof LegacyApiError ? e.message : t("account.deleteFailed")),
		onSuccess: () => {
			qc.clear();
			authAccountDeleted();
		},
	});

	const matches = email.trim().toLowerCase() === (user?.email ?? "").toLowerCase();

	return (
		<Panel title={t("account.delete")}>
			{open ? (
				<View style={styles.form}>
					<Text style={styles.title}>{t("account.deleteTitle")}</Text>
					<Text style={styles.hint}>{t("account.deleteBody")}</Text>
					<Input
						autoCapitalize="none"
						autoCorrect={false}
						keyboardType="email-address"
						label={t("account.deleteConfirmEmail")}
						onChangeText={setEmail}
						placeholder={user?.email}
						value={email}
					/>
					<Input
						autoCapitalize="none"
						label={t("account.deletePassword")}
						onChangeText={setPassword}
						secureTextEntry
						value={password}
					/>
					{error ? <Text style={styles.error}>{error}</Text> : null}
					{mut.isPending ? <Text style={styles.hint}>{t("account.deleteRunning")}</Text> : null}
					<View style={styles.actions}>
						<Button
							busy={mut.isPending}
							disabled={!matches}
							icon="trash-outline"
							label={t("account.delete")}
							onPress={() => {
								setError(null);
								mut.mutate();
							}}
							variant="destructive"
						/>
						<Button
							disabled={mut.isPending}
							label={t("common.cancel")}
							onPress={() => {
								setOpen(false);
								setError(null);
							}}
							variant="outline"
						/>
					</View>
				</View>
			) : (
				<Button
					icon="trash-outline"
					label={t("account.delete")}
					onPress={() => setOpen(true)}
					variant="outline"
				/>
			)}
		</Panel>
	);
};

const styles = StyleSheet.create((theme) => ({
	actions: {
		flexDirection: "row",
		gap: 8,
	},
	error: {
		color: theme.colors.down,
		fontSize: theme.fontSize.xs,
	},
	form: {
		gap: 10,
	},
	hint: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
		marginBottom: 8,
	},
	title: {
		color: theme.colors.foreground,
		fontSize: theme.fontSize.sm,
		fontWeight: "600",
	},
}));
