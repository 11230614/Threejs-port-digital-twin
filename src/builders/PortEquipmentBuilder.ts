// ============================================================================
// PortEquipmentBuilder.js —— 港口设备构建器（Equipment Builder：批量摆放设备）
//
// 【这个文件干什么】
// Builder（构建器）负责“成批地把设备造出来并摆到正确位置”。工厂（Factory）管
// 单个实体怎么装配，构建器管一群实体怎么排布，两者职责分开。
//
// 本文件两个函数：
//   · createAGVs（批量创建无人集卡）：沿车道等间距铺开，速度略带随机
//   · createQuayCranes（批量创建岸桥）：难点在于精确贴靠码头岸壁，
//     用到了“只统计车轮部分包围盒”的技巧，详见函数内注释
//
// 【术语翻译】
//   Builder（构建器模式）      Equipment（设备）
//   AGV（自动导引运输车 / 无人集卡）   Quay Crane（岸桥）
//   lane（车道）               laneLength（车道总长）
//   clone（克隆模型，从同一份原始数据复制出多个实例）
//   padStart（字符串左侧补零，1 -> “01”）
//   Box3（三维包围盒）         union（包围盒求并集）
//   traverse（递归遍历子节点）  isMesh（是否为可绘制网格）
//   dock（码头平台 / 岸壁）     berth（泊位）
// ============================================================================

import * as THREE from "three";
import { createAGVAsset, createCraneAsset } from "../domain/AssetCatalog";
import { AGVFactory } from "../factories/AGVFactory";
import { QuayCraneFactory } from "../factories/QuayCraneFactory";
import type { AssetManager } from "../assets/AssetManager";
import type { Entity } from "../ecs/Entity";
import type { EntityManager } from "../ecs/EntityManager";

export interface RoadSystemLike { getLaneLength(laneId: string): number }
export interface EquipmentBuilderOptions { modelAssetManager: AssetManager; assetManager: AssetManager; entityManager: EntityManager; scene: THREE.Scene; roadSystem: RoadSystemLike; roadId: string; laneId: string; count?: number }
export function createAGVs({ modelAssetManager, assetManager, entityManager, scene, roadSystem, roadId, laneId, count = 5 }: EquipmentBuilderOptions): Entity[] {
  const laneLength = roadSystem.getLaneLength(laneId); const agvs: Entity[] = [];
  for (let index = 0; index < count; index += 1) {
    const model = modelAssetManager.clone("agv");
    const agv = AGVFactory.create(entityManager, { id: `AGV_${String(index + 1).padStart(2, "0")}`, model, roadId, laneId, distance: (laneLength / count) * index, speed: 28 + Math.random() * 8, onDispose: () => modelAssetManager.release("agv") });
    if (agv.wrapper) scene.add(agv.wrapper); assetManager.attach(agv, createAGVAsset(index)); agvs.push(agv);
  }
  return agvs;
}

export interface QuayCraneBuilderOptions { modelAssetManager: AssetManager; assetManager: AssetManager; entityManager: EntityManager; scene: THREE.Scene; dock: THREE.Object3D; positions?: readonly number[] }
export function createQuayCranes({ modelAssetManager, assetManager, entityManager, scene, dock, positions = [-180, 0, 180] }: QuayCraneBuilderOptions): Entity[] {
  dock.updateMatrixWorld(true); const dockBox = new THREE.Box3().setFromObject(dock);
  return positions.map((x, index) => {
    const model = modelAssetManager.clone("crane"); model.rotation.y = Math.PI; model.updateMatrixWorld(true);
    const craneBox = new THREE.Box3().setFromObject(model); const craneSize = craneBox.getSize(new THREE.Vector3()); const wheelBox = new THREE.Box3();
    const wheelTop = craneBox.min.y + craneSize.y * 0.18; let hasWheelMeshes = false;
    model.traverse((child) => { if (!child.isMesh) return; const childBox = new THREE.Box3().setFromObject(child); if (childBox.max.y <= wheelTop) { wheelBox.union(childBox); hasWheelMeshes = true; } });
    if (!hasWheelMeshes) wheelBox.copy(craneBox);
    const crane = QuayCraneFactory.create(entityManager, { id: `QC_${String(index + 1).padStart(2, "0")}`, model, position: { x, y: -craneBox.min.y, z: dockBox.max.z - wheelBox.max.z }, onDispose: () => modelAssetManager.release("crane") });
    if (crane.wrapper) scene.add(crane.wrapper); assetManager.attach(crane, createCraneAsset(index)); return crane;
  });
}
