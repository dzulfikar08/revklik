/**
 * Progressive enhancement for the static MDX output: the copy button on code
 * blocks. The click is delegated from `document`, so it keeps working across
 * Astro view transitions. It only flips attributes on the button after a click,
 * never adds or removes nodes inside the React island.
 */

const COPIED_RESET_MS = 1500;

async function copyCode(button: HTMLButtonElement): Promise<void> {
	const pre = button.closest("figure")?.querySelector("pre");

	if (!pre) return;

	const clone = pre.cloneNode(true) as HTMLElement;

	for (const node of clone.querySelectorAll(".nd-copy-ignore")) node.replaceWith("\n");

	try {
		await navigator.clipboard.writeText(clone.textContent ?? "");
	} catch {
		return;
	}

	button.dataset.checked = "";
	button.setAttribute("aria-label", button.dataset.labelCopied ?? "Copied");
	window.setTimeout(() => {
		delete button.dataset.checked;
		button.setAttribute("aria-label", button.dataset.labelCopy ?? "Copy");
	}, COPIED_RESET_MS);
}

document.addEventListener("click", (event) => {
	if (!(event.target instanceof Element)) return;

	const button = event.target.closest<HTMLButtonElement>("[data-copy-code]");

	if (button) void copyCode(button);
});
