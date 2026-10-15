// Optional end-to-end check: npm install --no-save playwright
// npx playwright install chromium && node tests/browser-smoke.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TorusKnotGeometry } from "../vendor/three/three.module.js";
import { exportBinarySTL } from "../mesh-utils.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "ibero-viewer-"));
const server = spawn(
  process.env.PYTHON || "python",
  ["-m", "http.server", "8787", "--bind", "127.0.0.1"],
  { cwd: root, stdio: "ignore" },
);
let serverError;
server.on("error", (error) => {
  serverError = error;
});
let browser;
try {
  for (let i = 0; i < 50; i++) {
    if (serverError) throw serverError;
    try {
      if ((await fetch("http://127.0.0.1:8787")).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
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
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.draws = 0;
    window.ticks = 0;
    setInterval(() => window.ticks++, 10);
    for (const type of [WebGLRenderingContext, WebGL2RenderingContext]) {
      for (const name of ["drawArrays", "drawElements"]) {
        const original = type.prototype[name];
        type.prototype[name] = function (...args) {
          window.draws++;
          return original.apply(this, args);
        };
      }
    }
  });
  await page.goto("http://127.0.0.1:8787");
  const idle = () =>
    page.waitForFunction(() => document.getElementById("busy").hidden, {
      timeout: 90000,
    });
  const triangles = async () =>
    Number((await page.locator("#fTris").textContent()).replaceAll(",", ""));
  const upload = async (name, buffer) => {
    await page
      .locator("#file")
      .setInputFiles({ name, mimeType: "model/stl", buffer });
    await idle();
  };
  const ascii = Buffer.from(
    "solid t\nfacet normal 0 0 1\nouter loop\nvertex 1 2 3\nvertex 3 2 3\nvertex 1 4 3\nendloop\nendfacet\nendsolid t",
  );
  await upload("triangle.stl", ascii);
  assert.equal(await triangles(), 1);
  assert(await page.locator("#btnSimplify").isDisabled());
  await upload("bad.stl", Buffer.from("not an STL"));
  assert.equal(await triangles(), 1);
  assert(
    await page
      .locator("#status")
      .evaluate((element) => element.classList.contains("error")),
  );
  await upload("truncated.stl", Buffer.alloc(100));
  assert.equal(await triangles(), 1);
  await page.click("#btnDemo");
  await idle();
  assert.equal(await triangles(), 40960);
  await page.waitForTimeout(800);
  const draws = await page.evaluate(() => window.draws);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.draws), draws);
  await page.locator("#targetTriangles").fill("10000");
  await page.click("#btnSimplify");
  await idle();
  const reduced = await triangles();
  assert(reduced <= 10000);
  await page.click("#btnOriginal");
  assert.equal(await triangles(), 40960);
  await page.click("#btnOptimized");
  assert.equal(await triangles(), reduced);
  await page.locator("details").last().locator("summary").click();
  await page.click('[data-rotate="z,1"]');
  await page.click('[data-move="x,1"]');
  const dimensions = await page.locator("#fDims").textContent(),
    center = await page.locator("#fCenter").textContent();
  const downloadEvent = page.waitForEvent("download");
  await page.click("#btnSave");
  const download = await downloadEvent;
  await download.saveAs(join(temp, "export.stl"));
  const exported = await readFile(join(temp, "export.stl"));
  assert.equal(exported.length, 84 + reduced * 50);
  await upload("export.stl", exported);
  assert.equal(await triangles(), reduced);
  assert.equal(await page.locator("#fDims").textContent(), dimensions);
  assert.equal(await page.locator("#fCenter").textContent(), center);
  await page.click("#chkCenterLoad");
  await upload("offset.stl", ascii);
  assert.equal(await page.locator("#fCenter").textContent(), "0 , 0 , 0");
  await page.click("#chkCenterLoad");

  const fixture = new TorusKnotGeometry(35, 11, 1600, 256);
  const heavy = Buffer.from(
    exportBinarySTL(
      fixture.attributes.position.array,
      fixture.index.array,
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    ),
  );
  await upload("heavy.stl", heavy);
  assert.equal(await triangles(), 819200);
  await page.locator("#reduction").fill("90");
  await page.locator("#reduction").dispatchEvent("input");
  await page.click("#btnSimplify");
  await page.click("#btnCancel");
  assert.equal(await triangles(), 819200);
  assert(await page.locator("#comparison").isHidden());
  const tick = await page.evaluate(() => window.ticks);
  await page.click("#btnSimplify");
  await idle();
  assert((await triangles()) <= 81920);
  assert((await page.evaluate(() => window.ticks)) - tick > 5);
  console.log(
    "Heavy STL:",
    heavy.length,
    "bytes; result:",
    await triangles(),
    "triangles;",
    await page.locator("#status").textContent(),
  );
  await page.locator("#targetTriangles").fill("50000");
  await page.click("#btnSimplify");
  await idle();
  assert((await triangles()) <= 50000);
  await page.click("#btnRestore");
  assert.equal(await triangles(), 819200);
  await page.click("#btnDemo");
  await upload("latest.stl", ascii);
  assert.equal(await triangles(), 1);
  assert.equal(await page.locator("#fName").textContent(), "latest.stl");
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: ASCII/binary, invalid preservation, idle rendering, simplification, comparison, transformed export/reload, centering, cancellation, large model, repeat/restore, latest load, mobile.",
  );
} finally {
  await browser?.close();
  server.kill();
  await rm(temp, { recursive: true, force: true });
}
