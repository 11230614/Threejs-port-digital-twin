import { chromium } from "playwright";
import { build } from "vite";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chromePath = process.env.PW_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const output = await mkdtemp(path.join(tmpdir(), "port-first-frame-61-"));
let browser;
let server;
const contexts = new Set();

const mime = new Map([[".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"], [".glb", "model/gltf-binary"], [".json", "application/json"], [".ico", "image/x-icon"]]);

function listen(target) {
  return new Promise((resolve, reject) => {
    target.once("error", reject);
    target.listen(0, "127.0.0.1", () => { target.off("error", reject); resolve(target.address().port); });
  });
}

function safeFile(dir, pathname) {
  const resolved = path.resolve(dir, `.${decodeURIComponent(pathname.split("?")[0])}`);
  return resolved.startsWith(`${dir}${path.sep}`) ? resolved : null;
}

function serve(dir) {
  const instance = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "POST" && url.pathname === "/api/containers/sync") { request.resume(); response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ synchronized: true, count: 0, total: 0 })); return; }
      response.writeHead(404, { "content-type": "application/json" }); response.end(JSON.stringify({ error: { message: "diagnostic stub" } })); return;
    }
    let file = safeFile(dir, url.pathname);
    try { if (!file || !(await stat(file)).isFile()) file = null; } catch { file = null; }
    if (!file) file = path.join(dir, "index.html");
    response.writeHead(200, { "content-type": mime.get(path.extname(file)) ?? "application/octet-stream", "cache-control": path.basename(file) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable" });
    createReadStream(file).pipe(response);
  });
  return { instance, listen: () => listen(instance) };
}

function diagnosticPlugin(disableBloom) {
  return {
    name: `first-frame-diagnostics-${disableBloom ? "no-bloom" : "normal"}`,
    enforce: "post",
    transform(code, id) {
      if (id.endsWith("/src/app/PortRuntime.ts")) {
        return { code: code.replace("async start() {", 'async start() { performance.mark("runtime-start");').replace("this.renderSystem.start();", 'performance.mark("systems-started"); this.renderSystem.start(); performance.mark("render-system-start-called");'), map: null };
      }
      if (!id.endsWith("/src/rendering/RenderSystem.ts")) return null;
      let next = code
        .replace(/this\.composer\s*=\s*new EffectComposer\(renderer\);[\s\S]*?this\.composer\.addPass\(new OutputPass\(\)\);/, (match) => `${match} performance.mark("composer-created");`)
        .replace(/const animate = \(\): void => \{/, 'const animate = (): void => { if (this.frameCount === 0) performance.mark("first-frame-start");')
        .replace(/this\.composer\.render\(\);/, 'performance.mark("composer-render-start"); this.composer.render(); performance.mark("composer-render-end"); if (this.frameCount === 0) performance.mark("first-frame-end");');
      if (disableBloom) next = next.replace(/this\.composer\.addPass\(new UnrealBloomPass\(([^;]+)\);/, (match) => `${match} this.composer.passes[this.composer.passes.length - 1].enabled = false;`);
      return { code: next, map: null };
    },
  };
}

async function buildVariant(disableBloom) {
  const dir = path.join(output, disableBloom ? "no-bloom" : "normal");
  await mkdir(dir, { recursive: true });
  await build({ configFile: path.join(root, "vite.config.js"), root, mode: "production", plugins: [diagnosticPlugin(disableBloom)], build: { outDir: dir, emptyOutDir: true } });
  return dir;
}

async function observe(context, url, condition, phase, index) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const state = window.__firstFrame = { canvas: null, draw: null, longTasks: [], errors: [] };
    const canvasObserver = new MutationObserver(() => { if (state.canvas === null && document.querySelector("canvas")) state.canvas = performance.now(); });
    canvasObserver.observe(document, { childList: true, subtree: true });
    try { new PerformanceObserver((list) => state.longTasks.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })))).observe({ type: "longtask", buffered: true }); } catch { /* unsupported */ }
    for (const name of ["WebGLRenderingContext", "WebGL2RenderingContext"]) for (const method of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
      const prototype = window[name]?.prototype; const original = prototype?.[method]; if (!original) continue;
      prototype[method] = function (...args) { if (state.draw === null) state.draw = performance.now(); return original.apply(this, args); };
    }
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const responses = []; const ids = new Map();
  cdp.on("Network.requestWillBeSent", (event) => ids.set(event.requestId, event.request.url));
  cdp.on("Network.responseReceived", (event) => { if (event.response.url.startsWith(url)) responses.push({ url: event.response.url, status: event.response.status, fromDiskCache: event.response.fromDiskCache, encodedBytes: null, type: event.type }); });
  cdp.on("Network.loadingFinished", (event) => { const item = responses.findLast((entry) => entry.url === ids.get(event.requestId) && entry.encodedBytes === null); if (item) item.encodedBytes = event.encodedDataLength; });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  const started = Date.now(); let response;
  try { response = await page.goto(url, { waitUntil: "load", timeout: 120_000 }); await page.waitForLoadState("networkidle", { timeout: 120_000 }); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  const observation = await page.evaluate(() => {
    const names = ["runtime-start", "systems-started", "render-system-start-called", "composer-created", "first-frame-start", "composer-render-start", "composer-render-end", "first-frame-end"];
    const marks = Object.fromEntries(names.map((name) => [name, performance.getEntriesByName(name).at(-1)?.startTime ?? null]));
    const navigation = performance.getEntriesByType("navigation")[0];
    return { marks, canvas: window.__firstFrame.canvas, draw: window.__firstFrame.draw, longTasks: window.__firstFrame.longTasks, paints: Object.fromEntries(performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime])), navigation: navigation ? { responseStart: navigation.responseStart, load: navigation.loadEventEnd } : null };
  });
  const sample = { condition, phase, index, valid: Boolean(response?.ok() && observation.canvas !== null && errors.length === 0), elapsedToNetworkIdleMs: Date.now() - started, status: response?.status() ?? null, observation, errors, network: responses };
  await cdp.detach().catch(() => {}); await page.close(); return sample;
}

async function runVariant(condition, dir) {
  const preview = serve(dir); server = preview.instance; const port = await preview.listen(); const url = `http://127.0.0.1:${port}/`;
  const samples = { cold: [], hot: [] };
  for (let i = 1; i <= 5; i += 1) { const context = await browser.newContext(); contexts.add(context); samples.cold.push(await observe(context, url, condition, "cold", i)); await context.close(); contexts.delete(context); }
  const hot = await browser.newContext(); contexts.add(hot); const warm = await hot.newPage(); await warm.goto(url, { waitUntil: "load", timeout: 120_000 }); await warm.waitForLoadState("networkidle", { timeout: 120_000 }); await warm.close();
  for (let i = 1; i <= 5; i += 1) samples.hot.push(await observe(hot, url, condition, "hot", i));
  await hot.close(); contexts.delete(hot); await new Promise((resolve) => server.close(resolve)); server = null;
  return samples;
}

function summary(samples) {
  const valid = samples.filter((sample) => sample.valid);
  const values = (selector) => valid.map(selector).filter(Number.isFinite).sort((a, b) => a - b);
  const median = (values) => values.length ? values[Math.floor(values.length / 2)] : null;
  return { validSamples: valid.length, totalSamples: samples.length, networkIdleMs: (() => { const v = values((s) => s.elapsedToNetworkIdleMs); return { median: median(v), min: v[0] ?? null, max: v.at(-1) ?? null }; })(), firstFrameDurationMs: (() => { const v = values((s) => s.observation.marks["first-frame-end"] - s.observation.marks["first-frame-start"]); return { median: median(v), min: v[0] ?? null, max: v.at(-1) ?? null }; })(), composerDurationMs: (() => { const v = values((s) => s.observation.marks["composer-render-end"] - s.observation.marks["composer-render-start"]); return { median: median(v), min: v[0] ?? null, max: v.at(-1) ?? null }; })(), firstDrawMs: (() => { const v = values((s) => s.observation.draw); return { median: median(v), min: v[0] ?? null, max: v.at(-1) ?? null }; })(), longestLongTaskMs: (() => { const v = values((s) => Math.max(...s.observation.longTasks.map((task) => task.duration), 0)); return { median: median(v), min: v[0] ?? null, max: v.at(-1) ?? null }; })() };
}

try {
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const result = { schemaVersion: 1, createdAt: new Date().toISOString(), environment: { node: process.version, chromeVersion: browser.version(), chromeExecutable: chromePath }, conditions: { normal: { bloom: "enabled" }, noBloom: { bloom: "disabled by diagnostic build transform; all other code unchanged" } }, samples: {}, summaries: {} };
  result.samples.normal = await runVariant("normal", await buildVariant(false));
  result.summaries.normal = Object.fromEntries(Object.entries(result.samples.normal).map(([phase, samples]) => [phase, summary(samples)]));
  result.samples.noBloom = await runVariant("no-bloom", await buildVariant(true));
  result.summaries.noBloom = Object.fromEntries(Object.entries(result.samples.noBloom).map(([phase, samples]) => [phase, summary(samples)]));
  const resultPath = path.join(output, "first-frame-summary.json"); await writeFile(resultPath, `${JSON.stringify({ ...result, outputDirectory: output, resultPath }, null, 2)}\n`); console.log(`Raw samples and summary: ${resultPath}`);
  if ([...Object.values(result.samples)].flat().some((sample) => !sample.valid)) process.exitCode = 1;
} finally {
  await Promise.all([...contexts].map((context) => context.close().catch(() => {})));
  await browser?.close(); if (server?.listening) await new Promise((resolve) => server.close(resolve));
}
