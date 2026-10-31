import { randomUUID } from 'node:crypto';
import { fail, redirect } from '@sveltejs/kit';
import { createListing, type Condition } from '$lib/server/engine';
import { attempt, signedIn } from '$lib/server/form';
import { allow } from '$lib/server/ratelimit';
import { NOTE_MAX, UUID, isbn, text } from '$lib/server/validate';

export const load = ({ locals }) => {
	const user = signedIn(locals);
	if (!user.city || !user.whatsapp) redirect(303, '/me');
	return { token: randomUUID() };
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

const field = (form: FormData, name: string) => {
	const v = form.get(name);
	return typeof v === 'string' ? v : '';
};
const typed = (form: FormData) => ({
	isbn: field(form, 'isbn'),
	title: field(form, 'title'),
	author: field(form, 'author'),
	condition: field(form, 'condition'),
	note: field(form, 'note')
});

export const actions = {
	lookup: async ({ request, locals }) => {
		const user = signedIn(locals);
		const form = await request.formData();
		const values = typed(form);
		const code = isbn(values.isbn);
		if (!code) return fail(400, { ...values, error: 'That does not look like an ISBN.' });
		if (!allow(`lookup:${user.id}`, 30, 30)) return fail(429, { ...values, error: 'Too many lookups. Try again later.' });
		const found = await openLibrary(code);
		if (!found) return { ...values, isbn: code, error: 'No match found. Type the details in below.' };
		return { ...values, isbn: code, title: found.title || values.title, author: found.author || values.author };
	},

	create: async ({ request, locals }) => {
		const user = signedIn(locals);
		const form = await request.formData();
		const values = typed(form);
		const title = text(values.title, 200);
		const author = text(values.author, 200);
		const code = values.isbn ? isbn(values.isbn) : null;
		const { condition } = values;
		const note = text(values.note, NOTE_MAX);
		if (!title || !author) return fail(400, { ...values, error: 'Title and author are required.' });
		if (values.isbn && !code) return fail(400, { ...values, error: 'That does not look like an ISBN.' });
		if (condition !== 'like_new' && condition !== 'good' && condition !== 'worn')
			return fail(400, { ...values, error: 'Choose a condition.' });
		if (values.note.trim() && !note)
			return fail(400, { ...values, error: `Keep your note to ${NOTE_MAX} characters.` });
		const raw = field(form, 'token');
		const token = UUID.test(raw) ? raw : null;
		if (!allow(`list:${user.id}`, 20, 20))
			return fail(429, { ...values, error: 'Too many listings. Try again later.' });
		const failed = await attempt(
			() => createListing(user.id, { title, author, isbn: code, condition: condition as Condition, note, token }),
			values
		);
		if (failed) return failed;
		redirect(303, '/shelf');
	}
};
