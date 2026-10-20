// ============================================================================
// ContainerSystem.js —— 集装箱系统（Container System：箱子的归属与状态流转）
//
// 【这个文件干什么】
// 管一个箱子在整个搬运过程中的四件事：归谁管、挂在哪个父节点下、
// 用哪种渲染方式、处于什么业务状态。
//
// 【最核心的概念：静态箱与动态箱的双轨制】
// 码头里堆场上万个箱子，若每个都做成独立的三维实体，显存与绘制调用会直接爆掉。
// 所以本项目把箱子分成两种存在形态：
//
//   静态箱（堆场里码着不动的）
//     · 由 ContainerRenderManager 用 instancing（实例化渲染）批量画，
//       上万个箱子只占几次绘制调用
//     · 没有独立实体，只是 registry（登记表）里的一条数据记录
//
//   动态箱（正被搬运的）
//     · promote（提升）成独立实体，有自己的模型、包围盒、可被点选
//     · 能挂到车上、被吊具吊起，能单独改姿态
//
// releaseForTask 就是那个"静态 → 动态"的转换点，本文件最重的一段逻辑在那里。
//
// 【状态机】
//   YARD（在堆场）→ RELEASED（已出库、变成动态箱）
//     → TRANSPORTING（车上运输中）→ DELIVERED（已送达）
//
// 【第二个要点：父节点搬家用 attach】
// 装箱时把箱子挂到车下、卸箱时挂回场景，都用 attach（挂接）而非 add。
// attach 自动补偿变换、保持世界位置不变；用 add 箱子会瞬移到父节点原点。
//
// 【术语翻译】
//   Container（集装箱）        yard（堆场）        block（箱区）
//   YARD / RELEASED / TRANSPORTING / DELIVERED（在堆场 / 已出库 / 运输中 / 已送达）
//   reserve（预留）           release（释放、出库）
//   reservedBy（被哪个任务预留）
//   registry（登记表）         record（数据记录）
//   instancing（实例化渲染，一次绘制画出成千上万个相同物体）
//   promote（提升，从批量渲染中摘出来变成独立对象）
//   acquire / release（借出 / 归还，模型资源池的两个操作）
//   attach（挂接，换父节点并保持世界位置不变）
//   quaternion（四元数，表示旋转的一种方式，比欧拉角稳定）
//   requireTop（要求是最顶层，堆叠的箱子只能从上往下取）
//   round-robin（轮询，轮流分配以均衡负载）
//   Set（集合，此处用来去重）
//   %（取模，用于循环取下标）
//   Math.floor（向下取整）
// ============================================================================

// 导入 Three.js，用到 Vector3（三维向量）
import * as THREE from "three";
// 导入组件类型常量表
import { ComponentTypes } from "../components/ComponentTypes.ts";
// 导入集装箱实体工厂（负责把模型包装成 ECS 实体）
import { ContainerFactory } from "../../factories/ContainerFactory.ts";
// 导入集装箱布局配置（尺寸、间距等），作为默认参数
import { PORT_CONTAINER_LAYOUT_CONFIG } from "../../config/PortSpatialConfig.ts";
import type { EntityManager } from "../EntityManager";
import type { Entity } from "../Entity";
import type { TransformComponent } from "../components/TransformComponent";
import type { YardContainerRecord, YardSystem } from "../../world/YardSystem";
import type { ContainerLayout } from "../../world/YardSystem";

export const ContainerState = Object.freeze({
  YARD: "YARD",
  RELEASED: "RELEASED",
  TRANSPORTING: "TRANSPORTING",
  DELIVERED: "DELIVERED",
} as const);
export type ContainerStateValue = (typeof ContainerState)[keyof typeof ContainerState];

export interface ContainerModelAssetManager {
  acquire(assetId: string): THREE.Object3D;
  release(assetId: string): unknown;
}
export interface ContainerBatchRenderer { promote(record: YardContainerRecord): unknown }
export interface ContainerSystemOptions {
  scene: THREE.Scene;
  entityManager: EntityManager;
  yardSystem: YardSystem;
  modelAssetManager: ContainerModelAssetManager;
  containerRenderManager?: ContainerBatchRenderer | null;
  containerLayout?: ContainerLayout;
}
export interface ContainerAGVArrival {
  phase?: string;
  agv: Entity;
  position: THREE.Vector3;
}
export interface ContainerTaskContext {
  id: string;
  containerId: string | null;
  to: { area: string };
}

export class ContainerSystem {
  readonly scene: THREE.Scene;
  readonly entityManager: EntityManager;
  readonly yardSystem: YardSystem;
  readonly modelAssetManager: ContainerModelAssetManager;
  readonly containerRenderManager: ContainerBatchRenderer | null | undefined;
  readonly registry: Map<string, YardContainerRecord>;
  readonly loadOffset: THREE.Vector3;

  constructor({ scene, entityManager, yardSystem, modelAssetManager, containerRenderManager, containerLayout = PORT_CONTAINER_LAYOUT_CONFIG }: ContainerSystemOptions) {
    this.scene = scene;
    this.entityManager = entityManager;
    this.yardSystem = yardSystem;
    this.modelAssetManager = modelAssetManager;
    this.containerRenderManager = containerRenderManager;
    // registry（登记表）直接引用堆场系统的那份，不复制一份。
    this.registry = yardSystem.containers;
    // 装车时复用箱子高度作为相对车身的载货偏移。
    this.loadOffset = new THREE.Vector3(0, containerLayout.size.y, 0);
  }

  getContainer(id: string): YardContainerRecord | null { return this.registry.get(id) ?? null; }

  getAvailableContainer(index = 0): YardContainerRecord | null {
    const candidates = this.yardSystem.getReleasableContainers().filter((record) => !record.reservedBy);
    if (candidates.length === 0) return null;
    const blockIds = [...new Set(candidates.map((record) => record.blockId))];
    const blockId = blockIds[index % blockIds.length];
    const blockCandidates = candidates.filter((record) => record.blockId === blockId);
    const cycle = Math.floor(index / blockIds.length);
    return blockCandidates[cycle % blockCandidates.length] ?? null;
  }

  reserveForTask(id: string, taskId: string): boolean {
    const container = this.getContainer(id);
    if (!container || container.state !== ContainerState.YARD || container.reservedBy) return false;
    container.reservedBy = taskId;
    return true;
  }

  releaseForTask(id: string | null | undefined, taskId: string): YardContainerRecord | null {
    if (!id) return null;
    const record = this.getContainer(id);
    if (!record || record.reservedBy !== taskId) return null;
    const released = this.yardSystem.releaseContainer(id, { requireTop: true });
    if (!released) return null;
    this.containerRenderManager?.promote(released);
    const model = this.modelAssetManager.acquire(released.assetId);
    model.position.copy(released.position);
    model.quaternion.copy(released.quaternion);
    model.scale.copy(released.scale);
    const entity = ContainerFactory.create(this.entityManager, {
      id: released.id,
      model,
      record: released,
      onDispose: () => this.modelAssetManager.release(released.assetId),
    });
    if (entity.wrapper) this.scene.add(entity.wrapper);
    released.entity = entity;
    released.owner = "DYNAMIC";
    released.state = ContainerState.RELEASED;
    released.location = "RELEASED";
    released.taskId = taskId;
    released.currentAGV = null;
    released.reservedBy = null;
    return released;
  }

  getWorldPosition(id: string): THREE.Vector3 | null { return this.yardSystem.getContainerWorldPosition(id); }

  handleAGVArrived(event: ContainerAGVArrival, task: ContainerTaskContext): YardContainerRecord | null {
    if (!task.containerId) return null;
    const container = this.getContainer(task.containerId);
    if (!container || container.taskId !== task.id || !container.entity) return null;
    if (event.phase === "PICKUP") {
      const agvTransform = event.agv.getComponent<TransformComponent>(ComponentTypes.TRANSFORM);
      const containerTransform = container.entity.getComponent<TransformComponent>(ComponentTypes.TRANSFORM);
      if (!agvTransform || !containerTransform) return null;
      agvTransform.wrapper.attach(containerTransform.wrapper);
      containerTransform.wrapper.position.copy(this.loadOffset);
      containerTransform.wrapper.rotation.set(0, 0, 0);
      containerTransform.updateBBox();
      container.state = ContainerState.TRANSPORTING;
      container.location = "AGV";
      container.currentAGV = event.agv.id;
      return container;
    }
    if (event.phase === "DELIVERY") {
      const transform = container.entity.getComponent<TransformComponent>(ComponentTypes.TRANSFORM);
      if (!transform) return null;
      this.scene.attach(transform.wrapper);
      transform.wrapper.position.copy(event.position);
      transform.wrapper.rotation.set(0, 0, 0);
      transform.updateBBox();
      container.state = ContainerState.DELIVERED;
      container.location = task.to.area;
      container.currentAGV = null;
      container.taskId = null;
      return container;
    }
    return null;
  }
}
