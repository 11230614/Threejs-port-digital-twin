// ============================================================================
// QuayCraneSystem.js —— 岸桥系统（Quay Crane System：卸船的九步机械动作状态机）
//
// 【这个文件干什么】
// 岸桥（Quay Crane，也叫岸边集装箱起重机、桥吊）把箱子从船上吊到集卡上。
// 这个过程是一串严格有序的机械动作，本文件用 state machine（状态机）实现：
// 每台桥同一时刻处于一个状态，动作做完自动进入下一状态。
//
// 【九步流程与两个执行机构】
// 岸桥只有两个能动的部件，所有动作都是它们的组合：
//   · trolley（小车）：在大梁上水平横移，决定吊具在船与岸之间的位置
//   · hoist（起升机构）：垂直升降吊具（spreader）
//
//   IDLE（待机）
//    1 MOVE_TO_CONTAINER          小车横移到箱子上方        ← 小车动
//    2 LOWER_SPREADER_TO_CONTAINER 吊具下降到箱顶            ← 起升动
//    3 ATTACH_CONTAINER            锁箱（节点挂到吊具下）    ← 瞬间完成
//    4 LIFT_CONTAINER              提升到待机高度            ← 起升动
//    5 MOVE_TO_AGV                 小车横移到集卡上方        ← 小车动
//    6 LOWER_SPREADER_TO_AGV       吊具下降到车板            ← 起升动
//    7 DETACH_CONTAINER            解锁（节点挂到车上）      ← 瞬间完成
//    8 LIFT_SPREADER               吊具升回待机高度          ← 起升动
//      → 回到 IDLE，回调通知任务系统
//
// 【状态机怎么推进】
// 关键在 update 里的判断 `if (!trolley.isMoving)`：进入某状态时先给执行机构
// 下达一个目标位移，之后每帧只检查"它还在动吗"，停了就进下一状态。
// 这样时长完全由机构自己的速度决定，不需要在这里写任何计时器，
// 改一下小车速度，整个流程的节奏自动跟着变。
//
// 【最巧的一处：用 attach 而不是 add 换父节点】
// 第 3 步锁箱与第 7 步解锁，本质是把集装箱的三维节点在"船 → 吊具 → 集卡"
// 之间搬家。attach（挂接）会自动补偿变换，保证箱子在世界坐标里原地不动；
// 若用 add（添加子节点），箱子会瞬间跳到新父节点的局部原点上。
//
// 【术语翻译】
//   Quay Crane（岸桥、岸边集装箱起重机）  spreader（吊具，锁箱子的那个框架）
//   trolley（小车，在大梁上横移的部件）    hoist（起升机构，负责升降）
//   state machine（状态机）              transition（状态转移）
//   IDLE（待机）        ATTACH / DETACH（锁箱 / 解锁）
//   LIFT（提升）        LOWER（下降）      staging（待命位）
//   cargoSlot（车上的载货槽位，一个空节点，标记箱子该放在车的哪个位置）
//   Box3（三维包围盒）   setFromObject（由物体算出包围盒）
//   attach（挂接，换父节点并保持世界位置不变）
//   transformDirection（把方向向量变换到另一坐标系，只转不平移）
//   dot（点积，用来求某向量在某方向上的投影长度）
//   matrixWorld（世界变换矩阵）
//   ON_SHIP / LIFTED / ON_AGV（箱子状态：在船上 / 已吊起 / 在车上）
//   switch/case（多路分支）             ?.（可选链）      ??（空值合并）
// ============================================================================

// 导入 Three.js：用到 Box3（包围盒）与 Vector3（三维向量）
import * as THREE from "three";
// 导入组件类型常量表
import { ComponentTypes } from "../components/ComponentTypes.ts";
import type { Entity } from "../Entity";
import type { EntityManager } from "../EntityManager";
import type { AGVComponent } from "../components/AGVComponent";
import type { HoistComponent } from "../components/HoistComponent";
import type { QuayCraneComponent } from "../components/QuayCraneComponent";
import type { TaskComponent } from "../components/TaskComponent";
import type { TrolleyComponent } from "../components/TrolleyComponent";
import type { TaskOperation } from "../components/TaskComponent";

interface ShipContainer {
  id: string;
  entity: Entity;
  state: string;
  location?: string;
  taskId?: string | null;
}

interface QuayOperation extends TaskOperation {
  taskId: string;
  crane: Entity;
  agv: Entity;
  container: ShipContainer;
  cargoSlot: THREE.Object3D;
  onStateChange?: ((state: QuayCraneStateValue, step: number) => void) | null;
  onComplete?: ((operation: QuayOperation) => void) | null;
}

type QuayCraneTaskComponent = TaskComponent & { operation: QuayOperation | null };

type QuayCraneStateValue = (typeof QuayCraneState)[keyof typeof QuayCraneState];

interface QuayCraneStartOptions {
  crane: Entity | null | undefined;
  agv: Entity | null | undefined;
  container: ShipContainer | null | undefined;
  taskId: string;
  onStateChange?: QuayOperation["onStateChange"];
  onComplete?: QuayOperation["onComplete"];
}

// QuayCraneState（岸桥状态枚举）：导出给任务系统写入界面。
// Object.freeze（冻结）做成只读，防止运行时被改坏
export const QuayCraneState = Object.freeze({
  // 待机：无活可干，可被派单
  IDLE: "IDLE",
  // 小车横移到集装箱上方
  MOVE_TO_CONTAINER: "MOVE_TO_CONTAINER",
  // 吊具下降到箱顶
  LOWER_SPREADER_TO_CONTAINER: "LOWER_SPREADER_TO_CONTAINER",
  // 锁箱
  ATTACH_CONTAINER: "ATTACH_CONTAINER",
  // 提升集装箱
  LIFT_CONTAINER: "LIFT_CONTAINER",
  // 小车横移到集卡上方
  MOVE_TO_AGV: "MOVE_TO_AGV",
  // 吊具下降到车板高度
  LOWER_SPREADER_TO_AGV: "LOWER_SPREADER_TO_AGV",
  // 解锁，箱子落到车上
  DETACH_CONTAINER: "DETACH_CONTAINER",
  // 吊具升回待机高度
  LIFT_SPREADER: "LIFT_SPREADER",
});

// STEP_BY_STATE（状态 → 界面步骤号的映射表）：
// 状态机内部用状态名，界面进度条用数字下标，这张表是两者之间的翻译。
// [QuayCraneState.XXX]: 这种写法叫 computed property name（计算属性名），
// 用变量的值当键名。好处是改枚举字符串时这张表自动跟着变，不会脱节。
// 数字要与 TaskSystem 里 QUAY_DISCHARGE_STEPS 的下标严格对应
const STEP_BY_STATE: Partial<Record<QuayCraneStateValue, number>> = Object.freeze({
  [QuayCraneState.MOVE_TO_CONTAINER]: 1,
  [QuayCraneState.LOWER_SPREADER_TO_CONTAINER]: 2,
  [QuayCraneState.ATTACH_CONTAINER]: 3,
  [QuayCraneState.LIFT_CONTAINER]: 4,
  [QuayCraneState.MOVE_TO_AGV]: 5,
  [QuayCraneState.LOWER_SPREADER_TO_AGV]: 6,
  [QuayCraneState.DETACH_CONTAINER]: 7,
  [QuayCraneState.LIFT_SPREADER]: 8,
});

// export（导出）class（类）：声明并公开"岸桥系统"
export class QuayCraneSystem {
  // constructor（构造函数）：只需要实体管理器
  readonly entityManager: EntityManager;
  readonly shipContainers = new Map<string, ShipContainer>();
  private readonly _box: THREE.Box3;
  private readonly _position: THREE.Vector3;
  private readonly _target: THREE.Vector3;
  private readonly _axis: THREE.Vector3;

  constructor({ entityManager }: { entityManager: EntityManager }) {
    // 保存实体管理器，用于查询所有岸桥实体
    this.entityManager = entityManager;
    // shipContainers（船上集装箱表）：箱号 -> 箱子数据。
    // 船上的箱子不走堆场那套管理，单独存一份，
    // 因为它们的生命周期不同——卸完就离开这张表
    this.shipContainers = new Map();
    // 以下四个是复用的临时对象，避免每帧新建造成垃圾回收压力
    // _box（临时包围盒）：反复用于算箱子与吊具的上下边界
    this._box = new THREE.Box3();
    // _position（临时位置向量）
    this._position = new THREE.Vector3();
    // _target（临时目标向量）
    this._target = new THREE.Vector3();
    // _axis（临时轴向量）：存小车轨道方向
    this._axis = new THREE.Vector3();
  }

  // registerShipContainer（登记船上集装箱）：场景搭建时把船上的箱子录进来
  registerShipContainer(container: ShipContainer): void {
    // 以箱号为键存入
    this.shipContainers.set(container.id, container);
  }

  // acquireShipContainer（取一个待卸集装箱并锁给指定任务）
  acquireShipContainer(taskId: string): ShipContainer | null {
    // [...map.values()] 把 Map 的值展开成数组才能用 find（查找）。
    // 条件是两个：没被别的任务占用（!taskId），且还在船上（state 为 ON_SHIP）
    const container = [...this.shipContainers.values()].find(
      (candidate) => !candidate.taskId && candidate.state === "ON_SHIP",
    );
    // 船上没有可卸的箱子了
    if (!container) return null;
    // 立刻打上任务标记，相当于加锁。
    // 这一步必须在返回之前做——否则下一个任务紧接着查询会挑中同一个箱子
    container.taskId = taskId;
    // 返回箱子
    return container;
  }

  // getAvailableCrane（挑一台最合适的空闲岸桥）：形参是要卸的那个箱子
  getAvailableCrane(container: ShipContainer): Entity | null {
    // 箱子的世界坐标
    const containerPosition = container.entity.getWorldPosition();
    // 三步链式处理：查全部 → 筛空闲 → 按距离排序取最近
    return this._getCranes()
      // filter（过滤）：只要状态为 IDLE（待机）的
      .filter((crane) => crane.getComponent<TaskComponent>(ComponentTypes.TASK)?.state === QuayCraneState.IDLE)
      // sort（排序）：按到箱子的距离升序
      .sort((left, right) => {
        // 只比 X 轴距离，忽略 Y 与 Z。这不是简化——
        // 岸桥沿岸线（X 轴）排布，只能在轨道上前后走，
        // 它够不够得到某个箱子完全取决于 X 方向的远近。
        // Math.abs（绝对值）是因为箱子可能在桥的任意一侧
        const leftPosition = left.getWorldPosition();
        const rightPosition = right.getWorldPosition();
        const leftDistance = Math.abs(leftPosition!.x - containerPosition!.x);
        const rightDistance = Math.abs(rightPosition!.x - containerPosition!.x);
        // 返回负数表示 left 排前面，这是 sort 比较函数的约定
        return leftDistance - rightDistance;
      })
      // [0] 取最近的那台；?? null 处理"筛完一台都不剩"的情况——
      // 空数组的 [0] 是 undefined，统一成 null 让调用方只判一种空值
      [0] ?? null;
  }

  // getAGVStagingPosition（算出集卡该停在这台桥下的哪个位置）
  getAGVStagingPosition(crane: Entity): THREE.Vector3 {
    // 取吊具节点
    const spreader = crane.getComponent<QuayCraneComponent>(ComponentTypes.QUAY_CRANE)!.spreader;
    // 读吊具当前的世界坐标，写进复用向量
    spreader.getWorldPosition(this._position);
    // 用吊具的 X、Z 加固定高度 0.2 构造停车点。
    // 为什么以吊具为基准而不是桥体中心？因为小车的行程有限，
    // 车必须停在吊具能覆盖到的范围内，对齐吊具当前位置最稳妥。
    // Y 固定 0.2 是车轮离地的贴地高度。
    // 这里必须 new（新建）而不是返回 this._position ——
    // 返回值会被调用方长期持有，共享复用向量会让停车点随下一次调用而改变
    return new THREE.Vector3(this._position.x, 0.2, this._position.z);
  }

  // start（启动一次卸箱作业）：返回是否受理成功
  //   crane（岸桥）、agv（集卡）、container（箱子）、taskId（任务号）
  //   onStateChange（状态变更回调）、onComplete（完成回调）
  start({ crane, agv, container, taskId, onStateChange, onComplete }: QuayCraneStartOptions): boolean {
    // ?.（可选链）应对传空的情况
    const task = crane?.getComponent<QuayCraneTaskComponent>(ComponentTypes.TASK);
    const agvComponent = agv?.getComponent<AGVComponent>(ComponentTypes.AGV);
    // 四道前置校验合并成一个条件，任何一条不满足就拒绝受理：
    //   · 没有任务组件（不是一台合规的岸桥）
    //   · 桥不在待机状态（正忙着卸别的箱子）
    //   · 箱子没有对应的三维实体（吊不了看不见的东西）
    //   · 车上没有 cargoSlot（载货槽位），箱子没地方放
    if (!crane || !agv || !task || task.state !== QuayCraneState.IDLE || !container?.entity || !agvComponent?.cargoSlot) {
      return false;
    }

    // 把本次作业的全部上下文存进任务组件。
    // 存下来的原因：状态机后续每一帧都要用到这些引用，
    // 而 update 是由帧循环调用的、拿不到这里的参数
    task.start({
      taskId,
      crane,
      agv,
      container,
      // 提前把槽位节点摘出来存好，省得后面反复 getComponent
      cargoSlot: agvComponent.cargoSlot,
      onStateChange,
      onComplete,
    });
    // 进入第一个动作状态，机械动作就此开始
    this._enterState(crane, QuayCraneState.MOVE_TO_CONTAINER);
    // 受理成功
    return true;
  }

  // update（每帧更新）：推进所有岸桥的状态机
  update(dt: number): void {
    // 遍历每台桥单独推进。桥与桥之间完全独立，可以并行作业
    this._getCranes().forEach((crane) => this._updateCrane(crane, dt));
  }

  // _getCranes（内部方法：查询全部岸桥实体）
  _getCranes(): Entity[] {
    // 五个组件齐备才算一台可作业的岸桥：
    // QUAY_CRANE（有吊具等部件引用）、TROLLEY（小车）、HOIST（起升机构）、
    // TASK（能接单）、TRANSFORM（有形体）。
    // 缺任何一个都会让下面的状态机读到 undefined，所以在查询阶段就挡掉
    return this.entityManager.getEntitiesWith(
      ComponentTypes.QUAY_CRANE,
      ComponentTypes.TROLLEY,
      ComponentTypes.HOIST,
      ComponentTypes.TASK,
      ComponentTypes.TRANSFORM,
    );
  }

  // _updateCrane（内部方法：推进一台岸桥）
  _updateCrane(crane: Entity, dt: number): void {
    // 取两个执行机构与任务组件
    const trolley = crane.getComponent<TrolleyComponent>(ComponentTypes.TROLLEY)!;
    const hoist = crane.getComponent<HoistComponent>(ComponentTypes.HOIST)!;
    const task = crane.getComponent<QuayCraneTaskComponent>(ComponentTypes.TASK)!;
    // 先让机构自己走一帧。这两行必须在状态判断之前——
    // 顺序反了就会用上一帧的运动状态做判断，导致每次都晚一帧切换
    trolley.update(dt);
    hoist.update(dt);
    // 待机中的桥无事可做，提前返回省掉后面的 switch
    if (task.state === QuayCraneState.IDLE) return;

    // 取本次作业的上下文（含箱子、车、回调等）
    const operation = task.operation!;
    // switch（多路分支）：按当前状态决定这一帧要检查什么。
    // 整个状态机的推进逻辑就藏在这里，模式高度统一——
    // "动作类"状态只等机构停下，"瞬间类"状态立刻执行并跳走
    switch (task.state) {
      // 小车横移中：停了就进入下降吊具
      case QuayCraneState.MOVE_TO_CONTAINER:
        if (!trolley.isMoving) this._enterState(crane, QuayCraneState.LOWER_SPREADER_TO_CONTAINER);
        break;
      // 吊具下降中：停了就锁箱
      case QuayCraneState.LOWER_SPREADER_TO_CONTAINER:
        if (!hoist.isMoving) this._enterState(crane, QuayCraneState.ATTACH_CONTAINER);
        break;
      // 锁箱是瞬间动作：执行完立刻进下一状态，不等任何机构。
      // 所以这个状态实际只存在一帧，界面上是一闪而过
      case QuayCraneState.ATTACH_CONTAINER:
        this._attachContainer(crane, operation);
        this._enterState(crane, QuayCraneState.LIFT_CONTAINER);
        break;
      // 提升中：停了就横移到车上方
      case QuayCraneState.LIFT_CONTAINER:
        if (!hoist.isMoving) this._enterState(crane, QuayCraneState.MOVE_TO_AGV);
        break;
      // 横移到车上方：停了就下降
      case QuayCraneState.MOVE_TO_AGV:
        if (!trolley.isMoving) this._enterState(crane, QuayCraneState.LOWER_SPREADER_TO_AGV);
        break;
      // 下降到车板：停了就解锁
      case QuayCraneState.LOWER_SPREADER_TO_AGV:
        if (!hoist.isMoving) this._enterState(crane, QuayCraneState.DETACH_CONTAINER);
        break;
      // 解锁也是瞬间动作
      case QuayCraneState.DETACH_CONTAINER:
        this._detachContainer(crane, operation);
        this._enterState(crane, QuayCraneState.LIFT_SPREADER);
        break;
      // 吊具升回待机高度：停了就整体收尾
      case QuayCraneState.LIFT_SPREADER:
        if (!hoist.isMoving) this._complete(crane);
        break;
      // default（兜底分支）：出现未知状态时什么都不做。
      // 空着也要写，一是满足 lint 规则，二是明示"这不是漏写"
      default:
        break;
    }
  }

  // _enterState（内部方法：进入某个状态，并下达对应的机构指令）
  // 这是状态机的另一半：update 负责"何时切换"，本方法负责"切换时干什么"。
  // 把两件事分开写，是因为切换动作只在状态跳变的那一帧执行一次，
  // 混在 update 里就得额外加"是不是刚进入"的判断标志
  _enterState(crane: Entity, state: QuayCraneStateValue): void {
    // 取任务组件与作业上下文
    const task = crane.getComponent<QuayCraneTaskComponent>(ComponentTypes.TASK)!;
    const operation = task.operation!;
    // 取两个执行机构
    const trolley = crane.getComponent<TrolleyComponent>(ComponentTypes.TROLLEY)!;
    const hoist = crane.getComponent<HoistComponent>(ComponentTypes.HOIST)!;
    // 取岸桥组件（拿吊具节点用）
    const quayCrane = crane.getComponent<QuayCraneComponent>(ComponentTypes.QUAY_CRANE)!;
    // 正式改写状态
    task.transition(state);
    // 通知外界（任务系统据此更新界面进度）。
    // ?.（可选链）允许调用方不传回调；?? 0 兜底，
    // 防止 STEP_BY_STATE 里没登记的状态传出 undefined 让进度条错乱
    // 通知回调仍先于机械指令执行，以保持既有正常调用顺序；若外部回调失败，
    // 先记下异常并继续下达本状态的指令，避免下一帧把“尚未开始的动作”误判为完成。
    let notificationFailed = false;
    let notificationError: unknown;
    try {
      operation.onStateChange?.(state, STEP_BY_STATE[state] ?? 0);
    } catch (error) {
      notificationFailed = true;
      notificationError = error;
    }
    const rethrowNotificationError = () => {
      if (notificationFailed) throw notificationError;
    };

    // ---- 第 1 步：小车横移到集装箱上方 ----
    if (state === QuayCraneState.MOVE_TO_CONTAINER) {
      // 目标是箱子当前的世界坐标
      const position = operation.container.entity.getWorldPosition();
      this._moveTrolleyTo(trolley, quayCrane.spreader, position!);
      rethrowNotificationError();
      return;
    }

    // ---- 第 2 步：吊具下降到箱顶 ----
    if (state === QuayCraneState.LOWER_SPREADER_TO_CONTAINER) {
      // 算出箱子的包围盒，取它的顶面高度
      const containerBox = this._box.setFromObject(operation.container.entity.wrapper!);
      // 目标高度是箱顶再高 0.15 米——留一点间隙，
      // 让吊具刚好悬在箱子上方而不是压进去穿模
      this._moveSpreaderBottomTo(hoist, quayCrane.spreader, containerBox.max.y + 0.15);
      rethrowNotificationError();
      return;
    }

    // ---- 第 4、8 步：提升（带箱或空吊具都一样回原位）----
    if (state === QuayCraneState.LIFT_CONTAINER || state === QuayCraneState.LIFT_SPREADER) {
      // moveHome（回到起始高度）。两个状态共用一句，因为动作完全相同，
      // 区别只在吊具下面挂着东西没有——那是节点层级的事，与升降指令无关
      hoist.moveHome();
      rethrowNotificationError();
      return;
    }

    // ---- 第 5 步：小车横移到集卡上方 ----
    if (state === QuayCraneState.MOVE_TO_AGV) {
      // 目标是车上载货槽位的世界坐标。传 this._target 是让 Three.js
      // 把结果写进复用向量而不是新建一个
      this._moveTrolleyTo(trolley, quayCrane.spreader, operation.cargoSlot.getWorldPosition(this._target));
      rethrowNotificationError();
      return;
    }

    // ---- 第 6 步：吊具下降到车板高度 ----
    if (state === QuayCraneState.LOWER_SPREADER_TO_AGV) {
      // 箱子的包围盒（此刻箱子已挂在吊具下，会跟着一起算进来）
      const containerBox = this._box.setFromObject(operation.container.entity.wrapper!);
      // 槽位的世界坐标
      const slotPosition = operation.cargoSlot.getWorldPosition(this._target);
      // 位移量 = 槽位高度 - 箱底高度。
      // 这里的巧思是拿"箱底"而不是"吊具底"当基准：
      // 目标是让箱子的底面正好落在槽位平面上，箱子多高、吊具多厚都不用管，
      // 这个差值天然把两者的尺寸都算进去了
      hoist.moveBy(slotPosition.y - containerBox.min.y);
    }
    rethrowNotificationError();
  }

  // _moveTrolleyTo（内部方法：让小车横移到某个世界坐标对应的位置）
  //   trolley（小车）、spreader（吊具）、targetWorld（目标世界坐标）
  _moveTrolleyTo(trolley: TrolleyComponent, spreader: THREE.Object3D, targetWorld: THREE.Vector3): void {
    // 吊具当前的世界坐标（小车带着吊具走，所以用吊具位置代表小车位置）
    const current = spreader.getWorldPosition(this._position);
    // 小车的局部运动轴（模型里定义的那根轨道方向，比如 (1,0,0)）
    const localAxis = trolley.axis.clone();
    // transformDirection（变换方向）：把局部轴转到世界坐标系。
    // 用它而不是 applyMatrix4 的关键区别是它只旋转、不平移，
    // 而且结果自动归一化——方向向量本来就不该带位置信息
    this._axis.copy(localAxis).transformDirection(trolley.node.parent!.matrixWorld);
    // 核心计算：先求出"目标 - 当前"这个三维差值向量，
    // 再用 dot（点积）把它投影到轨道方向上。
    // 为什么要投影？小车只能沿一根轨道走，目标点在垂直方向上偏多少都无所谓，
    // 它只关心"沿着我的轨道要走多少米"。点积正好给出这个投影长度
    const distance = this._target.copy(targetWorld).sub(current).dot(this._axis);
    // 下达相对位移指令，小车自己按速度走过去
    trolley.moveBy(distance);
  }

  // _moveSpreaderBottomTo（内部方法：让吊具的底面落到指定高度）
  _moveSpreaderBottomTo(hoist: HoistComponent, spreader: THREE.Object3D, targetY: number): void {
    // 算出吊具的包围盒
    const spreaderBox = this._box.setFromObject(spreader);
    // 位移量 = 目标高度 - 当前底面高度。
    // 以底面（min.y）为基准而不是节点原点，是因为模型的原点位置全凭建模时的
    // 随意摆放，可能在顶部也可能在中心；底面才是物理上真正要对齐的那个面
    hoist.moveBy(targetY - spreaderBox.min.y);
  }

  // _attachContainer（内部方法：锁箱——把集装箱挂到吊具下）
  _attachContainer(crane: Entity, operation: QuayOperation): void {
    // 取吊具节点
    const spreader = crane.getComponent<QuayCraneComponent>(ComponentTypes.QUAY_CRANE)!.spreader;
    // attach（挂接）而非 add（添加子节点）：这是整个文件最关键的一行。
    // attach 会自动计算并补偿变换矩阵，让箱子换了父节点后在世界坐标里
    // 仍停在原地；用 add 的话箱子会瞬间"吸"到吊具的局部原点上，
    // 画面上就是箱子凭空跳一下。挂上之后箱子随吊具一起升降，不需要额外同步
    spreader.attach(operation.container.entity.wrapper!);
    // 更新箱子的业务状态：已吊起
    operation.container.state = "LIFTED";
    // 记下它此刻归属于哪台设备，界面查询箱子位置时用
    operation.container.location = crane.id;
    // 父节点变了，包围盒必须重算，否则拾取与剔除会用错位置
    operation.container.entity.updateBBox();
  }

  // _detachContainer（内部方法：解锁——把集装箱交给集卡）
  _detachContainer(crane: Entity, operation: QuayOperation): void {
    // 同样用 attach 把箱子的父节点从吊具换成车上的槽位。
    // 此时箱底已经贴在槽位平面上（第 6 步算好的），
    // attach 保持世界位置不变，所以箱子看上去就是稳稳落在了车板上
    operation.cargoSlot.attach(operation.container.entity.wrapper!);
    // 状态改为在车上
    operation.container.state = "ON_AGV";
    // 归属改为这辆车
    operation.container.location = operation.agv.id;
    // 重算包围盒
    operation.container.entity.updateBBox();
  }

  // _complete（内部方法：一次作业收尾）
  _complete(crane: Entity): void {
    // 取任务组件与上下文
    const task = crane.getComponent<QuayCraneTaskComponent>(ComponentTypes.TASK)!;
    const operation = task.operation!;
    // 先回调通知外界，再清理。顺序很重要——
    // clear 会把 operation 里的引用全部清空，
    // 反过来写的话回调拿到的就是一个空壳
    try {
      operation.onComplete?.(operation);
    } finally {
      // 回调仍在清理前执行且异常继续向上抛；但即使回调失败，也不能让
      // 已完成的作业在下一帧重复通知或永久占用岸桥。
      task.clear();
      // 桥身的包围盒也要更新：小车挪了位、吊具升降过，整体轮廓变了
      crane.updateBBox();
    }
  }
}
