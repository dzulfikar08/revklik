/** Generate (or export a provided) P-256 private key as an ASC-style .p8 PEM. */
export async function generatePkcs8Pem(privateKey?: CryptoKey): Promise<string> {
	const keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const key = privateKey ?? keyPair.privateKey;
	const pkcs8 = (await crypto.subtle.exportKey("pkcs8", key)) as ArrayBuffer;
	const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
	const lines = b64.match(/.{1,64}/g) ?? [];
	return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}
