const MAX_KEYS = 50_000;
const scopes = new Map<string, Map<string, { tokens: number; at: number }>>();

// ponytail: in-memory token bucket, per process and reset on restart. Move to Postgres or Redis
// when running more than one instance. One map per scope (the key's prefix), so flooding the
// IP-keyed sign-in bucket cannot evict anyone's per-user limits.
export function allow(key: string, capacity: number, perHour: number): boolean {
	const scope = key.split(':')[0];
	const buckets = scopes.get(scope) ?? new Map();
	scopes.set(scope, buckets);
	const now = Date.now();
	const b = buckets.get(key) ?? { tokens: capacity, at: now };
	b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 3_600_000) * perHour);
	b.at = now;
	// Re-inserting keeps the map in least-recently-used order, so eviction takes the oldest.
	buckets.delete(key);
	buckets.set(key, b);
	if (buckets.size > MAX_KEYS) buckets.delete(buckets.keys().next().value);
	if (b.tokens < 1) return false;
	b.tokens -= 1;
	return true;
}
