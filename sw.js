import { putSharedFile } from "./share-store.js";

// Bump this version whenever a precached file changes. Waiting updates are
// activated by the user, so the viewer cannot switch code halfway through a job.
const VERSION = "2026-10-15-pwa-1";
const BASE = self.registration.scope;
const PREFIX = `ibero-3d:${new URL(BASE).pathname}:`;
const CACHE = PREFIX + VERSION;
const SHELL = [
  "index.html",
  "index2.html",
  "styles.css",
  "app.js",
  "mesh-utils.js",
  "mesh-worker.js",
  "pwa.js",
  "share-store.js",
  "manifest.webmanifest",
  "favicon.ico",
  "assets/logo-ibero.png",
  "assets/app-icon-192.png",
  "assets/app-icon-512.png",
  "vendor/three/three.module.js",
  "vendor/three/addons/controls/OrbitControls.js",
  "vendor/three/addons/loaders/STLLoader.js",
  "vendor/fast-quadric/a.out.js",
  "vendor/fast-quadric/a.out.wasm",
];
const assetPaths = new Set(SHELL.map((path) => new URL(path, BASE).pathname));
const indexURL = new URL("index.html", BASE).href;
const shareURL = new URL("share-target", BASE).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(
          SHELL.map(
            (path) => new Request(new URL(path, BASE), { cache: "reload" }),
          ),
        ),
      ),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith(PREFIX) && name !== CACHE)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE")
    event.waitUntil(self.skipWaiting());
});

function redirect(parameters) {
  const url = new URL(indexURL);
  for (const [name, value] of Object.entries(parameters))
    url.searchParams.set(name, value);
  return Response.redirect(url.href, 303);
}
async function receiveShare(request) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return redirect({ "share-error": "missing" });
  }
  try {
    const files = form.getAll("files").filter((value) => value instanceof File);
    if (files.length !== 1)
      return redirect({ "share-error": files.length ? "multiple" : "missing" });
    const file = files[0];
    if (!/\.stl$/i.test(file.name) || !file.size)
      return redirect({ "share-error": "type" });
    const id = await putSharedFile(file);
    return redirect({ shared: id });
  } catch {
    return redirect({ "share-error": "storage" });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === "POST" && url.href === shareURL) {
    // Consume the multipart body locally; never forward STL bytes to the host.
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== "GET") return;
  const isIndex =
    url.pathname === new URL(BASE).pathname ||
    url.pathname === new URL(indexURL).pathname;
  if (!isIndex && !assetPaths.has(url.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(
        isIndex ? indexURL : url.origin + url.pathname,
      );
      return cached || fetch(request);
    })(),
  );
});
