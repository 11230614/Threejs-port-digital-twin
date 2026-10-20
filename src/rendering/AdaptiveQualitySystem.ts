export type QualityLevel = "low" | "medium" | "high";
export interface AdaptiveQualityConfig { enabled?: boolean; degradeP95Ms?: number; upgradeP95Ms?: number; degradeWindows?: number; upgradeWindows?: number; cooldownMs?: number }
export interface ResolvedAdaptiveQualityConfig { enabled?: boolean; degradeP95Ms: number; upgradeP95Ms: number; degradeWindows: number; upgradeWindows: number; cooldownMs: number }
export interface QualityControllerLike { apply(level: QualityLevel): void }
export interface PerformanceLike { latestSnapshot?: { frameMs?: { p95?: number } } | null }

const ORDER: readonly QualityLevel[] = ["low", "medium", "high"];
const DEFAULT_CONFIG = { degradeP95Ms: 22, upgradeP95Ms: 14, degradeWindows: 3, upgradeWindows: 10, cooldownMs: 5000 } as const;

export class AdaptiveQualitySystem {
  readonly performanceSystem: PerformanceLike;
  readonly qualityController: QualityControllerLike;
  readonly config: ResolvedAdaptiveQualityConfig;
  enabled: boolean;
  level: QualityLevel = "high";
  badWindows = 0;
  goodWindows = 0;
  lastChange = -Infinity;
  constructor({ performanceSystem, qualityController, config = {} }: { performanceSystem: PerformanceLike; qualityController: QualityControllerLike; config?: AdaptiveQualityConfig }) {
    this.performanceSystem = performanceSystem; this.qualityController = qualityController; this.config = { ...DEFAULT_CONFIG, ...config }; this.enabled = config.enabled !== false; qualityController.apply(this.level);
  }
  update(_dt: number, elapsed: number): void { if (!this.enabled) return; const p95 = this.performanceSystem.latestSnapshot?.frameMs?.p95; if (!Number.isFinite(p95)) return; const now = elapsed * 1000; if (now - this.lastChange < this.config.cooldownMs) return; if ((p95 as number) > this.config.degradeP95Ms) { this.badWindows += 1; this.goodWindows = 0; if (this.badWindows >= this.config.degradeWindows) this.setLevel(ORDER[Math.max(0, ORDER.indexOf(this.level) - 1)], now); } else if ((p95 as number) < this.config.upgradeP95Ms) { this.goodWindows += 1; this.badWindows = 0; if (this.goodWindows >= this.config.upgradeWindows) this.setLevel(ORDER[Math.min(2, ORDER.indexOf(this.level) + 1)], now); } else { this.badWindows = 0; this.goodWindows = 0; } }
  setEnabled(enabled: boolean): void { this.enabled = Boolean(enabled); if (!this.enabled) this.setLevel("high"); }
  setLevel(level: QualityLevel, now = 0): void { if (level === this.level) return; this.level = level; this.lastChange = now; this.badWindows = 0; this.goodWindows = 0; this.qualityController.apply(level); }
  getMetrics(now = globalThis.performance?.now?.() ?? Date.now()): { level: QualityLevel; enabled: boolean; p95: number | null; degrade: number; upgrade: number; cooldownMs: number; degradeWindows: number; upgradeWindows: number } { return { level: this.level, enabled: this.enabled, p95: this.performanceSystem.latestSnapshot?.frameMs?.p95 ?? null, degrade: this.badWindows, upgrade: this.goodWindows, cooldownMs: Math.max(0, this.config.cooldownMs - (now - this.lastChange)), degradeWindows: this.config.degradeWindows, upgradeWindows: this.config.upgradeWindows }; }
}
