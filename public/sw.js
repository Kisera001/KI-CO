const SHELL_CACHE = "ki-co-shell-v2-logo";
const RUNTIME_CACHE = "ki-co-runtime-v2-logo";
const CORE_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/pwa-icon.svg?v=logo2",
  "/pwa-icon-192.png?v=logo2",
  "/pwa-icon-512.png?v=logo2",
  "/apple-touch-icon.png?v=logo2",
  "/offline.html",
];
const EXTERNAL_CACHE_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
const NON_CACHEABLE_MEDIA_EXTENSIONS = /\.(mp4|mp3|wav|m4a|mov|mkv)$/i;
const STATIC_ASSET_EXTENSIONS = /\.(js|mjs|css|svg|png|jpg|jpeg|webp|gif|ico|json|woff2?|ttf|otf|txt)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "CACHE_URLS" || !Array.isArray(data.payload)) return;
  event.waitUntil(cacheUrls(data.payload));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isCacheableStaticAsset(url)) {
    event.respondWith(networkFirstRuntime(request));
    return;
  }

  if (url.origin !== self.location.origin && EXTERNAL_CACHE_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function cacheUrls(urls) {
  const cache = await caches.open(RUNTIME_CACHE);
  const uniqueUrls = [...new Set(urls)].filter(Boolean);

  await Promise.all(
    uniqueUrls.map(async (entry) => {
      try {
        const requestUrl = new URL(entry, self.location.origin);
        const isSameOrigin = requestUrl.origin === self.location.origin;
        const request = new Request(requestUrl.href, {
          mode: isSameOrigin ? "same-origin" : "no-cors",
          credentials: isSameOrigin ? "same-origin" : "omit",
        });
        const response = await fetch(request);
        if (response.ok || response.type === "opaque") {
          await cache.put(request, response.clone());
        }
      } catch {
        // Optional warmup failures should not block the app shell.
      }
    }),
  );
}

async function cacheAppShell() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(CORE_URLS);

  try {
    const response = await fetchWithTimeout("/", 3000);
    if (response.ok) {
      await cache.put("/", response.clone());
      await cache.put("/index.html", response.clone());
      const html = await response.text();
      await cacheUrls(extractSameOriginAssetUrls(html));
    }
  } catch {
    // CORE_URLS are already cached; optional asset warmup can fail.
  }
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetchWithTimeout(request, 1500);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    const appShell = (await caches.match("/")) || (await caches.match("/index.html"));
    if (appShell) return appShell;

    return (await caches.match("/offline.html")) || new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(async (response) => {
      if (response.ok || response.type === "opaque") {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached || optionalEmptyResponse(request));

  return cached || networkFetch;
}

async function networkFirstRuntime(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetchWithTimeout(request, 2500);
    if (response.ok || response.type === "opaque") {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("Runtime asset unavailable");
  }
}

function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function extractSameOriginAssetUrls(html) {
  const urls = new Set();
  const patterns = [
    /\bsrc=["']([^"']+)["']/gi,
    /\bhref=["']([^"']+)["']/gi,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = match[1];
      if (!value || value.startsWith("http") || value.startsWith("data:") || value.startsWith("#")) continue;
      urls.add(value);
    }
  }

  return [...urls];
}

function optionalEmptyResponse(request) {
  const destination = request.destination;
  const contentType =
    destination === "script"
      ? "application/javascript"
      : destination === "style"
        ? "text/css"
        : "text/plain";

  return new Response("", {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

function isCacheableStaticAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (NON_CACHEABLE_MEDIA_EXTENSIONS.test(url.pathname)) return false;
  return STATIC_ASSET_EXTENSIONS.test(url.pathname);
}
