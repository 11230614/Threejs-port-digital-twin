//
// 【这个文件干什么】
// 它是整个 ECS（Entity-Component-System，实体-组件-系统）架构的心脏，管两张表：
//   · entities（实体表）：Map（映射表），id（编号） -> Entity（实体对象）
//   · componentStores（组件仓库）：Map 的 Map，
//        组件类型名 -> ( 实体 id -> 组件对象 )
//
// 为什么组件不直接挂在实体上，要单独开一张表？这叫 SoA（Structure of Arrays，
// 结构数组化）思路：同类组件存在一起，系统遍历“所有会动的东西”时只需扫一张小表，
// 而不是把每个实体对象整个翻一遍，CPU 缓存命中率更高，几千个实体也不卡。
//
// 此外它还负责把数据变化同步给 Pinia store（状态仓库），让 Vue 界面自动刷新。
//
// 【术语翻译】
//   Entity（实体）        Component（组件）      Manager（管理器）
//   Map（映射表）         Set（集合）
//   store（状态仓库，此处指 Pinia 里的响应式数据源）
//   register / unregister（注册 / 注销）
//   userData（Three.js 物体自带的自定义数据口袋）
//   pickable（可拾取的，能被鼠标射线点中的）
//   raycast（射线检测，从相机往鼠标方向发射线看打到谁）
//   template literal（模板字符串，用反引号和 ${} 拼接）
//   rest parameter（剩余参数，...types 把多个实参收成数组）
// ============================================================================

import * as THREE from "three";
import { useAssetStore } from "../stores/AssetStore";
import { useDeviceStore } from "../stores/DeviceStore";
import type { SceneEntity } from "../stores/types";
import { ComponentTypes, type ComponentType } from "./components/ComponentTypes";
import { Entity, type ComponentValue, type EntityId } from "./Entity";
import type { TransformComponent } from "./components/TransformComponent";
import type { TypeComponent } from "./components/TypeComponent";

export class EntityManager {
  readonly entities = new Map<EntityId, Entity>();
  readonly componentStores = new Map<ComponentType | string, Map<EntityId, ComponentValue>>();
  private readonly store = useDeviceStore();
  private readonly assetStore = useAssetStore();

  createEntity(id: EntityId): Entity { if (this.entities.has(id)) throw new Error(`Entity already exists: ${id}`); return new Entity({ id, manager: this }); }
  add(entity: Entity): Entity { this.entities.set(entity.id, entity); this.store.registerEntity(entity as unknown as SceneEntity); return entity; }
  addComponent(entityOrId: Entity | EntityId, type: ComponentType | string, component: ComponentValue): ComponentValue {
    const id = typeof entityOrId === "string" ? entityOrId : entityOrId.id;
    const store = this.componentStores.get(type) ?? new Map<EntityId, ComponentValue>(); store.set(id, component); this.componentStores.set(type, store);
    if (type === ComponentTypes.TRANSFORM) {
      const transform = component as TransformComponent;
      const entity = typeof entityOrId === "string" ? this.entities.get(id) : entityOrId;
      if (transform.wrapper) { transform.wrapper.userData.entityId = id; transform.wrapper.userData.entityRef = entity; }
    }
    return component;
  }
  removeComponent(id: EntityId, type: ComponentType | string): void { this.componentStores.get(type)?.delete(id); }
  getComponent<T extends ComponentValue = ComponentValue>(id: EntityId, type: ComponentType | string): T | null { return (this.componentStores.get(type)?.get(id) as T | undefined) ?? null; }
  hasComponent(id: EntityId, type: ComponentType | string): boolean { return this.componentStores.get(type)?.has(id) ?? false; }
  getEntitiesWith(...types: Array<ComponentType | string>): Entity[] { return this.getAll().filter((entity) => types.every((type) => this.hasComponent(entity.id, type))); }
  remove(id: EntityId, scene: THREE.Scene): void {
    const entity = this.entities.get(id); if (!entity) return;
    if (entity.wrapper) scene.remove(entity.wrapper); entity.dispose(); this.entities.delete(id);
    this.componentStores.forEach((store) => store.delete(id)); this.store.unregisterEntity(id);
  }
  notifyUpdated(): void { this.store.markFrame(); this.assetStore.markFrame(); }
  getById(id: EntityId): Entity | undefined { return this.entities.get(id); }
  getAll(): Entity[] { return Array.from(this.entities.values()); }
  getByType(type: string): Entity[] { return this.getEntitiesWith(ComponentTypes.TYPE).filter((entity) => this.getComponent<TypeComponent>(entity.id, ComponentTypes.TYPE)?.value === type); }
  getPickableWrappers(): THREE.Object3D[] { return this.getEntitiesWith(ComponentTypes.TRANSFORM, ComponentTypes.SELECTABLE).map((entity) => this.getComponent<TransformComponent>(entity.id, ComponentTypes.TRANSFORM)?.wrapper).filter((wrapper): wrapper is THREE.Object3D => Boolean(wrapper)); }
  resolveEntity(hitObject: THREE.Object3D | null): Entity | null { let current = hitObject; while (current) { const id = current.userData.entityId; if (typeof id === "string") return this.getById(id) ?? null; current = current.parent; } return null; }
}
