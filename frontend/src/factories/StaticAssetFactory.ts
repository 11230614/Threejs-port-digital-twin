// ============================================================================
// StaticAssetFactory.js —— 静态资产工厂（Static Asset Factory：造“可点选的空盒子”）
//
// 【这个文件干什么】
// 为不会动的设施（厂房、仓库、闸口等）创建实体。它有个特别设计：
// 生成的不是真实的建筑模型，而是一个 pick volume（拾取体）——一个几乎全透明的
// 长方体（BoxGeometry 盒子几何体）。
//
// 为什么要这么干？真实建筑模型的形状往往凹凸不规则，鼠标想点中它得靠射线打到
// 某个具体三角面，边角处很难点准。于是额外套一个规整的透明盒子专门负责“被点中”，
// 用户看到的仍是建筑本体，点击体验却变得非常好。opacity（不透明度）设成 0.035
// 而不是 0，是为了鼠标悬停时有一丝极淡的青色反馈。
//
// 【术语翻译】
//   Static Asset（静态资产，不动的设施）      Factory（工厂模式）
//   pick volume（拾取体，专供射线点选的隐形包围体）
//   MeshBasicMaterial（基础网格材质，不受光照影响，恒定颜色）
//   BoxGeometry（盒子几何体）    Mesh（网格，几何体 + 材质 = 可见物体）
//   transparent（开启透明混合）  opacity（不透明度，0 全透明 ~ 1 完全不透明）
//   depthWrite（深度写入，关掉它可避免透明物体互相遮挡出错）
//   clone（克隆材质，让每个实例能独立改颜色而不互相影响）
//   0x31f7ff（十六进制颜色，青蓝色）
// ============================================================================

import * as THREE from "three";
import { ComponentTypes } from "../ecs/components/ComponentTypes";
import { RenderComponent } from "../ecs/components/RenderComponent";
import { SelectableComponent } from "../ecs/components/SelectableComponent";
import { StaticAssetComponent } from "../ecs/components/StaticAssetComponent";
import { TransformComponent } from "../ecs/components/TransformComponent";
import { TypeComponent } from "../ecs/components/TypeComponent";
import type { Entity } from "../ecs/Entity";
import type { EntityManager } from "../ecs/EntityManager";

const PICK_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x31f7ff, transparent: true, opacity: 0.035, depthWrite: false });
export interface StaticAssetCreateOptions { id: string; type: string; size: { x: number; y: number; z: number }; position: { x: number; y: number; z: number } }
export class StaticAssetFactory {
  static create(entityManager: EntityManager, { id, type, size, position }: StaticAssetCreateOptions): Entity {
    const entity = entityManager.createEntity(id); const model = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), PICK_MATERIAL.clone()); model.name = `${id}-pick-volume`;
    const wrapper = new THREE.Group(); wrapper.name = id; wrapper.position.set(position.x, position.y, position.z); wrapper.userData.isStaticAsset = true; wrapper.add(model);
    const transform = new TransformComponent(wrapper);
    entity.addComponent(ComponentTypes.TYPE, new TypeComponent(type))
      .addComponent(ComponentTypes.TRANSFORM, transform)
      .addComponent(ComponentTypes.RENDER, new RenderComponent(model))
      .addComponent(ComponentTypes.SELECTABLE, new SelectableComponent())
      .addComponent(ComponentTypes.STATIC_ASSET, new StaticAssetComponent());
    transform.updateBBox(); return entityManager.add(entity);
  }
}
