// ============================================================================
// RenderResourceSystem.ts —— 渲染资源系统（Render Resource System：显存的看门人）
//
// JavaScript 兼容入口保留在 RenderResourceSystem.js；本文件是唯一业务实现。
// 它只负责驱动 GpuResourcePool 的清扫并汇总指标，不拥有适配器或资产资源。
// ============================================================================

import { GpuResourcePool } from "../../rendering/GpuResourcePool.ts";
import type { GpuResourcePoolMetrics, GpuResourcePoolOptions } from "../../rendering/GpuResourcePool.ts";

export interface RenderResourceMetrics extends GpuResourcePoolMetrics {
  sweeps: number;
  disposedLastSweep: number;
}

export class RenderResourceSystem {
  readonly pool: GpuResourcePool;
  private sweeps = 0;
  private lastDisposed = 0;

  constructor(config: GpuResourcePoolOptions = {}) {
    this.pool = new GpuResourcePool(config);
  }

  update(): void {
    this.lastDisposed = this.pool.sweep();
    this.sweeps += 1;
  }

  getMetrics(): RenderResourceMetrics {
    return {
      ...this.pool.getMetrics(),
      sweeps: this.sweeps,
      disposedLastSweep: this.lastDisposed,
    };
  }

  dispose(): void {
    this.pool.dispose();
  }
}
