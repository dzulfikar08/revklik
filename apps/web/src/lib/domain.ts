/**
 * Turn whatever was pasted into the domain field ("https://Shop.com/promo/",
 * "www.blog.id?ref=x") into the bare host the tracker matches on.
 * Returns null when nothing host-like is left.
 */
const SCHEME = /^[a-z][a-z\d+.-]*:\/\//iu;
const HOST = /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d-]{2,63}$/u;
const LOCALHOST = /^localhost$/u;

export const normalizeDomain = (input: string): string | null => {
	let value = input.trim().toLowerCase().replace(SCHEME, "");
	// Path, query and fragment go; so do credentials and the port.
	value = value.split(/[/?#]/u)[0] ?? "";
	value = value.slice(value.lastIndexOf("@") + 1);
	value = value.replace(/:\d+$/u, "").replace(/\.$/u, "");
	if (!value) {
		return null;
	}
	return HOST.test(value) || LOCALHOST.test(value) ? value : null;
};
