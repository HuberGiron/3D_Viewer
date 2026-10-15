// Optional integration test: node tests/pwa-smoke.mjs (requires Playwright).
// Exercises the real service worker under a subdirectory, like GitHub Pages.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
let postRequests = 0,
  nextVersion = false;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
};
const server = createServer(async (request, response) => {
  if (request.method !== "GET") {
    postRequests++;
    response.writeHead(405).end();
    return;
  }
  const url = new URL(request.url, "http://localhost");
  if (!url.pathname.startsWith("/viewer/")) {
    response.writeHead(404).end();
    return;
  }
  const path = resolve(
    root,
    decodeURIComponent(url.pathname.slice("/viewer/".length)) || "index.html",
  );
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    let content = await readFile(path);
    if (nextVersion && path === resolve(root, "sw.js"))
      content = Buffer.from(content.toString().replace("pwa-1", "pwa-test-2"));
    response
      .writeHead(200, {
        "Content-Type": mime[extname(path)] || "application/octet-stream",
        "Cache-Control": "no-store",
      })
      .end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/viewer/`;
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage(),
    errors = [];
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  console.log(
    "PWA page loaded",
    await page.locator("#pwaStatus").textContent(),
  );
  await page.waitForFunction(
    () => Boolean(navigator.serviceWorker.controller),
    { timeout: 15000 },
  );
  await page.evaluate(() => navigator.serviceWorker.ready);
  console.log("PWA cache ready");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const manifest = await page.evaluate(async () =>
    (await fetch("manifest.webmanifest")).json(),
  );
  assert.equal(manifest.display, "standalone");
  assert.equal(
    new URL(manifest.share_target.action, base).href,
    base + "share-target",
  );
  assert.equal(manifest.share_target.method, "POST");
  assert(
    manifest.share_target.params.files[0].accept.includes(
      "application/octet-stream",
    ),
  );
  const cdp = await context.newCDPSession(page);
  const installability = await cdp.send("Page.getInstallabilityErrors");
  console.log("PWA installability", installability);
  assert.deepEqual(installability.installabilityErrors, []);
  const iconSizes = await page.evaluate(async () =>
    Promise.all(
      [192, 512].map(async (size) => {
        const image = await createImageBitmap(
          await (await fetch(`assets/app-icon-${size}.png`)).blob(),
        );
        return [image.width, image.height];
      }),
    ),
  );
  assert.deepEqual(iconSizes, [
    [192, 192],
    [512, 512],
  ]);
  await page.click("#btnInstall");
  assert(await page.locator("#installHelp").isVisible());
  await page.getByRole("button", { name: "Entendido" }).click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const receive = async (names) => {
    const navigation = page.waitForNavigation();
    await page.evaluate((names) => {
      const ascii =
        "solid t\nfacet normal 0 0 1\nouter loop\nvertex 1 2 3\nvertex 3 2 3\nvertex 1 4 3\nendloop\nendfacet\nendsolid t";
      const data = new DataTransfer();
      for (const name of names)
        data.items.add(
          new File([ascii], name, { type: "application/octet-stream" }),
        );
      const input = document.createElement("input");
      input.type = "file";
      input.name = "files";
      input.multiple = true;
      input.files = data.files;
      const form = document.createElement("form");
      form.action = new URL("share-target", location.href);
      form.method = "POST";
      form.enctype = "multipart/form-data";
      if (names.length) form.append(input);
      document.body.append(form);
      form.submit();
    }, names);
    await navigation;
  };
  // Receiving is local even while completely offline. This is the same multipart
  // POST that Android's share sheet supplies to the manifest action.
  await context.setOffline(true);
  await receive(["compartido.STL"]);
  console.log("PWA offline share delivered", page.url());
  await page.waitForFunction(
    () => document.getElementById("fName").textContent === "compartido.STL",
  );
  assert.equal(await page.locator("#fTris").textContent(), "1");
  assert.equal(new URL(page.url()).search, "");
  assert.equal(postRequests, 0);
  const stored = await page.evaluate(async () => {
    const module = await import("./share-store.js");
    const id = await module.putSharedFile(new File(["data"], "atomic.stl"));
    const [a, b] = await Promise.all([
      module.takeSharedFile(id),
      module.takeSharedFile(id),
    ]);
    return [Boolean(a), Boolean(b)];
  });
  assert.equal(stored.filter(Boolean).length, 1);
  await receive(["bad.txt"]);
  await page.waitForFunction(() =>
    document.getElementById("status").classList.contains("error"),
  );
  assert((await page.locator("#status").textContent()).includes(".stl"));
  await receive([]);
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.includes("no entregó"),
  );
  await receive(["a.stl", "b.stl"]);
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.includes("un solo"),
  );
  await page.reload();
  await page.click("#btnDemo");
  await page.waitForFunction(() => document.getElementById("busy").hidden);
  await page.click("#btnSimplify");
  await page.waitForFunction(
    () => !document.getElementById("comparison").hidden,
  );
  assert.equal(await page.locator("#fTris").textContent(), "20,480");
  assert.equal(postRequests, 0);
  // A new deployment waits for an explicit update, preserves unrelated caches,
  // and does not reload a model spontaneously.
  await context.setOffline(false);
  await page.evaluate(async () => {
    await caches.open("unrelated-app");
    await caches.open("ibero-3d:/viewer/:obsolete-test");
  });
  nextVersion = true;
  await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistration()).update(),
  );
  await page.waitForFunction(
    () => !document.getElementById("btnUpdateApp").hidden,
  );
  assert.equal(await page.locator("#fTris").textContent(), "20,480");
  await page.click("#btnUpdateApp");
  await page.waitForFunction(
    () => document.getElementById("fName").textContent === "Sin archivo",
  );
  const cachesAfter = await page.evaluate(() => caches.keys());
  assert(cachesAfter.includes("unrelated-app"));
  assert(!cachesAfter.includes("ibero-3d:/viewer/:obsolete-test"));
  assert(cachesAfter.includes("ibero-3d:/viewer/:2026-10-15-pwa-test-2"));
  assert.deepEqual(errors, []);
  console.log(
    "PASS PWA: installability, icons, subdirectory scope, offline STL shares, single-use storage, invalid/missing/multiple files, offline WASM, explicit update, cache isolation, mobile layout. Native Android install/share sheet still requires a real-device test.",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
