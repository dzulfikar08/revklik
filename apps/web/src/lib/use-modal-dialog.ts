import { useEffect, useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog keyboard behaviour for a `role="dialog"` element: focus moves
 * in on open, Tab and Shift+Tab cycle inside, Escape closes, and focus goes
 * back to the opener on close. Keys are handled on the dialog itself, so a
 * nested dialog only closes itself.
 */
export const useModalDialog = <T extends HTMLElement>(
	onClose: () => void,
): { ref: RefObject<T | null>; onKeyDown: (e: KeyboardEvent<T>) => void } => {
	const ref = useRef<T>(null);

	useEffect(() => {
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const node = ref.current;
		if (node && !node.contains(document.activeElement)) {
			const first = node.querySelector<HTMLElement>("[data-autofocus]:not([disabled])");
			(first ?? node).focus();
		}
		return () => {
			// The opener can be gone (row deleted); only restore if still mounted.
			if (opener?.isConnected) {
				opener.focus();
			}
		};
	}, []);

	const onKeyDown = (e: KeyboardEvent<T>) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			onClose();
			return;
		}
		if (e.key !== "Tab" || !ref.current) {
			return;
		}
		const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
			(el) => el.offsetParent !== null || el === document.activeElement,
		);
		const first = items[0];
		const last = items.at(-1);
		if (!first || !last) {
			e.preventDefault();
			return;
		}
		if (
			e.shiftKey &&
			(document.activeElement === first || document.activeElement === ref.current)
		) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	};

	return { onKeyDown, ref };
};
