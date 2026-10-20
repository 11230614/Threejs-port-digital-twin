// ============================================================================
// AGVRenderAdapter.js —— AGV 渲染适配器
//                          （AGV Render Adapter：给通用适配器填三个参数）
//
// 整个文件只有十行有效代码，全部是“填参数”。真正的换档逻辑
// 一行都不在这里，全在父类 ObjectRenderAdapter 里。
// ============================================================================

import { ObjectRenderAdapter } from "./ObjectRenderAdapter.ts";
import type { GpuResourcePool } from "../../../rendering/GpuResourcePool";

export interface AGVSelectionEntity { id: string }
export interface AGVSelectionSystem { getSelected(): AGVSelectionEntity | null | undefined }
export interface AGVRenderAdapterOptions {
  selectionSystem?: AGVSelectionSystem | null;
  resourcePool?: GpuResourcePool | null;
}

export class AGVRenderAdapter extends ObjectRenderAdapter<AGVSelectionEntity> {
  constructor({ selectionSystem, resourcePool = null }: AGVRenderAdapterOptions = {}) {
    super({
      renderType: "agv",
      proxyColor: 0x2f8fd5,
      resourcePool,
      lowDetailRatio: 0.24,
      isPinned: (entity?: AGVSelectionEntity) => selectionSystem?.getSelected()?.id === entity?.id,
    });
  }
}
