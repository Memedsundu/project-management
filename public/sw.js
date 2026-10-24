/*
 * Service worker for the installed app (PWA).
 *
 * - Pages: network first. The last 60 pages she opened are kept, so they stay
 *   readable without signal; a kept copy is shown after 5 seconds of a slow
 *   network, marked so the page can say it is a copy.
 * - /_next/static: cache first (file names change with every build).
 * - /offline: shown when a page was never kept.
 * - Push: shows reminders and opens the right screen when tapped.
 *
 * Plain JavaScript with no build step. The page talks to it with
 * postMessage: "keep" (save this page now), "warm" (save files already
 * loaded) and "forget" (drop kept pages, on sign-out).
 */

const VERSION = "v1";
// src/lib/client/offline.ts uses the same name to read and clear kept pages.
const PAGES = `pages-${VERSION}`;
const STATIC = `static-${VERSION}`;
const OFFLINE_URL = "/offline";
const MAX_PAGES = 60;
const MAX_STATIC = 400;
const NETWORK_TIMEOUT = 5000;
const FRESH_FOR = 5 * 60 * 1000;
const NEVER_KEEP = [/^\/sign-in/, /^\/setup/, /^\/pair/, /^\/offline/, /^\/api\//, /^\/print\//, /^\/_next\//];

self.addEventListener("install", (event) => {
  event.waitUntil(precache().finally(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== PAGES && key !== STATIC) await caches.delete(key);
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

/** The offline page and every file it needs, so it works with no signal at all. */
async function precache() {
  try {
    const res = await fetch(OFFLINE_URL, { cache: "no-store", credentials: "same-origin" });
    if (!res.ok || res.redirected) return;
    const html = await res.clone().text();
    const cache = await caches.open(STATIC);
    await cache.put(OFFLINE_URL, res);
    await warm(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []);
  } catch {
    // No connection while installing: the next start tries again.
  }
}

async function warm(urls) {
  const cache = await caches.open(STATIC);
  for (const href of new Set(urls)) {
    const url = new URL(href, self.location.origin);
    if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/")) continue;
    if (await cache.match(url.href)) continue;
    try {
      const res = await fetch(url.href, { credentials: "same-origin" });
      if (res.ok) await cache.put(url.href, res);
    } catch {
      return;
    }
  }
  await trim(cache, MAX_STATIC);
}

function keepable(url) {
  return url.origin === self.location.origin && !NEVER_KEEP.some((re) => re.test(url.pathname));
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

/** Keep a page she opened. A sign-in page means the session ended: drop every kept page. */
async function remember(url, res) {
  if (new URL(res.url || url.href).pathname === "/sign-in") {
    if (res.ok && res.type === "basic") await caches.delete(PAGES);
    return;
  }
  if (!res.ok || res.redirected || res.type !== "basic" || !keepable(url)) return;
  if (!(res.headers.get("content-type") || "").includes("text/html")) return;
  const headers = new Headers(res.headers);
  headers.set("x-sw-saved-at", String(Date.now()));
  const copy = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
  const cache = await caches.open(PAGES);
  await cache.put(url.href, copy);
  await trim(cache, MAX_PAGES);
}

async function findKept(url) {
  const cache = await caches.open(PAGES);
  return (await cache.match(url.href)) || (await cache.match(url.href, { ignoreSearch: true }));
}

/** Add a marker the page reads to say "this is a saved copy". */
async function marked(res, name, value) {
  const html = await res.text();
  const tag = `<meta name="${name}" content="${String(value).replace(/[<>"&]/g, "")}">`;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(html.replace(/<head([^>]*)>/i, (m) => m + tag), { status: 200, headers });
}

async function offlinePage(url) {
  const res = await caches.match(OFFLINE_URL);
  if (!res) return Response.error();
  return marked(res, "x-offline-for", url.pathname + url.search);
}

async function navigate(event) {
  const url = new URL(event.request.url);
  const network = (async () => {
    const res = (await event.preloadResponse) || (await fetch(event.request));
    // Saved in the background, so the page still streams in as it renders.
    // Downloads (/api/) pass straight through: a copy of a large ZIP would sit in memory.
    if (keepable(url) || url.pathname === "/sign-in") event.waitUntil(remember(url, res.clone()).catch(() => {}));
    return res;
  })();
  event.waitUntil(network.catch(() => {}));

  const kept = keepable(url) ? await findKept(url) : null;
  if (!kept) {
    try {
      return await network;
    } catch {
      return offlinePage(url);
    }
  }
  try {
    const res = await Promise.race([network, new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT))]);
    if (res) return res;
  } catch {
    // No connection: the kept copy below.
  }
  return marked(kept, "x-offline-copy", kept.headers.get("x-sw-saved-at") || "");
}

async function cacheFirst(event) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const res = await fetch(event.request);
  if (res.ok && res.type === "basic") event.waitUntil(cache.put(event.request, res.clone()).then(() => trim(cache, MAX_STATIC)));
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    event.respondWith(navigate(event));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event));
  }
});

/** Save a page she opened inside the app, at most every 5 minutes. */
async function keep(href) {
  const url = new URL(href, self.location.origin);
  if (!keepable(url)) return;
  const hit = await (await caches.open(PAGES)).match(url.href);
  if (hit && Date.now() - Number(hit.headers.get("x-sw-saved-at") || 0) < FRESH_FOR) return;
  try {
    await remember(url, await fetch(url.href, { credentials: "same-origin", headers: { Accept: "text/html" } }));
  } catch {
    // Offline: the copy she has stays.
  }
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "keep" && typeof data.url === "string") event.waitUntil(keep(data.url));
  else if (data.type === "warm" && Array.isArray(data.urls)) event.waitUntil(warm(data.urls.filter((u) => typeof u === "string")).then(precacheIfMissing));
  else if (data.type === "forget") event.waitUntil(caches.delete(PAGES));
});

async function precacheIfMissing() {
  if (!(await caches.match(OFFLINE_URL))) await precache();
}

/* ---------------------------------- Push ---------------------------------- */

function sameOrigin(href) {
  try {
    const url = new URL(href || "/", self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Hatırlatma";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      data: { url: sameOrigin(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = sameOrigin(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        try {
          await open.focus();
        } catch {
          // Focus needs the tap itself; the window still moves to the screen.
        }
        try {
          await open.navigate(target);
          return;
        } catch {
          // Not controlled by this worker yet: open a window instead.
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/** The browser renewed the subscription: tell the server the new address. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      let sub = event.newSubscription;
      if (!sub && old && old.options && old.options.applicationServerKey) {
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: old.options.applicationServerKey });
      }
      if (!sub) return;
      await fetch("/api/push", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldEndpoint: old ? old.endpoint : null, subscription: sub.toJSON() }),
      });
    })().catch(() => {}),
  );
});
