// ============================================================================
// RenderComponent.js —— 渲染组件（Render Component：模型引用 + 显存回收钩子）
//
// 【这个文件干什么】
// 记住实体用的是哪个可视对象（model），并提供一个“只会生效一次”的 dispose
// （释放）方法。为什么强调只生效一次？因为三维模型占用的是 GPU（显卡）显存，
// 释放两次会报错或释放掉别人正在用的资源，所以用 disposed（已释放）标记加锁。
//
// 【术语翻译】
//   Render（渲染，把三维数据画成屏幕像素）   model（模型）
//   dispose（释放、销毁，归还显存等资源）    disposed（已释放）
//   onDispose（释放时的回调函数，hook 钩子）
//   GPU（Graphics Processing Unit，图形处理器 / 显卡）
//   memory leak（内存泄漏，用完不还导致越跑越卡）
// ============================================================================

import type * as THREE from "three";

export interface RenderComponentOptions { onDispose?: (() => void) | null }
export class RenderComponent {
  disposed = false;
  readonly model: THREE.Object3D;
  readonly onDispose: (() => void) | null;
  constructor(model: THREE.Object3D, { onDispose = null }: RenderComponentOptions = {}) { this.model = model; this.onDispose = onDispose; }
  dispose(): boolean { if (this.disposed || !this.onDispose) return false; this.disposed = true; this.onDispose(); return true; }
}
