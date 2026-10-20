// ============================================================================
// TrolleyComponent.js —— 小车组件（Trolley：岸桥大梁上横向往复行走的机构）
//
// 【这个文件干什么】
// 让一个节点（node）沿着指定的一条直线轴（axis）匀速滑到目标点。
// 用法是两步走：先 moveBy（相对移动一段距离）设定目标，然后每帧调 update
// （更新）让它逼近目标；到位后 update 返回 true（真），上层据此推进流程。
// 这种“设目标 → 每帧逼近 → 返回是否到位”的写法叫 tween（补间动画）。
//
// 【术语翻译】
//   Trolley（小车）      node（节点，Three.js 场景中的一个物体）
//   axis（轴，方向向量） speed（速度，单位/秒）    target（目标位置）
//   normalize（归一化，把向量长度变成 1，只保留方向）
//   clone（克隆，复制一份新对象，避免改动原对象）
//   addScaledVector（按倍数叠加向量）  distanceTo（求两点间直线距离）
//   lerp（linear interpolation，线性插值）
//   dt / deltaTime（帧间隔时间，单位：秒）
// ============================================================================

import * as THREE from "three";

export class TrolleyComponent {
  readonly node: THREE.Object3D;
  readonly axis: THREE.Vector3;
  readonly speed: number;
  target: THREE.Vector3 | null = null;

  constructor({ node, axis = new THREE.Vector3(0, 0, 1), speed = 42 }: { node: THREE.Object3D; axis?: THREE.Vector3; speed?: number }) {
    this.node = node; this.axis = axis.clone().normalize(); this.speed = speed;
  }
  moveBy(distance: number): void { this.target = this.node.position.clone().addScaledVector(this.axis, distance); }
  get isMoving(): boolean { return this.target !== null; }
  update(dt: number): boolean {
    if (!this.target) return false;
    const distance = this.node.position.distanceTo(this.target); const step = this.speed * dt;
    if (distance <= step) { this.node.position.copy(this.target); this.target = null; return true; }
    this.node.position.lerp(this.target, step / distance); return false;
  }
}
