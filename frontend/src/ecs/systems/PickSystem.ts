// ============================================================================
// PickSystem.js —— 拾取系统（Pick System：把鼠标点击换算成"点中了哪个实体"）
//
// 【这个文件干什么】
// 屏幕是二维的，场景是三维的，中间靠 raycasting（射线检测）打通：
// 从相机出发、穿过鼠标所在的那个像素、向场景深处发一条射线，
// 看它先碰到哪个物体，那个就是用户想点的东西。
//
// 三个易错点本文件都处理了：
//   1) 坐标换算：Three.js 要的是 NDC（Normalized Device Coordinates，归一化
//      设备坐标），范围 -1~1 且 Y 轴朝上；而浏览器给的是像素坐标且 Y 轴朝下。
//   2) 必须用 getBoundingClientRect（取元素在页面中的位置）做基准，
//      直接用 event.clientX 在画布不占满全屏时会整体偏移。
//   3) 隐藏物体不该被点中：Three.js 的射线检测不检查 visible（可见性），
//      所以要自己沿父链逐级确认，见文件末尾的 isWorldVisible。
//
// 【术语翻译】
//   Pick（拾取，用鼠标选中三维物体）    Raycaster（射线投射器）
//   raycasting（射线检测）             ray（射线）
//   NDC（归一化设备坐标，-1~1 的标准化屏幕坐标）
//   getBoundingClientRect（获取元素相对视口的位置与尺寸）
//   clientX / clientY（鼠标相对浏览器视口的像素坐标）
//   intersectObjects（求射线与物体的交点集合）
//   recursive（递归，连子节点一起检测）
//   hit（命中，射线与物体的一个交点）
//   visible（可见性标记）              bind（绑定 this）
//   callback（回调函数）
// ============================================================================

// 导入 Three.js，用到 Raycaster（射线投射器）与 Vector2（二维向量）
import * as THREE from "three";
import type { Entity } from "../Entity";
import type { EntityManager } from "../EntityManager";

export interface PickPointerEvent { clientX: number; clientY: number }
export interface PickCanvas {
  addEventListener(type: "click", listener: (event: MouseEvent) => void): void;
  removeEventListener(type: "click", listener: (event: MouseEvent) => void): void;
  getBoundingClientRect(): PickCanvasRect;
}
export interface PickCanvasRect { left: number; top: number; width: number; height: number }
export interface PickEntityManager {
  getPickableWrappers(): THREE.Object3D[];
  resolveEntity(hitObject: THREE.Object3D | null): Entity | null;
}
export type PickCallback = (entity: Entity | null) => void;

export class PickSystem {
  readonly camera: THREE.Camera;
  readonly domElement: PickCanvas;
  readonly entityManager: PickEntityManager;
  readonly raycaster: THREE.Raycaster;
  readonly callbacks: PickCallback[] = [];
  private readonly _boundHandleClick: (event: MouseEvent) => void;

  constructor(camera: THREE.Camera, domElement: PickCanvas, entityManager: PickEntityManager) {
    this.camera = camera;
    this.domElement = domElement;
    this.entityManager = entityManager;
    this.raycaster = new THREE.Raycaster();
    this._boundHandleClick = this._handleClick.bind(this);
    domElement.addEventListener("click", this._boundHandleClick);
  }

  onPick(callback: PickCallback): void { this.callbacks.push(callback); }

  destroy(): void {
    this.domElement.removeEventListener("click", this._boundHandleClick);
  }

  private _handleClick(event: PickPointerEvent): void {
    const rect = this.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.entityManager.getPickableWrappers(), true)
      .filter((hit) => isWorldVisible(hit.object));
    const entity = hits.length ? this.entityManager.resolveEntity(hits[0].object) : null;
    this.callbacks.forEach((callback) => callback(entity));
  }
}

function isWorldVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}
