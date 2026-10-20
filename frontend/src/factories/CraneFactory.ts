// ============================================================================
// CraneFactory.js —— 吊车工厂（Crane Factory：装配普通吊车实体）
//
// 【这个文件干什么】
// 装配“只需要简单摆动动画”的吊车。与 QuayCraneFactory（岸桥工厂）的区别是：
// 这里不拆解运动机构，只挂一个 CraneComponent（吊车组件）让它整体做周期性动作；
// 岸桥则要把小车、起升、吊具分别接管，实现真正的装卸流程。
//
// 【术语翻译】
//   Crane（起重机 / 吊车）     Factory（工厂模式）
//   static method（静态方法）  wrapper（包裹节点）
//   position（位置）           bbox / bounding box（包围盒）
//   method chaining（链式调用）
// ============================================================================

import * as THREE from "three";
import { ComponentTypes } from "../ecs/components/ComponentTypes";
import { CraneComponent } from "../ecs/components/CraneComponent";
import { RenderComponent } from "../ecs/components/RenderComponent";
import { SelectableComponent } from "../ecs/components/SelectableComponent";
import { TransformComponent } from "../ecs/components/TransformComponent";
import { TypeComponent } from "../ecs/components/TypeComponent";
import type { Entity } from "../ecs/Entity";
import type { EntityManager } from "../ecs/EntityManager";

export interface CraneCreateOptions { id: string; model: THREE.Object3D; position: { x: number; y: number; z: number } }
export class CraneFactory {
  static create(entityManager: EntityManager, { id, model, position }: CraneCreateOptions): Entity {
    const entity = entityManager.createEntity(id); const wrapper = new THREE.Group(); wrapper.name = id; wrapper.position.set(position.x, position.y, position.z); wrapper.add(model);
    const transform = new TransformComponent(wrapper);
    entity.addComponent(ComponentTypes.TYPE, new TypeComponent("CRANE"))
      .addComponent(ComponentTypes.TRANSFORM, transform)
      .addComponent(ComponentTypes.RENDER, new RenderComponent(model))
      .addComponent(ComponentTypes.SELECTABLE, new SelectableComponent())
      .addComponent(ComponentTypes.CRANE, new CraneComponent({ model }));
    transform.updateBBox(); return entityManager.add(entity);
  }
}
