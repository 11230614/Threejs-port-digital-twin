// ============================================================================
// ContainerComponent.js —— 集装箱组件（Container Component：箱子的业务档案）
//
// 【这个文件干什么】
// 把一条集装箱业务记录挂到实体上。record（记录）里通常包含箱号、箱型
// （20 尺 / 40 尺）、重量、所在贝位（bay，船上或堆场的格位坐标）等信息。
// 三维模型只负责“长什么样”，业务数据全靠这个组件携带。
//
// 【术语翻译】
//   Container（集装箱）   record（记录，一条数据）
//   bay（贝位，堆场/船上的定位格）   TEU（标准箱单位，20 尺集装箱）
// ============================================================================

export interface ContainerRecord {
  id: string;
  state: string;
  location?: string;
  taskId?: string | null;
  entity?: unknown;
  [key: string]: unknown;
}

export class ContainerComponent {
  constructor(public record: ContainerRecord) {}
}
