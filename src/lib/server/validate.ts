const CITY_ALIASES: Record<string, string> = {
	bangalore: 'Bengaluru', bengaluru: 'Bengaluru', bombay: 'Mumbai', calcutta: 'Kolkata', madras: 'Chennai',
	gurgaon: 'Gurugram', vizag: 'Visakhapatnam', trivandrum: 'Thiruvananthapuram', cochin: 'Kochi', poona: 'Pune'
};

/**
 * One spelling per city, because cities are compared and shown publicly. Letters only, so this
 * public field cannot carry a phone number or a link. ponytail: not a list of real places;
 * use one if someone writes words in it.
 */
export function city(value: FormDataEntryValue | null): string | null {
	if (typeof value !== 'string') return null;
	const s = value.replace(/\s+/g, ' ').trim().toLowerCase();
	if (s.length < 2 || s.length > 40 || s.split(' ').length > 4 || !/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(s)) return null;
	return CITY_ALIASES[s] ?? s.replace(/(^|[ -])(\p{L})/gu, (m) => m.toUpperCase());
}

export const NOTE_MAX = 280;

/** Trimmed single-line text, or null if empty or over max. */
export function text(value: FormDataEntryValue | null, max: number): string | null {
	if (typeof value !== 'string') return null;
	const s = value.replace(/[\s\p{Cc}]+/gu, ' ').trim();
	return s && s.length <= max ? s : null;
}

/** The same for an address: line breaks survive. Control characters would break Postgres. */
export function multiline(value: FormDataEntryValue | null, max: number): string | null {
	if (typeof value !== 'string') return null;
	const s = value.replace(/\r\n/g, '\n').replace(/[^\P{Cc}\n]+/gu, ' ').trim();
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
