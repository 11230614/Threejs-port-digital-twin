// ============================================================================
// PortRuntime.ts —— 码头运行时（Port Runtime：把所有系统装配成一个可运行的整体）
//
// 【这个文件干什么】
// 前面几十个文件各自实现一件事，但谁都不知道彼此存在。本文件是 composition
// root（组装根）：唯一一处知道"整个系统由哪些部件构成、按什么顺序创建、
// 谁依赖谁"的地方。Vue 组件只需 new PortRuntime(...).start()，
// 拿到一个已经跑起来的码头。
//
// 【为什么要有这么一个文件】
// 各系统之间的依赖关系是一张网：任务系统要车辆系统，车辆系统要运动系统，
// 运动系统要道路系统，道路系统由地面系统生成……若让它们各自 import 并 new
// 自己的依赖，就会出现同一个系统被创建两份、循环依赖、以及无法替换实现
// （测试时想塞个假的都做不到）。把 new 全部集中到这里，各系统只通过构造函数
// 接收现成的依赖——这就是 dependency injection（依赖注入）。
//
// 【启动顺序不是随意的】
//   1) 基础设施：场景、实体管理器、资产管理器、帧观察器
//   2) 模型预加载（异步，必须 await，后面所有 3D 内容都依赖它）
//   3) 地面与水面 → 副产物：道路系统、堆场系统（很多系统要用）
//   4) 交互与显示层：选中、高亮、报警、运动、渲染、标签、性能
//   5) 六个分组方法：核心帧任务 → 箱子渲染 → 拾取 → 静态世界
//                    → 任务系统 → 空间优化 → 遥测 → 界面
//   6) 启动渲染循环
// 顺序错了会拿到 undefined，所以每一步都注释了它为什么必须在这个位置。
//
// 【三个贯穿全文的模式】
//   · frame task（帧任务）：所有需要每帧更新的系统都注册到 FrameObserver，
//     带 interval（间隔节流）与 priority（优先级），而不是自己开
//     requestAnimationFrame。集中调度才能控总开销、统一错误隔离。
//   · unregister 闭包：每个注册动作都返回一个"退订函数"，存成 this.unregisterXxx，
//     destroy 时逐个调用。这是防内存泄漏的关键。
//   · metric provider（指标提供者）：各系统把自己的统计数据以回调形式登记给
//     性能系统，由后者统一采样。这样性能面板不需要认识任何具体系统。
//
// 【术语翻译】
//   Runtime（运行时）              composition root（组装根，集中创建对象的地方）
//   dependency injection（依赖注入，依赖由外部传入而非自己创建）
//   frame task（帧任务）           interval（执行间隔，毫秒）
//   priority（优先级，数字越小越先执行）
//   manifest（资源清单）           preload（预加载）
//   chunk（区块，空间分块的一格）   LOD（Level of Detail，细节层级）
//   frustum（视锥体，相机能看见的那个金字塔形空间）
//   frustum culling（视锥剔除，画面外的东西不画）
//   adapter（适配器，把不同类型物体的显隐操作统一成同一套接口）
//   metric（指标）                 snapshot（快照）
//   sweep / gc（清扫 / 垃圾回收）
//   dispose（释放显存与资源）      destroy（销毁）
//   Promise.all（等一批异步操作全部完成）
//   try/catch（异常捕获）          bind（绑定 this）
//   Box3（三维包围盒）             Matrix4（四维矩阵，三维变换用）
//   ?.（可选链）  ??（空值合并）    Set / Map（集合 / 映射表）
// ============================================================================

// 导入 Three.js：本文件用到 Frustum（视锥）、Matrix4（矩阵）、Box3、Vector3
import * as THREE from "three";
// 导入设备建造函数：创建车队与岸桥
import { createAGVs, createQuayCranes } from "../builders/PortEquipmentBuilder.ts";
// 导入场景建造函数：作业模型、船上作业箱、静态资产
import {
  createPortOperationModels,
  createShipOperationContainer,
  createStaticAssets,
} from "../builders/PortSceneBuilder.ts";
// 导入场景配置：区块、集装箱资产编号、LOD、模型清单、渲染资源配置
import {
  PORT_CHUNK_CONFIG,
  PORT_CONTAINER_ASSET_IDS,
  PORT_LOD_CONFIG,
  PORT_MODEL_ASSETS,
  PORT_RENDER_RESOURCE_CONFIG,
} from "../config/PortSceneConfig.ts";
// 资产管理器（既管业务资产台账，也复用为模型资源池）
import { AssetManager } from "../assets/AssetManager.ts";
// 组件类型常量表
import { ComponentTypes } from "../ecs/components/ComponentTypes.ts";
// 实体管理器
import { EntityManager } from "../ecs/EntityManager.ts";
// 设备管理器（按类型/编号查设备与关键位置）
import { EquipmentManager } from "../managers/EquipmentManager.ts";
// 帧观察器（统一的每帧任务调度中心）
import { FrameObserver } from "../core/FrameObserver.ts";
// 路径管理器（生成行驶路线）
import { PathManager } from "../world/PathManager.ts";
// 主场景（相机、渲染器、天空、灯光）
import { MainScene } from "../scene/MainScene.ts";

// ---- ECS 业务系统（管数据与逻辑，不碰渲染细节）----
// 报警系统
import { AlarmSystem } from "../ecs/systems/AlarmSystem.ts";
// 车辆系统
import { AGVSystem } from "../ecs/systems/AGVSystem.ts";
// 集装箱系统
import { ContainerSystem } from "../ecs/systems/ContainerSystem.ts";
// 运动系统
import { MotionSystem } from "../ecs/systems/MotionSystem.ts";
// 拾取系统
import { PickSystem } from "../ecs/systems/PickSystem.ts";
// 岸桥系统
import { QuayCraneSystem } from "../ecs/systems/QuayCraneSystem.ts";
// 选中系统
import { SelectionSystem } from "../ecs/systems/SelectionSystem.ts";
// 任务系统
import { TaskSystem } from "../ecs/systems/TaskSystem.ts";
// 遥测系统
import { TelemetrySystem } from "../ecs/systems/TelemetrySystem.ts";
import { useTaskStore } from "../stores/TaskStore.ts";
import { TaskExecutionBridge } from "../tasks/TaskExecutionBridge.ts";
import { synchronizeContainerSnapshot } from "../api/containers.ts";
import { useAlarmStore } from "../stores/AlarmStore.ts";
import type { TelemetryMessage } from "../ecs/systems/TelemetrySystem";

// ---- 渲染与表现层系统（管画面效果）----
// 报警可视化（出事的设备闪红光）
import { AlarmVisualSystem } from "../rendering/AlarmVisualSystem.ts";
// 集装箱批量渲染管理器（实例化渲染上万个箱子）
import { ContainerRenderManager } from "../rendering/ContainerRenderManager.ts";
// 选中高亮
import { HighlightSystem } from "../rendering/HighlightSystem.ts";
// 三维标签
import { LabelSystem } from "../rendering/LabelSystem.ts";
// 性能监测
import { PerformanceSystem } from "../rendering/PerformanceSystem.ts";
import { QualityController } from "../rendering/QualityController.ts";
import { AdaptiveQualitySystem } from "../rendering/AdaptiveQualitySystem.ts";
// 渲染循环与相机控制
import { RenderSystem } from "../rendering/RenderSystem.ts";
// 叠加的原生界面层
import { UISystem } from "../rendering/UISystem.ts";

// ---- 世界与空间优化系统 ----
// 地面系统（地面、水面、道路、堆场都由它生成）
import { GroundSystem } from "../world/GroundSystem.ts";
// 区块系统（空间分块，按距离加载卸载）
import { ChunkSystem } from "../systems/chunk/ChunkSystem.ts";
// 细节层级系统（远处物体降级为低模）
import { LODSystem } from "../systems/lod/LODSystem.ts";
// 空间渲染系统。注意用 as 改名为 SpatialRenderSystem ——
// 项目里有两个 RenderSystem，一个管渲染循环、一个管空间显隐，
// 不改名会直接命名冲突。这也提示这两个类的命名本身值得优化
import { RenderSystem as SpatialRenderSystem } from "../systems/render/RenderSystem.ts";
// 五个渲染适配器：把不同类型物体的显隐/降级操作统一成同一套接口
import { AGVRenderAdapter } from "../systems/render/adapters/AGVRenderAdapter.ts";
import { ContainerRenderAdapter } from "../systems/render/adapters/ContainerRenderAdapter.ts";
import { CraneRenderAdapter } from "../systems/render/adapters/CraneRenderAdapter.ts";
import { RoadRenderAdapter } from "../systems/render/adapters/RoadRenderAdapter.ts";
import { ShipRenderAdapter } from "../systems/render/adapters/ShipRenderAdapter.ts";
// 渲染资源系统（几何体与材质的共享池）
import { RenderResourceSystem } from "../systems/render/RenderResourceSystem.ts";

import type { PerformanceSnapshot } from "../stores/types";

/** 仍处于 JavaScript 迁移边界的运行时对象。具体模块迁移后可逐项收窄。 */
type LegacyRuntimeValue = any;
type Unregister = () => boolean;
type FrameUpdate = (deltaTime: number, elapsedTime: number) => void;
interface UpdateTaskOptions { interval?: number; priority?: number; update?: FrameUpdate | null }
interface SpatialOwnerOptions {
  id: string;
  object: THREE.Object3D;
  renderType?: string | null;
  data?: LegacyRuntimeValue;
  dynamic?: boolean;
}

export interface PortRuntimeOptions {
  container: HTMLElement;
  onPerformanceSnapshot?: (snapshot: PerformanceSnapshot) => void;
  qualityPixelRatio?: number;
}

// export（导出）class（类）：声明并公开"码头运行时"
export class PortRuntime {
  readonly container: HTMLElement;
  readonly qualityPixelRatio: number;
  readonly onPerformanceSnapshot: (snapshot: PerformanceSnapshot) => void;
  started = false;
  destroyed = false;

  // 尚未迁移的 JS 系统先通过显式边界接入，避免把业务对象误认成 Three.js 实体。
  mainScene: LegacyRuntimeValue = null;
  entityManager: LegacyRuntimeValue = null;
  assetManager: LegacyRuntimeValue = null;
  modelAssetManager: LegacyRuntimeValue = null;
  frameObserver: LegacyRuntimeValue = null;
  groundSystem: LegacyRuntimeValue = null;
  groundResult: LegacyRuntimeValue = null;
  sceneOperation: LegacyRuntimeValue = null;
  selectionSystem: LegacyRuntimeValue = null;
  highlightSystem: LegacyRuntimeValue = null;
  alarmSystem: LegacyRuntimeValue = null;
  alarmVisualSystem: LegacyRuntimeValue = null;
  motionSystem: LegacyRuntimeValue = null;
  renderSystem: LegacyRuntimeValue = null;
  labelSystem: LegacyRuntimeValue = null;
  performanceSystem: LegacyRuntimeValue = null;
  taskSystem: LegacyRuntimeValue = null;
  taskBridge: LegacyRuntimeValue = null;
  containerRenderManager: LegacyRuntimeValue = null;
  pickSystem: LegacyRuntimeValue = null;
  quayCraneSystem: LegacyRuntimeValue = null;
  containerSystem: LegacyRuntimeValue = null;
  agvSystem: LegacyRuntimeValue = null;
  telemetrySystem: LegacyRuntimeValue = null;
  chunkSystem: LegacyRuntimeValue = null;
  lodSystem: LegacyRuntimeValue = null;
  spatialRenderSystem: LegacyRuntimeValue = null;
  spatialFrustum: LegacyRuntimeValue = null;
  spatialProjectionMatrix: LegacyRuntimeValue = null;
  renderResourceSystem: LegacyRuntimeValue = null;
  qualityController: LegacyRuntimeValue = null;
  adaptiveQualitySystem: LegacyRuntimeValue = null;
  spatialEntityRegistrations = new Map<string, Unregister>();
  uiSystem: LegacyRuntimeValue = null;
  agvRenderAdapter: LegacyRuntimeValue = null;
  containerRenderAdapter: LegacyRuntimeValue = null;
  craneRenderAdapter: LegacyRuntimeValue = null;
  roadRenderAdapter: LegacyRuntimeValue = null;
  shipRenderAdapter: LegacyRuntimeValue = null;
  unregisterPerformanceListener: Unregister = () => false;
  unregisterContainerMetrics: Unregister = () => false;
  unregisterChunkMetrics: Unregister = () => false;
  unregisterLodMetrics: Unregister = () => false;
  unregisterSpatialRenderMetrics: Unregister = () => false;
  unregisterRenderResourceMetrics: Unregister = () => false;
  unregisterModelAssetMetrics: Unregister = () => false;
  unregisterQualityMetrics: Unregister = () => false;
  private devCameraMoveHandler: ((event: Event) => void) | null = null;
  private devDisposeHandler: (() => void) | null = null;
  private devAlarmHandler: ((event: Event) => void) | null = null;
  private devAlarmSnapshotHandler: (() => void) | null = null;
  private devContainerSnapshotHandler: ((event: Event) => void) | null = null;
  private spatialDiagnosticFrame = 0;

  // constructor（构造函数）：刻意做得极轻——只存参数、不建任何东西。
  // 真正的创建全在 start 里，因为模型加载是异步的，
  // 而构造函数不能是 async（异步）。这种"构造轻、启动重"的拆分
  // 也让调用方能先拿到实例、再决定何时启动
  constructor({
    // container（容器）：画布要挂进哪个 DOM 元素
    container,
    // onPerformanceSnapshot（性能快照回调）：默认打印到控制台。
    // 给个默认实现而不是留空，是为了单独调试时不必传参也能看到数据
    onPerformanceSnapshot = (snapshot) => console.log("[PerformanceSnapshot]", snapshot),
    qualityPixelRatio = 1,
  }: Partial<PortRuntimeOptions> = {}) {
    // fail fast（快速失败）：没有容器就当场抛错。
    // 若放任它走下去，错误会推迟到 MainScene 内部才爆出来，
    // 到那时报错信息已与真正的原因（调用方忘了传容器）相距很远
    if (!container) throw new Error("PortRuntime requires a scene container.");

    // 保存容器
    this.container = container;
    this.qualityPixelRatio = qualityPixelRatio;
    // 保存性能回调
    this.onPerformanceSnapshot = onPerformanceSnapshot;
    // started（已启动标志）：防止重复启动
    this.started = false;
    // destroyed（已销毁标志）：销毁后不允许再启动
    this.destroyed = false;
  }

  // start（启动）：async（异步）方法，因为要 await 模型加载。
  // 返回 this 是为了支持 `const runtime = await new PortRuntime(...).start()`
  // 这种一行写法
  async start() {
    // idempotent（幂等）保护：已启动就直接返回，重复调用无副作用
    if (this.started) return this;
    // 销毁过的实例不允许复活。三维资源已经被 dispose（释放显存）了，
    // 强行重启会画出一堆空白物体，报错还极难定位，不如直接拒绝
    if (this.destroyed) throw new Error("A destroyed PortRuntime cannot be restarted.");

    // 整个启动过程包在 try（尝试）里，任何一步失败都走统一的清理逻辑
    try {
      this._emitDiagnostic("runtime-initialization-started");
      // ---- 第一层：基础设施 ----
      // 主场景：相机、渲染器、灯光、天空
      this.mainScene = new MainScene(this.container);
      this._installDevCameraProbe();
      this._installDevDisposeProbe();
      this._installDevContainerSnapshotProbe();
      // 实体管理器：所有实体的登记处
      this.entityManager = new EntityManager();
      // 资产管理器：业务资产台账（设备编号、区域、在线状态）
      this.assetManager = new AssetManager();
      // 第二个资产管理器实例，专门当模型资源池用。
      // 同一个类服务两种用途，区别只在配置——这个带 idleDisposeMs
      // （闲置多久后释放显存），因为模型占显存、台账数据不占
      this.modelAssetManager = new AssetManager({
        idleDisposeMs: PORT_RENDER_RESOURCE_CONFIG.assetIdleDisposeMs,
      });
      // 帧观察器：后面所有每帧任务都注册到它
      this.frameObserver = new FrameObserver();

      // 登记模型清单（告诉资源池有哪些模型、各自的路径与目标尺寸）
      this.modelAssetManager.registerManifest(PORT_MODEL_ASSETS);
      // 并行预加载全部模型。Promise.all（等全部完成）而不是逐个 await ——
      // 串行加载十几个模型要等好几秒，并行只等最慢的那一个。
      // 这里必须 await：下面所有创建三维内容的代码都假设模型已就位
      await Promise.all(PORT_MODEL_ASSETS.map(({ id }) => this.modelAssetManager.preload(id)));
      this._emitDiagnostic("assets-loaded", { assets: this.modelAssetManager.getMetrics() });

      // ---- 第二层：世界地形 ----
      // 地面系统：它是最重要的一环，产出地面、水面、码头、道路网与堆场
      this.groundSystem = new GroundSystem(this.mainScene.scene, {
          modelAssetManager: this.modelAssetManager,
          containerAssetIds: PORT_CONTAINER_ASSET_IDS,
          // 传相机进去，地面系统内部要做距离相关的处理
          camera: this.mainScene.camera,
      });
      // create（创建）返回一大包副产物：dock（码头）、water（水面）、
      // roadSystem（道路系统）、yardSystem（堆场系统）、yards（堆场列表）等。
      // 后面十几处都要用 this.groundResult 里的东西，所以整包存下来
      this.groundResult = this.groundSystem.create();
      // 将场景生成的容器纯业务快照交给后端持久化；不传递 Three.js/ECS 对象。
      void synchronizeContainerSnapshot(
        this.groundResult.yardSystem.getBlocks().flatMap((block: LegacyRuntimeValue) => block.containers.map((record: LegacyRuntimeValue) => ({
          businessId: record.id,
          entityId: record.entity?.id ?? null,
          assetId: record.assetId,
          blockId: record.blockId,
          area: record.area,
          slot: {
            key: record.slot.key,
            row: record.slot.row,
            col: record.slot.col,
            layer: record.slot.layer,
            x: record.position.x,
            y: record.position.y,
            z: record.position.z,
          },
          location: record.location,
        }))),
      ).catch((error) => console.error("容器快照同步失败：", error));
      // 作业模型：船、拖轮等。要在地面之后建，因为船的吃水线要对齐水面高度
      this.sceneOperation = createPortOperationModels({
        modelAssetManager: this.modelAssetManager,
        scene: this.mainScene.scene,
        dock: this.groundResult.dock,
        water: this.groundResult.water,
      });

      // ---- 第三层：交互、表现与监测 ----
      // 选中系统（写 Pinia 仓库）
      this.selectionSystem = new SelectionSystem(this.entityManager);
      // 高亮系统：依赖选中系统，得知道"当前选中了谁"才知道该给谁描边
      this.highlightSystem = new HighlightSystem(
        this.mainScene.scene,
        this.selectionSystem,
      );
      // 报警系统
      this.alarmSystem = new AlarmSystem({
        assetManager: this.assetManager,
        entityManager: this.entityManager,
      });
      // 报警可视化（让出事的设备在三维里闪红光）
      this.alarmVisualSystem = new AlarmVisualSystem(this.entityManager);
      this._installDevAlarmProbe();
      // 运动系统：依赖地面系统产出的道路系统。
      // safeDistance 34 比默认 30 略大，因为本项目的车比较长，
      // 30 米的车距在视觉上显得过近
      this.motionSystem = new MotionSystem(this.entityManager, {
        roadSystem: this.groundResult.roadSystem,
        safeDistance: 34,
      });
      // 渲染系统：管渲染循环与相机。要把主场景的一整套东西都交给它
      this.renderSystem = new RenderSystem({
        scene: this.mainScene.scene,
        camera: this.mainScene.camera,
        renderer: this.mainScene.renderer,
        labelRenderer: this.mainScene.labelRenderer,
        // cruiseCurve（巡游曲线）：自动巡航模式下相机沿这条曲线飞
        cruiseCurve: this.mainScene.cruiseCurve,
        lookTarget: this.mainScene.lookTarget,
        frameObserver: this.frameObserver,
      });
      // 标签系统：三维空间中的文字标注
      this.labelSystem = new LabelSystem({
        scene: this.mainScene.scene,
        camera: this.mainScene.camera,
        labelRenderer: this.mainScene.labelRenderer,
        groundSystem: this.groundSystem,
      });
      // 性能系统：采集帧率、绘制调用、显存等
      this.performanceSystem = new PerformanceSystem({
        renderer: this.mainScene.renderer,
        onSnapshot: this.onPerformanceSnapshot,
      });
      // 性能采样器注册为 frame listener（帧监听器）而非普通任务。
      // priority 0（最高优先级）保证它在所有系统之前跑，
      // 采到的是"这一帧开始时"的干净数据，而不是被其他系统干扰过的
      this.unregisterPerformanceListener = this.frameObserver.addFrameListener({
        name: "performance-sampler",
        observer: this.performanceSystem,
        priority: 0,
      });

      // ---- 第四层：八个分组装配步骤，顺序有严格依赖 ----
      // 注册核心帧任务（运动、相机、高亮、报警等）
      this._registerCoreSystems();
      // 建箱子的批量渲染器。必须在任务系统之前——
      // 集装箱系统要拿它做 promote（提升为动态箱）
      this._createContainerRenderer();
      // 建鼠标拾取（要用到渲染器的画布元素）
      this._createInteractionSystem();
      // 建静态世界：堆场标牌、岸桥、车队
      this._createStaticWorld();
      this._emitDiagnostic("initial-entities-created", { entities: this.entityManager.getAll().length });
      // 建任务系统。必须在 _createStaticWorld 之后——
      // 派车时车队得已经存在，否则第一批任务全部因"无车可派"而暂停
      this._createTaskSystems();
      this.taskBridge = new TaskExecutionBridge({
        taskStore: useTaskStore(),
        createLocal: (type: LegacyRuntimeValue) => {
          const task = this.taskSystem?.createTask(type) ?? null;
          if (task) {
            // 浏览器测试观测真实任务启动前的箱位记录；仅开发环境发出纯数据诊断。
            const container = task.containerId
              ? this.containerSystem?.getContainer(task.containerId)
              : null;
            this._emitDiagnostic("runtime-container-task-created", {
              taskId: task.id,
              taskType: task.type,
              containerId: container?.id ?? null,
              beforeStart: container ? {
                owner: container.owner,
                state: container.state,
                hasStaticBatchBinding: Boolean(container.renderBinding),
                visibleInstances: this.containerRenderManager?.getMetrics?.().visibleInstances ?? null,
                assetRefCount: this.modelAssetManager?.get?.(container.assetId)?.refCount ?? null,
                activeLeases: this.renderResourceSystem?.getMetrics?.().activeLeases ?? null,
              } : null,
            });
            this.taskSystem.startTask(task.id);
          }
          return task;
        },
      });
      this.taskBridge.start();
      // 建空间优化（区块、LOD、视锥剔除）。放在最后是因为它要遍历
      // 已经建好的所有物体做登记
      this._createSpatialOptimization();
      // 启动后端 WebSocket 遥测数据流。
      // _startTelemetry 内部使用 mode="websocket"，不会启动前端随机遥测。
      this._startTelemetry();
      // 建叠加界面层
      this._createOverlayUI();

      this._emitDiagnostic("systems-started", { tasks: this.frameObserver.tasks.length, listeners: this.frameObserver.frameListeners.length });

      // 一切就绪，启动渲染循环，画面开始动
      this.renderSystem.start();
      // 置已启动标志
      this.started = true;
      this._emitDiagnostic("runtime-ready", { entities: this.entityManager.getAll().length });
      return this;
    } catch (error) {
      this._emitDiagnostic("runtime-initialization-failed", { message: error instanceof Error ? error.message : String(error) });
      // catch（捕获）里先清理再抛出。这一步至关重要：
      // 启动到一半失败时，已经建好的那部分（尤其是 WebGL 上下文与显存）
      // 若不清理就会永久泄漏。清理完再 throw（抛出）原始错误，
      // 保证调用方仍能看到真正的失败原因
      try {
        this.destroy();
      } catch (cleanupError) {
        // 清理错误需要可见，但不能覆盖触发初始化回滚的原始错误。
        console.error("PortRuntime cleanup after initialization failure failed:", cleanupError);
      }
      throw error;
    }
  }

  private _emitDiagnostic(name: string, detail: Record<string, unknown> = {}): void {
    if (!import.meta.env.DEV || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(name, { detail: { name, ...detail, timestamp: Date.now() } }));
  }

  // _installDevCameraProbe（开发环境相机观测缝）：只改变真实相机的位置，
  // 后续仍由 FrameObserver 的区块、LOD 与空间渲染任务正常计算。
  // 生产构建不注册这个事件，测试也不能借此直接修改 LOD 或渲染状态。
  private _installDevCameraProbe(): void {
    if (!import.meta.env.DEV || typeof window === "undefined" || this.devCameraMoveHandler) return;
    this.devCameraMoveHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ position?: { x?: number; y?: number; z?: number }; lookAt?: { x?: number; y?: number; z?: number } }>).detail;
      const position = detail?.position;
      const camera = this.mainScene?.camera;
      if (!camera || !position || ![position.x, position.y, position.z].every((value) => Number.isFinite(value))) return;
      camera.position.set(position.x as number, position.y as number, position.z as number);
      // 测试接缝期间暂停 OrbitControls 的阻尼回写，避免真实相机位置被
      // 下一帧控制器状态覆盖；区块/LOD/空间渲染任务仍照常运行。
      this.renderSystem?.controls && (this.renderSystem.controls.enabled = false);
      const lookAt = detail?.lookAt;
      if (lookAt && [lookAt.x, lookAt.y, lookAt.z].every((value) => Number.isFinite(value))) {
        camera.lookAt(lookAt.x as number, lookAt.y as number, lookAt.z as number);
      }
      camera.updateMatrixWorld(true);
    };
    window.addEventListener("runtime-test-camera", this.devCameraMoveHandler);
  }

  private _removeDevCameraProbe(): void {
    if (typeof window !== "undefined" && this.devCameraMoveHandler) {
      window.removeEventListener("runtime-test-camera", this.devCameraMoveHandler);
    }
    this.devCameraMoveHandler = null;
  }

  // _installDevDisposeProbe（开发环境销毁观测缝）：调用真实 destroy 路径，
  // 不直接修改内部状态，也不暴露 Runtime 或资源对象。
  private _installDevDisposeProbe(): void {
    if (!import.meta.env.DEV || typeof window === "undefined" || this.devDisposeHandler) return;
    this.devDisposeHandler = () => this.destroy();
    window.addEventListener("runtime-test-dispose", this.devDisposeHandler);
  }

  private _removeDevDisposeProbe(): void {
    if (typeof window !== "undefined" && this.devDisposeHandler) {
      window.removeEventListener("runtime-test-dispose", this.devDisposeHandler);
    }
    this.devDisposeHandler = null;
  }

  // 只在 Vite DEV 环境响应测试快照请求；返回业务状态和计数，不暴露 Runtime 对象。
  private _installDevContainerSnapshotProbe(): void {
    if (!import.meta.env.DEV || typeof window === "undefined" || this.devContainerSnapshotHandler) return;
    this.devContainerSnapshotHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string; taskId?: string }>).detail;
      if (!detail?.requestId || !detail.taskId || this.destroyed) return;
      const task = this.taskSystem?.store?.taskMap?.get(detail.taskId);
      const container = task?.containerId ? this.containerSystem?.getContainer(task.containerId) : null;
      const entity = container?.entity ?? null;
      const transform = entity?.getComponent?.(ComponentTypes.TRANSFORM) ?? null;
      const render = entity?.getComponent?.(ComponentTypes.RENDER) ?? null;
      const business = entity?.getComponent?.(ComponentTypes.CONTAINER) ?? null;
      const parent = transform?.wrapper?.parent ?? null;
      const asset = container?.assetId ? this.modelAssetManager?.get?.(container.assetId) : null;
      window.dispatchEvent(new CustomEvent("runtime-container-task-snapshot", {
        detail: {
          requestId: detail.requestId,
          task: task ? {
            id: task.id,
            type: task.type,
            status: task.status,
            currentStepIndex: task.currentStepIndex,
            containerId: task.containerId,
            agvId: task.agvId ?? null,
            routeError: task.routeError ?? null,
          } : null,
          container: container ? {
            id: container.id,
            assetId: container.assetId,
            owner: container.owner,
            state: container.state,
            location: container.location,
            taskId: container.taskId,
            reservedBy: container.reservedBy,
            hasStaticBatchBinding: Boolean(container.renderBinding),
            hasEntity: Boolean(entity && this.entityManager?.getById?.(container.id) === entity),
            hasTransform: Boolean(transform),
            hasRender: Boolean(render),
            hasBusinessComponent: Boolean(business && business.record === container),
            renderModelAttached: Boolean(render?.model && transform?.wrapper?.children?.includes(render.model)),
            wrapperParent: parent === this.mainScene?.scene ? "scene" : parent?.userData?.entityId ?? parent?.name ?? null,
            assetRefCount: asset?.refCount ?? null,
          } : null,
          rendering: this.containerRenderManager?.getMetrics?.() ?? null,
          resources: this.renderResourceSystem?.getMetrics?.() ?? null,
        },
      }));
    };
    window.addEventListener("runtime-test-container-snapshot", this.devContainerSnapshotHandler);
  }

  private _removeDevContainerSnapshotProbe(): void {
    if (typeof window !== "undefined" && this.devContainerSnapshotHandler) {
      window.removeEventListener("runtime-test-container-snapshot", this.devContainerSnapshotHandler);
    }
    this.devContainerSnapshotHandler = null;
  }

  // _installDevAlarmProbe（开发环境告警观测缝）：输入先进入 TelemetrySystem
  // 的 pending 缓冲，再由真实 FrameObserver 任务驱动 AlarmSystem 和视觉系统。
  // 普通运行不注册监听器，也不改变默认遥测关闭策略。
  private _installDevAlarmProbe(): void {
    if (!import.meta.env.DEV || typeof window === "undefined" || this.devAlarmHandler) return;
    this.devAlarmHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: "raise" | "clear"; assetId?: string }>).detail ?? {};
      const assets = this.assetManager?.getAll?.() ?? [];
      const asset = assets.find((item: LegacyRuntimeValue) => item.id === detail.assetId)
        ?? assets.find((item: LegacyRuntimeValue) => item.type === "AGV");
      if (!asset) return;

      this._ensureDevTelemetryTask();
      const action = detail.action === "clear" ? "clear" : "raise";
      const telemetry: TelemetryMessage = {
        assetId: asset.id,
        entityId: asset.entityId ?? null,
        channel: "mock-websocket",
        topic: "port/agv/position",
        timestamp: Date.now(),
        status: action === "raise" ? "WARNING" : "RUNNING",
        onlineStatus: "ONLINE",
        faultStatus: "NORMAL",
        currentTask: "开发环境告警集成验证",
        taskProgress: action === "raise" ? 1 : 2,
        speed: 20,
        battery: action === "raise" ? 10 : 80,
        load: "空载",
        craneException: false,
        containerConflict: false,
        alarmLevel: "NORMAL",
        alarmMessage: "无告警",
      };
      this.telemetrySystem?.injectForDevelopment(telemetry);
      this._emitDiagnostic("alarm-test-input-applied", { action, assetId: asset.id, entityId: asset.entityId ?? null });
    };
    this.devAlarmSnapshotHandler = () => {
      const alarmStore = useAlarmStore();
      const visualSnapshot = this.alarmVisualSystem?.getDiagnosticSnapshot?.() ?? null;
      this._emitDiagnostic("alarm-test-snapshot", {
        alarms: alarmStore.alarms.map((alarm: LegacyRuntimeValue) => ({ id: alarm.id, type: alarm.type, severity: alarm.severity, assetId: alarm.assetId, entityId: alarm.entityId ?? null, status: alarm.status, closedAt: alarm.closedAt ?? null })),
        activeAlarms: alarmStore.activeAlarms.map((alarm: LegacyRuntimeValue) => ({ id: alarm.id, type: alarm.type, severity: alarm.severity, assetId: alarm.assetId, entityId: alarm.entityId ?? null, status: alarm.status })),
        visual: visualSnapshot,
      });
    };
    window.addEventListener("runtime-test-alarm", this.devAlarmHandler);
    window.addEventListener("runtime-test-alarm-snapshot", this.devAlarmSnapshotHandler);
  }

  private _ensureDevTelemetryTask(): void {
    if (this.telemetrySystem) return;
    this.telemetrySystem = new TelemetrySystem({
      assetManager: this.assetManager,
      entityManager: this.entityManager,
      mode: "websocket",
      interval: 100,
    });
    this._registerUpdateTask("telemetry", this.telemetrySystem, {
      interval: 100,
      priority: 4,
    });
  }

  private _removeDevAlarmProbe(): void {
    if (typeof window !== "undefined") {
      if (this.devAlarmHandler) window.removeEventListener("runtime-test-alarm", this.devAlarmHandler);
      if (this.devAlarmSnapshotHandler) window.removeEventListener("runtime-test-alarm-snapshot", this.devAlarmSnapshotHandler);
    }
    this.devAlarmHandler = null;
    this.devAlarmSnapshotHandler = null;
  }

  // destroy（销毁）：把所有资源与监听全部拆掉。
  // 【整个方法通篇都是 ?. （可选链）】这不是保守，而是必需——
  // 它同时被"正常卸载"与"启动失败回滚"两条路径调用，
  // 后者进来时半数属性还是 undefined，不用 ?. 就会在清理途中再抛一次错，
  // 导致后面的清理全被跳过
  destroy() {
    // 幂等保护：销毁过就不再重复
    if (this.destroyed) return;
    // 先置标志再清理。顺序很重要——清理过程中可能触发某些回调
    // 反过来调用本类的方法，标志已置位才能挡住它们
    this.destroyed = true;
    this._emitDiagnostic("runtime-disposal-started");
    this._removeDevCameraProbe();
    this._removeDevDisposeProbe();
    this._removeDevAlarmProbe();
    this._removeDevContainerSnapshotProbe();

    // 【清理顺序的原则：先掐断输入源，再拆内部结构】
    // 解绑鼠标事件（否则卸载后点击画布还会触发回调）
    this.pickSystem?.destroy();
    // 停掉遥测数据流（断开模拟长连接）
    this.telemetrySystem?.stop();
    this.taskBridge?.stop();
    // 拆界面层 DOM 与其事件
    this.uiSystem?.destroy();
    // 停掉渲染循环。这一步之后不再有任何 requestAnimationFrame 回调，
    // 下面拆结构才安全——若循环还在跑，会访问到已被释放的对象
    this.renderSystem?.stop();

    // 逐个退订性能指标提供者。每个都是注册时返回的闭包，
    // 不调用的话性能系统会一直持有各系统的引用，整张对象图都无法被回收
    this.unregisterContainerMetrics?.();
    this.unregisterChunkMetrics?.();
    this.unregisterLodMetrics?.();
    this.unregisterSpatialRenderMetrics?.();
    this.unregisterRenderResourceMetrics?.();
    this.unregisterModelAssetMetrics?.();
    this.unregisterPerformanceListener?.();
    // 释放性能系统自己的资源
    this.performanceSystem?.dispose();

    // 释放五个渲染适配器持有的显存资源
    this.roadRenderAdapter?.dispose();
    this.craneRenderAdapter?.dispose();
    this.shipRenderAdapter?.dispose();
    this.agvRenderAdapter?.dispose();
    // 集装箱这里要分情况：适配器存在时由它统一释放（它内部会调管理器的
    // dispose）；适配器没建成功（启动中途失败）就直接释放管理器。
    // 写成 if/else 是为了避免双重释放——两个都调会导致 WebGL 报
    // "已删除的缓冲区"错误
    if (this.containerRenderAdapter) this.containerRenderAdapter.dispose();
    else this.containerRenderManager?.dispose();

    // 释放共享的几何体与材质池
    this.renderResourceSystem?.dispose();
    // 清空空间渲染系统的登记
    this.spatialRenderSystem?.clear();
    // 清空 LOD 状态
    this.lodSystem?.clear();
    // 清空区块登记
    this.chunkSystem?.clear();
    // 清空实体的空间登记表
    this.spatialEntityRegistrations?.clear();
    // 清空所有帧任务
    this.frameObserver?.clear();
    // GroundSystem 拥有水面、码头、浮标和标签等环境节点；在移除主场景前先释放它们。
    this.groundSystem?.destroy();
    // 拆主场景（释放 WebGL 上下文、移除画布、解绑窗口 resize 事件）
    this.mainScene?.destroy();
    // 最后清空模型资源池，释放所有几何体与贴图显存。
    // 放在最后是因为上面那些 dispose 可能还要访问池里的资源
    this.modelAssetManager?.clear();

    // 复位启动标志
    this.started = false;
    this._emitDiagnostic("runtime-disposed", {
      canvasPresent: Boolean(this.container.querySelector("canvas")),
      activeFrameTasks: this.frameObserver?.tasks?.length ?? 0,
    });
  }

  // ==========================================================================
  // 以下四个是对外的公共接口，供 Vue 组件调用。
  // 它们构成 facade（门面）：界面层只认这几个方法，不需要知道内部有多少系统
  // ==========================================================================

  // focusAsset（聚焦到某个资产）：界面点击资产列表时调用
  focusAsset(assetId: string) {
    // 遍历所有实体，找 asset.id 匹配的那个。
    // 这是线性查找 O(n)，资产上万时会慢——但这个方法只在用户点击时触发，
    // 一次几毫秒完全无感，为它建一张索引表反而增加维护成本
    const entity = this.entityManager?.getAll().find(
      (candidate: LegacyRuntimeValue) => candidate.asset?.id === assetId,
    );
    // 找不到就返回 false，让界面提示"该设备当前不在场景中"
    // （可能已被流式卸载）
    if (!entity) return false;

    // 选中它（右侧面板显示详情）
    this.selectionSystem.select(entity);
    // 镜头飞过去
    this.renderSystem.focusOnEntity(entity);
    return true;
  }

  focusDeviceEntity(entityId: string) {
    const entity = this.entityManager?.getById(entityId);
    if (!entity) return false;
    this.selectionSystem.select(entity);
    this.renderSystem.focusOnEntity(entity);
    return true;
  }

  // startTask（启动指定任务）
  startTask(taskId: string) {
    // ?? false：任务系统还没建好时返回 false 而不是 undefined，
    // 让界面的返回值判断统一
    return this.taskSystem?.startTask(taskId) ?? false;
  }

  // startAllTasks（启动全部等待中的任务）
  startAllTasks() {
    return this.taskSystem?.startAll() ?? false;
  }

  // createTask（新建并立即启动一个任务）：界面上"下发任务"按钮调用
  createTask(type: LegacyRuntimeValue) {
    if (this.taskBridge) return this.taskBridge.createAndStart(type);
    const task = this.taskSystem?.createTask(type) ?? null;
    // 建完立刻启动。TaskSystem 把建与启分开是为了支持"先排队后执行"，
    // 但界面上这个按钮的语义是"马上派一单"，所以在这里合并成一步
    if (task) this.taskSystem.startTask(task.id);
    return task;
  }

  // ==========================================================================
  // 以下是内部装配方法
  // ==========================================================================

  // _registerCoreSystems（内部方法：注册核心帧任务）
  // 【怎么读这段】每个任务有三个关键参数：
  //   priority（优先级）：数字越小越先执行，同帧内的执行次序
  //   interval（间隔毫秒）：0 表示每帧都跑，其余表示节流
  //   update（自定义更新函数）：不传就用系统自己的 update 方法
  // 节流是本项目最主要的性能手段——不是所有东西都需要 60 次/秒
  _registerCoreSystems() {
    // 运动：每帧必跑（interval 默认 0），优先级 1。
    // 车的位置必须每帧更新，否则移动会一顿一顿
    this._registerUpdateTask("motion", this.motionSystem, { priority: 1 });
    // 相机：每帧跑，优先级 2（排在运动之后）。
    // 顺序有意义——相机跟随的目标是车，车先动完相机再跟，否则会差一帧
    this._registerUpdateTask("camera", this.renderSystem, {
      priority: 2,
      // 传自定义 update：因为要调的是 updateCamera 而不是 update，
      // 后者是整个渲染循环、不能在这里触发
      update: (deltaTime: number) => this.renderSystem.updateCamera(deltaTime),
    });
    // 地面动画（水面波纹）：每帧跑，优先级 3
    this._registerUpdateTask("ground-animation", this.groundSystem, { priority: 3 });
    // 高亮：50 毫秒一次（20 次/秒）。选中框的呼吸效果不需要 60 帧，
    // 人眼看不出 20 与 60 的区别，省下的三分之二开销很实在
    this._registerUpdateTask("highlight", this.highlightSystem, {
      interval: 50,
      priority: 3,
    });
    // 报警可视化：100 毫秒一次。红光闪烁频率本来就低
    this._registerUpdateTask("alarm-visual", this.alarmVisualSystem, {
      interval: 100,
      priority: 4,
    });
    // 报警扫描：500 毫秒一次，优先级 8（靠后）。
    // 它要遍历所有资产跑六条规则，是个重活；而故障晚半秒发现毫无影响，
    // 所以节流到 2 次/秒。这是"重任务 + 低实时性 = 大间隔"的典型
    this._registerUpdateTask("alarm-scan", this.alarmSystem, {
      interval: 500,
      priority: 8,
    });
    // 实体状态同步：把实体变化通知给 Vue 界面。
    // 这里传的是一个匿名对象而非某个系统——当逻辑只有一行时，
    // 没必要为它专门建一个类
    this._registerUpdateTask("entity-state-sync", {
      update: () => this.entityManager.notifyUpdated(),
    }, {
      // 100 毫秒一次：界面刷新 10 次/秒已经足够流畅，
      // 而每次通知都会触发 Vue 的响应式重算，频率高了会拖慢界面
      interval: 100,
      priority: 2,
    });
    // 标签位置更新：50 毫秒一次
    this._registerUpdateTask("labels", this.labelSystem, {
      interval: 50,
      priority: 3,
    });
    // 性能数据发布：1000 毫秒一次。采样是每帧做的（frame listener），
    // 但汇总发布给界面只需每秒一次
    this._registerUpdateTask("performance-publish", this.performanceSystem, {
      interval: 1000,
      priority: 10,
    });
    // 模型资源垃圾回收：每秒扫一次，释放长时间没用的模型显存。
    // 优先级 9 排在很后面，因为它可能触发显存释放这种重操作，
    // 让它在所有渲染相关的工作完成之后再做
    this._registerUpdateTask("model-asset-gc", {
      update: () => this.modelAssetManager.sweep(),
    }, {
      interval: 1000,
      priority: 9,
    });
  }

  // _createContainerRenderer（内部方法：建集装箱批量渲染器）
  _createContainerRenderer() {
    // 渲染资源系统：几何体与材质的共享池。
    // 上万个箱子若各自持有一份几何体，显存瞬间爆掉；共享后只占一份
    this.renderResourceSystem = new RenderResourceSystem(PORT_RENDER_RESOURCE_CONFIG);
    // 集装箱渲染管理器：用 instancing（实例化渲染）批量画箱子
    this.containerRenderManager = new ContainerRenderManager({
      scene: this.mainScene.scene,
      modelAssetManager: this.modelAssetManager,
      // 共用上面那个资源池
      resourcePool: this.renderResourceSystem.pool,
    });
    // 用堆场系统的箱区数据初始化批次。
    // 必须传箱区（block）而不是单个箱子——同一个箱区的箱子共用一个批次，
    // 这是分批的依据
    this.containerRenderManager.initialize(this.groundResult.yardSystem.getBlocks());
    // 把箱子的统计数据登记给性能系统。传的是箭头函数而非当下的数值——
    // 这叫 lazy evaluation（惰性求值），性能系统采样时才调用，
    // 拿到的永远是最新数据
    this.unregisterContainerMetrics = this.performanceSystem.registerMetricProvider(
      "containers",
      () => this.containerRenderManager.getMetrics(),
    );
  }

  // _createInteractionSystem（内部方法：建鼠标拾取）
  _createInteractionSystem() {
    // 拾取系统需要相机（发射线）与画布元素（监听点击）
    this.pickSystem = new PickSystem(
      this.mainScene.camera,
      // renderer.domElement 就是那个 <canvas> 画布
      this.mainScene.renderer.domElement,
      this.entityManager,
    );
    // 把拾取结果接到选中系统上。这一行就是"点三维物体 → 右侧面板显示详情"
    // 这条链路的全部粘合代码。entity 为 null 时 select 内部会处理为取消选中
    this.pickSystem.onPick((entity: LegacyRuntimeValue) => this.selectionSystem.select(entity));
  }

  // _createStaticWorld（内部方法：建静态世界内容）
  _createStaticWorld() {
    // 堆场标牌等静态资产
    createStaticAssets({
      assetManager: this.assetManager,
      entityManager: this.entityManager,
      scene: this.mainScene.scene,
      yards: this.groundResult.yards,
    });
    // 岸桥。要传 dock（码头）进去，因为岸桥必须精确停靠在码头边缘的轨道上
    createQuayCranes({
      modelAssetManager: this.modelAssetManager,
      assetManager: this.assetManager,
      entityManager: this.entityManager,
      scene: this.mainScene.scene,
      dock: this.groundResult.dock,
    });
    // 车队。要传道路与车道编号，车一出生就落在环线上开始巡航
    createAGVs({
      modelAssetManager: this.modelAssetManager,
      assetManager: this.assetManager,
      entityManager: this.entityManager,
      scene: this.mainScene.scene,
      roadSystem: this.groundResult.roadSystem,
      roadId: this.groundResult.agvRoadId,
      laneId: this.groundResult.agvLaneId,
    });
  }

  // _createTaskSystems（内部方法：建任务相关的四个系统）
  _createTaskSystems() {
    // 设备管理器：用 const 局部变量而非 this.xxx，因为只有任务系统需要它，
    // 不必挂到实例上暴露给外界
    const equipmentManager = new EquipmentManager(this.entityManager);
    // 岸桥系统
    this.quayCraneSystem = new QuayCraneSystem({
      entityManager: this.entityManager,
    });
    // 注册为每帧任务，优先级 1（与运动同级）。
    // 岸桥的机械动作也需要每帧推进，否则吊具升降会卡顿
    this._registerUpdateTask("quay-crane", this.quayCraneSystem, { priority: 1 });

    // 集装箱系统
    this.containerSystem = new ContainerSystem({
      scene: this.mainScene.scene,
      entityManager: this.entityManager,
      yardSystem: this.groundResult.yardSystem,
      modelAssetManager: this.modelAssetManager,
      containerRenderManager: this.containerRenderManager,
    });
    // 车辆系统（只是状态管理，不需要每帧更新，所以不注册帧任务）
    this.agvSystem = new AGVSystem({
      entityManager: this.entityManager,
      motionSystem: this.motionSystem,
    });
    // 在船上放一个待卸的箱子，好让卸船任务有活可干
    const shipContainer = createShipOperationContainer({
      modelAssetManager: this.modelAssetManager,
      entityManager: this.entityManager,
      scene: this.mainScene.scene,
      ship: this.sceneOperation.ship,
    });
    // 登记给岸桥系统，它才知道船上有箱子可卸
    this.quayCraneSystem.registerShipContainer(shipContainer);
    // 任务系统：把上面所有系统汇聚起来。它是依赖最多的一个，
    // 也正是为什么它必须最后创建
    this.taskSystem = new TaskSystem({
      containerSystem: this.containerSystem,
      agvSystem: this.agvSystem,
      motionSystem: this.motionSystem,
      // 路径管理器在这里就地 new。它是任务系统的私有工具，
      // 别处不用，没必要挂到 this 上
      pathManager: new PathManager({
        roadSystem: this.groundResult.roadSystem,
        yardRoadNetwork: this.groundResult.roadNetwork,
      }),
      equipmentManager,
      quayCraneSystem: this.quayCraneSystem,
    });
    // 铺四个初始任务，让画面一开始就有车在跑
    // 初始四条任务是纯本地演示数据，现阶段任务列表以 PostgreSQL 的 /api/tasks 为准。
    // this.taskSystem.createInitialTasks();
  }

  // _startTelemetry（内部方法：启动遥测数据流）
  _startTelemetry() {
    this.telemetrySystem = new TelemetrySystem({
      assetManager: this.assetManager,
      entityManager: this.entityManager,
      // mock-websocket（模拟长连接）：生成随机数据。
      // 接真实数据源时只改这个字符串，其余代码一行不用动
      mode: "websocket",
      // 100 毫秒推一条（10 次/秒），比真实项目频繁，为了让演示画面更活跃
      interval: 100,
    });
    // 启动数据流（开始往缓冲里塞数据）
    this.telemetrySystem.start();
    // 注册帧任务，把缓冲里的数据应用到场景。
    // interval 与推送间隔一致（都是 100），刚好一帧处理一条，
    // 既不积压也不空转
    this._registerUpdateTask("telemetry", this.telemetrySystem, {
      interval: 100,
      priority: 4,
    });
  }

  // _createSpatialOptimization（内部方法：建空间优化体系）
  // 【这是全文件最长的一段，它解决的是"上万个物体怎么才不卡"】
  // 三层机制叠加：
  //   ChunkSystem（区块）：把场地切成 160 米一格，远处的整格不加载
  //   LODSystem（细节层级）：加载了的物体，远的用低模、近的用高模
  //   SpatialRenderSystem（空间渲染）：把上面两层的决策真正执行下去，
  //     通过 adapter（适配器）对不同类型物体做各自的显隐操作
  // 再加上 frustum culling（视锥剔除）：画面外的区块直接跳过
  _createSpatialOptimization() {
    // 区块系统
    this.chunkSystem = new ChunkSystem(PORT_CHUNK_CONFIG);
    // 细节层级系统
    this.lodSystem = new LODSystem(PORT_LOD_CONFIG);
    // 空间渲染系统，依赖 LOD 系统的决策结果
    this.spatialRenderSystem = new SpatialRenderSystem({ lodSystem: this.lodSystem });
    // 视锥体与投影矩阵：在构造阶段建好长期复用，
    // 而不是每次判断可见性时新建——这两个对象都不小
    this.spatialFrustum = new THREE.Frustum();
    this.spatialProjectionMatrix = new THREE.Matrix4();
    // 五个适配器。它们是 adapter pattern（适配器模式）的教科书用例：
    // 箱子要改实例化矩阵、道路要换几何体、吊机要切低模、船要换材质……
    // 操作方式完全不同，但空间渲染系统只想调统一的 show/hide/setLod。
    // 适配器把这些差异各自封装起来
    this.containerRenderAdapter = new ContainerRenderAdapter(this.containerRenderManager);
    // 共享的资源池，五个适配器都要用
    const resourcePool = this.renderResourceSystem.pool;
    this.roadRenderAdapter = new RoadRenderAdapter({
      scene: this.mainScene.scene,
      resourcePool,
    });
    // 吊机与车辆的适配器要认识选中系统——被选中的物体不能被降级成低模，
    // 否则用户正看着的东西突然变粗糙
    this.craneRenderAdapter = new CraneRenderAdapter({
      selectionSystem: this.selectionSystem,
      resourcePool,
    });
    this.shipRenderAdapter = new ShipRenderAdapter({ resourcePool });
    this.agvRenderAdapter = new AGVRenderAdapter({
      selectionSystem: this.selectionSystem,
      resourcePool,
    });
    // 按 renderType（渲染类型）字符串登记。后面登记物体时带上这个字符串，
    // 空间渲染系统就知道该找哪个适配器处理
    this.spatialRenderSystem.registerAdapter("container", this.containerRenderAdapter);
    this.spatialRenderSystem.registerAdapter("road", this.roadRenderAdapter);
    this.spatialRenderSystem.registerAdapter("crane", this.craneRenderAdapter);
    this.spatialRenderSystem.registerAdapter("ship", this.shipRenderAdapter);
    this.spatialRenderSystem.registerAdapter("agv", this.agvRenderAdapter);
    // spatialEntityRegistrations（实体空间登记表）：实体编号 -> 退订函数。
    // 实体会动态增删（箱子出库、车辆卸载），要能对应地登记与注销
    this.spatialEntityRegistrations = new Map();

    // ---- 登记堆场：箱区与箱子两个粒度 ----
    this.groundResult.yardSystem.getBlocks().forEach((block: LegacyRuntimeValue) => {
      // 先登记整个箱区。粗粒度的意义是：整个箱区都在远处时，
      // 一次判断就能跳过里面所有箱子
      this.chunkSystem.register({
        id: `yard-block:${block.blockId}`,
        bounds: block.bounds,
        data: block,
      });
      // 再逐个登记箱子
      block.containers.forEach((record: LegacyRuntimeValue) => {
        // 用"退化包围盒"——最小点与最大点都是同一个坐标，即一个点。
        // 为什么不用箱子的真实包围盒？因为区块归属只需要判断"它在哪一格"，
        // 用中心点就够了，而算真实包围盒要遍历几何体顶点，上万个箱子太慢。
        // 两次 clone（克隆）是必需的：Box3 内部会分别持有这两个向量，
        // 传同一个对象进去会让 min 与 max 变成同一个引用，
        // 之后任何一方被修改都会连带改掉另一方
        const pointBounds = new THREE.Box3(record.position.clone(), record.position.clone());
        this.chunkSystem.register({
          id: `container:${record.id}`,
          bounds: pointBounds,
          renderType: "container",
          data: record,
        });
      });
    });
    // ---- 登记道路：按渲染分段 ----
    this.groundResult.roadSystem.getRenderSegments().forEach((segment: LegacyRuntimeValue) => {
      this._registerSpatialOwner({
        id: `road:${segment.id}`,
        object: segment.object,
        renderType: "road",
        data: segment,
      });
    });
    // ---- 登记船 ----
    const ship = this.sceneOperation.ship;
    this._registerSpatialOwner({
      id: "world:ship",
      object: ship,
      renderType: "ship",
      data: {
        // 名字可能为空，用 || 兜底一个默认编号
        id: ship.name || "SHIP_01",
        wrapper: ship,
        // detail（高模节点）：优先用建模时标记的那个，
        // 没有就退回第一个子节点
        detail: ship.userData.renderObject ?? ship.children[0],
      },
    });
    // 首次同步一遍实体登记（把已存在的车、吊机都登记进区块系统）
    this._syncSpatialEntityHandles();

    // ---- 注册三个空间优化帧任务，注意优先级是精心排过的小数 ----
    // 区块更新：优先级 4
    this._registerUpdateTask("chunk-spatial", {
      // 形参 _deltaTime 前面的下划线是约定俗成的标记，表示"这个参数用不到"，
      // 既能满足位置参数的顺序要求，又能让 lint 不报未使用变量
      update: (_deltaTime: number, elapsedTime: number) => {
        // 每次先同步实体登记，因为车辆与箱子可能刚被创建或销毁
        this._syncSpatialEntityHandles();
        const camera = this.mainScene.camera;
        // 强制刷新相机的世界矩阵。必须显式调用——
        // Three.js 只在渲染时才自动更新矩阵，而这个任务跑在渲染之前，
        // 不刷新就会用上一帧的相机位置做剔除，快速转动视角时边缘会闪
        camera.updateMatrixWorld();
        // 算出 projection × viewInverse，即"世界坐标 → 裁剪坐标"的完整变换。
        // 矩阵乘法顺序不能颠倒，反了得到的视锥完全错位
        this.spatialProjectionMatrix.multiplyMatrices(
          camera.projectionMatrix,
          camera.matrixWorldInverse,
        );
        // 由这个矩阵解出视锥体的六个平面
        this.spatialFrustum.setFromProjectionMatrix(this.spatialProjectionMatrix);
        // 更新区块：传相机位置（算距离）、时间戳、以及可见性判定函数
        this.chunkSystem.update(camera.position, elapsedTime * 1000, {
          // isVisible（是否可见）以回调形式传入，是为了让区块系统
          // 不必依赖 Three.js —— 它只负责"什么时候问"，
          // 怎么判断由调用方决定。这样区块系统可以单独做单元测试
          isVisible: (chunk: LegacyRuntimeValue) => this.spatialFrustum.intersectsBox(chunk.bounds),
        });
      },
    }, {
      // 100 毫秒一次。区块加载卸载是重操作，而且相机在 100 毫秒内
      // 移动不了多远，没必要每帧算
      interval: 100,
      priority: 4,
    });
    // LOD 决策：优先级 4.5 —— 用小数插在 4 与 4.75 之间。
    // 这三个任务必须严格按 区块 → LOD → 渲染执行 的顺序跑：
    // LOD 只处理"当前激活的区块"，渲染只执行 LOD 的决策，
    // 顺序错了就会用上一帧的数据，物体的显隐会延迟一帧
    this._registerUpdateTask("lod-policy", {
      update: (_deltaTime: number, elapsedTime: number) => {
        this.lodSystem.update({
          cameraPosition: this.mainScene.camera.position,
          // 只看激活区块，这是分层优化的精髓——
          // 已经被区块系统排除的东西，LOD 连看一眼都不用
          activeChunks: this.chunkSystem.getActiveChunks(),
          // elapsedTime 是秒，乘 1000 换成毫秒。
          // LOD 内部的时间防抖用毫秒，单位必须对齐
          timestamp: elapsedTime * 1000,
        });
      },
    }, {
      interval: 100,
      priority: 4.5,
    });
    // 空间渲染执行：优先级 4.75，三者中最后
    this._registerUpdateTask("spatial-render", {
      update: (_deltaTime: number, elapsedTime: number) => {
        this.spatialRenderSystem.update();
        this.spatialDiagnosticFrame += 1;
        if (this.spatialDiagnosticFrame % 3 !== 0) return;
        const camera = this.mainScene.camera;
        this._emitDiagnostic("spatial-render-snapshot", {
          camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          chunks: this.chunkSystem.getMetrics(),
          lod: this.lodSystem.getMetrics(),
          spatialRender: this.spatialRenderSystem.getMetrics(),
          road: this.roadRenderAdapter?.getMetrics?.() ?? null,
          containers: this.containerRenderManager?.getMetrics?.() ?? null,
          renderer: {
            calls: this.mainScene.renderer.info.render.calls,
            triangles: this.mainScene.renderer.info.render.triangles,
            points: this.mainScene.renderer.info.render.points,
          },
          elapsedTime,
        });
      },
    }, {
      interval: 100,
      priority: 4.75,
    });
    // 渲染资源回收：每秒一次，把没人用的几何体与材质释放掉
    this._registerUpdateTask("render-resource-gc", this.renderResourceSystem, {
      interval: 1000,
      priority: 5,
    });

    // ---- 五个性能指标提供者，全部用惰性回调登记 ----
    // 区块指标（激活数、加载数）
    this.unregisterChunkMetrics = this.performanceSystem.registerMetricProvider(
      "chunks",
      () => this.chunkSystem.getMetrics(),
    );
    // LOD 指标（各层级各有多少物体）
    this.unregisterLodMetrics = this.performanceSystem.registerMetricProvider(
      "lod",
      () => this.lodSystem.getMetrics(),
    );
    // 空间渲染指标（本轮改了多少物体的显隐）
    this.unregisterSpatialRenderMetrics = this.performanceSystem.registerMetricProvider(
      "spatialRender",
      () => this.spatialRenderSystem.getMetrics(),
    );
    // 渲染资源指标（池里有多少几何体与材质）
    this.unregisterRenderResourceMetrics = this.performanceSystem.registerMetricProvider(
      "renderResources",
      () => this.renderResourceSystem.getMetrics(),
    );
    // 模型资源指标（借出多少、闲置多少）
    this.unregisterModelAssetMetrics = this.performanceSystem.registerMetricProvider(
      "modelAssets",
      () => this.modelAssetManager.getMetrics(),
    );
    this.qualityController = new QualityController({
      renderer: this.mainScene.renderer,
      composer: this.renderSystem.composer,
      renderSystem: this.renderSystem,
      lodSystem: this.lodSystem,
      pixelRatioOverride: this.qualityPixelRatio,
    } as LegacyRuntimeValue);
    this.adaptiveQualitySystem = new AdaptiveQualitySystem({
      performanceSystem: this.performanceSystem,
      qualityController: this.qualityController,
      config: { enabled: false },
    });
    this.unregisterQualityMetrics = this.performanceSystem.registerMetricProvider("quality", () => this.adaptiveQualitySystem.level);
    this.performanceSystem.registerMetricProvider("adaptiveQuality", () => this.adaptiveQualitySystem.getMetrics());
    this._registerUpdateTask("adaptive-quality", this.adaptiveQualitySystem, { interval: 1000, priority: 5.5 });
  }

  // _registerSpatialOwner（内部方法：把一个三维物体登记进区块系统）
  //   id（登记编号）、object（三维物体）、renderType（渲染类型）
  //   data（附带数据，默认就是物体本身）、dynamic（是否会移动）
  _registerSpatialOwner({ id, object, renderType = null, data = object, dynamic = false }: SpatialOwnerOptions) {
    // 先强制刷新世界矩阵，参数 true 表示连子节点一起刷。
    // 双 ?. 是因为 object 可能为空、也可能不是 Object3D（没这个方法）。
    // 不刷新的话下一行算出的包围盒会用陈旧的变换，位置全错
    object?.updateMatrixWorld?.(true);
    // 不是三维物体就登记不了
    if (!object?.isObject3D) return false;
    // 算出物体的真实包围盒
    const objectBounds = new THREE.Box3().setFromObject(object);
    // 空包围盒说明这个物体没有任何可见几何体（比如只是个空的分组节点），
    // 登记它毫无意义，还会让区块系统里多一条永远不可见的记录
    if (objectBounds.isEmpty()) return false;
    // staticOwner（静态物体的中心点）：只算一次，之后一直用。
    // 静态物体不会动，每次都重算包围盒纯属浪费
    const staticOwner = objectBounds.getCenter(new THREE.Vector3());
    // getBounds（取包围盒的函数）：动态物体每次读实时位置，静态物体用缓存的中心点。
    // 返回的是"点包围盒"（min 与 max 同值），理由同前——
    // 区块归属只需要一个代表点
    const getBounds = () => {
      const position = dynamic
        ? object.getWorldPosition(new THREE.Vector3())
        : staticOwner;
      return new THREE.Box3(position.clone(), position.clone());
    };
    // 登记
    this.chunkSystem.register({
      id,
      // 初始包围盒
      bounds: getBounds(),
      // getBounds 只给动态物体传。静态物体传 null，
      // 区块系统看到 null 就知道"这个不用每次重算"，直接省掉一次函数调用。
      // 上万个静态物体累积起来，这个省法很可观
      getBounds: dynamic ? getBounds : null,
      dynamic,
      renderType,
      data,
    });
    return true;
  }

  // _syncSpatialEntityHandles（内部方法：同步实体的空间登记）
  // 【为什么需要"同步"而不是一次性登记】
  // 实体是动态的：箱子出库时新建、送达后可能销毁、车辆被流式卸载。
  // 所以每隔 100 毫秒做一次双向对齐：新出现的登记进去、已消失的注销掉。
  // 这种模式叫 reconciliation（对账）
  _syncSpatialEntityHandles() {
    // currentIds（本轮存在的实体编号集合）：用来找出"已消失"的
    const currentIds = new Set();
    // ---- 正向：遍历当前实体，把没登记过的登记上 ----
      this.entityManager.getAll().forEach((entity: LegacyRuntimeValue) => {
      currentIds.add(entity.id);
      // 已登记过就跳过。这个判断让本方法可以高频调用而几乎零开销——
      // 稳定状态下所有实体都已登记，每次只是走一遍 Set 判断
      if (this.spatialEntityRegistrations.has(entity.id)) return;

      const transform = entity.getComponent(ComponentTypes.TRANSFORM);
      // 没有包围盒或包围盒为空：模型可能还没加载完。
      // 这里直接 return 而不登记，下一轮（100 毫秒后）会再试一次，
      // 相当于自带重试机制
      if (!transform?.bbox || transform.bbox.isEmpty()) return;
      // 判断渲染类型（吊机 / 车辆 / 其他）
      const renderType = this._getEntityRenderType(entity);
      // 有 MOTION（运动）组件的就是会动的
      const dynamic = entity.hasComponent(ComponentTypes.MOTION);
      // 点包围盒生成函数，同 _registerSpatialOwner 里的思路
      const getOwnerBounds = () => {
        const position = transform.getWorldPosition();
        return new THREE.Box3(position.clone(), position.clone());
      };
      // 登记，并接住返回的退订函数
      const unregister = this.chunkSystem.register({
        id: `entity:${entity.id}`,
        // 有 renderType 的用点包围盒，没有的用真实包围盒。
        // 差别在于：有渲染类型的物体（吊机、车）由适配器负责显隐，
        // 区块系统只需知道它大致在哪一格；
        // 没有渲染类型的物体靠包围盒做精确的视锥剔除，需要真实尺寸
        bounds: renderType ? getOwnerBounds() : transform.bbox,
        dynamic,
        // 动态物体的实时包围盒获取函数。这里嵌套了一层判断：
        // 有渲染类型的仍用点；没有的要先 updateBBox（重算包围盒）
        // 再返回——因为物体动了，缓存的盒子已经过期
        getBounds: dynamic ? () => {
          if (renderType) return getOwnerBounds();
          transform.updateBBox();
          return transform.bbox;
        } : null,
        renderType,
        data: entity,
      });
      // 存起退订函数，销毁时或实体消失时要用
      this.spatialEntityRegistrations.set(entity.id, unregister);
    });

    // ---- 反向：遍历登记表，注销已经不存在的实体 ----
    this.spatialEntityRegistrations.forEach((unregister, entityId) => {
      // 还在就跳过
      if (currentIds.has(entityId)) return;
      // 已消失：调用退订函数从区块系统摘掉
      unregister();
      // 从登记表里删除。这一步是防泄漏的关键——
      // 少了它，登记表会随着箱子的出库入库无限膨胀，
      // 每个条目都通过闭包持有一个已销毁的实体，整张对象图都回收不掉
      this.spatialEntityRegistrations.delete(entityId);
    });
  }

  // _getEntityRenderType（内部方法：判断实体该用哪个渲染适配器）
  _getEntityRenderType(entity: LegacyRuntimeValue): string | null {
    // 吊机
    if (entity.type === "CRANE") return "crane";
    // 车辆
    if (entity.type === "AGV") return "agv";
    // 其余返回 null（空），表示"不走适配器，用通用的包围盒剔除"
    return null;
  }

  // _createOverlayUI（内部方法：建叠加在画布上的原生界面层）
  _createOverlayUI() {
    this.uiSystem = new UISystem({
      // 挂到与画布同一个容器里
      mount: this.container,
      selectionSystem: this.selectionSystem,
      // 巡航开关的回调：界面按钮点了之后转给渲染系统
      onToggleCruise: (enabled: boolean) => this.renderSystem.setCruising(enabled),
      // stats（统计数字）：显示在角落的概览面板上
      stats: {
        // 资产总数从管理器实时取
        assets: this.assetManager.getAll().length,
        // 吊机与车辆数量写死。这里是个已知的小瑕疵——
        // 数字与 PortEquipmentBuilder 里实际创建的数量是两处独立维护的，
        // 改了建造数量却忘了改这里，面板就会显示错。
        // 更好的做法是从 equipmentManager 实时查
        cranes: 3,
        agvs: 5,
        // 堆场数与箱子总数从地面系统的产出里取，这两个是准的
        yards: this.groundResult.yards.length,
        containers: this.groundResult.containerCount,
      },
    });
    // 界面每 100 毫秒刷一次，优先级 6（在业务系统之后）
    this._registerUpdateTask("overlay-ui", this.uiSystem, {
      interval: 100,
      priority: 6,
    });
  }

  // _registerUpdateTask（内部方法：注册帧任务的统一入口）
  // 本文件里注册了十几个任务，全部经由这一个方法。集中的好处是
  // 参数默认值、错误检查、绑定逻辑只写一遍
  _registerUpdateTask(name: string, system: LegacyRuntimeValue, { interval = 0, priority = 0, update = null }: UpdateTaskOptions = {}) {
    // 优先用显式传入的 update，否则取系统自己的 update 方法。
    // bind（绑定 this）不能省——把 system.update 直接取出来会丢掉 this，
    // 方法内部访问 this.xxx 就会报 undefined。这是 JS 里最经典的坑之一
    const callback = update ?? system?.update?.bind(system);
    // fail fast（快速失败）：拿不到可调用的函数就当场抛错，
    // 并在错误信息里带上任务名。
    // 若放任它注册进去，运行时才会在帧循环深处报 "callback is not a function"，
    // 那时根本看不出是哪个任务写错了。启动时报错、带名字，定位成本天差地别
    if (typeof callback !== "function") {
      throw new Error(`Frame task "${name}" requires a system update method.`);
    }

    // 交给帧观察器统一调度
    this.frameObserver.addTask({
      name,
      interval,
      priority,
      update: callback,
    });
  }
}
