/** Blocks a second submit and disables the buttons. The server's request token is the real guard. */
export function once(form: HTMLFormElement) {
	let sent = false;
	const buttons = () => [...form.querySelectorAll<HTMLButtonElement>('button:not([type="button"])')];
	const submit = (e: SubmitEvent) => {
		if (sent) return e.preventDefault();
		sent = true;
		// Later, so a pressed button's own name and value still go with the form.
		setTimeout(() => buttons().forEach((b) => (b.disabled = true)));
	};
	// Coming back from the browser's history restores the page as it was left.
	const restore = () => {
		sent = false;
		buttons().forEach((b) => (b.disabled = false));
	};
	form.addEventListener('submit', submit);
	window.addEventListener('pageshow', restore);
	return {
		destroy() {
			form.removeEventListener('submit', submit);
			window.removeEventListener('pageshow', restore);
		}
	};
}
