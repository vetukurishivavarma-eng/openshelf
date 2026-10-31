import { fail, redirect } from '@sveltejs/kit';
import { createListing, type Condition } from '$lib/server/engine';
import { attempt, signedIn } from '$lib/server/form';
import { allow } from '$lib/server/ratelimit';
import { NOTE_MAX, isbn, text } from '$lib/server/validate';

export const load = ({ locals }) => {
	const user = signedIn(locals);
	if (!user.city || !user.whatsapp) redirect(303, '/me');
};

async function openLibrary(code: string) {
	try {
		const res = await fetch(
			`https://openlibrary.org/api/books?bibkeys=ISBN:${code}&format=json&jscmd=data`,
			{ signal: AbortSignal.timeout(4000) }
		);
		if (!res.ok) return null;
		const book = (await res.json())[`ISBN:${code}`];
		if (!book) return null;
		return {
			title: String(book.title ?? '').slice(0, 200),
			author: String(book.authors?.[0]?.name ?? '').slice(0, 200)
		};
	} catch {
		return null; // Timeouts and bad responses both fall back to manual entry.
	}
}

export const actions = {
	lookup: async ({ request, locals }) => {
		signedIn(locals);
		const code = isbn((await request.formData()).get('isbn'));
		if (!code) return fail(400, { error: 'That does not look like an ISBN.' });
		const found = await openLibrary(code);
		if (!found) return { isbn: code, title: '', author: '', error: 'No match found. Type the details in below.' };
		return { isbn: code, ...found };
	},

	create: async ({ request, locals }) => {
		const user = signedIn(locals);
		const form = await request.formData();
		const title = text(form.get('title'), 200);
		const author = text(form.get('author'), 200);
		const rawIsbn = form.get('isbn');
		const code = rawIsbn ? isbn(rawIsbn) : null;
		const condition = form.get('condition');
		const rawNote = form.get('note');
		const note = text(rawNote, NOTE_MAX);
		const values = { title: title ?? '', author: author ?? '', isbn: typeof rawIsbn === 'string' ? rawIsbn : '' };
		if (!title || !author) return fail(400, { ...values, error: 'Title and author are required.' });
		if (rawIsbn && !code) return fail(400, { ...values, error: 'That does not look like an ISBN.' });
		if (condition !== 'like_new' && condition !== 'good' && condition !== 'worn')
			return fail(400, { ...values, error: 'Choose a condition.' });
		if (typeof rawNote === 'string' && rawNote.trim() && !note)
			return fail(400, { ...values, error: `Keep your note to ${NOTE_MAX} characters.` });
		if (!allow(`list:${user.id}`, 20, 20))
			return fail(429, { ...values, error: 'Too many listings. Try again later.' });
		const failed = await attempt(() =>
			createListing(user.id, { title, author, isbn: code, condition: condition as Condition, note })
		);
		if (failed) return failed;
		redirect(303, '/shelf');
	}
};
