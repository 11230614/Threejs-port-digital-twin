// ============================================================================
// TaskSystem.js —— 任务系统（Task System：整个码头业务流程的总指挥）
//
// 【这个文件干什么】
// 前面那些系统各管一件事：AGVSystem 管车的状态、MotionSystem 管车怎么走、
// QuayCraneSystem 管岸桥怎么抓箱、ContainerSystem 管箱子在哪。本系统是把它们
// 串成一条完整业务流水线的那根线——它自己不碰任何三维对象，只做三件事：
// 建任务、派活、听事件推进到下一步。
//
// 三条业务线（由 TaskType 决定走哪条）：
//   1) 堆场搬箱 TRANSPORT_CONTAINER：取箱 → 载货行驶 → 卸箱
//   2) 岸桥卸船 DISCHARGE：车开到桥下待命 → 岸桥九步机械动作 → 完成
//   3) 充电 CHARGING：车开到充电桩 → 完成（不涉及箱子）
//
// 【最关键的设计：事件驱动而非轮询】
// 任务不是靠每帧检查"车到了吗"来推进的，而是在构造函数里订阅 AGV_ARRIVED
// （车辆已抵达）事件，车一到就被动唤醒。好处是任务系统完全不需要 update 方法，
// 零帧开销；坏处是调试时调用栈会跳跃，所以下面每个事件分支都写清了来源。
//
// 状态流转靠 store.patchTask（局部更新任务）写进 Pinia 仓库，
// 界面的任务列表订阅仓库自动刷新，本系统不直接操作任何 DOM。
//
// 【术语翻译】
//   Task（任务）              step（步骤）        stepIndex（当前步骤序号）
//   WAITING（等待中）          RUNNING（执行中）    PAUSED（已暂停）
//   COMPLETED（已完成）
//   TRANSPORT_CONTAINER（集装箱运输）  DISCHARGE（卸船）
//   YARD_TRANSFER（堆场倒箱）          CHARGING（充电）
//   phase（阶段：PICKUP 取货 / DELIVERY 送货 / QUAY_PICKUP 岸桥待命 / CHARGING 充电）
//   staging（待命、就位）      berth（泊位）        charger（充电桩）
//   RTG（Rubber Tyred Gantry，轮胎式龙门吊 / 场桥）
//   route（路线）             dispatch（派发指令）  assign（分配）
//   reserve / release（预留 / 释放）
//   patch（局部更新，只改传入的字段，其余保持不变）
//   Object.freeze（冻结对象，做成只读常量）
//   Set（集合，用于快速判断"是否属于某一类"）
//   callback（回调函数）      Date.now（当前时间戳，毫秒）
// ============================================================================

// 导入 Three.js，本文件只用到 Vector3（三维向量）做位置偏移计算
import * as THREE from "three";
import type { Entity } from "../Entity";
import type { MotionPhase, MotionRoute } from "../components/MotionComponent";
import type { TaskState, ScenePosition, TaskDestination } from "../../stores/types";
import type { TaskStatusValue, TaskTypeValue } from "../../tasks/TaskCatalog";
import type { PathManager } from "../../world/PathManager";
import type { EquipmentManager } from "../../managers/EquipmentManager";
import type { TransformComponent } from "../components/TransformComponent";
import type { MotionComponent } from "../components/MotionComponent";
import type { AssetComponent } from "../components/AssetComponent";
import type { TaskComponent } from "../components/TaskComponent";
// 导入组件类型常量表
import { ComponentTypes } from "../components/ComponentTypes.ts";
// 导入任务状态仓库（任务数据的唯一真实来源，界面从这里读）
import { useTaskStore } from "../../stores/TaskStore.ts";
// 从任务目录导入：编号生成器、步骤模板表、状态枚举、类型枚举
import {
  createTaskId,
  TASK_STEP_TEMPLATES,
  TaskStatus,
  TaskType,
} from "../../tasks/TaskCatalog.ts";
// 导入岸桥状态枚举（派发岸桥作业时要写入初始状态）
import { QuayCraneState } from "./QuayCraneSystem.ts";

type ContainerRecord = {
  id: string;
  area: string;
  slot: { key: string };
  taskId?: string | null;
  entity?: Entity;
  [key: string]: unknown;
};

interface ContainerSystemApi {
  getAvailableContainer(index?: number): ContainerRecord | null;
  reserveForTask(id: string, taskId: string): boolean;
  releaseForTask(id: string | null | undefined, taskId: string): ContainerRecord | null;
  getWorldPosition(id: string): THREE.Vector3;
  handleAGVArrived(event: AGVArrivalEvent, task: TaskRecord): ContainerRecord | null;
}
interface AGVComponentLike { taskId?: string | null; currentContainer?: Entity | string | null; status?: string; cargoSlot?: THREE.Object3D | null }
interface MotionComponentLike { command: { taskId?: string; phase?: MotionPhase } | null; taskLocked: boolean }
interface AssetComponentLike { asset: { number?: string } }
interface AGVSystemApi {
  assignVehicle(options: { taskId: string; containerId?: string }): Entity | null;
  dispatch(options: { agv: Entity; taskId: string; phase: MotionPhase; route: MotionRoute | null; speed: number }): boolean;
  markContainerLoaded(agv: Entity, containerId: string): void;
  releaseVehicle(agv: Entity): void;
}
interface MotionSystemApi {
  on(eventName: string, listener: (event: AGVArrivalEvent) => void): () => boolean;
  holdAGV(agv: Entity): void;
  resumeCruise(agv: Entity): boolean;
}
interface QuayCraneContainer extends ContainerRecord { state?: string }
interface QuayCraneSystemApi {
  shipContainers: Map<string, QuayCraneContainer>;
  acquireShipContainer(taskId: string): QuayCraneContainer | null;
  getAvailableCrane(container: QuayCraneContainer): Entity | null;
  getAGVStagingPosition(crane: Entity): THREE.Vector3;
  start(options: {
    crane: Entity;
    agv: Entity;
    container: QuayCraneContainer;
    taskId: string;
    onStateChange: (state: string, stepIndex: number) => void;
    onComplete: (operation: { agv: Entity; container: QuayCraneContainer }) => void;
  }): boolean;
}
type TaskRecord = TaskState;
interface AGVArrivalEvent { agv: Entity; taskId?: string; phase?: MotionPhase; position: THREE.Vector3 }
interface DispatchInput { agv: Entity; taskId: string; phase: MotionPhase; route: MotionRoute | null; speed: number }

// YARD_CONTAINER_TASK_TYPES（需要搬箱子的堆场任务类型集合）：
// 这四种任务都得先找一个可用集装箱。用 Set（集合）而不是数组，
// 是因为下面要反复做"是否属于这一类"的判断，Set.has 是常数时间，
// 数组的 includes 要逐个比对
const YARD_CONTAINER_TASK_TYPES: ReadonlySet<TaskTypeValue> = new Set([
  // 集装箱运输（主流程）
  TaskType.TRANSPORT_CONTAINER,
  // 普通运输
  TaskType.TRANSPORT,
  // 装船
  TaskType.LOADING,
  // 堆场内部倒箱
  TaskType.YARD_TRANSFER,
]);

// QUAY_DISCHARGE_STEPS（岸桥卸船的九个步骤 + 完成）：
// 这一串文字直接显示在界面的任务进度条上。为什么不放进 TASK_STEP_TEMPLATES
// （统一的步骤模板表）？因为岸桥流程的步骤与 QuayCraneSystem 的状态机
// 一一对应，改动时必须两边同步，放在这里离得近、不容易漏改。
// Object.freeze（冻结）防止运行时被误改
const QUAY_DISCHARGE_STEPS = Object.freeze([
  // 0：车开到桥下待命位
  "AGV staging",
  // 1：小车横移到集装箱正上方
  "Move trolley to container",
  // 2：吊具下降
  "Lower spreader",
  // 3：锁住集装箱
  "Attach container",
  // 4：提升集装箱
  "Lift container",
  // 5：小车横移到车辆上方
  "Move trolley to AGV",
  // 6：吊具下降到车板高度
  "Lower spreader to AGV",
  // 7：解锁，箱子落到车上
  "Detach container",
  // 8：吊具升回待机高度
  "Lift spreader",
  // 9：全流程结束
  "Completed",
]);

// export（导出）class（类）：声明并公开"任务系统"
export class TaskSystem {
  readonly containerSystem: ContainerSystemApi;
  readonly agvSystem: AGVSystemApi;
  readonly motionSystem: MotionSystemApi;
  readonly pathManager: PathManager;
  readonly equipmentManager: EquipmentManager;
  readonly quayCraneSystem: QuayCraneSystemApi | null;
  readonly store: ReturnType<typeof useTaskStore>;
  counter = 0;
  // constructor（构造函数）：用对象参数一次注入六个协作系统。
  // 参数多到这个程度时用对象而非位置参数，是为了调用处能看清每个值的含义，
  // 也不必记住顺序
  constructor({
    // 集装箱系统（查箱子、预留、装卸）
    containerSystem,
    // 车辆系统（派车、改状态、释放）
    agvSystem,
    // 运动系统（真正让车走起来，也是 AGV_ARRIVED 事件的来源）
    motionSystem,
    // 路径管理器（生成从 A 到 B 的行驶路线）
    pathManager,
    // 设备管理器（查泊位、充电桩、场桥的位置）
    equipmentManager,
    // 岸桥系统（卸船任务才用得到，可为空）
    quayCraneSystem,
  }: {
    containerSystem: ContainerSystemApi;
    agvSystem: AGVSystemApi;
    motionSystem: MotionSystemApi;
    pathManager: PathManager;
    equipmentManager: EquipmentManager;
    quayCraneSystem?: QuayCraneSystemApi | null;
  }) {
    // 逐个保存到实例上
    this.containerSystem = containerSystem;
    this.agvSystem = agvSystem;
    this.motionSystem = motionSystem;
    this.pathManager = pathManager;
    this.equipmentManager = equipmentManager;
    this.quayCraneSystem = quayCraneSystem ?? null;
    // 拿到任务仓库
    this.store = useTaskStore();
    // counter（计数器）：任务编号的自增序号，也用作"第几号箱子/第几台场桥"的索引
    this.counter = 0;

    // 订阅"车辆已抵达"事件——这是整个任务系统的心跳。
    // 用箭头函数包一层是为了固定 this 指向本实例；
    // 若直接传 this._handleAGVArrival，回调里的 this 会变成 undefined
    this.motionSystem.on("AGV_ARRIVED", (event) =>
      this._handleAGVArrival(event),
    );
  }

  // createInitialTasks（建立初始任务）：场景刚加载时铺四个搬箱任务，
  // 让画面一开始就有活干，不至于空荡荡
  createInitialTasks(): void {
    // 循环四次，index += 1 与 index++ 等价，写全是为了风格统一
    for (let index = 0; index < 4; index += 1) {
      // 默认建集装箱运输任务
      this.createTask(TaskType.TRANSPORT_CONTAINER);
    }
  }

  // createTask（新建任务）：只负责"造出任务数据并登记"，不启动它。
  // 建与启分开是有意的：界面上任务先以 WAITING（等待中）出现在列表里，
  // 用户点"开始"才真正派车，符合调度室的实际操作习惯
  createTask(type: TaskTypeValue = TaskType.TRANSPORT_CONTAINER): TaskRecord {
    // 取当前序号
    const index = this.counter;
    // 生成任务编号（形如 "TASK-TRANSPORT-001"）
    const id = createTaskId(type, index);
    // 判断这个类型要不要搬箱子
    const isContainerTask = YARD_CONTAINER_TASK_TYPES.has(type);
    // 要搬箱的就去挑一个可用箱子；不搬箱的（如充电）置 null（空）
    const container = isContainerTask
      ? // 传 index 进去，让集装箱系统按序号轮着挑，避免四个任务抢同一个箱子
        this.containerSystem.getAvailableContainer(index)
      : null;
    // 算出目的地（不同任务类型去的地方不同）
    const destination = this._resolveDestination(type, index);
    // 序号自增。注意放在这里——上面所有用到 index 的地方都取的是自增前的值
    this.counter += 1;

    // 挑到箱子就立刻预留（reserve），把它锁给这个任务。
    // 不锁的话下一个任务创建时会挑中同一个箱子，两辆车去抢一个箱
    if (container) this.containerSystem.reserveForTask(container.id, id);

    // 组装任务对象（纯数据，没有任何方法，方便直接扔进 Pinia 做响应式）
    const task = {
      // 任务编号
      id,
      // 任务类型
      type,
      // 初始状态：等待中
      status: TaskStatus.WAITING,
      // steps（步骤清单）：三级兜底。
      // 卸船任务用专用的九步清单；否则查模板表；
      // 模板表里没有这个类型时（?? 空值合并），
      // 搬箱类退回集装箱运输的模板，其余退回充电模板。
      // 三级兜底是为了保证 steps 永不为 undefined ——
      // 界面读 task.steps.length 算进度，一旦为空就直接报错白屏
      steps:
        type === TaskType.DISCHARGE
          ? QUAY_DISCHARGE_STEPS
          : (TASK_STEP_TEMPLATES[type] ??
            (isContainerTask
              ? TASK_STEP_TEMPLATES[TaskType.TRANSPORT_CONTAINER]
              : TASK_STEP_TEMPLATES[TaskType.CHARGING])),
      // 当前进行到第几步，从 0 开始
      currentStepIndex: 0,
      // 关联的箱号（没有就是 null）
      containerId: container?.id ?? null,
      // agvId（车辆的业务编号，如 "AGV-03"）：此刻还没派车，先留空
      agvId: null,
      // agvEntityId（车辆的实体编号）：派车后填，用于反查三维对象
      agvEntityId: null,
      // from（起点信息）：有箱子就记它所在的堆场区与箱位，
      // 没箱子说明车从车队待命区出发
      from: container
        ? { area: container.area, slot: container.slot.key }
        : { area: "AGV_POOL" },
      // to（终点信息）
      to: destination,
      // 创建时间戳（毫秒），界面按它排序
      createdAt: Date.now(),
      // 最后更新时间戳，初值与创建时间相同
      updatedAt: Date.now(),
    };

    // 登记进仓库，界面的任务列表立即出现这一条
    this.store.registerTask(task);
    // 把任务对象返回给调用方（测试代码与批量创建会用到）
    return task;
  }

  // startTask（启动任务）：按类型分派到三条不同的业务线
  startTask(id: string): void {
    // 从仓库的 taskMap（任务索引表）按编号取任务
    const task = this.store.taskMap.get(id);
    // 双重校验：任务不存在，或不是等待中状态，一律不启动。
    // 后半个条件挡的是重复点击"开始"——已经在跑的任务再启动一次会派出第二辆车
    if (!task || task.status !== TaskStatus.WAITING) return;

    // 分支一：卸船任务（涉及岸桥的复杂机械动作）
    if (task.type === TaskType.DISCHARGE) {
      this._startQuayDischarge(task);
      // 处理完立即返回。这种"分派 + return"的写法比 if/else if 链更扁平，
      // 加新任务类型时只需插一段，不必调整既有缩进
      return;
    }

    // 分支二：需要搬箱子的堆场任务
    if (YARD_CONTAINER_TASK_TYPES.has(task.type)) {
      this._startContainerTransport(task);
      return;
    }

    // 分支三（兜底）：其余都当充电任务处理
    this._startCharging(task);
  }

  // startAll（全部启动）：界面上"一键开始"按钮调用
  startAll(): void {
    // 遍历所有任务
    this.store.tasks.forEach((task) => {
      // 只启动等待中的，已在跑的与已完成的跳过
      if (task.status === TaskStatus.WAITING) this.startTask(task.id);
    });
  }

  // _startContainerTransport（内部方法：启动堆场搬箱任务）
  _startContainerTransport(task: TaskRecord): void {
    // 把预留状态解除，正式取用这个箱子。releaseForTask 会校验
    // "这个箱子确实是预留给这个任务的"，串号时返回 null（空）
    const container = this.containerSystem.releaseForTask(
      task.containerId,
      task.id,
    );
    // 箱子没了（被别的流程动过，或创建时就没挑到）
    if (!container) {
      // 置为 PAUSED（已暂停）而不是失败。暂停是可恢复状态，
      // 等有箱子腾出来时用户可以重新点开始；标记失败就得重建任务
      this.store.patchTask(task.id, { status: TaskStatus.PAUSED });
      return;
    }

    // 向车辆系统要一辆空闲车
    const agv = this.agvSystem.assignVehicle({
      taskId: task.id,
      containerId: container.id,
    });
    // 车队全忙，同样暂停等待
    if (!agv) {
      this.store.patchTask(task.id, { status: TaskStatus.PAUSED });
      return;
    }
    // 注意这里有个已知的取舍：车没派到时箱子已经 release 了，
    // 状态上箱子处于"可用但没人管"，下次创建任务会重新挑到它，不会泄漏

    // 取箱点的世界坐标
    const pickupPosition = this.containerSystem.getWorldPosition(container.id);
    // 生成从"车当前位置"到"取箱点"的路线
    const route = this.pathManager.createYardRoute(
      // 车的当前世界坐标
      agv.getComponent<TransformComponent>(ComponentTypes.TRANSFORM)?.getWorldPosition() ?? new THREE.Vector3(),
      // 目标坐标
      pickupPosition,
      // 附带箱号，路径管理器据此微调停靠姿态（对准箱位而不是压在箱子上）
      { containerId: container.id },
    );

    // 更新任务状态：进入执行中，跳到第 3 步。
    // 为什么直接跳到 3？前三步（接单、确认箱位、规划路径）是瞬间完成的，
    // 逐步显示反而让用户看不清——一次性推进到"正在前往取箱点"才有信息量
    this.store.patchTask(task.id, {
      status: TaskStatus.RUNNING,
      currentStepIndex: 3,
      // agvId 优先用资产编号（人能看懂的 "AGV-03"），
      // 没有资产组件时退回实体编号
      agvId: agv.getComponent<AssetComponent>(ComponentTypes.ASSET)?.asset.number ?? agv.id,
      // 实体编号单独存一份，程序内部反查用
      agvEntityId: agv.id,
    });
    // 下发行驶指令，车开始动。speed 28 略低于送货时的 30 ——
    // 空车去取箱不着急，载货返程才是关键路径
    this._dispatchRoute({
      agv,
      taskId: task.id,
      phase: "PICKUP",
      route,
      speed: 28,
    });
  }

  // _startCharging（内部方法：启动充电任务）
  _startCharging(task: TaskRecord): void {
    // 要一辆空闲车。不传 containerId，因为充电不涉及箱子
    const agv = this.agvSystem.assignVehicle({ taskId: task.id });
    // 没车就暂停
    if (!agv) {
      this.store.patchTask(task.id, { status: TaskStatus.PAUSED });
      return;
    }

    // 生成到充电桩的路线
    const route = this.pathManager.createYardRoute(
      agv.getComponent<TransformComponent>(ComponentTypes.TRANSFORM)?.getWorldPosition() ?? new THREE.Vector3(),
      // 充电桩位置由设备管理器提供
      this.equipmentManager.chargerPosition,
    );
    // 更新状态：执行中，跳到第 2 步（充电流程步骤少，跳的格数也少）
    this.store.patchTask(task.id, {
      status: TaskStatus.RUNNING,
      currentStepIndex: 2,
      agvId: agv.getComponent<AssetComponent>(ComponentTypes.ASSET)?.asset.number ?? agv.id,
      agvEntityId: agv.id,
    });
    // 派车。phase 用 "CHARGING"（充电）这个专属阶段名，
    // 抵达事件里据此走"直接完成"的分支，不去找箱子
    this._dispatchRoute({
      agv,
      taskId: task.id,
      phase: "CHARGING",
      route,
      speed: 24,
    });
  }

  // _startQuayDischarge（内部方法：启动岸桥卸船任务）
  _startQuayDischarge(task: TaskRecord): void {
    // 岸桥系统是可选注入的，没有就直接暂停——
    // 这种配置缺失若不显式挡掉，下一行就是读 null 的属性报错
    const quayCraneSystem = this.quayCraneSystem;
    if (!quayCraneSystem) {
      this.store.patchTask(task.id, { status: TaskStatus.PAUSED });
      return;
    }

    // 从船上取一个待卸的箱子（并把它锁给本任务）
    const container = quayCraneSystem.acquireShipContainer(task.id);
    // 三级链式获取：有箱子才找能覆盖到它的岸桥
    const crane = container
      ? quayCraneSystem.getAvailableCrane(container)
      : null;
    // 有岸桥才派车。这种"前一步成功才做下一步"的链式写法，
    // 避免了在资源不足时白白占用后面的资源
    const agv = crane
      ? this.agvSystem.assignVehicle({
          taskId: task.id,
          containerId: container?.id,
        })
      : null;
    // 三者缺一不可
    if (!container || !crane || !agv) {
      // 关键的回滚：箱子已经被锁给本任务了，现在流程走不下去，
      // 必须清掉锁把它还给船。少这一行，那个箱子就永远卸不下来了
      if (container) container.taskId = null;
      this.store.patchTask(task.id, { status: TaskStatus.PAUSED });
      return;
    }

    // 算出车该停在这台岸桥下的哪个位置（待命位，正好在小车行程范围内）
    const stagingPosition = quayCraneSystem.getAGVStagingPosition(crane);
    // 生成到待命位的路线
    const route = this.pathManager.createYardRoute(
      agv.getComponent<TransformComponent>(ComponentTypes.TRANSFORM)?.getWorldPosition() ?? new THREE.Vector3(),
      stagingPosition,
    );
    // 更新任务：卸船流程从第 0 步开始（"AGV staging" 车辆就位）
    this.store.patchTask(task.id, {
      status: TaskStatus.RUNNING,
      currentStepIndex: 0,
      // 箱号在创建时可能是 null（船上箱子是这一刻才分配的），补写进去
      containerId: container.id,
      // craneId（岸桥编号）：后面 _startQuayOperation 靠它找回同一台桥
      craneId:
        crane.getComponent<AssetComponent>(ComponentTypes.ASSET)?.asset.number ?? crane.id,
      agvId: agv.getComponent<AssetComponent>(ComponentTypes.ASSET)?.asset.number ?? agv.id,
      agvEntityId: agv.id,
    });
    // 派车。phase 用 "QUAY_PICKUP"（岸桥待命）——
    // 抵达后不是直接完成，而是转交岸桥系统做九步机械动作
    this._dispatchRoute({
      agv,
      taskId: task.id,
      phase: "QUAY_PICKUP",
      route,
      speed: 24,
    });
  }

  // _handleAGVArrival（内部方法：处理"车辆已抵达"事件）
  // 这是任务系统的中枢——所有流程推进都由这个回调驱动。
  // event（事件负载）含 agv（车辆）、taskId（任务号）、phase（阶段）、position（坐标）
  _handleAGVArrival(event: AGVArrivalEvent): void {
    // 按事件里带的任务号找任务
    if (!event.taskId) return;
    const task = this.store.taskMap.get(event.taskId);
    // 两道防线：任务已被删除，或已不在执行中（被暂停/取消/完成）。
    // 这在异步世界里绝非多余——车在路上跑的几秒内用户完全可能取消任务，
    // 不校验就会把一个已取消的任务往下推
    if (!task || task.status !== TaskStatus.RUNNING) return;

    // ---- 分支 A：到达岸桥待命位 ----
    if (event.phase === "QUAY_PICKUP") {
      // 交给岸桥作业流程接手
      this._startQuayOperation(task, event.agv);
      return;
    }

    // ---- 分支 B：到达充电桩 ----
    if (event.phase === "CHARGING") {
      // 充电任务没有后续动作，直接把车还给车队
      this.agvSystem.releaseVehicle(event.agv);
      this.motionSystem.resumeCruise(event.agv);
      // 标记任务完成
      this._complete(task);
      return;
    }

    // ---- 分支 C：到达取箱点 ----
    if (event.phase === "PICKUP") {
      // 让集装箱系统执行装箱（把箱子从堆场挂到车上）
      const container = this.containerSystem.handleAGVArrived(event, task);
      // 装箱失败就地停住，不推进也不报错。
      // 车还锁在任务上，下一帧运动系统不会动它，等于原地待命
      if (!container) return;

      // 车辆状态改为 TRANSPORTING（载货运输中）
      this.agvSystem.markContainerLoaded(event.agv, container.id);
      // 把仓库里存的纯数据坐标还原成 Vector3（三维向量）。
      // 仓库里刻意存的是 {x,y,z} 普通对象而非 Vector3 ——
      // Pinia 对 Vector3 做响应式代理会破坏 Three.js 内部的属性访问
      // 集装箱最终卸放位置，保留原业务目标。
      const destination = this._vectorFrom(task.to.position);

      // AGV 实际行驶终点，与箱子卸放位置分开。
      let drivingTarget = destination;

      // 只处理当前泊位运输目标。
      // 堆场倒箱、充电等目标不能一律投影到外环。
      if (task.to.area === "BERTH-01") {
        const parking = this.pathManager.getBerthParkingPoint(destination);

        if (!parking) {
          this.motionSystem.holdAGV(event.agv);

          this.store.patchTask(task.id, {
            status: TaskStatus.PAUSED,
            routeError: this.pathManager.lastError,
          });

          return;
        }

        drivingTarget = parking.position;

        this.store.patchTask(task.id, {
          agvParkingPosition: this._positionData(drivingTarget),
          agvParkingLaneId: parking.laneId,
        });

        console.log("[泊位停车位置]", {
          agvParkingPosition: [drivingTarget.x, drivingTarget.y, drivingTarget.z],
          containerDestination: [destination.x, destination.y, destination.z],
          distanceToBerth: parking.distanceToBerth,
          laneId: parking.laneId,
        });
      }

      // 仍然通过合法路网寻路：
      // 堆场道路 → 侧面入口 → 外环车道 → 泊位停车点。
      const route = this.pathManager.createYardRoute(
        event.agv.getComponent<TransformComponent>(ComponentTypes.TRANSFORM)?.getWorldPosition() ?? new THREE.Vector3(),
        drivingTarget,
      );
      console.log("[装箱后规划送箱路线]", {
        taskId: task.id,

        from: (() => { const position = event.agv.getComponent<TransformComponent>(ComponentTypes.TRANSFORM)?.getWorldPosition() ?? new THREE.Vector3(); return [position.x, position.y, position.z]; })(),

        destination: [destination.x, destination.y, destination.z],

        route,

        reason: this.pathManager.lastError,
      });
      // 推进到第 5 步（"运输中"）
      this.store.patchTask(task.id, { currentStepIndex: 5 });
      // 派发第二段行驶指令。载货返程用满速 30，这段是关键路径
      this._dispatchRoute({
        agv: event.agv,
        taskId: task.id,
        phase: "DELIVERY",
        route,
        speed: 30,
      });
      console.log("[送箱指令下发结果]", {
        command: event.agv.getComponent<MotionComponent>(ComponentTypes.MOTION)?.command,

        taskStatus: this.store.taskMap.get(task.id)?.status,

        routeError: this.store.taskMap.get(task.id)?.routeError,
      });
      return;
    }

    // ---- 分支 D：到达卸箱点 ----
    if (event.phase === "DELIVERY") {
      // 同样还原目标坐标
      const destination = this._vectorFrom(task.to.position);
      // 卸箱。注意这里用展开语法 { ...event, position: destination }
      // 把事件里的实际抵达坐标替换成规划的目标坐标——
      // 车实际停的位置总有几十厘米误差，若按实际位置放箱，
      // 箱子会歪在堆位边上；用规划坐标能保证严丝合缝地对齐箱位
      const container = this.containerSystem.handleAGVArrived(
        { ...event, position: destination },
        task,
      );
      // 卸箱失败就原地等待
      if (!container) return;

      // 车归还车队
      this.agvSystem.releaseVehicle(event.agv);
      this.motionSystem.resumeCruise(event.agv);
      // 任务完成
      this._complete(task);
    }
  }
  _dispatchRoute({ agv, taskId, phase, route, speed }: DispatchInput): boolean {
    const pause = (message: string): false => {
      this.motionSystem.holdAGV(agv);

      const road = route?.roadId ? this.pathManager.roadSystem.getRoad(route.roadId) : null;

      if (road?.transient) {
        this.pathManager.roadSystem.removeRoad(road.id);
      }

      this.store.patchTask(taskId, {
        status: TaskStatus.PAUSED,
        routeError: message,
      });

      console.warn(`[${taskId}] ${message}`);

      return false;
    };

    if (!route) {
      return pause(this.pathManager.lastError ?? "未找到合法道路路线");
    }

    const result = this.agvSystem.dispatch({
      agv,
      taskId,
      phase,
      route,
      speed,
    });

    const command = agv.getComponent<MotionComponent>(ComponentTypes.MOTION)?.command;

    if (
      result === false ||
      !command ||
      command.taskId !== taskId ||
      command.phase !== phase
    ) {
      return pause("AGV 未受理行驶指令");
    }

    this.store.patchTask(taskId, {
      routeError: null,
    });

    return true;
  }

  // _startQuayOperation（内部方法：车已就位，启动岸桥的九步机械作业）
  //   task（任务）、agv（已就位的车辆）
  _startQuayOperation(task: TaskRecord, agv: Entity): void {
    const quayCraneSystem = this.quayCraneSystem;
    if (!quayCraneSystem) {
      this.store.patchTask(task.id, { status: TaskStatus.PAUSED });
      return;
    }
    // 按箱号从岸桥系统的船上箱子表里取回那个箱子
    const container = task.containerId ? quayCraneSystem.shipContainers.get(task.containerId) : undefined;
    // 按编号找回那台岸桥。为什么不在任务里直接存实体引用？
    // 因为任务数据要进 Pinia 做响应式，存三维实体会被深度代理，
    // 既拖慢性能又可能破坏 Three.js 的内部状态。存编号、用时反查是标准做法
    const crane = this.equipmentManager.getCranes().find(
      // 比对规则要与写入时完全一致：优先资产编号，退回实体编号
      (entity) =>
        (entity.getComponent<AssetComponent>(ComponentTypes.ASSET)?.asset.number ??
          entity.id) === task.craneId,
    );
    // 箱子或岸桥不见了（极端情况：设备被卸载或流式剔除）
    if (!container || !crane) {
      // 把车还回去，别让它一直锁在这个走不通的任务上
      this.agvSystem.releaseVehicle(agv);
      this.motionSystem.resumeCruise(agv);
      this.store.patchTask(task.id, { status: TaskStatus.PAUSED });
      return;
    }

    // 关键一步：给车上任务锁。车已经到位了，接下来几十秒它必须一动不动
    // 等岸桥把箱子放上来。不锁的话运动系统会把它当自由车放回环线继续绕圈，
    // 箱子就吊到空气上了
    const agvMotion = agv.getComponent<MotionComponent>(ComponentTypes.MOTION);
    if (agvMotion) agvMotion.taskLocked = true;
    // 启动岸桥作业，用两个回调把进度与结果接回来
    const started = quayCraneSystem.start({
      crane,
      agv,
      container,
      taskId: task.id,
      // onStateChange（状态变更回调）：岸桥每推进一个动作就回调一次，
      // 这里只做一件事——把步骤号写进仓库，界面进度条随之走动
      onStateChange: (state, stepIndex) => {
        this.store.patchTask(task.id, {
          currentStepIndex: stepIndex,
          // 同时存一份岸桥状态，界面上可显示"正在下降吊具"这类细节
          quayCraneState: state,
        });
      },
      // onComplete（完成回调）：九步走完、箱子已在车上时触发
      onComplete: (operation) => {
        // 箱子已经装到 AGV 上。
        this.agvSystem.markContainerLoaded(
          operation.agv,
          operation.container.id,
        );

        // 实际位于巡航车道时才恢复巡航，否则原地待命。
        this.motionSystem.resumeCruise(operation.agv);

        // 清除箱子的任务标记。
        operation.container.taskId = null;

        // 完成本次岸桥卸船任务。
        this._complete(task);
      },
    });
    // 岸桥拒绝受理（可能它正忙于别的箱子）
    if (!started) {
      this.agvSystem.releaseVehicle(agv);
      this.motionSystem.resumeCruise(agv);
      this.store.patchTask(task.id, { status: TaskStatus.PAUSED });
      // 这里有个已知的小缺口：上面刚设的 taskLocked 没在这条分支里解开。
      // 不过 releaseVehicle 会把车状态归零，下一轮派活时会重设，
      // 影响仅限于这一帧
      return;
    }

    // 受理成功，推进到第 1 步并写入岸桥的起始状态"小车横移到集装箱上方"
    this.store.patchTask(task.id, {
      currentStepIndex: 1,
      quayCraneState: QuayCraneState.MOVE_TO_CONTAINER,
    });
  }

  // _resolveDestination（内部方法：按任务类型算出目的地）
  //   type（任务类型）、index（任务序号，用于轮换目标设备）
  _resolveDestination(type: TaskTypeValue, index: number): TaskDestination {
    // 堆场倒箱：目的地是某台场桥（RTG，轮胎式龙门吊）
    if (type === TaskType.YARD_TRANSFER) {
      // 用 index + 1 取场桥，让连续创建的任务分散到不同场桥上，
      // 避免所有车都挤到同一台设备下排队
      const target = this.equipmentManager.getRTG(index + 1);
      return {
        // 区域名（显示在界面上）
        area: target.area,
        position: this._positionData(
          // clone（克隆）必须加：不克隆就是直接改设备本身的位置，
          // 一次任务创建就把场桥挪走了
          // 偏移 (0, 0.2, 18)：抬高 0.2 米避免车贴地穿模，
          // Z 轴 +18 米是停在场桥外侧的作业道上，而不是压在设备中心
          target.position.clone().add(new THREE.Vector3(0, 0.2, 18)),
        ),
      };
    }

    // 充电任务：目的地是充电桩
    if (type === TaskType.CHARGING) {
      return {
        area: "CHARGER-01",
        // 这里没 clone。chargerPosition 是只读的固定点，
        // _positionData 只读它的三个分量、不会写回去，所以安全
        position: this._positionData(this.equipmentManager.chargerPosition),
      };
    }

    // 兜底（含集装箱运输）：目的地是泊位
    return {
      area: "BERTH-01",
      position: this._positionData(
        this.equipmentManager.berthPosition.clone().add(
          // 偏移 (0, 0.2, -8)：Z 轴 -8 是往岸边方向退 8 米，
          // 停在岸桥的作业范围内而不是压在泊位标记点上
          new THREE.Vector3(0, 0.2, -8),
        ),
      ),
    };
  }

  // _vectorFrom（内部方法：普通对象 → Vector3 三维向量）
  _vectorFrom(position: ScenePosition): THREE.Vector3 {
    // 手工取三个分量新建，而不是 new Vector3().copy(position)。
    // 因为 copy 要求入参本身就是向量类型，而这里传进来的是从 Pinia
    // 取出的普通对象（甚至可能是响应式 Proxy 代理），手写更稳
    return new THREE.Vector3(position.x, position.y, position.z);
  }

  // _positionData（内部方法：Vector3 → 普通对象）
  _positionData(position: THREE.Vector3): ScenePosition {
    // 与 _vectorFrom 互为逆操作。存进 Pinia 前必须降级成普通对象：
    // 一是 Vector3 被响应式代理后，Three.js 内部的批量属性写入会失效；
    // 二是普通对象能直接序列化，方便存档与调试打印
    return { x: position.x, y: position.y, z: position.z };
  }

  // _complete（内部方法：标记任务完成）
  _complete(task: TaskRecord): void {
    this.store.patchTask(task.id, {
      // 状态置为已完成
      status: TaskStatus.COMPLETED,
      // 步骤号跳到最后一步。用 length - 1 而不是写死数字，
      // 因为不同任务类型的步骤数不同，硬编码会让进度条显示错位
      currentStepIndex: task.steps.length - 1,
    });
  }
}
