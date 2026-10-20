import type * as THREE from "three";
import type { PerformanceSnapshot } from "../stores/types";

export interface PerformanceMetricProvider { (): unknown }
export interface PerformanceSystemOptions { renderer: THREE.WebGLRenderer; publishInterval?: number; onSnapshot?: ((snapshot: PerformanceSnapshot) => void) | null }

export class PerformanceSystem {
  readonly renderer: THREE.WebGLRenderer;
  readonly publishInterval: number;
  readonly metricProviders = new Map<string, PerformanceMetricProvider>();
  readonly originalInfoAutoReset: boolean;
  onSnapshot: ((snapshot: PerformanceSnapshot) => void) | null;
  frameStart: number | null = null;
  renderStart: number | null = null;
  active: boolean;
  disposed = false;
  latestSnapshot: PerformanceSnapshot | null = null;
  private windowStart = 0;
  private frameCount = 0;
  private updateTotal = 0;
  private renderTotal = 0;
  private frameTotal = 0;
  private frameMax = 0;
  private frameSamples: number[] = [];
  private renderCalls = 0;
  private renderTriangles = 0;
  private renderLines = 0;
  private renderPoints = 0;
  private readonly _handleVisibilityChange: () => void;

  constructor({ renderer, publishInterval = 1000, onSnapshot = null }: PerformanceSystemOptions) {
    if (!renderer?.info) throw new Error("PerformanceSystem requires a WebGLRenderer instance.");
    this.renderer = renderer; this.publishInterval = Math.max(100, publishInterval); this.onSnapshot = onSnapshot;
    this.originalInfoAutoReset = renderer.info.autoReset; renderer.info.autoReset = false;
    this.active = typeof document === "undefined" || !document.hidden;
    this._handleVisibilityChange = this._handleVisibilityChangeImpl.bind(this);
    this._resetWindow(this._now());
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this._handleVisibilityChange);
  }

  beginFrame(): void { if (this.disposed) return; this.renderer.info.reset(); if (!this.active) { this.frameStart = null; this.renderStart = null; return; } this.frameStart = this._now(); this.renderStart = null; }
  beforeRender(): void { if (this.frameStart !== null) this.renderStart = this._now(); }
  afterRender(): void {
    if (this.frameStart === null || this.renderStart === null) return;
    const now = this._now(); const updateMs = this.renderStart - this.frameStart; const renderMs = now - this.renderStart; const frameMs = now - this.frameStart;
    this.frameCount += 1; this.updateTotal += updateMs; this.renderTotal += renderMs; this.frameTotal += frameMs; this.frameMax = Math.max(this.frameMax, frameMs); this.frameSamples.push(frameMs);
    this.renderCalls += this.renderer.info.render.calls; this.renderTriangles += this.renderer.info.render.triangles; this.renderLines += this.renderer.info.render.lines; this.renderPoints += this.renderer.info.render.points;
  }
  update(): void { if (!this.disposed) { const now = this._now(); if (now - this.windowStart >= this.publishInterval) this._publishSnapshot(now); } }
  dispose(): void { if (this.disposed) return; this.disposed = true; if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this._handleVisibilityChange); this.renderer.info.autoReset = this.originalInfoAutoReset; this.onSnapshot = null; this.metricProviders.clear(); }
  registerMetricProvider(name: string, provider: PerformanceMetricProvider): () => boolean { if (!name || typeof provider !== "function") return () => false; this.metricProviders.set(name, provider); return () => this.metricProviders.delete(name); }

  private _publishSnapshot(now: number): void {
    if (this.frameCount === 0) { this._resetWindow(now); return; }
    const elapsed = Math.max(now - this.windowStart, 1); const info = this.renderer.info; const samples = [...this.frameSamples].sort((left, right) => left - right); const p95Index = Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1);
    const snapshot: PerformanceSnapshot = Object.freeze({ timestamp: new Date().toISOString(), fps: this._round((this.frameCount * 1000) / elapsed, 1), frameMs: Object.freeze({ average: this._round(this.frameTotal / this.frameCount, 2), p95: this._round(samples[p95Index], 2), max: this._round(this.frameMax, 2) }), cpuMs: Object.freeze({ update: this._round(this.updateTotal / this.frameCount, 2), render: this._round(this.renderTotal / this.frameCount, 2) }), render: Object.freeze({ calls: Math.round(this.renderCalls / this.frameCount), triangles: Math.round(this.renderTriangles / this.frameCount), lines: Math.round(this.renderLines / this.frameCount), points: Math.round(this.renderPoints / this.frameCount) }), memory: Object.freeze({ geometries: info.memory.geometries, textures: info.memory.textures }), display: Object.freeze({ width: this.renderer.domElement.width, height: this.renderer.domElement.height, pixelRatio: this.renderer.getPixelRatio() }), metrics: Object.freeze(this._collectMetrics()) });
    this.onSnapshot?.(snapshot); this.latestSnapshot = snapshot; this._resetWindow(now);
  }
  private _resetWindow(now: number): void { this.windowStart = now; this.frameCount = 0; this.updateTotal = 0; this.renderTotal = 0; this.frameTotal = 0; this.frameMax = 0; this.frameSamples = []; this.renderCalls = this.renderTriangles = this.renderLines = this.renderPoints = 0; }
  private _handleVisibilityChangeImpl(): void { this.active = !document.hidden; this.frameStart = null; this.renderStart = null; this._resetWindow(this._now()); }
  private _collectMetrics(): Record<string, unknown> { const metrics: Record<string, unknown> = {}; this.metricProviders.forEach((provider, name) => { try { metrics[name] = provider(); } catch (error) { console.warn(`Performance metric provider "${name}" failed.`, error); } }); return metrics; }
  private _now(): number { return globalThis.performance?.now() ?? Date.now(); }
  private _round(value: number, digits: number): number { const factor = 10 ** digits; return Math.round(value * factor) / factor; }
}
