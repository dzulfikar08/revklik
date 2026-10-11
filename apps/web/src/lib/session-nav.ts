/**
 * A request came back 401 mid-session (token revoked or expired). The query
 * cache calls this instead of toasting; main.tsx registers navigation to
 * /login?next=<current page> once the router exists.
 */
type SessionExpiredHandler = () => void;

let handler: SessionExpiredHandler = () => {
	if (window.location.pathname !== "/login") {
		window.location.assign("/login");
	}
};

export const registerSessionExpiredHandler = (fn: SessionExpiredHandler): void => {
	handler = fn;
};

export const onSessionExpired = (): void => {
	handler();
};
