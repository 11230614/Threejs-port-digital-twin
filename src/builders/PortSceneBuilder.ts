// ============================================================================
// PortSceneBuilder.js —— 港口场景构建器（Scene Builder：搭建船舶与静态设施）
//
// 【这个文件干什么】
// 三个导出函数，各管一块场景搭建：
//   · createPortOperationModels（创建作业船舶）：把货船精确停靠到泊位上，
//     难点是“吃水线对齐”——船底要刚好落在水面，不能悬空也不能沉底。
//   · createShipOperationContainer（创建船上待卸集装箱）：在船舱内放一个箱子，
//     作为装卸作业流程的起点。
//   · createStaticAssets（创建静态设施）：泊位、堆场、箱区的可点选拾取体。
//
// 定位思路都一样：先用 Box3（包围盒）量出各方尺寸，再做减法把物体对齐，
// 而不是硬编码坐标。好处是换了模型文件也能自动适配，不用重新调数字。
//
// 【术语翻译】
//   Builder（构建器）           berth（泊位，船停靠的位置）
//   dock（码头平台 / 岸壁）      water（水面）
//   waterLevel（水面高度）       clearance（净距，物体之间预留的空隙）
//   Box3（三维包围盒）           getCenter / getSize（求包围盒中心 / 尺寸）
//   min / max（包围盒的最小角点 / 最大角点）
//   updateMatrixWorld（更新世界矩阵）
//   String.fromCharCode（按字符编码取字符，65 即字母 A）
//   ??（空值合并）               ?.（可选链）
//   closure（闭包，函数内部定义的辅助函数能直接用外层变量）
// ============================================================================

import * as THREE from "three";
import { AssetType, createBerthAsset, createContainerAsset, createRoadAsset, createYardAsset } from "../domain/AssetCatalog";
import { ContainerFactory } from "../factories/ContainerFactory";
import { StaticAssetFactory } from "../factories/StaticAssetFactory";
import type { AssetManager } from "../assets/AssetManager";
import type { Entity } from "../ecs/Entity";
import type { EntityManager } from "../ecs/EntityManager";
import type { ContainerRecord } from "../ecs/components/ContainerComponent";

export interface PortOperationOptions { modelAssetManager: AssetManager; scene: THREE.Scene; dock: THREE.Object3D; water?: THREE.Object3D | null }
export function createPortOperationModels({ modelAssetManager, scene, dock, water }: PortOperationOptions): { ship: THREE.Group } {
  const shipModel = modelAssetManager.clone("ship"); shipModel.updateMatrixWorld(true); const ship = new THREE.Group(); ship.name = "SHIP_01"; ship.userData.renderObject = shipModel; ship.add(shipModel);
  dock.updateMatrixWorld(true); const dockBox = new THREE.Box3().setFromObject(dock); const shipBox = new THREE.Box3().setFromObject(shipModel); const waterLevel = water?.getWorldPosition(new THREE.Vector3()).y ?? dockBox.max.y;
  ship.position.set(dockBox.getCenter(new THREE.Vector3()).x - shipBox.getCenter(new THREE.Vector3()).x, waterLevel - shipBox.min.y, dockBox.max.z + 6 - shipBox.min.z); scene.add(ship); return { ship };
}

export interface ShipContainerOptions { modelAssetManager: AssetManager; entityManager: EntityManager; scene: THREE.Scene; ship: THREE.Group }
export function createShipOperationContainer({ modelAssetManager, entityManager, scene, ship }: ShipContainerOptions): ContainerRecord {
  ship.updateMatrixWorld(true); const shipBox = new THREE.Box3().setFromObject(ship); const shipSize = shipBox.getSize(new THREE.Vector3()); const shipCenter = shipBox.getCenter(new THREE.Vector3()); const model = modelAssetManager.clone("container-blue");
  model.position.set(shipCenter.x, shipBox.min.y + shipSize.y * 0.24, shipCenter.z);
  const record: ContainerRecord = { id: "SHIP_CONTAINER_01", state: "ON_SHIP", location: "SHIP_BAY_01", taskId: null, entity: null };
  const entity = ContainerFactory.create(entityManager, { id: record.id, model, record, onDispose: () => modelAssetManager.release("container-blue") });
  if (entity.wrapper) scene.add(entity.wrapper); record.entity = entity; return record;
}

export interface YardLike { x: number; z: number; count: number; blockSize?: { x: number; y: number; z: number } }
export interface StaticAssetsOptions { assetManager: AssetManager; entityManager: EntityManager; scene: THREE.Scene; yards: readonly YardLike[] }
export function createStaticAssets({ assetManager, entityManager, scene, yards }: StaticAssetsOptions): void {
  assetManager.add(createRoadAsset());
  const berth = StaticAssetFactory.create(entityManager, { id: "BERTH_01", type: AssetType.BERTH, size: { x: 1180, y: 10, z: 34 }, position: { x: 0, y: 5, z: 44 } }); registerStaticAsset(berth, createBerthAsset());
  yards.forEach((yard, index) => {
    const blockSize = yard.blockSize ?? { x: 52, y: 9, z: 13 }; const yardPickSize = { x: blockSize.x + 20, y: blockSize.y + 6, z: blockSize.z + 20 }; const suffix = String.fromCharCode(65 + index);
    const yardEntity = StaticAssetFactory.create(entityManager, { id: `YARD_${suffix}`, type: AssetType.YARD, size: yardPickSize, position: { x: yard.x, y: yardPickSize.y / 2, z: yard.z } }); registerStaticAsset(yardEntity, createYardAsset(yard, index));
    const containerEntity = StaticAssetFactory.create(entityManager, { id: `CNTR_BLOCK_${suffix}`, type: AssetType.CONTAINER, size: blockSize, position: { x: yard.x, y: blockSize.y / 2, z: yard.z } }); registerStaticAsset(containerEntity, createContainerAsset(yard, index));
  });
  function registerStaticAsset(entity: Entity, asset: Parameters<AssetManager["attach"]>[1]): void { if (entity.wrapper) scene.add(entity.wrapper); assetManager.attach(entity, asset); }
}
