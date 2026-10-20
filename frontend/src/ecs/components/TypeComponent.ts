// ============================================================================
// TypeComponent.js —— 类型组件（Type Component：记录“这个实体是什么”）
//
// 【这个文件干什么】
// 给实体贴一个种类标签，例如 “agv”（无人集卡）、“quayCrane”（岸桥）、
// “container”（集装箱）。系统（System）靠它筛选出自己关心的那一批实体。
//
// 【术语翻译】
//   Type（类型）   Component（组件）   constructor（构造函数）
//   value（值）    this（当前实例自身）
// ============================================================================

export class TypeComponent {
  constructor(public value: string) {}
}
