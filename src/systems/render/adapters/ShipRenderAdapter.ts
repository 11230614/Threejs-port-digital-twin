// ============================================================================
// ShipRenderAdapter.ts —— 船舶渲染适配器
//                        （Ship Render Adapter：自带字段翻译的那一个）
//
// 【这个文件干什么】
// 同样是给通用适配器填参数，但它多传了一个 describe（描述函数），
// 这是它与 AGV、岸桥两个适配器最实质的差别。
//
// 【为什么船需要自己的 describe 而车与岸桥不需要】
// 父类的 defaultDescribe 把业务对象的 renderObject 字段
// 当作高精模型；船的对象把模型存在 detail 字段里，
// 因此这里负责把字段翻译成父类统一的 descriptor。
//
// 【resourceId 兜底成 "ship"】
// 没有资产元数据时，所有船共用同一个简模资源键，避免重复减面。
// 船没有 isPinned；它沿用父类默认的永不钉住策略。
// ============================================================================

import type { Object3D } from "three";
import { ObjectRenderAdapter } from "./ObjectRenderAdapter.ts";
import type { GpuResourcePool } from "../../../rendering/GpuResourcePool";

export interface ShipRenderItem {
  id: string;
  wrapper: Object3D;
  detail: Object3D;
}

export interface ShipRenderAdapterOptions {
  resourcePool?: GpuResourcePool | null;
}

export class ShipRenderAdapter extends ObjectRenderAdapter<ShipRenderItem> {
  constructor({ resourcePool = null }: ShipRenderAdapterOptions = {}) {
    super({
      renderType: "ship",
      proxyColor: 0x607b8a,
      resourcePool,
      lowDetailRatio: 0.1,
      describe: (item: ShipRenderItem) => ({
        id: item.id,
        wrapper: item.wrapper,
        detail: item.detail,
        resourceId: item.detail.userData?.assetMetadata?.id ?? "ship",
      }),
    });

  }
}
