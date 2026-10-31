export const NOTE_MAX = 280;

/** Trimmed single-line text, or null if empty or over max. */
export function text(value: FormDataEntryValue | null, max: number): string | null {
	if (typeof value !== 'string') return null;
	const s = value.replace(/\s+/g, ' ').trim();
	return s && s.length <= max ? s : null;
}

/** Any Indian mobile spelling to +91XXXXXXXXXX, or null. */
export function whatsapp(value: FormDataEntryValue | null): string | null {
	if (typeof value !== 'string') return null;
	const m = value.replace(/[\s()-]/g, '').match(/^(?:\+91|91|0)?([6-9]\d{9})$/);
	return m ? `+91${m[1]}` : null;
}

export function pincode(value: FormDataEntryValue | null): string | null {
	return typeof value === 'string' && /^[1-9]\d{5}$/.test(value.trim()) ? value.trim() : null;
}

/** ISBN-10 or ISBN-13 with separators removed, or null. */
export function isbn(value: FormDataEntryValue | null): string | null {
	if (typeof value !== 'string') return null;
	const s = value.replace(/[\s-]/g, '').toUpperCase();
	return /^(97[89]\d{10}|\d{9}[\dX])$/.test(s) ? s : null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
