// ============================================================================
// TaskComponent.js —— 任务组件（Task Component：设备身上的作业状态机）
//
// 【这个文件干什么】
// 用一个 state machine（状态机）记录设备正在干活的哪一步。
// 状态机的意思是：同一时刻只处于一个状态，且只能按规定路线跳转，
// 这样复杂流程（去取箱 → 装箱 → 送箱 → 卸箱 → 空闲）就不会乱。
// 典型流转：IDLE（空闲）→ MOVE_TO_CONTAINER（前往取箱点）→ 装箱 → 送达 → IDLE
//
// 【术语翻译】
//   Task（任务）              state（状态）        state machine（状态机）
//   IDLE（空闲）              operation（作业单，描述这次要搬什么、从哪到哪）
//   MOVE_TO_CONTAINER（前往集装箱位置）
//   transition（状态转移，从一个状态切到下一个状态）
// ============================================================================

export type TaskComponentState = "IDLE" | "MOVE_TO_CONTAINER" | string;
export interface TaskOperation { [key: string]: unknown }
export class TaskComponent {
  state: TaskComponentState = "IDLE";
  operation: TaskOperation | null = null;
  start(operation: TaskOperation): void { this.operation = operation; this.state = "MOVE_TO_CONTAINER"; }
  transition(state: TaskComponentState): void { this.state = state; }
  clear(): void { this.operation = null; this.state = "IDLE"; }
}
