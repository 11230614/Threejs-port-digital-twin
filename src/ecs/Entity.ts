//
// 【这个文件干什么】
// 在 ECS（Entity-Component-System，实体-组件-系统）架构里，Entity（实体）本身
// 几乎是空的——它只有一个 id（编号）和一个指向 manager（管理器）的引用。
// 真正的数据全在 Component（组件）里，而组件并不存在实体对象上，而是集中存放在
// EntityManager（实体管理器）的组件仓库中。
//
// 那这个类的价值在哪？它是一层 facade（外观模式，门面）：
//   · 让你写 entity.wrapper 而不是 manager.getComponent(id, "transform").wrapper；
//   · 把散落的组件访问收口到一处，将来改组件存储方式时外部代码不用动。
//
// 下面大量使用 getter（取值器）：定义时写 get xxx()，使用时写 entity.xxx，
// 看着像属性，实际每次读取都会执行一遍函数体去查组件。
//
// 【术语翻译】
//   Entity（实体）        Component（组件）      System（系统）
//   id（标识编号）        manager（管理器）
//   getter / setter（取值器 / 赋值器）
//   facade（外观模式，用简单接口包住复杂内部）
//   wrapper（包裹节点，实体在三维场景里的外壳）
//   bbox / bounding box（包围盒）
//   dispose（释放显存等资源）    traverse（递归遍历子节点）
//   geometry（几何体，模型的顶点数据）   material（材质，模型的表面外观）
//   method chaining（链式调用，方法返回 this 以便连着写 .a().b()）
//   ?. （可选链）  ?? （空值合并）
// ============================================================================

import * as THREE from "three";
import type { AssetState } from "../stores/types";
import type { EntityManager } from "./EntityManager";
import { ComponentTypes, type ComponentType } from "./components/ComponentTypes";
import type { AGVComponent } from "./components/AGVComponent";
import type { AssetComponent } from "./components/AssetComponent";
import type { ContainerComponent, ContainerRecord } from "./components/ContainerComponent";
import type { CraneComponent } from "./components/CraneComponent";
import type { HoistComponent } from "./components/HoistComponent";
import type { MotionComponent } from "./components/MotionComponent";
import type { QuayCraneComponent } from "./components/QuayCraneComponent";
import type { RenderComponent } from "./components/RenderComponent";
import type { SelectableComponent } from "./components/SelectableComponent";
import type { TaskComponent } from "./components/TaskComponent";
import type { TrolleyComponent } from "./components/TrolleyComponent";
import type { TransformComponent } from "./components/TransformComponent";
import type { TypeComponent } from "./components/TypeComponent";

export type EntityId = string;
export type ComponentValue = AGVComponent | AssetComponent | ContainerComponent | CraneComponent | HoistComponent | MotionComponent | QuayCraneComponent | RenderComponent | SelectableComponent | TaskComponent | TrolleyComponent | TransformComponent | TypeComponent | { value: unknown };

export class Entity {
  readonly id: EntityId;
  readonly manager: EntityManager;
  constructor({ id, manager }: { id: EntityId; manager: EntityManager }) { this.id = id; this.manager = manager; }
  addComponent(type: ComponentType | string, component: ComponentValue): this { this.manager.addComponent(this, type, component); return this; }
  removeComponent(type: ComponentType | string): this { this.manager.removeComponent(this.id, type); return this; }
  getComponent<T extends ComponentValue = ComponentValue>(type: ComponentType | string): T | null { return this.manager.getComponent<T>(this.id, type); }
  hasComponent(type: ComponentType | string): boolean { return this.manager.hasComponent(this.id, type); }
  get type(): string | null { return this.getComponent<TypeComponent>(ComponentTypes.TYPE)?.value ?? null; }
  get wrapper(): THREE.Object3D | null { return this.getComponent<TransformComponent>(ComponentTypes.TRANSFORM)?.wrapper ?? null; }
  get bbox(): THREE.Box3 | null { return this.getComponent<TransformComponent>(ComponentTypes.TRANSFORM)?.bbox ?? null; }
  get renderObject(): THREE.Object3D | null { return this.getComponent<RenderComponent>(ComponentTypes.RENDER)?.model ?? null; }
  get selectable(): SelectableComponent | null { return this.getComponent<SelectableComponent>(ComponentTypes.SELECTABLE); }
  get motion(): MotionComponent | null { return this.getComponent<MotionComponent>(ComponentTypes.MOTION); }
  get operation(): AGVComponent | null { return this.getComponent<AGVComponent>(ComponentTypes.AGV); }
  get animation(): CraneComponent | null { return this.getComponent<CraneComponent>(ComponentTypes.CRANE); }
  get asset(): AssetState | null { return this.getComponent<AssetComponent>(ComponentTypes.ASSET)?.asset ?? null; }
  get record(): ContainerRecord | null { return this.getComponent<ContainerComponent>(ComponentTypes.CONTAINER)?.record ?? null; }
  get taskLocked(): boolean { return this.motion?.taskLocked ?? false; }
  set taskLocked(value: boolean) { if (this.motion) this.motion.taskLocked = value; }
  updateBBox(): void { this.getComponent<TransformComponent>(ComponentTypes.TRANSFORM)?.updateBBox(); }
  getWorldPosition(): THREE.Vector3 | null { return this.getComponent<TransformComponent>(ComponentTypes.TRANSFORM)?.getWorldPosition() ?? null; }
  dispose(): void {
    if (this.getComponent<RenderComponent>(ComponentTypes.RENDER)?.dispose()) return;
    this.wrapper?.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      if (!mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    });
  }
}
