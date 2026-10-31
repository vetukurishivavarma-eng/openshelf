const buckets = new Map<string, { tokens: number; at: number }>();

// ponytail: in-memory token bucket, per process and reset on restart. Move to Postgres or Redis
// when running more than one instance.
export function allow(key: string, capacity: number, perHour: number): boolean {
	const now = Date.now();
	if (buckets.size > 50_000) buckets.clear();
	const b = buckets.get(key) ?? { tokens: capacity, at: now };
	b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 3_600_000) * perHour);
	b.at = now;
	buckets.set(key, b);
	if (b.tokens < 1) return false;
	b.tokens -= 1;
	return true;
}
