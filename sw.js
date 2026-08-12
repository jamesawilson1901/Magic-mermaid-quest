/* Service worker for Magic Mermaid Quest.
   Makes the game installable and playable offline: sprite frames and
   backgrounds are cached the first time they load (they never change
   without a new build), while the shell files are fetched
   network-first so updates arrive when online. */

const CACHE = "mmq-v1";
const SHELL = ["./", "index.html", "game.js", "assets/manifest.js",
               "manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  const isAsset = url.pathname.includes("/assets/") &&
                  !url.pathname.endsWith("manifest.js");
  if (isAsset || url.pathname.includes("/icons/")) {
    // Cache-first: art assets are immutable per deployment.
    e.respondWith(
      caches.open(CACHE).then(c =>
        c.match(e.request).then(hit => hit || fetch(e.request).then(res => {
          if (res.ok) c.put(e.request, res.clone());
          return res;
        }))
      )
    );
  } else {
    // Network-first: shell files pick up new versions when online.
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
  }
});
