// ============================================================================
// TransformComponent.js —— 变换组件（Transform：实体在三维空间中的位置与体积）
//
// 【这个文件干什么】
// 每个看得见的实体都要有它。内部持有两样东西：
//   · wrapper（包裹节点）：一个 Three.js 的 Group（组），实体的所有模型都塞在
//     它里面。为什么要套一层？因为直接改模型自身的坐标会跟模型文件里的原始
//     偏移打架，套一层“壳”后，移动壳子即可，模型内部结构保持原样。
//   · bbox（bounding box，包围盒）：能把实体整个装进去的最小长方体，用于
//     碰撞判断、点选、视锥剔除（frustum culling，看不见就不画）。
//
// 【术语翻译】
//   Transform（变换：位置 position / 旋转 rotation / 缩放 scale 的统称）
//   wrapper（包裹层、外壳节点）        Group（组，可容纳子物体的空节点）
//   bbox / bounding box（包围盒）      Box3（Three.js 的三维盒子类）
//   Vector3（三维向量，用来表示坐标或方向）
//   world position（世界坐标，相对整个场景原点的绝对位置）
//   local position（局部坐标，相对父节点的相对位置）
// ============================================================================

import * as THREE from "three";

export class TransformComponent {
  readonly wrapper: THREE.Object3D;
  readonly bbox: THREE.Box3;
  constructor(wrapper: THREE.Object3D = new THREE.Group()) { this.wrapper = wrapper; this.bbox = new THREE.Box3(); this.updateBBox(); }
  updateBBox(): void { this.bbox.setFromObject(this.wrapper); }
  getWorldPosition(): THREE.Vector3 { return this.wrapper.getWorldPosition(new THREE.Vector3()); }
}
