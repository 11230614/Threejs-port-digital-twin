export interface DiagnosticFrameSample { timestamp: number; rafIntervalMs: number; callbackCpuMs: number; updateMs: number; renderSubmitMs: number; drawCalls: number; triangles: number }
type MetricRing = { values: Float64Array; cursor: number; count: number; calls: number };

/** Opt-in development diagnostics. Fixed-capacity rings keep memory bounded. */
export class PerformanceDiagnostics {
  readonly capacity: number;
  readonly enabled: boolean;
  private readonly frame: Record<keyof DiagnosticFrameSample, Float64Array>;
  private frameCursor = 0;
  private frameCount = 0;
  private readonly metrics = new Map<string, MetricRing>();
  private readonly longTasks: Array<{ startTime: number; duration: number }> = [];
  private observer: PerformanceObserver | null = null;
  readonly longTaskSupported: boolean;
  private readonly startedAt = performance.now();

  constructor({ capacity = 12000, enabled = false }: { capacity?: number; enabled?: boolean } = {}) {
    this.capacity = Math.max(1, Math.floor(capacity)); this.enabled = enabled;
    this.frame = { timestamp: new Float64Array(this.capacity), rafIntervalMs: new Float64Array(this.capacity), callbackCpuMs: new Float64Array(this.capacity), updateMs: new Float64Array(this.capacity), renderSubmitMs: new Float64Array(this.capacity), drawCalls: new Float64Array(this.capacity), triangles: new Float64Array(this.capacity) };
    this.longTaskSupported = typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask") === true;
    if (enabled && this.longTaskSupported) { this.observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) { if (this.longTasks.length === this.capacity) this.longTasks.shift(); this.longTasks.push({ startTime: entry.startTime, duration: entry.duration }); } }); this.observer.observe({ type: "longtask", buffered: true }); }
  }
  recordFrame(sample: DiagnosticFrameSample): void { if (!this.enabled) return; const index = this.frameCursor; for (const key of Object.keys(this.frame) as (keyof DiagnosticFrameSample)[]) this.frame[key][index] = sample[key]; this.frameCursor = (index + 1) % this.capacity; this.frameCount = Math.min(this.frameCount + 1, this.capacity); }
  finishFrame(callbackCpuMs: number): void { if (!this.enabled || this.frameCount === 0) return; const index = (this.frameCursor - 1 + this.capacity) % this.capacity; this.frame.callbackCpuMs[index] = callbackCpuMs; }
  record(name: string, durationMs: number): void { if (!this.enabled) return; let ring = this.metrics.get(name); if (!ring) { ring = { values: new Float64Array(this.capacity), cursor: 0, count: 0, calls: 0 }; this.metrics.set(name, ring); } ring.values[ring.cursor] = durationMs; ring.cursor = (ring.cursor + 1) % this.capacity; ring.count = Math.min(ring.count + 1, this.capacity); ring.calls += 1; }
  summary(): Record<string, unknown> { const summarize = (values: Float64Array, count: number) => { const sorted = Array.from(values.slice(0, count)).sort((a, b) => a - b); const q = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null; const middle = Math.floor(sorted.length / 2); const p50 = !sorted.length ? null : sorted.length % 2 ? sorted[middle] : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2; return { count, p50, p95: q(.95), p99: q(.99), max: sorted.length ? sorted[sorted.length - 1] : null }; }; const frames: Record<string, unknown> = {}; for (const key of Object.keys(this.frame) as (keyof DiagnosticFrameSample)[]) frames[key] = summarize(this.frame[key], this.frameCount); const operations: Record<string, unknown> = {}; this.metrics.forEach((ring, name) => { operations[name] = { calls: ring.calls, ...summarize(ring.values, ring.count) }; }); const raw = this.rawFrames(); const correlatedLongTasks = this.longTasks.map((task) => { const taskEnd = task.startTime + task.duration; const following = raw.reduce<DiagnosticFrameSample | null>((best, frame) => frame.timestamp >= taskEnd && (!best || frame.timestamp < best.timestamp) ? frame : best, null); return { ...task, followingFrameDeltaMs: following ? following.timestamp - taskEnd : null, followingRafIntervalMs: following?.rafIntervalMs ?? null, followingCallbackCpuMs: following?.callbackCpuMs ?? null, followingUpdateMs: following?.updateMs ?? null, followingRenderSubmitMs: following?.renderSubmitMs ?? null }; }); return { enabled: this.enabled, capacity: this.capacity, windowMs: performance.now() - this.startedAt, sampleUnit: "one recorded RAF callback or one measured operation", frames, operations, longTaskSupported: this.longTaskSupported, longTaskCount: this.longTasks.length, longTasks: correlatedLongTasks }; }
  rawFrames(): DiagnosticFrameSample[] { if (!this.enabled) return []; const start = (this.frameCursor - this.frameCount + this.capacity) % this.capacity; return Array.from({ length: this.frameCount }, (_, offset) => { const i = (start + offset) % this.capacity; return { timestamp: this.frame.timestamp[i], rafIntervalMs: this.frame.rafIntervalMs[i], callbackCpuMs: this.frame.callbackCpuMs[i], updateMs: this.frame.updateMs[i], renderSubmitMs: this.frame.renderSubmitMs[i], drawCalls: this.frame.drawCalls[i], triangles: this.frame.triangles[i] }; }); }
  clear(): void { this.frameCursor = 0; this.frameCount = 0; this.metrics.clear(); this.longTasks.length = 0; }
  dispose(): void { this.observer?.disconnect(); this.observer = null; }
}
declare global { interface Window { __PORT_PERF_DIAGNOSTICS__?: { summary: () => Record<string, unknown>; rawFrames: () => DiagnosticFrameSample[]; clear: () => void; camera?: () => Record<string, unknown> } } }
