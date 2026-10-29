import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Panel, PanelBody } from "@/components/analytics/ui";
import { Button, Input } from "@/components/ui";
import { authSwitchAccount } from "@/lib/auth";
import {
	completeGoogleLink,
	fetchLinks,
	googleLinkUrl,
	LINKS_QUERY_KEY,
	linkErrorMessage,
	LinkError,
	linkWithPassword,
	parseLinkResult,
	previewGoogleLink,
	unlinkAccount,
} from "@/lib/klikapa/accounts";
import type { AccountLink } from "@/lib/klikapa/accounts";
import { GOOGLE_CALLBACK_URL } from "@/lib/klikapa/api";
import { initialsOf } from "@/lib/initials";

const Avatar = ({ name, email }: { name: string; email: string }) => (
	<View accessibilityElementsHidden importantForAccessibility="no" style={styles.avatar}>
		<Text style={styles.avatarText}>{initialsOf(name, email)}</Text>
	</View>
);

const codeOf = (error: unknown): string | undefined =>
	error instanceof LinkError ? error.code : undefined;

export const AccountsSection = () => {
	const qc = useQueryClient();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [switchingId, setSwitchingId] = useState<string | null>(null);
	const [googlePending, setGooglePending] = useState(false);
	const [currentPassword, setCurrentPassword] = useState("");

	const linksQ = useQuery({ queryFn: fetchLinks, queryKey: LINKS_QUERY_KEY });
	const links = linksQ.data ?? [];

	const linkMut = useMutation({
		mutationFn: () => linkWithPassword(email.trim(), password, currentPassword),
		onError: (error: unknown) => setFormError(linkErrorMessage(codeOf(error))),
		onSuccess: (link) => {
			setFormError(null);
			setEmail("");
			setPassword("");
			setCurrentPassword("");
			qc.invalidateQueries({ queryKey: LINKS_QUERY_KEY });
			Alert.alert(`Linked ${link.user.name}`);
		},
	});

	const unlinkMut = useMutation({
		mutationFn: (link: AccountLink) => unlinkAccount(link),
		onError: () => Alert.alert("Couldn't unlink this account."),
		onSuccess: () => qc.invalidateQueries({ queryKey: LINKS_QUERY_KEY }),
	});

	const confirmUnlink = (link: AccountLink) => {
		Alert.alert(
			`Unlink ${link.user.name}?`,
			`You and ${link.user.email} will no longer be able to switch to each other. Neither account is changed or deleted.`,
			[
				{ style: "cancel", text: "Cancel" },
				{ onPress: () => unlinkMut.mutate(link), style: "destructive", text: "Unlink" },
			],
		);
	};

	const switchTo = async (link: AccountLink) => {
		setSwitchingId(link.id);
		try {
			await authSwitchAccount(link.user);
			// Everything cached belongs to the previous account.
			qc.clear();
			router.navigate("/dashboard");
		} catch {
			Alert.alert("Couldn't switch accounts.");
		}
		setSwitchingId(null);
	};

	const linkWithGoogle = async () => {
		setGooglePending(true);
		try {
			const url = await googleLinkUrl(GOOGLE_CALLBACK_URL, currentPassword);
			const result = await WebBrowser.openAuthSessionAsync(url, GOOGLE_CALLBACK_URL);
			if (result.type === "success") {
				const outcome = parseLinkResult(result.url);
				if (outcome.code) {
					await confirmGoogleLink(outcome.code);
				} else {
					Alert.alert(linkErrorMessage(outcome.reason));
				}
			}
		} catch (error) {
			Alert.alert(linkErrorMessage(codeOf(error)));
		}
		setGooglePending(false);
	};

	/** Show which account Google confirmed and link only after the user agrees. */
	const confirmGoogleLink = async (code: string) => {
		const user = await previewGoogleLink(code);
		await new Promise<void>((resolve) => {
			Alert.alert(
				`Link ${user.name}?`,
				`Google confirmed ${user.email}. Once linked, you can switch between it and this account.`,
				[
					{ onPress: () => resolve(), style: "cancel", text: "Cancel" },
					{
						onPress: () => {
							completeGoogleLink(code)
								.then(() => {
									qc.invalidateQueries({ queryKey: LINKS_QUERY_KEY });
									Alert.alert("Google account linked");
								})
								.catch((error: unknown) => Alert.alert(linkErrorMessage(codeOf(error))))
								.finally(resolve);
						},
						text: "Link account",
					},
				],
			);
		});
	};

	return (
		<Panel hint="switch without signing in again" title="Accounts">
			{linksQ.isError ? (
				<View style={styles.errorRow}>
					<Text style={styles.error}>Could not load linked accounts.</Text>
					<Button label="Try again" onPress={() => linksQ.refetch()} size="sm" variant="outline" />
				</View>
			) : (
				<PanelBody
					emptyText="No linked accounts yet. Link one below to switch between accounts."
					hasData={links.length > 0}
					loading={linksQ.isLoading}
				>
					{links.map((link) => (
						<View key={link.id} style={styles.row}>
							<Avatar email={link.user.email} name={link.user.name} />
							<View style={styles.main}>
								<Text numberOfLines={1} style={styles.name}>
									{link.user.name}
								</Text>
								<Text numberOfLines={1} style={styles.email}>
									{link.user.email}
								</Text>
							</View>
							<Button
								busy={switchingId === link.id}
								disabled={switchingId !== null}
								label="Switch"
								onPress={() => switchTo(link)}
								size="sm"
								variant="outline"
							/>
							<Button
								accessibilityLabel={`Unlink ${link.user.name}`}
								disabled={unlinkMut.isPending}
								icon="unlink-outline"
								label="Unlink"
								onPress={() => confirmUnlink(link)}
								size="sm"
								variant="ghost"
							/>
						</View>
					))}
				</PanelBody>
			)}

			<View style={styles.form}>
				<Text style={styles.formTitle}>Link another account</Text>
				<Text style={styles.formHint}>
					Prove you own it once, with its password or with Google.
				</Text>
				<Input
					autoCapitalize="none"
					autoComplete="off"
					keyboardType="email-address"
					label="Email of the other account"
					onChangeText={setEmail}
					value={email}
				/>
				<Input
					autoCapitalize="none"
					autoComplete="off"
					label="Password of the other account"
					onChangeText={setPassword}
					onSubmitEditing={() => linkMut.mutate()}
					secureTextEntry
					value={password}
				/>
				<Input
					autoCapitalize="none"
					autoComplete="off"
					label="Your password"
					onChangeText={setCurrentPassword}
					secureTextEntry
					value={currentPassword}
				/>
				<Text style={styles.formHint}>
					Needed to link. If you only sign in with Google, leave it empty.
				</Text>
				{formError ? <Text style={styles.error}>{formError}</Text> : null}
				<Button
					busy={linkMut.isPending}
					disabled={!email.trim() || !password}
					icon="link-outline"
					label="Link account"
					onPress={() => linkMut.mutate()}
				/>
				<Button
					busy={googlePending}
					icon="logo-google"
					label="Link with Google"
					onPress={() => linkWithGoogle()}
					variant="outline"
				/>
			</View>
		</Panel>
	);
};

const styles = StyleSheet.create((theme) => ({
	avatar: {
		alignItems: "center",
		backgroundColor: theme.colors.muted,
		borderColor: theme.colors.border,
		borderRadius: 999,
		borderWidth: 1,
		height: 34,
		justifyContent: "center",
		width: 34,
	},
	avatarText: {
		color: theme.colors.foreground,
		fontSize: 12,
		fontWeight: "600",
	},
	email: {
		color: theme.colors.mutedForeground,
		fontFamily: "monospace",
		fontSize: 11,
	},
	error: {
		color: theme.colors.down,
		fontSize: theme.fontSize.xs,
	},
	errorRow: {
		alignItems: "center",
		flexDirection: "row",
		gap: 10,
		justifyContent: "space-between",
		paddingVertical: 8,
	},
	form: {
		borderColor: theme.colors.border,
		borderTopWidth: 1,
		gap: 8,
		marginTop: 10,
		paddingTop: 12,
	},
	formHint: {
		color: theme.colors.mutedForeground,
		fontSize: theme.fontSize.xs,
	},
	formTitle: {
		color: theme.colors.foreground,
		fontSize: 13,
		fontWeight: "600",
	},
	main: {
		flex: 1,
	},
	name: {
		color: theme.colors.foreground,
		fontSize: 13,
		fontWeight: "500",
	},
	row: {
		alignItems: "center",
		borderColor: theme.colors.border,
		borderTopWidth: 1,
		flexDirection: "row",
		gap: 8,
		paddingVertical: 8,
	},
}));
