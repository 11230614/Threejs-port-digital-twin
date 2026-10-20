// ============================================================================
// SelectableComponent.js —— 可选中组件（Selectable Component：能否被点选）
//
// 【这个文件干什么】
// 只要实体挂了这个组件，就代表它允许被鼠标拾取（pick，射线点选）。
// 组件内部再用 isSelected（是否已被选中）记录它当前的高亮状态。
// 拾取系统 PickSystem 负责把点击变成“选中”，高亮系统 HighlightSystem
// 负责根据这个标记给模型描边或变色。
//
// 【术语翻译】
//   Selectable（可选中的）   isSelected（是否已选中）
//   pick（拾取，用射线判断鼠标点到了哪个物体）
//   default parameter（默认参数，调用时不传就用这个值）
// ============================================================================

export class SelectableComponent {
  constructor(public isSelected = false, public isWarning = false) {}
}
