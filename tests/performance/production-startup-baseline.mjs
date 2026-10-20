import { chromium } from "playwright";
import { build } from "vite";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chromePath = process.env.PW_CHROME_PATH
  ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outputDirectory = await mkdtemp(path.join(tmpdir(), "port-startup-59-"));
const buildDirectory = path.join(outputDirectory, "production");
const resultPath = path.join(outputDirectory, "samples.json");
let server;
let browser;

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json"],
  [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".glb", "model/gltf-binary"],
  [".woff2", "font/woff2"], [".woff", "font/woff"],
]);

function listen(target) {
  return new Promise((resolve, reject) => {
    target.once("error", reject);
    target.listen(0, "127.0.0.1", () => {
      target.off("error", reject);
      resolve(target.address().port);
    });
  });
}

function safeFile(root, pathname) {
  const decoded = decodeURIComponent(pathname.split("?")[0]);
  const resolved = path.resolve(root, `.${decoded}`);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function startStaticServer(root) {
  const instance = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "POST" && url.pathname === "/api/containers/sync") {
        request.resume();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ synchronized: true, count: 0, total: 0 }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "No backend in performance baseline" } }));
      return;
    }

    let file = safeFile(root, url.pathname);
    if (file) {
      try {
        if (!(await stat(file)).isFile()) file = null;
      } catch {
        file = null;
      }
    }
    if (!file) file = path.join(root, "index.html");

    try {
      const headers = {
        "content-type": mimeTypes.get(path.extname(file)) ?? "application/octet-stream",
        "cache-control": path.basename(file) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
      };
      response.writeHead(200, headers);
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return { instance, listen: () => listen(instance) };
}

async function measure(context, url, phase, iteration, { observeWebGLDraw = false } = {}) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const state = window.__startupObservation = { firstCanvasAt: null, lcp: null, longTasks: [] };
    const recordCanvas = () => {
      if (state.firstCanvasAt !== null || !document.querySelector("canvas")) return;
      state.firstCanvasAt = performance.now();
    };
    new MutationObserver(recordCanvas).observe(document, { childList: true, subtree: true });
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) state.lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    try {
      new PerformanceObserver((entries) => {
        state.longTasks.push(...entries.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })));
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Long Task API is not available in every Chrome build.
    }
  });
  if (observeWebGLDraw) {
    await page.addInitScript(() => {
      const state = window.__startupObservation;
      const recordFirstDraw = (prototype, method) => {
        if (!prototype || typeof prototype[method] !== "function") return;
        const original = prototype[method];
        prototype[method] = function (...args) {
          if (state.firstWebGLDrawAt === null) state.firstWebGLDrawAt = performance.now();
          return original.apply(this, args);
        };
      };
      state.firstWebGLDrawAt = null;
      for (const name of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
        const prototype = window[name]?.prototype;
        for (const method of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
          recordFirstDraw(prototype, method);
        }
      }
    });
  }
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  const network = [];
  const requestIds = new Map();
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  session.on("Network.requestWillBeSent", (event) => requestIds.set(event.requestId, event.request.url));
  session.on("Network.responseReceived", (event) => {
    const requestUrl = event.response.url;
    if (requestUrl.startsWith(url)) network.push({
      url: requestUrl,
      status: event.response.status,
      fromDiskCache: event.response.fromDiskCache,
      fromServiceWorker: event.response.fromServiceWorker,
      contentEncoding: event.response.headers["content-encoding"] ?? event.response.headers["Content-Encoding"] ?? null,
      mimeType: event.response.mimeType,
      encodedBytes: null,
      resourceType: event.type,
    });
  });
  session.on("Network.loadingFinished", (event) => {
    const requestUrl = requestIds.get(event.requestId);
    const item = network.findLast((entry) => entry.url === requestUrl && entry.encodedBytes === null);
    if (item) item.encodedBytes = event.encodedDataLength;
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? "unknown" }));

  const startedAt = Date.now();
  let navigationError = null;
  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 120_000 });
    const pageData = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const resources = performance.getEntriesByType("resource");
      const paints = performance.getEntriesByType("paint");
      const canvas = [...document.querySelectorAll("canvas")].find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const observation = window.__startupObservation;
      return {
        navigation: navigation ? {
          startTime: navigation.startTime,
          responseStart: navigation.responseStart,
          domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
          loadEventEnd: navigation.loadEventEnd,
          transferSize: navigation.transferSize,
          encodedBodySize: navigation.encodedBodySize,
          decodedBodySize: navigation.decodedBodySize,
        } : null,
        paints: Object.fromEntries(paints.map((entry) => [entry.name, entry.startTime])),
        lcp: observation?.lcp ?? null,
        firstCanvasAt: observation?.firstCanvasAt ?? null,
        firstWebGLDrawAt: observation?.firstWebGLDrawAt ?? null,
        longTasks: observation?.longTasks ?? [],
        canvas: canvas ? { width: canvas.width, height: canvas.height, cssWidth: canvas.getBoundingClientRect().width, cssHeight: canvas.getBoundingClientRect().height } : null,
        resources: resources.map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          startTime: entry.startTime,
          duration: entry.duration,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
        })),
      };
    });
    const mainResources = pageData.resources.filter((entry) => /\.(?:js|css)(?:\?|$)/.test(entry.name));
    const mainResponses = network.filter((entry) => /\.(?:js|css)(?:\?|$)/.test(new URL(entry.url).pathname));
    const sample = {
      phase,
      iteration,
      valid: Boolean(response?.ok() && pageData.canvas && pageErrors.length === 0 && failedRequests.length === 0),
      invalidReason: !response?.ok() ? `document HTTP ${response?.status() ?? "no response"}` : !pageData.canvas ? "no non-zero-size WebGL canvas" : pageErrors.length ? `page error: ${pageErrors.join(" | ")}` : failedRequests.length ? `failed request: ${failedRequests.map((item) => item.url).join(" | ")}` : null,
      elapsedWallClockMs: Date.now() - startedAt,
      documentStatus: response?.status() ?? null,
      navigation: pageData.navigation,
      paints: pageData.paints,
      lcp: pageData.lcp,
      canvas: pageData.canvas,
        firstCanvasAtMs: pageData.firstCanvasAt,
        firstWebGLDrawAtMs: pageData.firstWebGLDrawAt,
        longTasks: pageData.longTasks,
      runtimeReady: { measured: false, reason: "runtime-ready is emitted only under import.meta.env.DEV; production build has no runtime-ready signal" },
      firstWebGLDraw: { measured: false, reason: "not observable without page-load WebGL instrumentation; instrumentation excluded from primary timings" },
      mainResources,
      network: network.map((entry) => ({ ...entry, isMainResource: /\.(?:js|css)(?:\?|$)/.test(new URL(entry.url).pathname) })),
      mainResponses,
      pageErrors,
      consoleErrors,
      failedRequests,
      apiWritesStubbed: true,
      responseContentEncoding: mainResponses.map(({ url: resourceUrl, contentEncoding }) => ({ url: resourceUrl, contentEncoding })),
    };
    return sample;
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
    return { phase, iteration, valid: false, invalidReason: navigationError, elapsedWallClockMs: Date.now() - startedAt, pageErrors, consoleErrors, failedRequests, network };
  } finally {
    await session.detach().catch(() => {});
    await page.close();
  }
}

function summarize(samples) {
  const valid = samples.filter((sample) => sample.valid).map((sample) => sample.elapsedWallClockMs).sort((a, b) => a - b);
  const median = valid.length ? valid[Math.floor(valid.length / 2)] : null;
  return {
    validSamples: valid.length,
    failedSamples: samples.length - valid.length,
    medianElapsedWallClockMs: median,
    minimumElapsedWallClockMs: valid[0] ?? null,
    maximumElapsedWallClockMs: valid.at(-1) ?? null,
  };
}

try {
  await build({
    configFile: path.join(projectRoot, "vite.config.js"),
    root: projectRoot,
    mode: "production",
    build: { outDir: buildDirectory, emptyOutDir: true },
  });
  const resolvedBuild = path.resolve(buildDirectory);
  if (resolvedBuild.startsWith(`${projectRoot}${path.sep}`)) throw new Error(`Refusing to use in-project build output: ${resolvedBuild}`);
  const preview = startStaticServer(buildDirectory);
  server = preview.instance;
  const port = await preview.listen();
  const url = `http://127.0.0.1:${port}/`;
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const chromeVersion = browser.version();
  const cold = [];
  const hot = [];
  const runCount = 7;

  for (let index = 1; index <= runCount; index += 1) {
    const context = await browser.newContext();
    const sample = await measure(context, url, "cold-independent-context", index);
    cold.push(sample);
    await context.close();
    console.log(`cold ${index}/${runCount}: ${sample.valid ? `${sample.elapsedWallClockMs}ms` : `FAILED ${sample.invalidReason}`}`);
  }

  const hotContext = await browser.newContext();
  const hotWarmup = await measure(hotContext, url, "hot-cache-warmup-not-counted", 0);
  console.log(`hot warm-up (excluded): ${hotWarmup.valid ? `${hotWarmup.elapsedWallClockMs}ms` : `FAILED ${hotWarmup.invalidReason}`}`);
  for (let index = 1; index <= runCount; index += 1) {
    const sample = await measure(hotContext, url, "hot-same-context-session", index);
    hot.push(sample);
    console.log(`hot ${index}/${runCount}: ${sample.valid ? `${sample.elapsedWallClockMs}ms` : `FAILED ${sample.invalidReason}`}`);
  }
  await hotContext.close();

  const diagnosticContext = await browser.newContext();
  const webglDiagnostic = await measure(diagnosticContext, url, "diagnostic-webgl-instrumented", 1, { observeWebGLDraw: true });
  webglDiagnostic.instrumented = true;
  webglDiagnostic.excludedFromPrimaryStatistics = true;
  if (webglDiagnostic.firstWebGLDrawAtMs !== undefined) {
    webglDiagnostic.firstWebGLDraw = { measured: webglDiagnostic.firstWebGLDrawAtMs !== null, timeSinceNavigationMs: webglDiagnostic.firstWebGLDrawAtMs, instrumentation: "one-shot wrappers around WebGL draw methods installed before page scripts; timing is diagnostic only" };
  }
  await diagnosticContext.close();

  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    environment: { platform: process.platform, arch: process.arch, node: process.version, chromeVersion, chromeExecutable: chromePath },
    build: { mode: "production", outDir: resolvedBuild, outsideProjectRoot: !resolvedBuild.startsWith(`${projectRoot}${path.sep}`), source: "current vite.config.js + installed Vite production build" },
    server: { url, type: "local static server", cacheControl: "index no-cache; emitted non-HTML files public max-age=31536000 immutable", contentEncoding: "none (local static server does not compress responses)" },
    conditions: {
      cold: "Seven new isolated Playwright browser contexts in the same Chrome process; each context has a fresh HTTP cache and no service worker state. This is a clean-context cold cache, not a cleared persistent profile.",
      hot: "Seven top-level navigations in one persistent browser context after the first navigation; HTTP cache remains enabled.",
      caveats: ["Network and machine state are local and uncontrolled; samples are a local baseline, not deployment-user timings.", "No backend is started. GET API endpoints return 404; POST /api/containers/sync is locally stubbed with a side-effect-free response to prevent DB writes.", "Canvas creation is observed, but it is not treated as Runtime ready or a successful first draw."],
    },
    sampleSummary: { cold: summarize(cold), hot: summarize(hot) },
    samples: { cold, hotWarmup, hot, webglDiagnostic },
    files: { buildDirectory: resolvedBuild, rawData: resultPath },
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`\nRaw data: ${resultPath}`);
  console.log(`Cold summary: ${JSON.stringify(result.sampleSummary.cold)}`);
  console.log(`Hot summary: ${JSON.stringify(result.sampleSummary.hot)}`);
  if (cold.filter((sample) => sample.valid).length < runCount || hot.filter((sample) => sample.valid).length < runCount) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
}
