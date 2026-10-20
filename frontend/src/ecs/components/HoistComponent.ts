// ============================================================================
// HoistComponent.js —— 起升组件（Hoist：控制吊具垂直升降的机构）
//
// 【这个文件干什么】
// 只管一个方向：Y 轴（垂直方向）的上下移动。与小车组件同样是“设目标 → 每帧
// 逼近”的模式，另外多记一个 homeY（原始高度），作业结束后能一键升回待机高度。
//
// 【术语翻译】
//   Hoist（起升机构、卷扬机）    node（节点，被驱动的三维物体）
//   speed（速度，单位/秒）       homeY（初始/待机高度，home 即“归位点”）
//   targetY（目标高度）          deltaY（高度增量）
//   Math.abs（绝对值）            Math.sign（取符号）
//   getter（取值器，把方法伪装成只读属性）
//   dt / deltaTime（帧间隔时间，单位：秒）
// ============================================================================

import type * as THREE from "three";

export class HoistComponent {
  readonly node: THREE.Object3D;
  readonly speed: number;
  readonly homeY: number;
  targetY: number | null = null;

  constructor({ node, speed = 28 }: { node: THREE.Object3D; speed?: number }) {
    this.node = node; this.speed = speed; this.homeY = node.position.y;
  }
  moveBy(deltaY: number): void { this.targetY = this.node.position.y + deltaY; }
  moveHome(): void { this.targetY = this.homeY; }
  get isMoving(): boolean { return this.targetY !== null; }
  update(dt: number): boolean {
    if (this.targetY === null) return false;
    const distance = this.targetY - this.node.position.y;
    const step = this.speed * dt;
    if (Math.abs(distance) <= step) { this.node.position.y = this.targetY; this.targetY = null; return true; }
    this.node.position.y += Math.sign(distance) * step;
    return false;
  }
}
