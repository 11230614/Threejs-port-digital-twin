// ============================================================================
// AssetComponent.js —— 资产组件（Asset Component：挂载模型资产的档案数据）
//
// 【这个文件干什么】
// 把一份“资产描述对象”挂到实体上。这个 asset（资产）对象通常来自
// AssetCatalog（资产目录），里面记着模型名称、文件路径、分类、尺寸等信息，
// 右侧的资产信息面板（AssetInfoPanel.vue）就是读它来显示详情的。
//
// 【术语翻译】
//   Asset（资产 / 素材，此处指 GLTF 等三维模型及其元数据）
//   Catalog（目录、清单）   metadata（元数据，描述数据的数据）
// ============================================================================

import type { AssetState } from "../../stores/types";

export class AssetComponent {
  constructor(public asset: AssetState) {}
}
