// ============================================================================
// QuayCraneComponent.js —— 岸桥组件（Quay Crane：码头岸边装卸船的大型吊机）
//
// 【这个文件干什么】
// 岸桥有好几套彼此独立的运动机构，这个组件把它们的引用集中存放，
// 让 QuayCraneSystem（岸桥系统）能分别驱动：
//   · gantry（大车/门架）—— 整台机器沿码头岸线纵向平移
//   · trolley（小车）    —— 在大梁上横向跑，把吊具送到船上或岸上
//   · hoist（起升机构）  —— 控制吊具垂直升降
//   · ropes（钢丝绳）    —— 随起升高度拉伸的绳索模型
//   · spreader（吊具）   —— 末端抓箱的框架
//
// 【术语翻译】
//   Quay（码头岸壁）   Quay Crane（岸桥 / 岸边集装箱起重机，简称 QC）
//   gantry（门架、大车行走机构）   trolley（小车）   hoist（起升机构）
//   rope（钢丝绳）   spreader（吊具）
//   destructuring（解构赋值，从对象里按名字取出多个字段）
// ============================================================================

import type * as THREE from "three";

export interface QuayCraneParts { gantry: THREE.Object3D; trolley: THREE.Object3D; hoist: THREE.Object3D; ropes: THREE.Object3D; spreader: THREE.Object3D }
export class QuayCraneComponent implements QuayCraneParts {
  constructor(public gantry: THREE.Object3D, public trolley: THREE.Object3D, public hoist: THREE.Object3D, public ropes: THREE.Object3D, public spreader: THREE.Object3D) {}
}
