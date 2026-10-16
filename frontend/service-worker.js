/* CloudTune PWA shell cache.
 * API responses and signed music URLs are deliberately never cached here.
 * This provides an offline app shell, not offline audio downloads.
 */
const CACHE_NAME = "cloudtune-shell-v1";
const SHELL_ASSETS = [
    "./index.html",
    "./style.css",
    "./app.js",
    "./recommendations.js",
    "./listener.js",
    "./karaoke.js",
    "./thought-search.js",
    "./visualizer.js",
    "./pwa.js",
    "./manifest.json",
    "./icons/cloudtune.svg"
];
const SHELL_FILENAMES = new Set(SHELL_ASSETS.map(path => path.split("/").pop()));

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key.startsWith("cloudtune-shell-") && key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.split("/").includes("api")) return;

    if (request.mode === "navigate") {
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                if (response.ok) {
                    const cache = await caches.open(CACHE_NAME);
                    await cache.put("./index.html", response.clone());
                }
                return response;
            } catch {
                const cached = await caches.match("./index.html");
                return cached || new Response("CloudTune is offline and its app shell is not cached yet.", {
                    status: 503,
                    headers: { "Content-Type": "text/plain; charset=utf-8" }
                });
            }
        })());
        return;
    }

    const filename = url.pathname.split("/").pop();
    if (!SHELL_FILENAMES.has(filename)) return;

    event.respondWith((async () => {
        const cached = await caches.match(request);
        const networkPromise = fetch(request).then(async response => {
            if (response.ok && response.type === "basic") {
                const cache = await caches.open(CACHE_NAME);
                await cache.put(request, response.clone());
            }
            return response;
        });
        if (cached) {
            event.waitUntil(networkPromise.catch(() => undefined));
            return cached;
        }
        try {
            return await networkPromise;
        } catch {
            return new Response("This CloudTune resource is unavailable offline.", {
                status: 503,
                headers: { "Content-Type": "text/plain; charset=utf-8" }
            });
        }
    })());
});