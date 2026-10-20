// ============================================================================
// CraneComponent.js —— 吊车组件（Crane Component：吊车的可动部件引用 + 相位）
//
// 【这个文件干什么】
// 从已加载的三维模型里，把“会动的两个零件”抓出来存好，供动画系统每帧驱动：
//   · trolley（小车）  —— 在大梁上横向来回跑的那个部件
//   · spreader（吊具） —— 挂在钢丝绳下、真正抓住集装箱的框架
// 另外记一个 phase（相位），让场景里多台吊车的摆动错开，不会整齐得很假。
//
// 【术语翻译】
//   Crane（起重机 / 吊车）      trolley（小车）     spreader（吊具）
//   phase（相位，周期运动的起始偏移量）
//   userData（Three.js 里每个物体自带的“自定义数据”口袋）
//   Math.random()（生成 0~1 之间的随机小数）   Math.PI（圆周率 π）
//   ??（空值合并：左边是 null/undefined 就取右边）
// ============================================================================

import type * as THREE from "three";

export class CraneComponent {
  readonly phase: number;
  readonly trolley: THREE.Object3D | null;
  readonly spreader: THREE.Object3D | null;

  constructor({ model, phase = Math.random() * Math.PI * 2 }: { model: THREE.Object3D; phase?: number }) {
    this.phase = phase;
    this.trolley = (model.userData.trolley as THREE.Object3D | undefined) ?? null;
    this.spreader = (model.userData.spreader as THREE.Object3D | undefined) ?? null;
  }
}
