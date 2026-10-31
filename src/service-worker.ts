/// <reference lib="webworker" />
// App shell only: built assets and static files. Pages are never cached (they hold private
// data); a failed navigation gets the static offline page.
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `shell-${version}`;
const ASSETS = new Set([...build, ...files]);

sw.addEventListener('install', (e) => {
	e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...ASSETS])).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (e) => {
	e.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (e) => {
	if (e.request.method !== 'GET') return;
	const url = new URL(e.request.url);
	if (url.origin !== sw.location.origin) return;
	if (ASSETS.has(url.pathname)) {
		e.respondWith(caches.match(e.request).then((r) => r ?? fetch(e.request)));
	} else if (e.request.mode === 'navigate') {
		e.respondWith(
			fetch(e.request).catch(async () => (await caches.match('/offline.html')) ?? Response.error())
		);
	}
});
