// ============================================================================
// ContainerFactory.js —— 集装箱工厂（Container Factory：装配集装箱实体）
//
// 【这个文件干什么】
// Factory（工厂模式）：把“创建一个完整实体需要挂哪些组件”这套繁琐流程封装成
// 一次静态方法调用，调用方不必记住集装箱要 5 个组件、顺序如何、包围盒何时更新。
//
// 本工厂有个关键动作叫 reparenting（重新挂载父节点）：
// 传进来的 model（模型）原本挂在别的父节点下（比如吊具或另一辆车），
// 直接搬到新 wrapper（包裹节点）里会因为父节点变了而导致位置突变。
// 所以先把它当前的世界变换（world transform：世界位置/朝向/缩放）抄到 wrapper 上，
// 再把模型自身的局部变换归零，这样“看起来”完全没动，但父子关系换了。
//
// 【术语翻译】
//   Factory（工厂模式）        static method（静态方法，直接用类名调用，不必 new）
//   world position / quaternion / scale（世界位置 / 世界朝向 / 世界缩放）
//   Quaternion（四元数，一种不会出现万向节死锁的旋转表示法）
//   identity（单位化，把旋转重置为“不旋转”）
//   wrapper（包裹节点）        reparent（更换父节点）
//   record（业务记录）         onDispose（释放回调）
//   method chaining（链式调用）
// ============================================================================

import * as THREE from "three";
import { ComponentTypes } from "../ecs/components/ComponentTypes";
import { ContainerComponent, type ContainerRecord } from "../ecs/components/ContainerComponent";
import { RenderComponent } from "../ecs/components/RenderComponent";
import { SelectableComponent } from "../ecs/components/SelectableComponent";
import { TransformComponent } from "../ecs/components/TransformComponent";
import { TypeComponent } from "../ecs/components/TypeComponent";
import type { Entity } from "../ecs/Entity";
import type { EntityManager } from "../ecs/EntityManager";

export interface ContainerCreateOptions { id: string; model: THREE.Object3D; record: ContainerRecord; onDispose?: (() => void) | null }
export class ContainerFactory {
  static create(entityManager: EntityManager, { id, model, record, onDispose = null }: ContainerCreateOptions): Entity {
    const worldPosition = model.getWorldPosition(new THREE.Vector3());
    const worldQuaternion = model.getWorldQuaternion(new THREE.Quaternion());
    const worldScale = model.getWorldScale(new THREE.Vector3());
    const entity = entityManager.createEntity(id); const wrapper = new THREE.Group(); wrapper.name = id;
    wrapper.position.copy(worldPosition); wrapper.quaternion.copy(worldQuaternion); wrapper.scale.copy(worldScale); wrapper.add(model);
    model.position.set(0, 0, 0); model.quaternion.identity(); model.scale.set(1, 1, 1);
    const transform = new TransformComponent(wrapper);
    entity.addComponent(ComponentTypes.TYPE, new TypeComponent("CONTAINER"))
      .addComponent(ComponentTypes.TRANSFORM, transform)
      .addComponent(ComponentTypes.RENDER, new RenderComponent(model, { onDispose }))
      .addComponent(ComponentTypes.SELECTABLE, new SelectableComponent())
      .addComponent(ComponentTypes.CONTAINER, new ContainerComponent(record));
    transform.updateBBox(); return entityManager.add(entity);
  }
}
