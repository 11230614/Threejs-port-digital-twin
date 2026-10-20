// QualityController.js —— 自适应画质控制器的 TypeScript 权威实现
// 保留原有画质档位、像素比、Bloom、LOD 和 EffectComposer 尺寸同步行为。

export type QualityLevel = "high" | "medium" | "low";
export interface QualityRenderer { domElement?: { clientWidth?: number; clientHeight?: number } | null; setPixelRatio?: (ratio: number) => void }
export interface QualityComposer { setPixelRatio?: (ratio: number) => void; setSize?: (width: number, height: number) => void }
export interface QualityRenderSystem { applyQuality?: (settings: { pixelRatio: number; bloom: boolean }) => void }
export interface QualityLodSystem { setQualityLevel?: (level: QualityLevel, lod: number) => void }
export interface QualityControllerOptions { renderer?: QualityRenderer | null; composer?: QualityComposer | null; renderSystem?: QualityRenderSystem | null; lodSystem?: QualityLodSystem | null; pixelRatioOverride?: number | null }

interface QualitySettings { pixelRatio: number; bloom: boolean; lod: number }
const SETTINGS: Readonly<Record<QualityLevel, QualitySettings>> = Object.freeze({
  high: { pixelRatio: 1, bloom: true, lod: 1 },
  medium: { pixelRatio: 0.8, bloom: false, lod: 0.8 },
  low: { pixelRatio: 0.6, bloom: false, lod: 0.6 },
});

export class QualityController {
  private readonly renderer: QualityRenderer | null;
  private readonly composer: QualityComposer | null;
  private readonly renderSystem: QualityRenderSystem | null;
  private readonly lodSystem: QualityLodSystem | null;
  private readonly pixelRatioOverride: number | null;
  private level: QualityLevel | null = null;

  constructor({ renderer = null, composer = null, renderSystem = null, lodSystem = null, pixelRatioOverride = null }: QualityControllerOptions) {
    this.renderer = renderer;
    this.composer = composer;
    this.renderSystem = renderSystem;
    this.lodSystem = lodSystem;
    this.pixelRatioOverride = Number.isFinite(pixelRatioOverride) ? pixelRatioOverride : null;
  }

  apply(level: QualityLevel): void {
    if (!(level in SETTINGS) || this.level === level) return;
    this.level = level;
    const settings = SETTINGS[level];
    const ratio = this.pixelRatioOverride ?? Math.min(globalThis.devicePixelRatio || 1, settings.pixelRatio);
    this.renderSystem?.applyQuality?.({ pixelRatio: ratio, bloom: settings.bloom });
    // EffectComposer maintains its own pixel-ratio state. Keep it aligned with
    // the renderer so the comparison changes only render resolution.
    this.renderer?.setPixelRatio?.(ratio);
    this.composer?.setPixelRatio?.(ratio);
    if (this.composer?.setSize && this.renderer?.domElement) {
      const width = this.renderer.domElement.clientWidth || globalThis.innerWidth || 1;
      const height = this.renderer.domElement.clientHeight || globalThis.innerHeight || 1;
      this.composer.setSize(width, height);
    }
    this.lodSystem?.setQualityLevel?.(level, settings.lod);
  }
}
