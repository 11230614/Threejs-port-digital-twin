// ============================================================================
// ComponentTypes.js —— 组件类型常量表（Component Types：组件种类的名字清单）
//
// 【这个文件干什么】
// 本项目采用 ECS 架构（Entity-Component-System，实体-组件-系统）：
//   · Entity（实体）  = 一个“东西”，本身只是个 id（编号），不含数据；
//   · Component（组件）= 挂在实体上的一坨数据，例如位置、速度、外观；
//   · System（系统）  = 每帧遍历实体、读写组件、推动逻辑前进的代码。
// 组件是用“字符串名字”来索引的（如 “transform”），字符串散落各处容易写错，
// 所以这里集中定义一份常量表，别处一律引用 ComponentTypes.TRANSFORM。
//
// 【术语翻译】
//   Component（组件）  Type（类型）      Object.freeze（对象冻结，禁止修改）
//   TRANSFORM（变换：位置/旋转/缩放）    RENDER（渲染）
//   SELECTABLE（可选中）                MOTION（运动）
//   AGV（Automated Guided Vehicle，自动导引运输车 / 无人集卡）
//   CRANE（起重机/吊车）                QUAY CRANE（岸桥，码头岸边装卸船的大吊机）
//   TROLLEY（小车，岸桥上横向跑的那个部件）
//   HOIST（起升机构，负责上下提放的部件）
//   CONTAINER（集装箱）                 ASSET（资产，指场景里的模型物件）
//   STATIC ASSET（静态资产，不动的物件，如楼房、灯塔）
// ============================================================================

export const ComponentTypes = Object.freeze({
  TYPE: "type",
  TRANSFORM: "transform",
  RENDER: "render",
  SELECTABLE: "selectable",
  MOTION: "motion",
  AGV: "agv",
  CRANE: "crane",
  QUAY_CRANE: "quayCrane",
  TROLLEY: "trolley",
  HOIST: "hoist",
  TASK: "task",
  CONTAINER: "container",
  ASSET: "asset",
  STATIC_ASSET: "staticAsset",
} as const);

export type ComponentType = (typeof ComponentTypes)[keyof typeof ComponentTypes];
