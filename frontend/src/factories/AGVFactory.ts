// ============================================================================
// AGVFactory.js —— 无人集卡工厂（AGV Factory：装配自动导引运输车实体）
//
// 【这个文件干什么】
// 装配一辆能沿道路跑、能载集装箱的 AGV（Automated Guided Vehicle，无人集卡）。
// 关键动作是自动生成 cargoSlot（载货位）：先量出车身的实际高度，在车顶上方
// 0.1 米处放一个空节点。装箱时把箱子挂到这个节点下面，箱子就会跟着车一起走，
// 无需每帧手动同步坐标——这是三维开发里非常省事的父子节点技巧。
//
// 【术语翻译】
//   AGV（Automated Guided Vehicle，自动导引运输车 / 无人集卡）
//   cargoSlot（载货位，车板上用于挂载货物的空节点）
//   Box3（三维包围盒类）        setFromObject（依据物体计算包围盒）
//   updateMatrixWorld（更新世界矩阵，把父子变换真正算一遍）
//   roadId / laneId（道路编号 / 车道编号）
//   distance（沿路已行驶里程）  speed（速度）
//   onDispose（释放回调）
// ============================================================================

import * as THREE from "three";
import { AGVComponent } from "../ecs/components/AGVComponent";
import { ComponentTypes } from "../ecs/components/ComponentTypes";
import { MotionComponent } from "../ecs/components/MotionComponent";
import { RenderComponent } from "../ecs/components/RenderComponent";
import { SelectableComponent } from "../ecs/components/SelectableComponent";
import { TransformComponent } from "../ecs/components/TransformComponent";
import { TypeComponent } from "../ecs/components/TypeComponent";
import type { Entity } from "../ecs/Entity";
import type { EntityManager } from "../ecs/EntityManager";

export interface AGVCreateOptions { id: string; model: THREE.Object3D; roadId: string; laneId: string; distance?: number; speed?: number; onDispose?: (() => void) | null }
export class AGVFactory {
  static create(entityManager: EntityManager, { id, model, roadId, laneId, distance = 0, speed = 30, onDispose = null }: AGVCreateOptions): Entity {
    const entity = entityManager.createEntity(id); const wrapper = new THREE.Group(); wrapper.name = id; wrapper.add(model);
    model.updateMatrixWorld(true); const modelBox = new THREE.Box3().setFromObject(model);
    const cargoSlot = new THREE.Group(); cargoSlot.name = `${id}-cargo-slot`; cargoSlot.position.set(0, modelBox.max.y + 0.1, 0); wrapper.add(cargoSlot);
    const transform = new TransformComponent(wrapper);
    entity.addComponent(ComponentTypes.TYPE, new TypeComponent("AGV"))
      .addComponent(ComponentTypes.TRANSFORM, transform)
      .addComponent(ComponentTypes.RENDER, new RenderComponent(model, { onDispose }))
      .addComponent(ComponentTypes.SELECTABLE, new SelectableComponent())
      .addComponent(ComponentTypes.MOTION, new MotionComponent({ roadId, laneId, distance, speed }))
      .addComponent(ComponentTypes.AGV, new AGVComponent({ cargoSlot }));
    transform.updateBBox(); return entityManager.add(entity);
  }
}
