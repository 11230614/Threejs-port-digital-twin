// ============================================================================
// SelectionSystem.ts —— 选中系统（Selection System：管理"当前选中了谁"）
//
// 【这个文件干什么】
// 三维场景里点中一个物体后，右侧面板要显示它的详情。这个系统就是三维世界与
// Vue 界面之间的那道桥：它不碰模型、不做高亮，只负责把"选中状态"写进两个
// Pinia store（状态仓库），Vue 侦测到数据变化后自动刷新面板。
//
// 为什么要写两个仓库？因为界面有两套面板：设备面板（看运行参数）与资产面板
// （看档案信息），两者互相独立，各自订阅自己的仓库。
//
// 【术语翻译】
//   Selection（选中）        System（系统）
//   store（状态仓库，Pinia 的响应式数据源）
//   select / deselect（选中 / 取消选中）
//   reactive（响应式，数据一变界面自动更新）
// ============================================================================

import { useDeviceStore } from "../../stores/DeviceStore.ts";
import { useAssetStore } from "../../stores/AssetStore.ts";
import type { SceneEntity } from "../../stores/types";
import type { EntityManager } from "../EntityManager";

export class SelectionSystem {
  private readonly manager: EntityManager;
  private readonly store = useDeviceStore();
  private readonly assetStore = useAssetStore();

  constructor(entityManager: EntityManager) {
    this.manager = entityManager;
  }

  select(entity: SceneEntity): void {
    this.store.selectEntity(entity);
    this.assetStore.selectEntity(entity);
  }

  deselect(): void {
    this.store.deselectEntity();
    this.assetStore.deselectAsset();
  }

  getSelected(): SceneEntity | null {
    return this.store.currentEntity;
  }
}
