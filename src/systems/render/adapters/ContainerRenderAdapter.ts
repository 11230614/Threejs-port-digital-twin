// ============================================================================
// ContainerRenderAdapter.ts —— 集装箱渲染适配器
//                              （Container Render Adapter：一层纯转发的薄壳）
//
// 【这个文件干什么】
// 四个方法全部是委托，真正的实例化渲染、资源池和批次生命周期仍由
// ContainerRenderManager 负责。本适配器只把 manager 收窄为 RenderSystem
// 所需的公共契约，避免维护第二份集装箱业务实现。
//
// 【为什么集装箱不能复用 ObjectRenderAdapter】
// 集装箱使用 InstancedMesh 批量绘制；InstanceBatch、共享 Geometry/Material
// 和资源引用计数均由 manager 所有，本文件不创建、不缓存、不释放这些资源。
//
// 【资源所有权】
// manager 由 PortRuntime 创建并只交给本适配器使用；dispose 仍按原有顺序
// 委托给 manager，由 manager 释放批次、资产引用和它拥有的资源池。
// ============================================================================

export interface ContainerLODContext {
  chunkId: string;
  items: readonly unknown[];
  level: number;
  [key: string]: unknown;
}

export interface ContainerRenderManagerContract {
  applyChunkLOD(context: ContainerLODContext): void;
  detach(item: unknown): unknown;
  getMetrics(): unknown;
  dispose(): void;
}

/** Keeps the existing high-volume container renderer behind the common adapter contract. */
export class ContainerRenderAdapter {
  private readonly manager: ContainerRenderManagerContract;

  constructor(manager: ContainerRenderManagerContract) {
    // 构造期校验保留原有 TypeError 语义；类型边界之外的旧调用仍能得到明确错误。
    if (!manager || typeof manager.applyChunkLOD !== "function") {
      throw new TypeError("Container adapter requires a render manager.");
    }
    this.manager = manager;
  }

  // 原样转发整个上下文，保留未来扩展字段和既有调用顺序。
  applyChunkLOD(context: ContainerLODContext): void {
    this.manager.applyChunkLOD(context);
  }

  // detach 的返回值由 manager 决定，适配器不改变其语义。
  detach(item: unknown): unknown {
    return this.manager.detach(item);
  }

  getMetrics(): unknown {
    return this.manager.getMetrics();
  }

  // manager 是本适配器唯一使用者，销毁责任继续归 manager。
  dispose(): void {
    this.manager.dispose();
  }
}
