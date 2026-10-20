import { chromium } from "playwright";
import { build } from "vite";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceMapConsumer } from "source-map-js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chromePath = process.env.PW_CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outputDirectory = await mkdtemp(path.join(tmpdir(), "port-long-task-60-"));
const buildDirectory = path.join(outputDirectory, "diagnostic-production");
const profilesDirectory = path.join(outputDirectory, "profiles");
const tracesDirectory = path.join(outputDirectory, "traces");
await Promise.all([profilesDirectory, tracesDirectory].map((directory) => mkdir(directory)));
let server;
let browser;
const contexts = new Set();

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json"], [".map", "application/json"],
  [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".glb", "model/gltf-binary"],
  [".woff2", "font/woff2"], [".woff", "font/woff"],
]);

function listen(target) {
  return new Promise((resolve, reject) => {
    target.once("error", reject);
    target.listen(0, "127.0.0.1", () => { target.off("error", reject); resolve(target.address().port); });
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
      } else {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "No backend in performance diagnostic" } }));
      }
      return;
    }
    let file = safeFile(root, url.pathname);
    if (file) {
      try { if (!(await stat(file)).isFile()) file = null; } catch { file = null; }
    }
    if (!file) file = path.join(root, "index.html");
    response.writeHead(200, {
      "content-type": mimeTypes.get(path.extname(file)) ?? "application/octet-stream",
      "cache-control": path.basename(file) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    createReadStream(file).pipe(response);
  });
  return { instance, listen: () => listen(instance) };
}

async function installPageObservations(page) {
  await page.addInitScript(() => {
    const state = window.__startupObservation = { firstCanvasAt: null, firstWebGLDrawAt: null, lcp: null, longTasks: [] };
    const findCanvas = () => {
      if (state.firstCanvasAt === null && document.querySelector("canvas")) state.firstCanvasAt = performance.now();
    };
    new MutationObserver(findCanvas).observe(document, { childList: true, subtree: true });
    new PerformanceObserver((entries) => { for (const entry of entries.getEntries()) state.lcp = entry.startTime; })
      .observe({ type: "largest-contentful-paint", buffered: true });
    try {
      new PerformanceObserver((entries) => state.longTasks.push(...entries.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration }))))
        .observe({ type: "longtask", buffered: true });
    } catch { /* Long Task API unavailable. */ }

    for (const interfaceName of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
      const prototype = window[interfaceName]?.prototype;
      for (const method of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
        if (!prototype || typeof prototype[method] !== "function") continue;
        const original = prototype[method];
        prototype[method] = function (...args) {
          if (state.firstWebGLDrawAt === null) state.firstWebGLDrawAt = performance.now();
          return original.apply(this, args);
        };
      }
    }
  });
}

async function collectProfile(context, url, mode, index) {
  const profilePath = path.join(profilesDirectory, `${mode}-${index}.cpuprofile`);
  const contextPage = await context.newPage();
  await installPageObservations(contextPage);
  const session = await context.newCDPSession(contextPage);
  await session.send("Network.enable");
  const network = [];
  const requestIds = new Map();
  session.on("Network.requestWillBeSent", (event) => requestIds.set(event.requestId, event.request.url));
  session.on("Network.responseReceived", (event) => {
    if (event.response.url.startsWith(url)) network.push({ url: event.response.url, status: event.response.status, fromDiskCache: event.response.fromDiskCache, mimeType: event.response.mimeType, contentEncoding: event.response.headers["content-encoding"] ?? null, encodedBytes: null, resourceType: event.type });
  });
  session.on("Network.loadingFinished", (event) => {
    const item = network.findLast((record) => record.url === requestIds.get(event.requestId) && record.encodedBytes === null);
    if (item) item.encodedBytes = event.encodedDataLength;
  });
  const pageErrors = [];
  const failedRequests = [];
  contextPage.on("pageerror", (error) => pageErrors.push(error.message));
  contextPage.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? "unknown" }));
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 1000 });
  await session.send("Profiler.start");
  const startedAt = Date.now();
  let documentStatus = null;
  let failure = null;
  let observations = null;
  let profile;
  try {
    const response = await contextPage.goto(url, { waitUntil: "load", timeout: 120_000 });
    documentStatus = response?.status() ?? null;
    await contextPage.waitForLoadState("networkidle", { timeout: 120_000 });
    observations = await contextPage.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      return {
        navigation: navigation ? { responseStart: navigation.responseStart, dcl: navigation.domContentLoadedEventEnd, load: navigation.loadEventEnd } : null,
        paints: Object.fromEntries(performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime])),
        firstCanvasAt: window.__startupObservation.firstCanvasAt,
        firstWebGLDrawAt: window.__startupObservation.firstWebGLDrawAt,
        lcp: window.__startupObservation.lcp,
        longTasks: window.__startupObservation.longTasks,
      };
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    profile = (await session.send("Profiler.stop")).profile;
    await session.send("Profiler.disable").catch(() => {});
  }
  await writeFile(profilePath, `${JSON.stringify(profile)}\n`, "utf8");
  const sample = {
    mode,
    index,
    valid: !failure && documentStatus >= 200 && documentStatus < 400 && observations?.firstCanvasAt != null && pageErrors.length === 0 && failedRequests.length === 0,
    failure,
    documentStatus,
    elapsedToNetworkIdleMs: Date.now() - startedAt,
    observations,
    pageErrors,
    failedRequests,
    network,
    profilePath,
    sampleCount: profile.samples?.length ?? 0,
    profileDurationMs: profile.endTime && profile.startTime ? (profile.endTime - profile.startTime) / 1000 : null,
  };
  await session.detach().catch(() => {});
  await contextPage.close();
  return { sample, profile };
}

async function collectTrace(context, url, mode, consumer) {
  const tracePath = path.join(tracesDirectory, `${mode}-startup-trace.json`);
  const profilePath = path.join(profilesDirectory, `${mode}-trace-correlated.cpuprofile`);
  const page = await context.newPage();
  await installPageObservations(page);
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  const chunks = [];
  const network = [];
  const requestIds = new Map();
  session.on("Network.requestWillBeSent", (event) => requestIds.set(event.requestId, event.request.url));
  session.on("Network.responseReceived", (event) => {
    if (event.response.url.startsWith(url)) network.push({ url: event.response.url, status: event.response.status, fromDiskCache: event.response.fromDiskCache, fromServiceWorker: event.response.fromServiceWorker, mimeType: event.response.mimeType, contentEncoding: event.response.headers["content-encoding"] ?? null, encodedBytes: null, resourceType: event.type });
  });
  session.on("Network.loadingFinished", (event) => {
    const record = network.findLast((entry) => entry.url === requestIds.get(event.requestId) && entry.encodedBytes === null);
    if (record) record.encodedBytes = event.encodedDataLength;
  });
  session.on("Tracing.dataCollected", (event) => chunks.push(...event.value));
  const traceComplete = new Promise((resolve) => session.once("Tracing.tracingComplete", resolve));
  const categories = [
    "devtools.timeline", "blink.user_timing", "loading", "v8",
    "disabled-by-default-devtools.timeline", "disabled-by-default-v8.compile",
  ].join(",");
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 1000 });
  await session.send("Profiler.start");
  await session.send("Tracing.start", { categories, transferMode: "ReportEvents", bufferUsageReportingInterval: 1000 });
  let pageError = null;
  let documentStatus = null;
  let observations = null;
  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: 120_000 });
    documentStatus = response?.status() ?? null;
    await page.waitForLoadState("networkidle", { timeout: 120_000 });
    observations = await page.evaluate(() => ({
      navigation: performance.getEntriesByType("navigation").map((entry) => ({ responseStart: entry.responseStart, load: entry.loadEventEnd })),
      paints: Object.fromEntries(performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime])),
      firstCanvasAt: window.__startupObservation.firstCanvasAt,
      firstWebGLDrawAt: window.__startupObservation.firstWebGLDrawAt,
      longTasks: window.__startupObservation.longTasks,
      resources: performance.getEntriesByType("resource").map((entry) => ({ name: entry.name, startTime: entry.startTime, duration: entry.duration, transferSize: entry.transferSize, decodedBodySize: entry.decodedBodySize, initiatorType: entry.initiatorType })),
    }));
  } catch (error) {
    pageError = error instanceof Error ? error.message : String(error);
  }
  const profile = (await session.send("Profiler.stop")).profile;
  await session.send("Profiler.disable").catch(() => {});
  await writeFile(profilePath, `${JSON.stringify(profile)}\n`, "utf8");
  await session.send("Tracing.end");
  await traceComplete;
  await writeFile(tracePath, `${JSON.stringify({ traceEvents: chunks })}\n`, "utf8");
  const tasks = chunks.filter((event) => event.name === "RunTask" && event.ph === "X").map((event) => ({ startTimeUs: event.ts, durationMs: (event.dur ?? 0) / 1000, processId: event.pid, threadId: event.tid, args: event.args }));
  const threadNames = new Map(chunks.filter((event) => event.name === "thread_name").map((event) => [`${event.pid}:${event.tid}`, event.args?.name ?? null]));
  for (const task of tasks) task.threadName = threadNames.get(`${task.processId}:${task.threadId}`) ?? null;
  const functions = chunks.filter((event) => ["FunctionCall", "EvaluateScript", "CompileScript", "v8.compile", "V8.CompileCode"].includes(event.name) && event.ph === "X");
  const longestTasks = [...tasks].sort((a, b) => b.durationMs - a.durationMs).slice(0, 12);
  const mainThreadTasks = tasks.filter((task) => task.threadName === "CrRendererMain").sort((a, b) => b.durationMs - a.durationMs).slice(0, 12);
  const taskScriptEvents = mainThreadTasks.slice(0, 8).map((task) => ({
    ...task,
    scriptEvents: functions.filter((event) => event.pid === task.processId && event.tid === task.threadId && event.ts >= task.startTimeUs && event.ts + (event.dur ?? 0) <= task.startTimeUs + task.durationMs * 1000)
      .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0)).slice(0, 12)
      .map((event) => {
        const data = event.args?.data ?? {};
        const mapped = consumer && data.url?.endsWith(".js")
          ? consumer.originalPositionFor({ line: (data.lineNumber ?? 0) + 1, column: data.columnNumber ?? 0 })
          : null;
        return { name: event.name, durationMs: (event.dur ?? 0) / 1000, startTimeUs: event.ts, args: event.args, mappedSource: mapped?.source ?? null, mappedLine: mapped?.line ?? null, mappedColumn: mapped?.column ?? null };
      }),
    cpuProfileAttribution: analyzeProfileInterval(profile, consumer, profilePath, task.startTimeUs, task.startTimeUs + task.durationMs * 1000),
  }));
  const sample = {
    mode,
    valid: !pageError && documentStatus >= 200 && documentStatus < 400 && observations?.firstCanvasAt != null,
    pageError,
    documentStatus,
    observations,
    network,
    categories,
    eventCount: chunks.length,
    rawTracePath: tracePath,
    correlatedCpuProfilePath: profilePath,
    correlatedCpuProfileSampleCount: profile.samples?.length ?? 0,
    runTaskCount: tasks.length,
    longestRunTasks: longestTasks,
    longestRendererMainTasks: mainThreadTasks,
    longestTasksWithScriptEvents: taskScriptEvents,
    scriptEventCount: functions.length,
    topScriptEvents: functions.sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0)).slice(0, 20).map((event) => ({ name: event.name, durationMs: (event.dur ?? 0) / 1000, startTimeUs: event.ts, processId: event.pid, threadId: event.tid, args: event.args })),
    eventNames: [...new Set(chunks.map((event) => event.name))].sort(),
  };
  await session.detach().catch(() => {});
  await page.close();
  return sample;
}

function categoryFor(source) {
  if (!source) return "browser-or-v8-internal";
  if (source.includes("/src/") || source.startsWith("src/")) return "application";
  if (source.includes("/node_modules/three/") || source.includes("three/src/") || source.includes("three/examples/")) return "three.js";
  if (source.includes("/node_modules/")) return "third-party";
  return "other-script";
}

function analyzeProfile(profile, consumer, profilePath) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const parent of profile.nodes) for (const childId of parent.children ?? []) parents.set(childId, parent.id);
  const self = new Map();
  const byCategory = new Map();
  const byPath = new Map();
  let sampledMicros = 0;
  for (let index = 0; index < profile.samples.length; index += 1) {
    const node = nodes.get(profile.samples[index]);
    if (!node) continue;
    const delta = profile.timeDeltas?.[index] ?? 0;
    sampledMicros += delta;
    const frame = node.callFrame;
    let source = frame.url || "";
    let functionName = frame.functionName || "(anonymous)";
    if (consumer && frame.url.includes(".js")) {
      const mapped = consumer.originalPositionFor({ line: (frame.lineNumber ?? 0) + 1, column: frame.columnNumber ?? 0 });
      if (mapped.source) source = mapped.source;
      if (mapped.name) functionName = mapped.name;
    }
    const category = categoryFor(source);
    const key = `${category} | ${source || frame.url || "<native>"} | ${functionName}`;
    const entry = self.get(key) ?? { category, source: source || null, functionName, samples: 0, sampledMicros: 0, rawUrl: frame.url || null, rawLine: frame.lineNumber, rawColumn: frame.columnNumber };
    entry.samples += 1;
    entry.sampledMicros += delta;
    self.set(key, entry);
    const categoryEntry = byCategory.get(category) ?? { category, samples: 0, sampledMicros: 0 };
    categoryEntry.samples += 1;
    categoryEntry.sampledMicros += delta;
    byCategory.set(category, categoryEntry);

    const stack = [];
    let cursor = node;
    while (cursor) {
      const cf = cursor.callFrame;
      let pathSource = cf.url || "";
      let pathFunction = cf.functionName || "(anonymous)";
      if (consumer && cf.url.includes(".js")) {
        const mapped = consumer.originalPositionFor({ line: (cf.lineNumber ?? 0) + 1, column: cf.columnNumber ?? 0 });
        if (mapped.source) pathSource = mapped.source;
        if (mapped.name) pathFunction = mapped.name;
      }
      stack.unshift(`${pathSource ? path.posix.basename(pathSource) : "[native]"}:${pathFunction}`);
      const parentId = parents.get(cursor.id);
      cursor = parentId === undefined ? null : nodes.get(parentId);
    }
    const pathKey = stack.join(" → ");
    const pathEntry = byPath.get(pathKey) ?? { stack: pathKey, samples: 0, sampledMicros: 0 };
    pathEntry.samples += 1;
    pathEntry.sampledMicros += delta;
    byPath.set(pathKey, pathEntry);
  }
  const ranked = [...self.values()].sort((a, b) => b.samples - a.samples).slice(0, 50);
  const applicationPaths = [...byPath.values()].filter((entry) => entry.stack.includes("/src/") || entry.stack.includes("src/") || /\.ts:|\.vue:/.test(entry.stack)).sort((a, b) => b.samples - a.samples).slice(0, 30);
  return {
    profilePath,
    totalProfileSamples: profile.samples.length,
    sampledDurationMs: sampledMicros / 1000,
    timingWarning: "Profiler samples and sample deltas are statistical CPU attribution, not exact wall-clock duration for each function.",
    categories: [...byCategory.values()].sort((a, b) => b.samples - a.samples),
    topSelfFrames: ranked,
    topApplicationCallStacks: applicationPaths,
  };
}

function analyzeProfileInterval(profile, consumer, profilePath, startTimeUs, endTimeUs) {
  const samples = [];
  const timeDeltas = [];
  let timestamp = profile.startTime;
  for (let index = 0; index < profile.samples.length; index += 1) {
    const delta = profile.timeDeltas?.[index] ?? 0;
    timestamp += delta;
    if (timestamp >= startTimeUs && timestamp <= endTimeUs) {
      samples.push(profile.samples[index]);
      timeDeltas.push(delta);
    }
  }
  const correlated = { ...profile, samples, timeDeltas };
  const analysis = samples.length ? analyzeProfile(correlated, consumer, profilePath) : null;
  return {
    timeOverlapSamples: samples.length,
    profileStartTimeUs: profile.startTime,
    profileEndTimeUs: profile.endTime,
    traceIntervalStartUs: startTimeUs,
    traceIntervalEndUs: endTimeUs,
    attribution: analysis ? {
      categories: analysis.categories,
      topSelfFrames: analysis.topSelfFrames.slice(0, 10),
      topApplicationCallStacks: analysis.topApplicationCallStacks.slice(0, 10),
    } : null,
    caveat: "Profile and trace were collected concurrently on the same page; sampling remains statistical and adds diagnostic overhead.",
  };
}

try {
  await build({
    configFile: path.join(projectRoot, "vite.config.js"),
    root: projectRoot,
    mode: "production",
    build: { outDir: buildDirectory, emptyOutDir: true, sourcemap: true },
  });
  const resolvedBuild = path.resolve(buildDirectory);
  if (resolvedBuild.startsWith(`${projectRoot}${path.sep}`)) throw new Error(`Refusing to use in-project build output: ${resolvedBuild}`);
  const assetDirectory = path.join(buildDirectory, "assets");
  const assetFiles = await readdir(assetDirectory);
  const bundleFile = assetFiles.find((file) => /^index-.*\.js$/.test(file));
  const mapName = assetFiles.find((file) => file === `${bundleFile}.map`);
  const sourceMap = mapName ? JSON.parse(await readFile(path.join(assetDirectory, mapName), "utf8")) : null;
  const mapConsumer = sourceMap ? new SourceMapConsumer(sourceMap) : null;
  const preview = startStaticServer(buildDirectory);
  server = preview.instance;
  const port = await preview.listen();
  const url = `http://127.0.0.1:${port}/`;
  browser = await chromium.launch({ executablePath: chromePath, headless: true });

  const diagnostics = { cpuProfiles: [], traces: [] };
  for (let index = 1; index <= 3; index += 1) {
    const context = await browser.newContext();
    contexts.add(context);
    const result = await collectProfile(context, url, "cold", index);
    diagnostics.cpuProfiles.push({ ...result.sample, analysis: await analyzeProfile(result.profile, mapConsumer, result.sample.profilePath) });
    console.log(`cold CPU profile ${index}/3: ${result.sample.valid ? `${result.sample.sampleCount} samples` : `INVALID ${result.sample.failure}`}`);
    await context.close();
    contexts.delete(context);
  }
  const hotContext = await browser.newContext();
  contexts.add(hotContext);
  const warmupPage = await hotContext.newPage();
  await warmupPage.goto(url, { waitUntil: "load", timeout: 120_000 });
  await warmupPage.waitForLoadState("networkidle", { timeout: 120_000 });
  await warmupPage.close();
  for (let index = 1; index <= 3; index += 1) {
    const result = await collectProfile(hotContext, url, "hot", index);
    diagnostics.cpuProfiles.push({ ...result.sample, analysis: await analyzeProfile(result.profile, mapConsumer, result.sample.profilePath) });
    console.log(`hot CPU profile ${index}/3: ${result.sample.valid ? `${result.sample.sampleCount} samples` : `INVALID ${result.sample.failure}`}`);
  }
  await hotContext.close();
  contexts.delete(hotContext);

  for (const mode of ["cold", "hot"]) {
    const context = await browser.newContext();
    contexts.add(context);
    if (mode === "hot") {
      const traceWarmupPage = await context.newPage();
      await traceWarmupPage.goto(url, { waitUntil: "load", timeout: 120_000 });
      await traceWarmupPage.waitForLoadState("networkidle", { timeout: 120_000 });
      await traceWarmupPage.close();
    }
    diagnostics.traces.push(await collectTrace(context, url, mode, mapConsumer));
    console.log(`${mode} trace: ${diagnostics.traces.at(-1).eventCount} events`);
    await context.close();
    contexts.delete(context);
  }

  const resultPath = path.join(outputDirectory, "diagnostics-summary.json");
  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    environment: { platform: process.platform, arch: process.arch, node: process.version, chromeVersion: browser.version(), chromeExecutable: chromePath },
    diagnosticBuild: { mode: "production", sourcemap: true, outputDirectory: resolvedBuild, bundleFile, sourceMapFile: mapName, sourceMapUsedForAnalysis: Boolean(mapConsumer), sameViteConfigAndMinifier: true, differsFromBaseline: "source maps enabled; CPU/trace and page observations add measurement overhead. Never compare its timings to batch 59 baseline." },
    measurement: { endpoint: "page load followed by Playwright networkidle", cpuSamplingIntervalUs: 1000, cpuProfilesPerCondition: 3, tracePerCondition: 1, cacheConditions: "cold uses 3 isolated new contexts; hot uses one context warm-up then 3 same-context navigations", server: "local static server with batch-59 cache headers; GET API routes return 404, POST /api/containers/sync is side-effect-free stub", firstDraw: "WebGL draw wrappers installed pre-script; their presence is part of diagnostic-only profiling/tracing samples" },
    cpuProfiles: diagnostics.cpuProfiles,
    traces: diagnostics.traces,
    files: { outputDirectory, summary: resultPath, profilesDirectory, tracesDirectory, diagnosticBundle: path.join(assetDirectory, bundleFile), sourceMap: mapName ? path.join(assetDirectory, mapName) : null },
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`Raw profiles, traces and summary: ${outputDirectory}`);
  console.log(`Summary: ${resultPath}`);
  if (diagnostics.cpuProfiles.some((sample) => !sample.valid) || diagnostics.traces.some((trace) => !trace.valid)) process.exitCode = 1;
} finally {
  await Promise.all([...contexts].map((context) => context.close().catch(() => {})));
  await browser?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
}
