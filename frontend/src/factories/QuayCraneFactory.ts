// ============================================================================
// QuayCraneFactory.js —— 岸桥工厂（Quay Crane Factory：装配可作业的岸边起重机）
//
// 【这个文件干什么】
// 这是全项目最“动手术”的一个工厂。岸桥模型（GLTF 文件）里的层级结构是建模师
// 定的，通常是扁平的一堆节点，无法直接驱动出“小车横移 + 吊具升降”的复合动作。
// 于是这里做 node hierarchy surgery（节点层级改造）：
//
//   改造前： gantry（门架）
//              ├── spreader（吊具）
//              └── HoistRopesandclaws（钢丝绳与吊钩）
//
//   改造后： gantry（门架）
//              └── trolleyNode（新建的小车节点，负责横向平移）
//                    └── hoistNode（新建的起升节点，负责垂直升降）
//                          ├── ropes（钢丝绳）
//                          └── spreader（吊具）
//
// 改造后只要平移 trolleyNode，绳子和吊具会自动跟着横移；只要下降 hoistNode，
// 它俩又会一起下降。父子关系天然实现了机构联动，完全不用手写坐标同步。
//
// 关键是用 attach（吸附式挂载）而不是 add（普通挂载）：attach 会自动补偿变换，
// 保证节点换了父级之后，在画面上的位置一动不动；add 则会导致模型瞬间跳位。
//
// 【术语翻译】
//   Quay Crane（岸桥 / 岸边集装箱起重机，简称 QC）
//   gantry（门架、大车行走机构）    trolley（小车，横向移动机构）
//   hoist（起升机构，垂直升降）     spreader（吊具，抓箱的框架）
//   ropes（钢丝绳）                 HoistRopesandclaws（建模师起的节点名：起升绳与抓爪）
//   getObjectByName（按名字在模型树里查找子节点）
//   node hierarchy（节点层级 / 父子结构）
//   attach（吸附挂载，换父节点但保持世界变换不变）
//   add（普通挂载，保持局部变换，世界位置会随新父节点改变）
//   updateMatrixWorld（更新世界矩阵）
//   fail fast（快速失败：前提不满足立刻抛错，而非留着以后诡异出错）
// ============================================================================

import * as THREE from "three";
import { ComponentTypes } from "../ecs/components/ComponentTypes";
import { CraneComponent } from "../ecs/components/CraneComponent";
import { HoistComponent } from "../ecs/components/HoistComponent";
import { QuayCraneComponent } from "../ecs/components/QuayCraneComponent";
import { RenderComponent } from "../ecs/components/RenderComponent";
import { SelectableComponent } from "../ecs/components/SelectableComponent";
import { TaskComponent } from "../ecs/components/TaskComponent";
import { TransformComponent } from "../ecs/components/TransformComponent";
import { TrolleyComponent } from "../ecs/components/TrolleyComponent";
import { TypeComponent } from "../ecs/components/TypeComponent";
import type { Entity } from "../ecs/Entity";
import type { EntityManager } from "../ecs/EntityManager";

export interface QuayCraneCreateOptions { id: string; model: THREE.Object3D; position: { x: number; y: number; z: number }; onDispose?: (() => void) | null }
export class QuayCraneFactory {
  static create(entityManager: EntityManager, { id, model, position, onDispose = null }: QuayCraneCreateOptions): Entity {
    const spreader = model.getObjectByName("spreader"); const ropes = model.getObjectByName("HoistRopesandclaws");
    if (!spreader || !ropes) throw new Error(`Quay crane "${id}" is missing spreader or hoist-rope nodes.`);
    const gantry = spreader.parent; if (!gantry || ropes.parent !== gantry) throw new Error(`Quay crane "${id}" has an unsupported hoist node hierarchy.`);
    model.updateMatrixWorld(true);
    const trolleyNode = new THREE.Group(); trolleyNode.name = `${id}-trolley`; gantry.add(trolleyNode);
    const hoistNode = new THREE.Group(); hoistNode.name = `${id}-hoist`; trolleyNode.add(hoistNode); hoistNode.attach(ropes); hoistNode.attach(spreader);
    const entity = entityManager.createEntity(id); const wrapper = new THREE.Group(); wrapper.name = id; wrapper.position.set(position.x, position.y, position.z); wrapper.add(model);
    const transform = new TransformComponent(wrapper); const trolley = new TrolleyComponent({ node: trolleyNode }); const hoist = new HoistComponent({ node: hoistNode });
    const quayCrane = new QuayCraneComponent(model, trolleyNode, hoistNode, ropes, spreader);
    entity.addComponent(ComponentTypes.TYPE, new TypeComponent("CRANE"))
      .addComponent(ComponentTypes.TRANSFORM, transform)
      .addComponent(ComponentTypes.RENDER, new RenderComponent(model, { onDispose }))
      .addComponent(ComponentTypes.SELECTABLE, new SelectableComponent())
      .addComponent(ComponentTypes.CRANE, new CraneComponent({ model }))
      .addComponent(ComponentTypes.QUAY_CRANE, quayCrane)
      .addComponent(ComponentTypes.TROLLEY, trolley)
      .addComponent(ComponentTypes.HOIST, hoist)
      .addComponent(ComponentTypes.TASK, new TaskComponent());
    transform.updateBBox(); return entityManager.add(entity);
  }
}
