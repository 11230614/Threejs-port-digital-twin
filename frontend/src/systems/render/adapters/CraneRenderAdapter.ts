// ============================================================================
// CraneRenderAdapter.js —— 岸桥渲染适配器
//                          （Crane Render Adapter：干活的岸桥不许降档）
//
// 本适配器只为 ObjectRenderAdapter 提供岸桥的渲染参数，并把“选中或正在
// 执行任务的岸桥必须保持最高精度”这一业务判断传给父类。资源池、LOD
// 切换和释放仍由父类及上层共享资源池负责。
// ============================================================================

import { ComponentTypes } from "../../../ecs/components/ComponentTypes.ts";
import { ObjectRenderAdapter } from "./ObjectRenderAdapter.ts";
import type { GpuResourcePool } from "../../../rendering/GpuResourcePool";
import type { TaskComponent } from "../../../ecs/components/TaskComponent";

export interface CraneEntity {
  id: string;
  getComponent<T>(type: string): T | null;
}

export interface CraneSelectionSystem {
  getSelected(): CraneEntity | null | undefined;
}

export interface CraneRenderAdapterOptions {
  selectionSystem?: CraneSelectionSystem | null;
  resourcePool?: GpuResourcePool | null;
}

export class CraneRenderAdapter extends ObjectRenderAdapter<CraneEntity> {
  constructor({ selectionSystem, resourcePool = null }: CraneRenderAdapterOptions = {}) {
    super({
      renderType: "crane",
      proxyColor: 0xe5b62f,
      resourcePool,
      lowDetailRatio: 0.12,
      isPinned: (entity?: CraneEntity) => {
        if (!entity) return false;
        const task = entity.getComponent<TaskComponent>(ComponentTypes.TASK);
        return selectionSystem?.getSelected()?.id === entity.id || Boolean(task && task.state !== "IDLE");
      },
    });
  }
}
